import { ReportDocument } from '../core/types';
import { abortable } from './abortable';
import {
  RemoteImageInfo,
  TransportError,
  UploadImageRequest,
  UploadTransport,
} from './UploadTransport';

export type FaultMode =
  | 'normal'
  | 'slow' // extra latency + throttled progress, then succeeds
  | 'drop_after_bytes' // connection dies after N bytes of an upload
  | 'refuse' // server rejects everything (permission-denied)
  | 'server_error' // 5xx-style failure
  | 'hang'; // never responds

export interface FaultConfig {
  mode: FaultMode;
  /** slow: added to every call. */
  latencyMs: number;
  /** slow / drop_after_bytes: simulated upload speed. */
  bytesPerSecond: number;
  /** drop_after_bytes: how many bytes get through before the drop. */
  dropAfterBytes: number;
}

export const DEFAULT_FAULT_CONFIG: FaultConfig = {
  mode: 'normal',
  latencyMs: 1_500,
  bytesPerSecond: 50 * 1024,
  dropAfterBytes: 200 * 1024,
};

/** Live-editable fault settings; the dev screen writes, the transport reads on every call. */
export class FaultController {
  private config: FaultConfig;
  private listeners = new Set<() => void>();

  constructor(initial: Partial<FaultConfig> = {}) {
    this.config = { ...DEFAULT_FAULT_CONFIG, ...initial };
  }

  get = (): FaultConfig => this.config;

  set(patch: Partial<FaultConfig>): void {
    this.config = { ...this.config, ...patch };
    this.listeners.forEach(l => l());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

const abortableSleep: Sleep = (ms, signal) =>
  abortable(
    signal,
    new Promise<void>(resolve => {
      setTimeout(resolve, ms);
    }),
  );

const TICK_MS = 200;

/**
 * Wraps any UploadTransport and misbehaves on demand. The engine cannot tell
 * it from a bad network, which is the point: the same code path is exercised
 * whether the failure is real or injected. (For truly real failures see the
 * README: emulator network throttling, airplane mode, stopping the emulator.)
 *
 * Note `slow` throttles by simulating progress before the real upload; it does
 * not slow the real socket.
 */
export class FaultyTransport implements UploadTransport {
  constructor(
    private readonly inner: UploadTransport,
    private readonly faults: FaultController,
    private readonly sleep: Sleep = abortableSleep,
  ) {}

  async getRemoteImage(path: string, signal: AbortSignal): Promise<RemoteImageInfo | null> {
    await this.beforeCall(signal);
    return this.inner.getRemoteImage(path, signal);
  }

  async uploadImage(request: UploadImageRequest): Promise<void> {
    const { signal } = request;
    await this.beforeCall(signal);
    const config = this.faults.get();

    if (config.mode === 'slow') {
      await this.simulateTransfer(request, request.sizeBytes, config.bytesPerSecond);
    } else if (config.mode === 'drop_after_bytes') {
      await this.simulateTransfer(request, config.dropAfterBytes, config.bytesPerSecond);
      if (config.dropAfterBytes < request.sizeBytes) {
        throw new TransportError('network', 'Connection dropped mid-upload (injected)');
      }
    }
    await this.inner.uploadImage(request);
  }

  async commitReport(doc: ReportDocument, signal: AbortSignal): Promise<void> {
    await this.beforeCall(signal);
    return this.inner.commitReport(doc, signal);
  }

  /** Faults that apply to every call, regardless of kind. */
  private async beforeCall(signal: AbortSignal): Promise<void> {
    const { mode, latencyMs } = this.faults.get();
    switch (mode) {
      case 'refuse':
        throw new TransportError('permission-denied', 'Refused (injected)');
      case 'server_error':
        throw new TransportError('server-error', 'Server error (injected)');
      case 'hang':
        // Never settles on its own; only an abort (watchdog / reset) ends it.
        await abortable(signal, new Promise<never>(() => {}));
        return;
      case 'slow':
        await this.sleep(latencyMs, signal);
        return;
      default:
        return;
    }
  }

  /** Reports progress at the configured speed until `limit` bytes have "moved". */
  private async simulateTransfer(
    request: UploadImageRequest,
    limit: number,
    bytesPerSecond: number,
  ): Promise<void> {
    const target = Math.min(limit, request.sizeBytes);
    const perTick = Math.max(1, Math.floor((bytesPerSecond * TICK_MS) / 1000));
    let sent = 0;
    while (sent < target) {
      await this.sleep(TICK_MS, request.signal);
      sent = Math.min(target, sent + perTick);
      request.onProgress(sent, request.sizeBytes);
    }
  }
}
