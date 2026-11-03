import { Report } from '../core/types';

/**
 * Durable home of the queue. `put` must be atomic and durable when it resolves:
 * the engine persists every transition BEFORE acting on it, so a kill right
 * after `put` resolves must still find the new state on restart.
 */
export interface QueueStore {
  /** Insert or fully replace a report (one atomic write per report). */
  put(report: Report): Promise<void>;
  get(id: string): Promise<Report | null>;
  /** Oldest first. */
  list(): Promise<Report[]>;
  /** Removes every report (used by reset). */
  clear(): Promise<void>;
}
