import { ImagePreparer } from '../images/ImagePreparer';
import { QueueStore } from '../storage/QueueStore';
import { UploadTransport } from '../transport/UploadTransport';
import { assertTransition, IN_FLIGHT } from './stateMachine';
import { backoffDelayMs, BackoffConfig, classifyError, DEFAULT_BACKOFF } from './retryPolicy';
import {
  FailureInfo,
  ImageRecord,
  imagePath,
  MAX_UPLOAD_BYTES,
  Report,
  ReportDocument,
  ReportStatus,
} from './types';
import { ImagePrepareError } from '../images/ImagePreparer';
import { Cancel, Scheduler, systemScheduler } from './scheduler';
import { withWatchdog } from './watchdog';

export interface ImageProgress {
  reportId: string;
  imageIndex: number;
  bytesTransferred: number;
  totalBytes: number;
}

/** Immutable snapshot the UI observes. A new object is created on every change. */
export interface EngineState {
  reports: readonly Report[];
  progress: ImageProgress | null;
}

export interface EngineOptions {
  store: QueueStore;
  transport: UploadTransport;
  preparer: ImagePreparer;
  now?: () => number;
  random?: () => number;
  backoff?: BackoffConfig;
  /** Abort an image upload if no bytes move for this long. */
  uploadStallMs?: number;
  /** Abort small calls (metadata check, Firestore commit) after this long. */
  requestTimeoutMs?: number;
  /** Timer source. Defaults to setTimeout; the app injects a native one that works in the background. */
  scheduler?: Scheduler;
}

type Listener = () => void;

/**
 * The queue engine. Pure TypeScript: it knows nothing about React, Firebase or
 * the file system. Rules it lives by:
 *  1. Persist the new state BEFORE doing the work it describes.
 *  2. Every step is idempotent, so redoing it after a kill is always safe.
 *  3. One report at a time, one image at a time (2G cannot do parallel uploads).
 */
export class UploadEngine {
  private readonly store: QueueStore;
  private readonly transport: UploadTransport;
  private readonly preparer: ImagePreparer;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly backoff: BackoffConfig;
  private readonly uploadStallMs: number;
  private readonly requestTimeoutMs: number;

  private state: EngineState = { reports: [], progress: null };
  private listeners = new Set<Listener>();
  private abort = new AbortController();
  private draining: Promise<void> | null = null;
  private rerun = false;
  private cancelWake: Cancel | null = null;
  private readonly scheduler: Scheduler;
  private started = false;
  /** Bumped by stop()/reset(); lets stray async work notice it belongs to a dead run. */
  private epoch = 0;

  constructor(options: EngineOptions) {
    this.store = options.store;
    this.transport = options.transport;
    this.preparer = options.preparer;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.backoff = options.backoff ?? DEFAULT_BACKOFF;
    this.uploadStallMs = options.uploadStallMs ?? 30_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.scheduler = options.scheduler ?? systemScheduler;
  }

  // ---- observation (what the UI uses) ------------------------------------

  getState = (): EngineState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  // ---- lifecycle ----------------------------------------------------------

  /**
   * Loads the queue from disk and starts working. Reports that were mid-flight
   * when the previous process died are put back to `saved_locally`: "uploading"
   * is only true while a live process is doing it.
   */
  async start(): Promise<void> {
    if (this.started) {
      // Already running: a second start must not reset in-flight reports.
      this.kick();
      return;
    }
    this.started = true;
    this.abort = new AbortController();
    for (const report of await this.store.list()) {
      if (IN_FLIGHT.includes(report.status)) {
        await this.transition(report, 'saved_locally');
      }
    }
    await this.refresh();
    this.kick();
  }

  /** Aborts in-flight work, waits for it to settle and stops scheduling. */
  async stop(): Promise<void> {
    this.started = false;
    this.epoch++;
    this.abort.abort();
    this.clearWake();
    while (this.draining) {
      await this.draining;
    }
    this.setProgress(null);
  }

  /**
   * Wipes the local queue. Order matters: abort and WAIT for in-flight work
   * first (so nothing can write a row or file afterwards), then clear. Leaves
   * the engine stopped; call start() to resume with an empty queue. Does not
   * touch the server.
   */
  async reset(): Promise<void> {
    await this.stop();
    await this.store.clear();
    this.state = { reports: [], progress: null };
    this.emit();
  }

  /**
   * Saves a new report. Resolves once it is durable; upload happens afterwards.
   * Idempotent on the report id: enqueueing an id that already exists is a no-op,
   * so a double-tap on Save can never reset a report that is already uploading.
   */
  async enqueue(report: Report): Promise<void> {
    if ((await this.store.get(report.id)) === null) {
      await this.store.put(report);
    }
    await this.refresh();
    this.kick();
  }

  /** Connectivity returned / app foregrounded: try everything waiting, right now. */
  kick(options: { skipBackoff?: boolean } = {}): void {
    if (!this.started) {
      return;
    }
    const epoch = this.epoch;
    (async () => {
      if (options.skipBackoff) {
        for (const r of await this.store.list()) {
          if (epoch !== this.epoch) {
            return; // stopped or reset meanwhile: do not write into a cleared queue
          }
          if (r.status === 'failed_retrying') {
            await this.store.put({ ...r, nextAttemptAt: this.now() });
          }
        }
        if (epoch !== this.epoch) {
          return;
        }
        await this.refresh();
      }
      this.drain();
    })().catch(() => {
      // A store failure here only delays the next pass; the periodic wake retries.
    });
  }

  /** Manual "Try again" for a failed_permanent report. */
  async retry(id: string): Promise<void> {
    const report = await this.store.get(id);
    if (!this.started || !report || report.status !== 'failed_permanent') {
      return;
    }
    await this.transition(report, 'saved_locally', {
      attempt: 0,
      nextAttemptAt: null,
      failure: null,
    });
    await this.refresh();
    this.kick();
  }

  /** Resolves when nothing is runnable right now. For tests and reset. */
  async idle(): Promise<void> {
    while (this.draining) {
      await this.draining;
    }
  }

  // ---- the loop -----------------------------------------------------------

  private drain(): void {
    if (this.draining) {
      this.rerun = true; // something changed while we were busy: look again
      return;
    }
    this.draining = (async () => {
      try {
        do {
          this.rerun = false;
          await this.runPass();
        } while (this.rerun && this.started);
      } finally {
        this.draining = null;
        this.scheduleWake().catch(() => {});
      }
    })();
  }

  private async runPass(): Promise<void> {
    while (this.started && !this.abort.signal.aborted) {
      const next = await this.nextRunnable();
      if (!next) {
        return;
      }
      await this.process(next);
    }
  }

  /**
   * Oldest-first, but a report waiting out its backoff does not block newer
   * ones: one stuck report must not hold the rest hostage. Permanent failures
   * are never picked.
   */
  private async nextRunnable(): Promise<Report | null> {
    const t = this.now();
    for (const r of await this.store.list()) {
      if (r.status === 'saved_locally') {
        return r;
      }
      if (r.status === 'failed_retrying' && (r.nextAttemptAt ?? 0) <= t) {
        return r;
      }
    }
    return null;
  }

  private async scheduleWake(): Promise<void> {
    this.clearWake();
    if (!this.started) {
      return;
    }
    const waiting = (await this.store.list())
      .filter(r => r.status === 'failed_retrying')
      .map(r => r.nextAttemptAt ?? 0);
    if (waiting.length === 0) {
      return;
    }
    const delay = Math.max(0, Math.min(...waiting) - this.now());
    this.cancelWake = this.scheduler.after(delay, () => this.drain());
  }

  private clearWake(): void {
    this.cancelWake?.();
    this.cancelWake = null;
  }

  // ---- processing one report ----------------------------------------------

  private async process(initial: Report): Promise<void> {
    try {
      let report = await this.transition(initial, 'preparing');
      report = await this.prepareImages(report);

      report = await this.transition(report, 'uploading');
      report = await this.uploadImages(report);

      report = await this.transition(report, 'finalizing');
      await this.commit(report);

      await this.transition(report, 'uploaded', {
        attempt: 0,
        nextAttemptAt: null,
        failure: null,
      });
    } catch (error) {
      if (this.abort.signal.aborted) {
        // Reset/stop: leave it resumable (start() will fix up in-flight states).
        return;
      }
      await this.handleFailure(initial.id, error);
    } finally {
      this.setProgress(null);
    }
  }

  private async prepareImages(report: Report): Promise<Report> {
    let current = report;
    for (const image of report.images) {
      if (image.status !== 'pending') {
        continue;
      }
      const prepared = await this.preparer.prepare(image.sourceUri, image.index, this.abort.signal);
      // The 5 MB guarantee is checked here, on the measured file size, before
      // the image can ever be marked uploadable. Defence in depth with the
      // Storage rule.
      if (prepared.sizeBytes >= MAX_UPLOAD_BYTES) {
        throw new ImagePrepareError('too_large', `Prepared image is ${prepared.sizeBytes} bytes`);
      }
      current = await this.updateImage(current, image.index, {
        preparedUri: prepared.uri,
        sizeBytes: prepared.sizeBytes,
        md5Base64: prepared.md5Base64,
        status: 'prepared',
      });
    }
    return current;
  }

  private async uploadImages(report: Report): Promise<Report> {
    let current = report;
    for (const image of report.images) {
      if (image.status === 'uploaded') {
        continue;
      }
      const { preparedUri, sizeBytes, md5Base64 } = image;
      if (preparedUri === null || sizeBytes === null || md5Base64 === null) {
        throw new Error(`Image ${image.index} reached upload without being prepared`);
      }
      const path = imagePath(report.id, image.index);

      // Lost-response / crash-after-upload guard: if the server already has
      // exactly these bytes, skip re-sending them (important on 2G).
      const remote = await withWatchdog(
        this.requestTimeoutMs,
        this.abort.signal,
        signal => this.transport.getRemoteImage(path, signal),
        this.scheduler,
        this.now,
      );
      const alreadyThere =
        remote !== null && remote.sizeBytes === sizeBytes && remote.md5Base64 === md5Base64;

      if (!alreadyThere) {
        await withWatchdog(
          this.uploadStallMs,
          this.abort.signal,
          (signal, touch) =>
          this.transport.uploadImage({
            path,
            localUri: preparedUri,
            sizeBytes,
            signal,
            onProgress: (bytesTransferred, totalBytes) => {
              touch();
              this.setProgress({
                reportId: report.id,
                imageIndex: image.index,
                bytesTransferred,
                totalBytes,
              });
            },
          }),
          this.scheduler,
          this.now,
        );
      }
      current = await this.updateImage(current, image.index, { status: 'uploaded' });
    }
    return current;
  }

  private async commit(report: Report): Promise<void> {
    const doc: ReportDocument = {
      id: report.id,
      description: report.description,
      imagePaths: report.images.map(i => imagePath(report.id, i.index)),
      createdAt: report.createdAt,
      status: 'complete',
    };
    await withWatchdog(
      this.requestTimeoutMs,
      this.abort.signal,
      signal => this.transport.commitReport(doc, signal),
      this.scheduler,
      this.now,
    );
  }

  private async handleFailure(id: string, error: unknown): Promise<void> {
    const report = await this.store.get(id);
    if (!report) {
      return;
    }
    const c = classifyError(error);
    const failure: FailureInfo = { code: c.code, reason: c.reason, at: this.now() };
    if (c.retryable) {
      const attempt = report.attempt + 1;
      await this.transition(report, 'failed_retrying', {
        attempt,
        failure,
        nextAttemptAt: this.now() + backoffDelayMs(attempt, this.random, this.backoff),
      });
    } else {
      await this.transition(report, 'failed_permanent', { failure, nextAttemptAt: null });
    }
  }

  // ---- persistence helpers -------------------------------------------------

  /** Persist-then-publish: the store is written before anyone (or any code) sees the new state. */
  private async transition(
    report: Report,
    to: ReportStatus,
    patch: Partial<Report> = {},
  ): Promise<Report> {
    this.throwIfAborted();
    assertTransition(report.status, to);
    const next: Report = { ...report, ...patch, status: to };
    await this.store.put(next);
    await this.refresh();
    return next;
  }

  private async updateImage(
    report: Report,
    index: number,
    patch: Partial<ImageRecord>,
  ): Promise<Report> {
    this.throwIfAborted();
    const next: Report = {
      ...report,
      images: report.images.map(i => (i.index === index ? { ...i, ...patch } : i)),
    };
    await this.store.put(next);
    await this.refresh();
    return next;
  }

  /** Once aborted (stop/reset) no further state may be persisted. */
  private throwIfAborted(): void {
    if (this.abort.signal.aborted) {
      throw new Error('aborted');
    }
  }

  private async refresh(): Promise<void> {
    this.state = { ...this.state, reports: await this.store.list() };
    this.emit();
  }

  private setProgress(progress: ImageProgress | null): void {
    this.state = { ...this.state, progress };
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach(l => l());
  }
}
