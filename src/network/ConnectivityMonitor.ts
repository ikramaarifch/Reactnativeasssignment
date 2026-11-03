export interface ConnectivityPort {
  /** Calls back immediately with the current state and again on every change. */
  subscribe(listener: (online: boolean) => void): () => void;
}

/**
 * Tracks online/offline and fires `onRestored` on an offline -> online edge.
 *
 * Connectivity is a HINT, never a gate: the engine still attempts uploads while
 * "offline" (the OS can be wrong, e.g. captive portals or a flaky 2G link that
 * reports connected). The hint only makes retries start sooner and powers the
 * banner.
 */
export class ConnectivityMonitor {
  /** undefined until the first report from the OS. */
  private online: boolean | undefined;
  private listeners = new Set<() => void>();
  private restored = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly port: ConnectivityPort) {}

  start(): void {
    if (this.unsubscribe) {
      return;
    }
    this.unsubscribe = this.port.subscribe(online => {
      const was = this.online;
      if (was === online) {
        return;
      }
      this.online = online;
      this.listeners.forEach(l => l());
      if (online && was === false) {
        this.restored.forEach(r => r());
      }
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  isOnline = (): boolean | undefined => this.online;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  onRestored(listener: () => void): () => void {
    this.restored.add(listener);
    return () => {
      this.restored.delete(listener);
    };
  }
}
