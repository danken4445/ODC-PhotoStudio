import { parentPort, workerData } from 'node:worker_threads';
import {
  renderCompositeImage,
  type RenderCompositeInput
} from '@odc-photostudio/template-engine';

/**
 * Isolated Worker Process for CPU-heavy Sharp Compositing (Section 4 & 5):
 * Keeps image normalization, rotation, cropping, and QR compositing off the renderer
 * and away from latency-sensitive Electron main-process event handlers.
 */
async function runWorker(): Promise<void> {
  if (!parentPort) {
    return;
  }

  parentPort.on('message', async (msg: { id: string; payload: RenderCompositeInput }) => {
    try {
      const result = await renderCompositeImage(msg.payload);
      parentPort?.postMessage({
        id: msg.id,
        ok: true,
        result
      });
    } catch (err: unknown) {
      parentPort?.postMessage({
        id: msg.id,
        ok: false,
        error: err instanceof Error ? err.message : 'COMPOSITOR_WORKER_ERROR'
      });
    }
  });
}

void runWorker();
export { workerData };
