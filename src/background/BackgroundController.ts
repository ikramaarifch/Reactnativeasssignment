import { describeBackground, infoKey, ServiceInfo } from './describeBackground';
import { Report } from '../core/types';
import { ImageProgress } from '../core/UploadEngine';

export interface ForegroundServicePort {
  /** Starts the service. Rejects if Android refuses (e.g. app not allowed to start one now). */
  start(info: ServiceInfo): Promise<void>;
  /** Updates the notification only; safe to call while the app is in the background. */
  update(info: ServiceInfo): Promise<void>;
  stop(): Promise<void>;
  /** Ground truth from the OS: the system can stop the service (e.g. Android 15 time limit). */
  isRunning(): Promise<boolean>;
  /** Best-effort, once: ask for the notification permission so the progress is visible. */
  prepare(): Promise<void>;
}

export interface BackgroundSource {
  getReports(): readonly Report[];
  getProgress(): ImageProgress | null;
  isOnline(): boolean | undefined;
}

const MIN_UPDATE_INTERVAL_MS = 1_000;

/**
 * Keeps a foreground service alive exactly while uploads are pending, so
 * Android is much less likely to freeze or kill the process mid-upload.
 * It only OBSERVES the engine; it never makes upload decisions.
 *
 * Honest limits (see README): it cannot survive "Force stop", it cannot start
 * from the background on Android 12+, and on Android 15+ the dataSync service
 * type is capped at ~6 h per day. `sync()` re-checks reality whenever the app
 * returns to the foreground.
 */
export class BackgroundController {
  private running = false;
  private lastKey: string | null = null;
  private lastUpdateAt = 0;
  private trailing: ReturnType<typeof setTimeout> | null = null;
  private busy: Promise<void> = Promise.resolve();
  private prepared = false;

  constructor(
    private readonly port: ForegroundServicePort,
    private readonly source: BackgroundSource,
    private readonly now: () => number = Date.now,
  ) {}

  /** Call on every engine / connectivity change. Safe to call very often. */
  notify(): void {
    this.enqueue(() => this.reconcile(false));
  }

  /** Call when the app returns to the foreground: trust the OS, not our memory. */
  sync(): void {
    this.enqueue(async () => {
      this.running = await this.port.isRunning().catch(() => false);
      await this.reconcile(true);
    });
  }

  dispose(): void {
    if (this.trailing) {
      clearTimeout(this.trailing);
      this.trailing = null;
    }
  }

  /** Operations run one at a time so start/update/stop can never interleave. */
  private enqueue(task: () => Promise<void>): void {
    this.busy = this.busy.then(task).catch(() => {});
  }

  private info(): ServiceInfo | null {
    return describeBackground(
      this.source.getReports(),
      this.source.getProgress(),
      this.source.isOnline(),
      this.now(),
    );
  }

  private async reconcile(force: boolean): Promise<void> {
    const info = this.info();

    if (!info) {
      if (this.running) {
        this.running = false;
        this.lastKey = null;
        await this.port.stop();
      }
      return;
    }

    if (!this.running) {
      if (!this.prepared) {
        this.prepared = true;
        await this.port.prepare().catch(() => {});
      }
      try {
        await this.port.start(info);
        this.running = true;
        this.lastKey = infoKey(info);
        this.lastUpdateAt = this.now();
      } catch {
        // Android refused (e.g. started from the background). Uploads still run
        // while the app is alive; sync() tries again when it is foregrounded.
      }
      return;
    }

    const key = infoKey(info);
    if (!force && key === this.lastKey) {
      return;
    }
    const wait = this.lastUpdateAt + MIN_UPDATE_INTERVAL_MS - this.now();
    if (!force && wait > 0) {
      // Too soon: schedule one trailing update with the latest state.
      if (!this.trailing) {
        this.trailing = setTimeout(() => {
          this.trailing = null;
          this.notify();
        }, wait);
      }
      return;
    }
    this.lastKey = key;
    this.lastUpdateAt = this.now();
    await this.port.update(info);
  }
}
