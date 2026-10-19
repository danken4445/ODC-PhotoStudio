import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { computeBufferSha256 } from '@odc-photostudio/contracts';
import type {
  CameraCapabilities,
  CameraMode,
  CaptureResult,
  ICameraProvider
} from './provider.js';

const execFileAsync = promisify(execFile);

export type SupportedCameraDriver = 'digicamcontrol' | 'canon-edsdk' | 'gphoto2' | 'custom';

export interface CommandExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RealCameraConfig {
  driverType?: SupportedCameraDriver;
  cliPath?: string;
  customCaptureCommand?: string;
  resolveSessionDir: (sessionId: string) => string;
  captureTimeoutMs?: number;
  liveViewIntervalMs?: number;
  /**
   * Optional custom CLI command runner for unit testing and CI simulation
   */
  commandExecutor?: (
    cmd: string,
    args: string[],
    signal?: AbortSignal
  ) => Promise<CommandExecutionResult>;
}

/**
 * Real Camera Provider (Section 6.3, 13 & 19):
 * - Interfaces with physical DSLR/mirrorless cameras over USB tethering.
 * - Supports industry-standard photobooth driver bridges:
 *   1. digiCamControl (`CameraControlCmd.exe`) — Canon/Nikon/Sony Windows tethering
 *   2. Canon EDSDK CLI (`edsdk-cli.exe`) — Canon EOS DSLR/Mirrorless SDK
 *   3. gPhoto2 CLI (`gphoto2` / `gphoto2.exe`) — Standard USB PTP camera driver
 *   4. Custom CLI bridge via command template
 * - Provides strict diagnostic error codes when driver or camera hardware is missing.
 * - Enforces single active capture mutex (`isCapturing`).
 * - Writes shutter release to staging file first, verifies byte length and sha256,
 *   extracts image dimensions via Sharp, and atomically renames to final session path.
 */
export class RealCameraProvider implements ICameraProvider {
  public readonly mode: CameraMode = 'real';
  private readonly driverType: SupportedCameraDriver;
  private readonly configuredCliPath?: string;
  private resolvedCliPath: string | null = null;
  private readonly resolveSessionDir: (sessionId: string) => string;
  private readonly captureTimeoutMs: number;
  private readonly liveViewIntervalMs: number;
  private readonly commandExecutor?: (
    cmd: string,
    args: string[],
    signal?: AbortSignal
  ) => Promise<CommandExecutionResult>;

  private isConnected = false;
  private isCapturing = false;
  private liveViewTimer: NodeJS.Timeout | null = null;

  constructor(config: RealCameraConfig) {
    this.driverType = config.driverType ?? 'digicamcontrol';
    this.configuredCliPath = config.cliPath;
    this.resolveSessionDir = config.resolveSessionDir;
    this.captureTimeoutMs = config.captureTimeoutMs ?? 15_000;
    this.liveViewIntervalMs = config.liveViewIntervalMs ?? 100;
    this.commandExecutor = config.commandExecutor;
  }

  public isReady(): boolean {
    return this.isConnected;
  }

  public getResolvedCliPath(): string | null {
    return this.resolvedCliPath;
  }

  /**
   * Probes for driver CLI executable and checks if a physical DSLR is tethered over USB.
   */
  public async initialize(): Promise<CameraCapabilities> {
    this.resolvedCliPath = await this.locateDriverExecutable();
    if (!this.resolvedCliPath) {
      throw new Error(
        `CAMERA_DRIVER_NOT_FOUND: Driver executable for '${this.driverType}' was not found. Please verify driver installation or provide explicit 'cliPath' in configuration.`
      );
    }

    const isDetected = await this.probeCameraConnection(this.resolvedCliPath);
    if (!isDetected) {
      this.isConnected = false;
      throw new Error(
        `CAMERA_NOT_DETECTED: Camera driver found (${this.resolvedCliPath}), but no physical DSLR camera was detected over USB. Check USB tether cable and camera power.`
      );
    }

    this.isConnected = true;
    return {
      liveView: true,
      remoteCapture: true,
      batteryReporting: this.driverType === 'digicamcontrol' || this.driverType === 'canon-edsdk'
    };
  }

  /**
   * Starts periodic live-view frame capture stream from tethered camera.
   */
  public async startLiveView(onFrame: (jpeg: Uint8Array) => void): Promise<void> {
    if (!this.isConnected || !this.resolvedCliPath) {
      throw new Error('CAMERA_DISCONNECTED: Cannot start live view while camera is disconnected');
    }
    await this.stopLiveView();

    this.liveViewTimer = setInterval(async () => {
      if (this.isCapturing || !this.isConnected || !this.resolvedCliPath) {
        return;
      }
      try {
        const frameBytes = await this.fetchLiveViewFrame(this.resolvedCliPath);
        if (frameBytes && frameBytes.length > 0) {
          onFrame(frameBytes);
        }
      } catch {
        // Drop transient frame errors without crashing live view
      }
    }, this.liveViewIntervalMs);
  }

  public async stopLiveView(): Promise<void> {
    if (this.liveViewTimer) {
      clearInterval(this.liveViewTimer);
      this.liveViewTimer = null;
    }
  }

  /**
   * Triggers shutter release on physical camera, writes to staging file, verifies SHA256,
   * extracts dimensions, and atomically moves to final asset path.
   */
  public async triggerCapture(input: {
    sessionId: string;
    frameIndex: number;
    signal: AbortSignal;
  }): Promise<CaptureResult> {
    if (!this.isConnected || !this.resolvedCliPath) {
      throw new Error('CAMERA_DISCONNECTED: Camera is disconnected or uninitialized');
    }

    if (this.isCapturing) {
      throw new Error('CAMERA_BUSY: Simultaneous capture requests are not permitted');
    }

    if (input.signal.aborted) {
      throw new Error('CAPTURE_ABORTED: Capture signal was already aborted');
    }

    this.isCapturing = true;

    const sessionDir = this.resolveSessionDir(input.sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });

    const assetId = crypto.randomUUID();
    const stagingPath = path.join(
      sessionDir,
      `shot-${input.frameIndex}-${assetId}.staging.jpg`
    );
    const finalPath = path.join(sessionDir, `shot-${input.frameIndex}-${assetId}.jpg`);

    try {
      await this.executeShutterRelease({
        cliPath: this.resolvedCliPath,
        stagingPath,
        signal: input.signal
      });

      // 1. Verify staging file was written and non-empty
      if (!fs.existsSync(stagingPath)) {
        throw new Error(
          `CAMERA_CAPTURE_FAILED: Driver reported success but staging file is missing at ${stagingPath}`
        );
      }

      const stagingStat = fs.statSync(stagingPath);
      if (stagingStat.size === 0) {
        throw new Error(
          `CAMERA_CAPTURE_FAILED: Staging file is empty (0 bytes) at ${stagingPath}`
        );
      }

      // 2. Read file, compute cryptographic checksum
      const rawBuffer = fs.readFileSync(stagingPath);
      const sha256 = computeBufferSha256(rawBuffer);

      // 3. Inspect image metadata via Sharp
      const metadata = await sharp(rawBuffer).metadata();
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;

      if (width <= 0 || height <= 0) {
        throw new Error(
          `CAMERA_CAPTURE_FAILED: Invalid or corrupt image captured (width: ${width}, height: ${height})`
        );
      }

      // 4. Atomically commit staging file to final asset path
      fs.renameSync(stagingPath, finalPath);

      return {
        assetId,
        frameIndex: input.frameIndex,
        localFilePath: finalPath,
        capturedAt: new Date().toISOString(),
        width,
        height,
        sha256
      };
    } catch (err) {
      // Clean up orphaned staging file on capture failure
      if (fs.existsSync(stagingPath)) {
        try {
          fs.unlinkSync(stagingPath);
        } catch {
          // Ignore cleanup error
        }
      }
      throw err;
    } finally {
      this.isCapturing = false;
    }
  }

  public async disconnect(): Promise<void> {
    await this.stopLiveView();
    this.isConnected = false;
  }

  /**
   * Dispatches shutter release command to the respective camera CLI bridge.
   */
  private async executeShutterRelease(params: {
    cliPath: string;
    stagingPath: string;
    signal: AbortSignal;
  }): Promise<void> {
    const { cliPath, stagingPath, signal } = params;

    let cmd = cliPath;
    let args: string[] = [];

    switch (this.driverType) {
      case 'digicamcontrol':
        args = ['/filename', stagingPath, '/capture'];
        break;
      case 'canon-edsdk':
        args = ['--capture', '--out', stagingPath];
        break;
      case 'gphoto2':
        args = ['--capture-image-and-download', '--filename', stagingPath, '--force-overwrite'];
        break;
      case 'custom':
        args = [stagingPath];
        break;
    }

    const abortHandler = (): void => {
      // Triggered when signal aborts
    };

    if (signal.aborted) {
      throw new Error('CAPTURE_ABORTED: Cancelled before shutter release');
    }

    try {
      signal.addEventListener('abort', abortHandler, { once: true });

      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(
            new Error(
              `CAMERA_CAPTURE_TIMEOUT: Camera did not respond within ${this.captureTimeoutMs}ms`
            )
          );
        }, this.captureTimeoutMs);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new Error('CAPTURE_ABORTED: Cancelled during shutter release'));
          },
          { once: true }
        );
      });

      const execPromise = this.runCommand(cmd, args, signal);
      await Promise.race([execPromise, timeoutPromise]);
    } finally {
      signal.removeEventListener('abort', abortHandler);
    }
  }

  /**
   * Fetches preview frame for live view from tethered camera.
   */
  private async fetchLiveViewFrame(cliPath: string): Promise<Uint8Array | null> {
    const tempFramePath = path.join(
      this.resolveSessionDir('__liveview_temp__'),
      `live-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
    );

    try {
      fs.mkdirSync(path.dirname(tempFramePath), { recursive: true });

      let args: string[] = [];
      switch (this.driverType) {
        case 'digicamcontrol':
          args = ['/capture-preview', tempFramePath];
          break;
        case 'canon-edsdk':
          args = ['--liveview-frame', '--out', tempFramePath];
          break;
        case 'gphoto2':
          args = ['--capture-preview', '--filename', tempFramePath, '--force-overwrite'];
          break;
        default:
          return null;
      }

      await this.runCommand(cliPath, args);
      if (fs.existsSync(tempFramePath)) {
        const buf = fs.readFileSync(tempFramePath);
        return new Uint8Array(buf);
      }
      return null;
    } catch {
      return null;
    } finally {
      if (fs.existsSync(tempFramePath)) {
        try {
          fs.unlinkSync(tempFramePath);
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Probes whether the camera driver recognizes an active connected DSLR.
   */
  private async probeCameraConnection(cliPath: string): Promise<boolean> {
    try {
      let args: string[] = [];
      switch (this.driverType) {
        case 'digicamcontrol':
          args = ['/list-cameras'];
          break;
        case 'canon-edsdk':
          args = ['--detect'];
          break;
        case 'gphoto2':
          args = ['--auto-detect'];
          break;
        case 'custom':
          args = ['--probe'];
          break;
      }

      const res = await this.runCommand(cliPath, args);
      if (res.exitCode !== 0) {
        return false;
      }

      const output = `${res.stdout} ${res.stderr}`.toLowerCase();
      if (
        output.includes('no camera') ||
        output.includes('0 cameras') ||
        output.includes('not connected') ||
        output.includes('no devices')
      ) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Locates the driver binary on disk or in system PATH.
   */
  private async locateDriverExecutable(): Promise<string | null> {
    if (this.configuredCliPath && fs.existsSync(this.configuredCliPath)) {
      return this.configuredCliPath;
    }

    if (this.commandExecutor) {
      // In test mock mode, configured CLI path or driver name is used
      return this.configuredCliPath ?? `${this.driverType}-cli`;
    }

    const candidatePaths: string[] = [];

    if (this.driverType === 'digicamcontrol') {
      candidatePaths.push(
        'C:\\Program Files (x86)\\digiCamControl\\CameraControlCmd.exe',
        'C:\\Program Files\\digiCamControl\\CameraControlCmd.exe',
        'CameraControlCmd.exe'
      );
    } else if (this.driverType === 'canon-edsdk') {
      candidatePaths.push(
        'C:\\Program Files\\Canon\\EDSDK\\edsdk-cli.exe',
        'C:\\EDSDK\\edsdk-cli.exe',
        'edsdk-cli.exe'
      );
    } else if (this.driverType === 'gphoto2') {
      candidatePaths.push(
        'C:\\Program Files\\gphoto2\\gphoto2.exe',
        'gphoto2.exe',
        'gphoto2'
      );
    }

    for (const candidate of candidatePaths) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    // Try finding via 'where' on Windows or 'which' on POSIX
    try {
      const lookupCmd = process.platform === 'win32' ? 'where' : 'which';
      const binaryName =
        this.driverType === 'digicamcontrol'
          ? 'CameraControlCmd.exe'
          : this.driverType === 'canon-edsdk'
            ? 'edsdk-cli.exe'
            : 'gphoto2';

      const { stdout } = await execFileAsync(lookupCmd, [binaryName]);
      const firstLine = stdout.split(/\r?\n/)[0]?.trim();
      if (firstLine && fs.existsSync(firstLine)) {
        return firstLine;
      }
    } catch {
      // not in PATH
    }

    return null;
  }

  /**
   * Executes binary command via provided mock executor or Node child_process.
   */
  private async runCommand(
    cmd: string,
    args: string[],
    signal?: AbortSignal
  ): Promise<CommandExecutionResult> {
    if (this.commandExecutor) {
      return this.commandExecutor(cmd, args, signal);
    }

    return new Promise<CommandExecutionResult>((resolve, reject) => {
      const child = execFile(
        cmd,
        args,
        { signal },
        (error, stdout, stderr) => {
          if (error) {
            if (signal?.aborted) {
              reject(new Error('CAPTURE_ABORTED: Cancelled during shutter release'));
              return;
            }
            reject(
              new Error(
                `COMMAND_EXECUTION_FAILED: ${cmd} exited with code ${error.code ?? 1}. Stderr: ${stderr}`
              )
            );
            return;
          }
          resolve({
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            exitCode: child.exitCode ?? 0
          });
        }
      );
    });
  }
}
