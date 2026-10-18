import fs from 'node:fs';
import path from 'node:path';
import type { PrintProfile } from '@odc-photostudio/contracts';
import { applyPrintImposition } from '@odc-photostudio/template-engine';

export interface PrinterDeviceDescriptor {
  deviceName: string;
  displayName: string;
  isDefault: boolean;
  supportsPhysicalConfirmation: boolean;
}

export interface SubmitPrintJobInput {
  attemptId: string;
  sessionId: string;
  compositeFilePath: string;
  profile: PrintProfile;
  copies: number;
}

export interface SubmitPrintJobResult {
  outcome: 'submitted' | 'confirmed' | 'failed' | 'unknown';
  displayMessage: string;
  previewArtifactPath?: string;
}

export interface IPrinterProvider {
  readonly mode: 'real' | 'mock';
  enumerateDevices(): Promise<PrinterDeviceDescriptor[]>;
  submitPrintJob(input: SubmitPrintJobInput): Promise<SubmitPrintJobResult>;
}

export interface MockPrinterScenarioConfig {
  simulateOutcome?: 'submitted' | 'confirmed' | 'failed' | 'crash_during_submit';
}

/**
 * Mock Printer Provider (Section 6.5 & 13):
 * - Writes a deterministic print preview artifact (with strip imposition applied when configured)
 *   without contacting a physical printer.
 * - Distinguishes spooler submission ('Submitted — check printer') from confirmed output.
 * - Supports simulating crash during submission (producing 'unknown' state on recovery).
 */
export class MockPrinterProvider implements IPrinterProvider {
  public readonly mode = 'mock' as const;
  private readonly outputDir: string;
  private scenario: MockPrinterScenarioConfig;

  constructor(outputDir: string, scenario: MockPrinterScenarioConfig = {}) {
    this.outputDir = outputDir;
    fs.mkdirSync(this.outputDir, { recursive: true });
    this.scenario = {
      simulateOutcome: scenario.simulateOutcome ?? 'submitted'
    };
  }

  public setScenario(scenario: Partial<MockPrinterScenarioConfig>): void {
    this.scenario = { ...this.scenario, ...scenario };
  }

  public async enumerateDevices(): Promise<PrinterDeviceDescriptor[]> {
    return [
      {
        deviceName: 'MOCK-DNP-DS620A',
        displayName: 'Simulated DNP DS620A Dye-Sub Printer (MOCK)',
        isDefault: true,
        supportsPhysicalConfirmation: false
      }
    ];
  }

  public async submitPrintJob(input: SubmitPrintJobInput): Promise<SubmitPrintJobResult> {
    if (input.copies > input.profile.maxCopiesPerSession) {
      return {
        outcome: 'failed',
        displayMessage: `Requested copies (${input.copies}) exceed profile limit (${input.profile.maxCopiesPerSession})`
      };
    }

    if (this.scenario.simulateOutcome === 'crash_during_submit') {
      throw new Error('SIMULATED_CRASH_DURING_PRINT_SUBMISSION');
    }

    if (this.scenario.simulateOutcome === 'failed') {
      return {
        outcome: 'failed',
        displayMessage: 'Printer spooler rejected job (simulated failure)'
      };
    }

    const compositeBuf = fs.readFileSync(input.compositeFilePath);
    const imposed = await applyPrintImposition(compositeBuf, input.profile);

    const artifactPath = path.join(
      this.outputDir,
      `print-${input.sessionId}-${input.attemptId}.jpg`
    );
    fs.writeFileSync(artifactPath, imposed.buffer);

    if (this.scenario.simulateOutcome === 'confirmed') {
      return {
        outcome: 'confirmed',
        displayMessage: 'Print confirmed complete',
        previewArtifactPath: artifactPath
      };
    }

    // Default realistic Windows spooler behavior (Section 6.5):
    // Distinguish spooler submission from confirmed physical output.
    return {
      outcome: 'submitted',
      displayMessage: 'Submitted — check printer',
      previewArtifactPath: artifactPath
    };
  }
}
