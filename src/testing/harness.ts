import { createReport } from '../core/report';
import { EngineOptions, EngineState, UploadEngine } from '../core/UploadEngine';
import { Report } from '../core/types';
import { MemoryQueueStore } from '../storage/MemoryQueueStore';
import { QueueStore } from '../storage/QueueStore';
import { FakePreparer, FakeServer, FakeTransport } from './fakes';

/**
 * "Disk" = store + server + preparer files. Creating a second engine over the
 * same harness simulates restarting the app: memory is gone, disk survived.
 */
export class Harness {
  readonly store: QueueStore;
  readonly server = new FakeServer();
  readonly preparer = new FakePreparer();
  readonly transport: FakeTransport;
  readonly engines: UploadEngine[] = [];

  constructor(store: QueueStore = new MemoryQueueStore()) {
    this.store = store;
    this.transport = new FakeTransport(this.server, this.preparer.md5ByUri);
  }

  engine(overrides: Partial<EngineOptions> = {}): UploadEngine {
    const engine = new UploadEngine({
      store: this.store,
      transport: this.transport,
      preparer: this.preparer,
      random: () => 0, // zero jitter => retries are due immediately
      uploadStallMs: 2_000,
      requestTimeoutMs: 2_000,
      ...overrides,
    });
    this.engines.push(engine);
    return engine;
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.engines.map(e => e.stop()));
  }
}

export const newReport = (id: string, imageCount = 2, createdAt = 1_000): Report =>
  createReport(
    {
      description: `report ${id}`,
      imageUris: Array.from({ length: imageCount }, (_, i) => `file:///docs/${id}-${i}.jpg`),
    },
    id,
    createdAt,
  );

export const statusOf = (engine: UploadEngine, id: string): string | undefined =>
  engine.getState().reports.find(r => r.id === id)?.status;

/** Resolves when the predicate holds for the engine state; rejects on timeout. */
export function until(
  engine: UploadEngine,
  predicate: (s: EngineState) => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (predicate(engine.getState())) {
      return resolve();
    }
    const timer = setTimeout(() => {
      unsubscribe();
      reject(
        new Error(
          `until() timed out; statuses: ${JSON.stringify(
            engine.getState().reports.map(r => [r.id, r.status, r.failure?.code]),
          )}`,
        ),
      );
    }, timeoutMs);
    const unsubscribe = engine.subscribe(() => {
      if (predicate(engine.getState())) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

export const reportIs = (id: string, status: string) => (s: EngineState) =>
  s.reports.find(r => r.id === id)?.status === status;
