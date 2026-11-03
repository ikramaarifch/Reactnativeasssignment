import { open } from '@op-engineering/op-sqlite';
import { SqlDatabase } from './SqliteQueueStore';

/** Opens the on-device queue database (app-private, survives force-quit). */
export function openQueueDatabase(name = 'field-reports.db'): SqlDatabase {
  const db = open({ name });
  return {
    execute: async (sql, params) => (await db.execute(sql, params)).rows,
  };
}
