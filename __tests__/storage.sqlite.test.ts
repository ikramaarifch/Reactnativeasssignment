import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SqlDatabase, SqliteQueueStore } from '../src/storage/SqliteQueueStore';
import { newReport } from '../src/testing/harness';

/** better-sqlite3 behind the same tiny interface op-sqlite is adapted to. */
function open(file: string): { db: SqlDatabase; close: () => void } {
  const raw = new Database(file);
  return {
    db: {
      execute: async (sql, params = []) => {
        const stmt = raw.prepare(sql);
        return stmt.reader ? (stmt.all(...params) as Record<string, unknown>[]) : (stmt.run(...params), []);
      },
    },
    close: () => raw.close(),
  };
}

describe('SqliteQueueStore', () => {
  let file: string;
  beforeEach(() => {
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'queue-')), 'q.db');
  });

  it('survives closing and reopening the database (process restart)', async () => {
    const a = open(file);
    const storeA = new SqliteQueueStore(a.db);
    await storeA.put(newReport('r1', 2));
    a.close();

    const b = open(file);
    const storeB = new SqliteQueueStore(b.db);
    const loaded = await storeB.get('r1');
    expect(loaded?.images).toHaveLength(2);
    expect(loaded?.status).toBe('saved_locally');
    b.close();
  });

  it('put replaces the same report atomically (no duplicate rows)', async () => {
    const o = open(file);
    const store = new SqliteQueueStore(o.db);
    const r = newReport('r1', 1);
    await store.put(r);
    await store.put({ ...r, status: 'uploading' });
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.status).toBe('uploading');
    o.close();
  });

  it('lists oldest first and clear() empties it', async () => {
    const o = open(file);
    const store = new SqliteQueueStore(o.db);
    await store.put(newReport('b', 1, 2_000));
    await store.put(newReport('a', 1, 1_000));
    expect((await store.list()).map(r => r.id)).toEqual(['a', 'b']);
    await store.clear();
    expect(await store.list()).toEqual([]);
    expect(await store.get('a')).toBeNull();
    o.close();
  });
});
