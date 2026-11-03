import { Report } from '../core/types';
import { QueueStore } from './QueueStore';

/**
 * In-memory store for tests. It deep-copies on the way in and out so a test
 * cannot accidentally share object references with the engine, which would hide
 * "forgot to persist" bugs. Sharing one instance between two engines simulates
 * an app restart (the disk survived, the process did not).
 */
export class MemoryQueueStore implements QueueStore {
  private rows = new Map<string, string>();

  async put(report: Report): Promise<void> {
    this.rows.set(report.id, JSON.stringify(report));
  }

  async get(id: string): Promise<Report | null> {
    const raw = this.rows.get(id);
    return raw === undefined ? null : (JSON.parse(raw) as Report);
  }

  async list(): Promise<Report[]> {
    return [...this.rows.values()]
      .map(raw => JSON.parse(raw) as Report)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  async clear(): Promise<void> {
    this.rows.clear();
  }
}
