import { ReportStatus } from './types';

/**
 * The only legal moves. Any other transition is a bug, so we throw instead of
 * silently corrupting a report's lifecycle.
 *
 * `uploaded` is terminal. `failed_permanent` only leaves via a manual retry.
 * Resuming after a kill or a retryable failure always goes back through
 * `saved_locally`/`preparing`: every step is idempotent, so redoing the
 * (cheap) checks is safer than trying to resume "in the middle".
 */
const TRANSITIONS: Record<ReportStatus, readonly ReportStatus[]> = {
  saved_locally: ['preparing', 'failed_retrying', 'failed_permanent'],
  preparing: ['uploading', 'saved_locally', 'failed_retrying', 'failed_permanent'],
  uploading: ['finalizing', 'saved_locally', 'failed_retrying', 'failed_permanent'],
  finalizing: ['uploaded', 'saved_locally', 'failed_retrying', 'failed_permanent'],
  failed_retrying: ['preparing', 'saved_locally', 'failed_permanent'],
  failed_permanent: ['saved_locally'],
  uploaded: [],
};

export class IllegalTransitionError extends Error {
  constructor(from: ReportStatus, to: ReportStatus) {
    super(`Illegal report transition ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export const canTransition = (from: ReportStatus, to: ReportStatus): boolean =>
  TRANSITIONS[from].includes(to);

export function assertTransition(from: ReportStatus, to: ReportStatus): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to);
  }
}

/** Statuses that only make sense while a live process is working on the report. */
export const IN_FLIGHT: readonly ReportStatus[] = ['preparing', 'uploading', 'finalizing'];

export const isTerminal = (s: ReportStatus): boolean => s === 'uploaded';
