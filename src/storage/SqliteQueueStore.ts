import { Report } from '../core/types';
import { QueueStore } from './QueueStore';

export type SqlValue = string | number | null;

/**
 * The tiny slice of a SQLite driver we need. The app plugs in op-sqlite; tests
 * plug in better-sqlite3, so the real SQL below is exercised in Jest.
 */
export interface SqlDatabase {
  execute(sql: string, params?: SqlValue[]): Promise<Record<string, unknown>[]>;
}

/**
 * One row per report; the report (including every image's state) is a single
 * JSON blob. Why: a single-row write is atomic in SQLite, so a report can
 * never be half-updated (e.g. status says `uploading` but image states are
 * stale) no matter when the process is killed. status/created_at are real
 * columns only so the queue can be queried and inspected.
 */
export class SqliteQueueStore implements QueueStore {
  private ready: Promise<void> | null = null;

  constructor(private readonly db: SqlDatabase) {}

  private init(): Promise<void> {
    this.ready ??= (async () => {
      // WAL = readers don't block the writer. synchronous=FULL = a committed
      // write is fsynced, so it survives even a sudden power loss.
      await this.db.execute('PRAGMA journal_mode = WAL');
      await this.db.execute('PRAGMA synchronous = FULL');
      await this.db.execute(
        `CREATE TABLE IF NOT EXISTS reports (
           id TEXT PRIMARY KEY NOT NULL,
           status TEXT NOT NULL,
           created_at INTEGER NOT NULL,
           data TEXT NOT NULL
         )`,
      );
      await this.db.execute(
        'CREATE INDEX IF NOT EXISTS reports_order ON reports (created_at, id)',
      );
    })();
    return this.ready;
  }

  async put(report: Report): Promise<void> {
    await this.init();
    await this.db.execute(
      `INSERT INTO reports (id, status, created_at, data) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data`,
      [report.id, report.status, report.createdAt, JSON.stringify(report)],
    );
  }

  async get(id: string): Promise<Report | null> {
    await this.init();
    const rows = await this.db.execute('SELECT data FROM reports WHERE id = ?', [id]);
    const first = rows[0];
    return first ? parse(first.data) : null;
  }

  async list(): Promise<Report[]> {
    await this.init();
    const rows = await this.db.execute('SELECT data FROM reports ORDER BY created_at, id');
    return rows.map(r => parse(r.data));
  }

  async clear(): Promise<void> {
    await this.init();
    await this.db.execute('DELETE FROM reports');
  }
}

function parse(data: unknown): Report {
  if (typeof data !== 'string') {
    throw new Error('Corrupt queue row: data is not a string');
  }
  return JSON.parse(data) as Report;
}
