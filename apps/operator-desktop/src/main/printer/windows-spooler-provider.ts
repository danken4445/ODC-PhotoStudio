import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PrintProfile } from '@odc-photostudio/contracts';
import { applyPrintImposition } from '@odc-photostudio/template-engine';
import type {
  IPrinterProvider,
  PrinterDeviceDescriptor,
  SubmitPrintJobInput,
  SubmitPrintJobResult
} from './provider.js';

const execFileAsync = promisify(execFile);

export interface WindowsSpoolerOptions {
  printCacheDir: string;
  targetPrinterName?: string;
  /**
   * Optional custom spool execution override for unit tests or specialized vendor drivers
   */
  spoolCommandOverride?: (
    filePath: string,
    printerName: string,
    copies: number
  ) => Promise<{ success: boolean; error?: string; confirmed?: boolean }>;
  /**
   * Optional printer enumerator override for unit tests
   */
  enumeratorOverride?: () => Promise<PrinterDeviceDescriptor[]>;
}

/**
 * Windows Spooler Printer Provider (Section 6.5, 13 & 19):
 * - Implements IPrinterProvider ('real' mode) for physical Windows dye-sublimation printers
 *   (e.g., DNP DS620A, HiTi P525L, Citizen CY-02).
 * - Queries installed Windows print queues via PowerShell / WMI CimInstance.
 * - Imposes 4x6 / 2x6 strip composite with correct aspect ratio and margin scaling.
 * - Writes deterministic imposed artifacts to the local print cache.
 * - Submits jobs to the Windows Spooler (spoolsv) without blocking dialogs.
 * - Distinguishes spooler submission ('submitted' — 'Submitted — check printer')
 *   from confirmed physical completion ('confirmed') or spooler rejection ('failed').
 */
export class WindowsSpoolerPrinterProvider implements IPrinterProvider {
  public readonly mode = 'real' as const;
  private readonly printCacheDir: string;
  private targetPrinterName?: string;
  private readonly spoolCommandOverride?: (
    filePath: string,
    printerName: string,
    copies: number
  ) => Promise<{ success: boolean; error?: string; confirmed?: boolean }>;
  private readonly enumeratorOverride?: () => Promise<PrinterDeviceDescriptor[]>;

  constructor(options: WindowsSpoolerOptions) {
    this.printCacheDir = options.printCacheDir;
    this.targetPrinterName = options.targetPrinterName;
    this.spoolCommandOverride = options.spoolCommandOverride;
    this.enumeratorOverride = options.enumeratorOverride;

    fs.mkdirSync(this.printCacheDir, { recursive: true });
  }

  public setTargetPrinter(printerName: string): void {
    this.targetPrinterName = printerName;
  }

  public getTargetPrinter(): string | undefined {
    return this.targetPrinterName;
  }

  /**
   * Enumerates printers installed in the Windows Print Spooler.
   */
  public async enumerateDevices(): Promise<PrinterDeviceDescriptor[]> {
    if (this.enumeratorOverride) {
      return this.enumeratorOverride();
    }

    if (process.platform !== 'win32') {
      return [
        {
          deviceName: 'FALLBACK-VIRTUAL-PRINTER',
          displayName: 'Non-Windows Host Fallback Printer',
          isDefault: true,
          supportsPhysicalConfirmation: false
        }
      ];
    }

    try {
      const psCommand =
        'Get-CimInstance Win32_Printer | Select-Object Name, DeviceID, DriverName, Default | ConvertTo-Json -Compress';
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        psCommand
      ]);

      const trimmed = stdout.trim();
      if (!trimmed) {
        return [];
      }

      const parsed = JSON.parse(trimmed);
      const rawList: Array<{
        Name?: string;
        DeviceID?: string;
        DriverName?: string;
        Default?: boolean;
      }> = Array.isArray(parsed) ? parsed : [parsed];

      return rawList.map((item) => {
        const name = item.Name ?? item.DeviceID ?? 'Unknown Printer';
        return {
          deviceName: name,
          displayName: item.DriverName ? `${name} (${item.DriverName})` : name,
          isDefault: Boolean(item.Default),
          // Windows Spooler fire-and-forget spooling does not physically verify sheet cut
          supportsPhysicalConfirmation: false
        };
      });
    } catch {
      // Fallback: query .NET System.Drawing.Printing.PrinterSettings if WMI CIM fails
      try {
        const fallbackCmd =
          '[System.Drawing.Printing.PrinterSettings]::InstalledPrinters | ConvertTo-Json -Compress';
        const { stdout } = await execFileAsync('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          fallbackCmd
        ]);
        const trimmed = stdout.trim();
        if (!trimmed) {
          return [];
        }
        const parsed = JSON.parse(trimmed);
        const names: string[] = Array.isArray(parsed) ? parsed : [parsed];
        return names.map((name, idx) => ({
          deviceName: name,
          displayName: name,
          isDefault: idx === 0,
          supportsPhysicalConfirmation: false
        }));
      } catch (fallbackErr) {
        throw new Error(
          `SPOOLER_ENUMERATION_FAILED: Unable to enumerate Windows printers. ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`
        );
      }
    }
  }

  /**
   * Applies print imposition, caches the file locally, and submits to the Windows spooler queue.
   */
  public async submitPrintJob(input: SubmitPrintJobInput): Promise<SubmitPrintJobResult> {
    if (input.copies > input.profile.maxCopiesPerSession) {
      return {
        outcome: 'failed',
        displayMessage: `Requested copies (${input.copies}) exceed profile limit (${input.profile.maxCopiesPerSession})`
      };
    }

    if (input.copies <= 0) {
      return {
        outcome: 'failed',
        displayMessage: `Invalid requested copies count (${input.copies})`
      };
    }

    if (!fs.existsSync(input.compositeFilePath)) {
      return {
        outcome: 'failed',
        displayMessage: `Composite file not found at path: ${input.compositeFilePath}`
      };
    }

    // 1. Apply strip / border imposition
    const compositeBuf = fs.readFileSync(input.compositeFilePath);
    const imposed = await applyPrintImposition(compositeBuf, input.profile);

    // 2. Persist imposed file to local print cache
    fs.mkdirSync(this.printCacheDir, { recursive: true });
    const artifactPath = path.join(
      this.printCacheDir,
      `print-${input.sessionId}-${input.attemptId}.jpg`
    );
    fs.writeFileSync(artifactPath, imposed.buffer);

    // 3. Resolve destination printer
    let printerName = this.targetPrinterName;
    if (!printerName) {
      const devices = await this.enumerateDevices();
      const defaultDevice = devices.find((d) => d.isDefault) ?? devices[0];
      if (!defaultDevice) {
        return {
          outcome: 'failed',
          displayMessage: 'No installed Windows printer found to service print job',
          previewArtifactPath: artifactPath
        };
      }
      printerName = defaultDevice.deviceName;
    }

    // 4. Submit to spooler
    if (this.spoolCommandOverride) {
      const res = await this.spoolCommandOverride(artifactPath, printerName, input.copies);
      if (!res.success) {
        return {
          outcome: 'failed',
          displayMessage: res.error ?? 'Spool submission rejected by printer driver',
          previewArtifactPath: artifactPath
        };
      }
      if (res.confirmed) {
        return {
          outcome: 'confirmed',
          displayMessage: `Print physically confirmed complete on ${printerName}`,
          previewArtifactPath: artifactPath
        };
      }
      return {
        outcome: 'submitted',
        displayMessage: `Submitted ${input.copies} cop${input.copies === 1 ? 'y' : 'ies'} to spooler (${printerName}) — check printer`,
        previewArtifactPath: artifactPath
      };
    }

    try {
      await this.spoolToWindowsQueue(artifactPath, printerName, input.copies);
      return {
        outcome: 'submitted',
        displayMessage: `Submitted ${input.copies} cop${input.copies === 1 ? 'y' : 'ies'} to spooler (${printerName}) — check printer`,
        previewArtifactPath: artifactPath
      };
    } catch (err) {
      return {
        outcome: 'failed',
        displayMessage: `Windows spooler error: ${err instanceof Error ? err.message : String(err)}`,
        previewArtifactPath: artifactPath
      };
    }
  }

  /**
   * Dispatches the image file to the designated Windows print spooler via System.Drawing.Printing.
   */
  private async spoolToWindowsQueue(
    filePath: string,
    printerName: string,
    copies: number
  ): Promise<void> {
    if (process.platform !== 'win32') {
      // Non-Windows simulation fallback
      return;
    }

    // Clean inline script to load System.Drawing and submit image directly to spoolsv
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$printerName = $args[0]
$filePath = $args[1]
$copies = [int]$args[2]

if (-not (Test-Path -Path $filePath)) {
  throw "Print file does not exist: $filePath"
}

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $printerName
if (-not $doc.PrinterSettings.IsValid) {
  throw "Invalid printer specified: $printerName"
}
$doc.PrinterSettings.Copies = $copies
$doc.OriginAtMargins = $false
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

$img = [System.Drawing.Image]::FromFile($filePath)
try {
  $doc.add_PrintPage({
    param($s, $e)
    $e.Graphics.DrawImage($img, $e.PageBounds)
    $e.HasMorePages = $false
  })
  $doc.Print()
} finally {
  $img.Dispose()
  $doc.Dispose()
}
`.trim();

    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
      printerName,
      filePath,
      copies.toString()
    ]);
  }
}
