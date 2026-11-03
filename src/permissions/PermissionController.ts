/**
 * granted  - usable
 * denied   - not granted, but the system dialog can still be shown ("Allow")
 * blocked  - user chose "never ask again": only Settings can fix it
 * unknown  - not checked yet
 */
export type PermissionStatus = 'unknown' | 'granted' | 'denied' | 'blocked';

export interface PermissionPort {
  isGranted(): Promise<boolean>;
  /** Shows the system dialog (or returns 'blocked' immediately if it cannot). */
  request(): Promise<'granted' | 'denied' | 'blocked'>;
}

/**
 * Tracks one permission. The OS cannot tell us "blocked" when merely checking,
 * so we remember it from the last request(). `recheck()` is called when the app
 * returns to the foreground: a permission granted in Settings then just works,
 * with no restart.
 */
export class PermissionController {
  private status: PermissionStatus = 'unknown';
  private listeners = new Set<() => void>();

  constructor(private readonly port: PermissionPort) {}

  getStatus = (): PermissionStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async recheck(): Promise<PermissionStatus> {
    if (await this.port.isGranted()) {
      return this.set('granted');
    }
    // Lost or never granted. Keep "blocked" if we already learned that.
    return this.set(this.status === 'blocked' ? 'blocked' : 'denied');
  }

  /** Resolves true if the permission is available after (maybe) asking. */
  async ensure(): Promise<boolean> {
    if (await this.port.isGranted()) {
      this.set('granted');
      return true;
    }
    const result = await this.port.request();
    this.set(result);
    return result === 'granted';
  }

  private set(next: PermissionStatus): PermissionStatus {
    if (next !== this.status) {
      this.status = next;
      this.listeners.forEach(l => l());
    }
    return next;
  }
}
