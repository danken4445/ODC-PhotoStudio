import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { computeBufferSha256 } from '@odc-photostudio/contracts';

export type CameraMode = 'real' | 'mock';

export interface CameraCapabilities {
  liveView: boolean;
  remoteCapture: boolean;
  batteryReporting: boolean;
}

export interface CaptureResult {
  assetId: string;
  frameIndex: number;
  localFilePath: string;
  capturedAt: string;
  width: number;
  height: number;
  sha256: string;
}

export interface ICameraProvider {
  readonly mode: CameraMode;
  initialize(): Promise<CameraCapabilities>;
  startLiveView(onFrame: (jpeg: Uint8Array) => void): Promise<void>;
  stopLiveView(): Promise<void>;
  triggerCapture(input: {
    sessionId: string;
    frameIndex: number;
    signal: AbortSignal;
  }): Promise<CaptureResult>;
  disconnect(): Promise<void>;
}

export interface MockCameraScenarioConfig {
  captureDelayMs?: number;
  disconnectAfterFrameIndex?: number | null;
  failOnFrameIndex?: number | null;
}

/**
 * Deterministic Mock Camera Provider (Section 13):
 * - Works without a webcam or physical camera
 * - Enforces single active capture mutex (no simultaneous capture requests)
 * - Resolves session directories internally from trusted sessionId
 * - Pauses live view during shutter release and bounds live-view buffers
 * - Supports controllable delay, disconnect after shot N (A02), and capture failure scenarios
 */
export class MockCameraProvider implements ICameraProvider {
  public readonly mode: CameraMode = 'mock';
  private isConnected = false;
  private isCapturing = false;
  private liveViewTimer: NodeJS.Timeout | null = null;
  private scenario: MockCameraScenarioConfig;
  private readonly resolveSessionDir: (sessionId: string) => string;

  constructor(
    resolveSessionDir: (sessionId: string) => string,
    scenario: MockCameraScenarioConfig = {}
  ) {
    this.resolveSessionDir = resolveSessionDir;
    this.scenario = {
      captureDelayMs: scenario.captureDelayMs ?? 20,
      disconnectAfterFrameIndex: scenario.disconnectAfterFrameIndex ?? null,
      failOnFrameIndex: scenario.failOnFrameIndex ?? null
    };
  }

  public setScenario(scenario: Partial<MockCameraScenarioConfig>): void {
    this.scenario = { ...this.scenario, ...scenario };
  }

  public reconnect(): void {
    this.isConnected = true;
  }

  public isReady(): boolean {
    return this.isConnected;
  }

  public async initialize(): Promise<CameraCapabilities> {
    this.isConnected = true;
    return {
      liveView: true,
      remoteCapture: true,
      batteryReporting: true
    };
  }

  public async startLiveView(onFrame: (jpeg: Uint8Array) => void): Promise<void> {
    if (!this.isConnected) {
      throw new Error('CAMERA_DISCONNECTED: Cannot start live view');
    }
    await this.stopLiveView();

    const frameBuf = await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: { r: 24, g: 24, b: 27 }
      }
    })
      .jpeg({ quality: 75 })
      .toBuffer();

    // Bounded live-view timer; drops frames if busy capturing
    this.liveViewTimer = setInterval(() => {
      if (!this.isCapturing && this.isConnected) {
        onFrame(new Uint8Array(frameBuf));
      }
    }, 100);
  }

  public async stopLiveView(): Promise<void> {
    if (this.liveViewTimer) {
      clearInterval(this.liveViewTimer);
      this.liveViewTimer = null;
    }
  }

  public async triggerCapture(input: {
    sessionId: string;
    frameIndex: number;
    signal: AbortSignal;
  }): Promise<CaptureResult> {
    if (!this.isConnected) {
      throw new Error('CAMERA_DISCONNECTED: Camera is disconnected');
    }
    if (this.isCapturing) {
      throw new Error('CAMERA_BUSY: Simultaneous capture requests are not permitted');
    }
    if (input.signal.aborted) {
      throw new Error('CAPTURE_ABORTED: Capture signal was already aborted');
    }

    this.isCapturing = true;
    try {
      const delayMs = this.scenario.captureDelayMs ?? 20;
      if (delayMs > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs);
          input.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new Error('CAPTURE_ABORTED: Cancelled during shutter release'));
            },
            { once: true }
          );
        });
      }

      if (
        this.scenario.disconnectAfterFrameIndex !== null &&
        this.scenario.disconnectAfterFrameIndex !== undefined &&
        input.frameIndex > this.scenario.disconnectAfterFrameIndex
      ) {
        this.isConnected = false;
        throw new Error(
          `CAMERA_DISCONNECTED: Simulated disconnect after frame ${this.scenario.disconnectAfterFrameIndex}`
        );
      }

      if (this.scenario.failOnFrameIndex === input.frameIndex) {
        throw new Error(`CAMERA_CAPTURE_FAILED: Simulated failure on frame ${input.frameIndex}`);
      }

      const sessionDir = this.resolveSessionDir(input.sessionId);
      fs.mkdirSync(sessionDir, { recursive: true });

      const assetId = crypto.randomUUID();
      const stagingPath = path.join(
        sessionDir,
        `shot-${input.frameIndex}-${assetId}.staging.jpg`
      );
      const finalPath = path.join(sessionDir, `shot-${input.frameIndex}-${assetId}.jpg`);

      // Generate deterministic synthetic sRGB photograph per frameIndex
      const palettes = [
        { r: 38, g: 70, b: 83 },
        { r: 42, g: 157, b: 143 },
        { r: 233, g: 196, b: 106 },
        { r: 231, g: 111, b: 81 }
      ];
      const bg = palettes[input.frameIndex % palettes.length] ?? { r: 60, g: 80, b: 120 };

      const width = 1200;
      const height = 1600;
      const imageBuffer = await sharp({
        create: {
          width,
          height,
          channels: 3,
          background: bg
        }
      })
        .toColorspace('srgb')
        .jpeg({ quality: 92, mozjpeg: false })
        .toBuffer();

      // Write to staging file first, verify, then atomically rename into final path (Section 6.3 & 6.4)
      fs.writeFileSync(stagingPath, imageBuffer);
      const verifyBuf = fs.readFileSync(stagingPath);
      const sha256 = computeBufferSha256(verifyBuf);
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
    } finally {
      this.isCapturing = false;
    }
  }

  public async disconnect(): Promise<void> {
    await this.stopLiveView();
    this.isConnected = false;
  }
}

/**
 * Placeholder for Real DSLR Camera SDK Adapter (Canon EDSDK / Nikon MAID / PTP-IP).
 * Per Section 2 & 19: Never claim physical hardware compatibility until tested on actual hardware.
 */
export class UnqualifiedRealCameraProvider implements ICameraProvider {
  public readonly mode: CameraMode = 'real';

  public async initialize(): Promise<CameraCapabilities> {
    throw new Error(
      'HARDWARE_UNQUALIFIED: Physical DSLR camera SDK adapter requires hardware qualification on target Windows x64 station'
    );
  }

  public async startLiveView(): Promise<void> {
    throw new Error('HARDWARE_UNQUALIFIED: Physical camera not connected');
  }

  public async stopLiveView(): Promise<void> {
    // no-op
  }

  public async triggerCapture(): Promise<CaptureResult> {
    throw new Error('HARDWARE_UNQUALIFIED: Physical camera not connected');
  }

  public async disconnect(): Promise<void> {
    // no-op
  }
}
