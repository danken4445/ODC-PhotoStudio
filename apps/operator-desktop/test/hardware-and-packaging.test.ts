import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { PrintProfile } from '@odc-photostudio/contracts';
import { WindowsSpoolerPrinterProvider } from '../src/main/printer/windows-spooler-provider.js';
import { RealCameraProvider } from '../src/main/camera/real-camera-provider.js';

const SAMPLE_PRINT_PROFILE_4X6: PrintProfile = {
  id: 'prof-4x6',
  name: 'Standard 4x6',
  deviceName: 'DNP DS620A',
  paperSize: '4x6_postcard',
  dpi: 300,
  scalingMode: 'exact_1_to_1',
  maxCopiesPerSession: 4,
  offsetXMm: 0,
  offsetYMm: 0,
  supportsTwoBySixCut: false,
  stripImposition: 'none'
};

const SAMPLE_PRINT_PROFILE_2X6_STRIP: PrintProfile = {
  id: 'prof-2x6',
  name: 'Photo Strip 2x6 Duplicate',
  deviceName: 'DNP DS620A',
  paperSize: '2x6_strip',
  dpi: 300,
  scalingMode: 'exact_1_to_1',
  maxCopiesPerSession: 6,
  offsetXMm: 0,
  offsetYMm: 0,
  supportsTwoBySixCut: true,
  stripImposition: 'duplicate_2x6_on_4x6'
};

describe('Hardware Adapters & Packaging Qualification (Phase 5 & 6)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odc-hw-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('WindowsSpoolerPrinterProvider', () => {
    it('enumerates devices with native Windows spooler or fallback', async () => {
      const provider = new WindowsSpoolerPrinterProvider({
        printCacheDir: path.join(tempDir, 'prints')
      });

      const devices = await provider.enumerateDevices();
      expect(Array.isArray(devices)).toBe(true);
      if (devices.length > 0) {
        expect(devices[0]).toHaveProperty('deviceName');
        expect(devices[0]).toHaveProperty('displayName');
        expect(devices[0]).toHaveProperty('isDefault');
        expect(devices[0]?.supportsPhysicalConfirmation).toBe(false);
      }
    });

    it('rejects copy requests exceeding profile maximum or invalid count', async () => {
      const provider = new WindowsSpoolerPrinterProvider({
        printCacheDir: path.join(tempDir, 'prints'),
        spoolCommandOverride: async () => ({ success: true })
      });

      const resOver = await provider.submitPrintJob({
        attemptId: 'att-1',
        sessionId: 'sess-1',
        compositeFilePath: path.join(tempDir, 'dummy.jpg'),
        profile: SAMPLE_PRINT_PROFILE_4X6,
        copies: 5 // max is 4
      });
      expect(resOver.outcome).toBe('failed');
      expect(resOver.displayMessage).toContain('exceed profile limit');

      const resZero = await provider.submitPrintJob({
        attemptId: 'att-2',
        sessionId: 'sess-1',
        compositeFilePath: path.join(tempDir, 'dummy.jpg'),
        profile: SAMPLE_PRINT_PROFILE_4X6,
        copies: 0
      });
      expect(resZero.outcome).toBe('failed');
      expect(resZero.displayMessage).toContain('Invalid requested copies');
    });

    it('fails when composite image file does not exist', async () => {
      const provider = new WindowsSpoolerPrinterProvider({
        printCacheDir: path.join(tempDir, 'prints'),
        spoolCommandOverride: async () => ({ success: true })
      });

      const res = await provider.submitPrintJob({
        attemptId: 'att-1',
        sessionId: 'sess-1',
        compositeFilePath: path.join(tempDir, 'non-existent-composite.jpg'),
        profile: SAMPLE_PRINT_PROFILE_4X6,
        copies: 1
      });
      expect(res.outcome).toBe('failed');
      expect(res.displayMessage).toContain('Composite file not found');
    });

    it('applies strip imposition, writes artifact to print cache, and distinguishes submitted vs confirmed vs failed', async () => {
      // Create sample 2x6 composite (600x1800)
      const compositePath = path.join(tempDir, 'sample-strip.jpg');
      const sampleStrip = await sharp({
        create: {
          width: 600,
          height: 1800,
          channels: 3,
          background: { r: 240, g: 120, b: 80 }
        }
      })
        .jpeg()
        .toBuffer();
      fs.writeFileSync(compositePath, sampleStrip);

      let submittedFilePath = '';
      let submittedPrinter = '';
      let submittedCopies = 0;

      const cacheDir = path.join(tempDir, 'print-cache');
      const provider = new WindowsSpoolerPrinterProvider({
        printCacheDir: cacheDir,
        targetPrinterName: 'DNP DS620A (Photo)',
        spoolCommandOverride: async (filePath, printer, copies) => {
          submittedFilePath = filePath;
          submittedPrinter = printer;
          submittedCopies = copies;
          return { success: true };
        }
      });

      const res = await provider.submitPrintJob({
        attemptId: 'att-100',
        sessionId: 'sess-abc',
        compositeFilePath: compositePath,
        profile: SAMPLE_PRINT_PROFILE_2X6_STRIP,
        copies: 2
      });

      expect(res.outcome).toBe('submitted');
      expect(res.displayMessage).toContain('Submitted 2 copies to spooler (DNP DS620A (Photo)) — check printer');
      expect(res.previewArtifactPath).toBeDefined();
      expect(fs.existsSync(res.previewArtifactPath!)).toBe(true);

      // Verify the imposed artifact is 1200x1800 (two 600x1800 strips side-by-side)
      const imposedMeta = await sharp(res.previewArtifactPath!).metadata();
      expect(imposedMeta.width).toBe(1200);
      expect(imposedMeta.height).toBe(1800);

      expect(submittedFilePath).toBe(res.previewArtifactPath);
      expect(submittedPrinter).toBe('DNP DS620A (Photo)');
      expect(submittedCopies).toBe(2);

      // Test driver confirmed outcome
      const confirmedProvider = new WindowsSpoolerPrinterProvider({
        printCacheDir: cacheDir,
        targetPrinterName: 'DNP DS620A (Photo)',
        spoolCommandOverride: async () => ({ success: true, confirmed: true })
      });
      const resConfirmed = await confirmedProvider.submitPrintJob({
        attemptId: 'att-101',
        sessionId: 'sess-abc',
        compositeFilePath: compositePath,
        profile: SAMPLE_PRINT_PROFILE_4X6,
        copies: 1
      });
      expect(resConfirmed.outcome).toBe('confirmed');
      expect(resConfirmed.displayMessage).toContain('physically confirmed complete');

      // Test driver failure outcome
      const failedProvider = new WindowsSpoolerPrinterProvider({
        printCacheDir: cacheDir,
        targetPrinterName: 'DNP DS620A (Photo)',
        spoolCommandOverride: async () => ({ success: false, error: 'Printer out of paper ribbon' })
      });
      const resFailed = await failedProvider.submitPrintJob({
        attemptId: 'att-102',
        sessionId: 'sess-abc',
        compositeFilePath: compositePath,
        profile: SAMPLE_PRINT_PROFILE_4X6,
        copies: 1
      });
      expect(resFailed.outcome).toBe('failed');
      expect(resFailed.displayMessage).toBe('Printer out of paper ribbon');
    });
  });

  describe('RealCameraProvider', () => {
    it('throws CAMERA_DRIVER_NOT_FOUND when driver CLI executable is not on disk', async () => {
      const provider = new RealCameraProvider({
        driverType: 'digicamcontrol',
        cliPath: path.join(tempDir, 'missing-CameraControlCmd.exe'),
        resolveSessionDir: (id) => path.join(tempDir, 'sessions', id)
      });

      await expect(provider.initialize()).rejects.toThrow('CAMERA_DRIVER_NOT_FOUND');
    });

    it('throws CAMERA_NOT_DETECTED when driver CLI exists but no camera is plugged into USB', async () => {
      const provider = new RealCameraProvider({
        driverType: 'canon-edsdk',
        cliPath: 'edsdk-mock',
        resolveSessionDir: (id) => path.join(tempDir, 'sessions', id),
        commandExecutor: async (_cmd, args) => {
          if (args.includes('--detect')) {
            return {
              stdout: '0 cameras found. No camera connected.',
              stderr: '',
              exitCode: 0
            };
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        }
      });

      await expect(provider.initialize()).rejects.toThrow('CAMERA_NOT_DETECTED');
      expect(provider.isReady()).toBe(false);
    });

    it('initializes successfully when tethered camera is detected', async () => {
      const provider = new RealCameraProvider({
        driverType: 'digicamcontrol',
        cliPath: 'CameraControlCmd-mock',
        resolveSessionDir: (id) => path.join(tempDir, 'sessions', id),
        commandExecutor: async (_cmd, args) => {
          if (args.includes('/list-cameras')) {
            return {
              stdout: 'Canon EOS Rebel T7 [USB::001::004]',
              stderr: '',
              exitCode: 0
            };
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        }
      });

      const caps = await provider.initialize();
      expect(caps.liveView).toBe(true);
      expect(caps.remoteCapture).toBe(true);
      expect(provider.isReady()).toBe(true);
    });

    it('enforces capture mutex and prevents simultaneous capture requests', async () => {
      let releaseShutter: (() => void) | null = null;
      const provider = new RealCameraProvider({
        driverType: 'canon-edsdk',
        cliPath: 'edsdk-mock',
        resolveSessionDir: (id) => path.join(tempDir, 'sessions', id),
        commandExecutor: async (_cmd, args) => {
          if (args.includes('--detect')) {
            return { stdout: 'Canon EOS R6 Mark II', stderr: '', exitCode: 0 };
          }
          if (args.includes('--capture')) {
            await new Promise<void>((resolve) => {
              releaseShutter = resolve;
            });
            const outIdx = args.indexOf('--out');
            const targetPath = args[outIdx + 1]!;
            const fakeJpeg = await sharp({
              create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 20, b: 30 } }
            }).jpeg().toBuffer();
            fs.writeFileSync(targetPath, fakeJpeg);
            return { stdout: 'OK', stderr: '', exitCode: 0 };
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        }
      });

      await provider.initialize();

      const controller1 = new AbortController();
      const controller2 = new AbortController();

      const capture1Promise = provider.triggerCapture({
        sessionId: 'sess-mutex',
        frameIndex: 0,
        signal: controller1.signal
      });

      // Second simultaneous capture should immediately fail with CAMERA_BUSY
      await expect(
        provider.triggerCapture({
          sessionId: 'sess-mutex',
          frameIndex: 1,
          signal: controller2.signal
        })
      ).rejects.toThrow('CAMERA_BUSY');

      releaseShutter?.();
      const cap1 = await capture1Promise;
      expect(cap1.frameIndex).toBe(0);
      expect(fs.existsSync(cap1.localFilePath)).toBe(true);
    });

    it('performs staging file write, computes sha256, verifies dimensions, and atomically commits', async () => {
      const provider = new RealCameraProvider({
        driverType: 'digicamcontrol',
        cliPath: 'CameraControlCmd-mock',
        resolveSessionDir: (id) => path.join(tempDir, 'sessions', id),
        commandExecutor: async (_cmd, args) => {
          if (args.includes('/list-cameras')) {
            return { stdout: 'Nikon D750 Connected', stderr: '', exitCode: 0 };
          }
          if (args.includes('/capture')) {
            const outIdx = args.indexOf('/filename');
            const stagingPath = args[outIdx + 1]!;

            // Write 1920x1080 JPEG to staging path
            const testImg = await sharp({
              create: {
                width: 1920,
                height: 1080,
                channels: 3,
                background: { r: 50, g: 150, b: 250 }
              }
            })
              .jpeg({ quality: 90 })
              .toBuffer();

            fs.writeFileSync(stagingPath, testImg);
            return { stdout: 'Captured to ' + stagingPath, stderr: '', exitCode: 0 };
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        }
      });

      await provider.initialize();

      const result = await provider.triggerCapture({
        sessionId: 'session-live-01',
        frameIndex: 2,
        signal: new AbortController().signal
      });

      expect(result.frameIndex).toBe(2);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(fs.existsSync(result.localFilePath)).toBe(true);
      expect(result.localFilePath).toContain('shot-2-');
      expect(result.localFilePath.endsWith('.jpg')).toBe(true);

      // Verify staging file was renamed and no longer exists with .staging.jpg
      const stagingPath = result.localFilePath.replace(/\.jpg$/, '.staging.jpg');
      expect(fs.existsSync(stagingPath)).toBe(false);
    });

    it('handles capture signal abort and stops live view', async () => {
      const provider = new RealCameraProvider({
        driverType: 'gphoto2',
        cliPath: 'gphoto2-mock',
        resolveSessionDir: (id) => path.join(tempDir, 'sessions', id),
        commandExecutor: async () => ({ stdout: 'Sony A7 IV', stderr: '', exitCode: 0 })
      });

      await provider.initialize();

      const controller = new AbortController();
      controller.abort();

      await expect(
        provider.triggerCapture({
          sessionId: 'sess-abort',
          frameIndex: 0,
          signal: controller.signal
        })
      ).rejects.toThrow('CAPTURE_ABORTED');

      await provider.disconnect();
      expect(provider.isReady()).toBe(false);
    });
  });

  describe('Desktop Packaging Configuration & Secret Guard', () => {
    it('verifies electron-builder.json configures Windows x64 NSIS target, sharp asarUnpack, and secret exclusions', () => {
      const configPath = path.resolve(__dirname, '../electron-builder.json');
      expect(fs.existsSync(configPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

      // Check app metadata
      expect(config.appId).toBe('com.odcphotostudio.operator');
      expect(config.productName).toBe('ODC-PhotoStudio Operator Console');

      // Check Windows x64 NSIS target
      expect(config.win).toBeDefined();
      expect(config.win.target).toBeDefined();
      const nsisTarget = config.win.target.find((t: { target: string }) => t.target === 'nsis');
      expect(nsisTarget).toBeDefined();
      expect(nsisTarget.arch).toContain('x64');

      // Check sharp and @img/sharp-win32-x64 native binaries in asarUnpack
      expect(Array.isArray(config.asarUnpack)).toBe(true);
      expect(config.asarUnpack.some((p: string) => p.includes('sharp'))).toBe(true);
      expect(config.asarUnpack.some((p: string) => p.includes('@img/sharp-win32-x64'))).toBe(true);

      // Check window icon exists
      const iconRelative = config.win.icon;
      const iconPath = path.resolve(__dirname, '..', iconRelative);
      expect(fs.existsSync(iconPath)).toBe(true);
      expect(fs.statSync(iconPath).size).toBeGreaterThan(1000);

      // Check secret guard file exclusions
      const files: string[] = config.files;
      expect(Array.isArray(files)).toBe(true);
      const secretKeywords = ['.env', 'secret', 'private-key', 'pem'];
      for (const kw of secretKeywords) {
        const found = files.some((f) => f.startsWith('!') && f.toLowerCase().includes(kw));
        expect(found).toBe(true);
      }
    });

    it('verifies .github/workflows/ci.yml runs install, typecheck, test, and build', () => {
      const ciPath = path.resolve(__dirname, '../../../.github/workflows/ci.yml');
      expect(fs.existsSync(ciPath)).toBe(true);

      const ciYaml = fs.readFileSync(ciPath, 'utf8');
      expect(ciYaml).toContain('pnpm install');
      expect(ciYaml).toContain('pnpm typecheck');
      expect(ciYaml).toContain('pnpm test');
      expect(ciYaml).toContain('pnpm build');
      expect(ciYaml).toContain('electron-builder.json');
    });

    it('wires a Private-profile-only firewall rule for the BYOD display into the NSIS installer', () => {
      const config = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, '../electron-builder.json'), 'utf8')
      );
      expect(config.nsis.include).toBe('build/installer.nsh');

      const nsh = fs.readFileSync(path.resolve(__dirname, '../build/installer.nsh'), 'utf8');
      const ruleName = 'ODC-PhotoStudio BYOD Display (Private)';
      expect(nsh).toContain('!macro customInstall');
      expect(nsh).toContain('!macro customUnInstall');
      expect(nsh).toContain(`delete rule name="${ruleName}"`);
      expect(nsh).toContain(`add rule name="${ruleName}"`);
      expect(nsh).toContain('dir=in action=allow protocol=TCP localport=47940');
      expect(nsh).toContain('profile=private');
      expect(nsh).toContain('program="$INSTDIR\\${APP_EXECUTABLE_FILENAME}"');
      expect(nsh).not.toMatch(/profile=(public|any|domain)/i);
      expect(nsh).not.toMatch(/profile=.*(public|any)/i);
      // install replaces any prior rule first, so upgrades never leave duplicates
      expect(nsh.indexOf('delete rule')).toBeLessThan(nsh.indexOf('add rule'));
    });

    it('never mutates the firewall automatically from application code', () => {
      const mainDir = path.resolve(__dirname, '../src');
      const sources: string[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.(ts|tsx)$/.test(entry.name)) sources.push(fs.readFileSync(full, 'utf8'));
        }
      };
      walk(mainDir);
      for (const source of sources) {
        expect(source).not.toMatch(/netsh|advfirewall|New-NetFirewallRule/i);
      }
    });
  });
});

