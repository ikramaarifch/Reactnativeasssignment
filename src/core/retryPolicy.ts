import { ImagePrepareError } from '../images/ImagePreparer';
import { TransportError } from '../transport/UploadTransport';
import { FailureCode } from './types';

export class NoProgressError extends Error {
  constructor(readonly stalledMs: number) {
    super(`No bytes moved for ${stalledMs} ms`);
    this.name = 'NoProgressError';
  }
}

export interface Classification {
  retryable: boolean;
  code: FailureCode;
  /** Shown to the user. Says what happened, never leaks SDK jargon. */
  reason: string;
}

const retry = (code: FailureCode, reason: string): Classification => ({
  retryable: true,
  code,
  reason: `${reason} Will retry automatically.`,
});

const permanent = (code: FailureCode, reason: string): Classification => ({
  retryable: false,
  code,
  reason,
});

/**
 * Retryable = the same request may well succeed later (the network, not the
 * request, is at fault). Everything the server explicitly rejected is permanent:
 * retrying a `permission-denied` forever would burn battery and hide the problem.
 * Unrecognised errors are retried: for an unattended uploader, giving up on a
 * report we cannot explain is worse than trying again.
 */
export function classifyError(error: unknown): Classification {
  if (error instanceof NoProgressError) {
    return retry('no_progress', 'The connection stalled.');
  }
  if (error instanceof ImagePrepareError) {
    switch (error.code) {
      case 'source_missing':
        return permanent('source_missing', 'A photo file is no longer on this phone.');
      case 'corrupt':
        return permanent('image_corrupt', 'A photo could not be read (corrupt or unsupported).');
      case 'too_large':
        return permanent('image_too_large', 'A photo could not be reduced under 5 MB.');
      default:
        return retry('unknown', 'Could not prepare photos right now.');
    }
  }
  if (error instanceof TransportError) {
    switch (error.code) {
      case 'network':
      case 'unavailable':
        return retry('network', 'No connection to the server.');
      case 'timeout':
      case 'deadline-exceeded':
        return retry('timeout', 'The server took too long.');
      case 'server-error':
        return retry('server_error', 'The server had a problem.');
      case 'canceled':
        return retry('network', 'Upload interrupted.');
      case 'permission-denied':
      case 'unauthenticated':
        return permanent('permission_denied', 'The server refused this report (not allowed).');
      case 'invalid-argument':
        return permanent('invalid_argument', 'The server rejected this report as invalid.');
      case 'quota-exceeded':
        return permanent('quota_exceeded', 'Server storage quota exceeded.');
      default:
        break;
    }
  }
  return retry('unknown', 'Something went wrong.');
}

export interface BackoffConfig {
  baseMs: number;
  capMs: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = { baseMs: 2_000, capMs: 5 * 60_000 };

/**
 * Exponential backoff with "full jitter": a random delay in [0, min(cap, base*2^attempt)].
 * Jitter stops many phones that lost signal together from retrying in lockstep.
 * `random` is injected (0..1) so tests are deterministic.
 */
export function backoffDelayMs(
  attempt: number,
  random: () => number,
  config: BackoffConfig = DEFAULT_BACKOFF,
): number {
  const ceiling = Math.min(config.capMs, config.baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(random() * ceiling);
}
