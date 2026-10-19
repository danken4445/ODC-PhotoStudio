import {
  CustomerDisplayFrameMetaSchema,
  CustomerDisplaySnapshotSchema,
  type CustomerDisplayFrameMeta,
  type CustomerDisplaySnapshot
} from '@odc-photostudio/contracts';

const FRAME_HEADER_BYTES = 20;

export interface CustomerDisplayFrame {
  meta: CustomerDisplayFrameMeta;
  jpeg: Uint8Array;
}

export interface CustomerDisplayBridge {
  getSnapshot(): Promise<CustomerDisplaySnapshot>;
  onSnapshot(listener: (snapshot: CustomerDisplaySnapshot) => void): () => void;
  onFrame(listener: (frame: CustomerDisplayFrame) => void): () => void;
  ackSnapshot(revision: number): void;
  ackFrame(sequence: number): void;
}

export interface CustomerDisplayTransport extends CustomerDisplayBridge {
  close(): void;
}

class ElectronCustomerDisplayTransport implements CustomerDisplayTransport {
  private readonly cleanup = new Set<() => void>();

  constructor(private readonly bridge: CustomerDisplayBridge) {}

  async getSnapshot(): Promise<CustomerDisplaySnapshot> {
    return CustomerDisplaySnapshotSchema.parse(await this.bridge.getSnapshot());
  }

  onSnapshot(listener: (snapshot: CustomerDisplaySnapshot) => void): () => void {
    const unsubscribe = this.bridge.onSnapshot((snapshot) => {
      const parsed = CustomerDisplaySnapshotSchema.safeParse(snapshot);
      if (parsed.success) listener(parsed.data);
    });
    this.cleanup.add(unsubscribe);
    return () => {
      this.cleanup.delete(unsubscribe);
      unsubscribe();
    };
  }

  onFrame(listener: (frame: CustomerDisplayFrame) => void): () => void {
    const unsubscribe = this.bridge.onFrame((frame) => {
      const meta = CustomerDisplayFrameMetaSchema.safeParse(frame.meta);
      if (!meta.success || !(frame.jpeg instanceof Uint8Array)) return;
      if (frame.jpeg.byteLength !== meta.data.byteLength) return;
      listener({ meta: meta.data, jpeg: frame.jpeg });
    });
    this.cleanup.add(unsubscribe);
    return () => {
      this.cleanup.delete(unsubscribe);
      unsubscribe();
    };
  }

  ackSnapshot(revision: number): void {
    this.bridge.ackSnapshot(revision);
  }

  ackFrame(sequence: number): void {
    this.bridge.ackFrame(sequence);
  }

  close(): void {
    for (const unsubscribe of this.cleanup) unsubscribe();
    this.cleanup.clear();
  }
}

class WebSocketCustomerDisplayTransport implements CustomerDisplayTransport {
  private readonly socket: WebSocket;
  private readonly snapshotListeners = new Set<(snapshot: CustomerDisplaySnapshot) => void>();
  private readonly frameListeners = new Set<(frame: CustomerDisplayFrame) => void>();
  private latestSnapshot: CustomerDisplaySnapshot | null = null;
  private resolveInitial: ((snapshot: CustomerDisplaySnapshot) => void) | null = null;
  private rejectInitial: ((error: Error) => void) | null = null;
  private readonly initialSnapshot: Promise<CustomerDisplaySnapshot>;

  constructor(location: Location) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socket = new WebSocket(`${protocol}//${location.host}/display/socket`);
    this.socket.binaryType = 'arraybuffer';
    this.initialSnapshot = new Promise((resolve, reject) => {
      this.resolveInitial = resolve;
      this.rejectInitial = reject;
    });
    this.socket.addEventListener('message', (event) => this.handleMessage(event.data));
    this.socket.addEventListener('error', () => {
      this.rejectInitial?.(new Error('DISPLAY_SOCKET_UNAVAILABLE'));
      this.rejectInitial = null;
    });
  }

  getSnapshot(): Promise<CustomerDisplaySnapshot> {
    return this.latestSnapshot ? Promise.resolve(this.latestSnapshot) : this.initialSnapshot;
  }

  onSnapshot(listener: (snapshot: CustomerDisplaySnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  onFrame(listener: (frame: CustomerDisplayFrame) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  ackSnapshot(revision: number): void {
    this.send({ type: 'ack-snapshot', revision });
  }

  ackFrame(sequence: number): void {
    this.send({ type: 'ack-frame', sequence });
  }

  close(): void {
    this.snapshotListeners.clear();
    this.frameListeners.clear();
    this.socket.close(1000, 'display-unmounted');
  }

  private handleMessage(data: unknown): void {
    if (typeof data === 'string') {
      let value: unknown;
      try {
        value = JSON.parse(data);
      } catch {
        return;
      }
      if (!value || typeof value !== 'object' || !('type' in value)) return;
      const envelope = value as { type: unknown; snapshot?: unknown };
      if (envelope.type !== 'snapshot') return;
      const parsed = CustomerDisplaySnapshotSchema.safeParse(envelope.snapshot);
      if (!parsed.success) return;
      this.latestSnapshot = parsed.data;
      this.resolveInitial?.(parsed.data);
      this.resolveInitial = null;
      this.rejectInitial = null;
      for (const listener of this.snapshotListeners) listener(parsed.data);
      return;
    }

    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : null;
    if (!bytes) return;
    const frame = decodeFrame(bytes);
    if (!frame) return;
    for (const listener of this.frameListeners) listener(frame);
  }

  private send(value: unknown): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value));
  }
}

function decodeFrame(bytes: Uint8Array): CustomerDisplayFrame | null {
  if (
    bytes.byteLength <= FRAME_HEADER_BYTES ||
    bytes[0] !== 79 ||
    bytes[1] !== 68 ||
    bytes[2] !== 67 ||
    bytes[3] !== 70 ||
    bytes[4] !== 1 ||
    (bytes[5] !== 1 && bytes[5] !== 2) ||
    bytes[6] !== 0 ||
    bytes[7] !== 0
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jpeg = bytes.slice(FRAME_HEADER_BYTES);
  const meta = CustomerDisplayFrameMetaSchema.safeParse({
    protocolVersion: 1,
    kind: bytes[5] === 1 ? 'live' : 'preview',
    sequence: view.getUint32(8, false),
    capturedAtMs: view.getFloat64(12, false),
    byteLength: jpeg.byteLength
  });
  return meta.success ? { meta: meta.data, jpeg } : null;
}

export function createCustomerDisplayTransport(location: Location): CustomerDisplayTransport {
  if (window.odcDisplayBridge) {
    return new ElectronCustomerDisplayTransport(window.odcDisplayBridge);
  }
  return new WebSocketCustomerDisplayTransport(location);
}

declare global {
  interface Window {
    odcDisplayBridge?: CustomerDisplayBridge;
  }
}
