import { TransportError, TransportErrorCode } from './UploadTransport';

const NETWORK_MESSAGE = /network|connect|timeout|timed out|offline|unreachable|socket|reset|host/i;

/**
 * Maps whatever Firebase throws to our small, SDK-agnostic error vocabulary.
 * The engine's retry decisions depend ONLY on this mapping, so it is the one
 * place that knows Firebase's error codes (and it is unit-tested).
 *
 * RNFB codes look like `storage/unauthorized` or `firestore/unavailable`;
 * we drop the prefix and map the rest.
 */
export function mapFirebaseError(error: unknown): TransportError {
  if (error instanceof TransportError) {
    return error;
  }
  const code = readString(error, 'code')?.replace(/^(storage|firestore)\//, '') ?? '';
  const message = readString(error, 'message') ?? '';
  return new TransportError(mapCode(code, message), message || code || 'Firebase error');
}

function mapCode(code: string, message: string): TransportErrorCode {
  switch (code) {
    // --- definitive rejections: retrying the same request cannot help ---
    case 'unauthorized':
    case 'permission-denied':
      return 'permission-denied';
    case 'unauthenticated':
      return 'unauthenticated';
    case 'invalid-argument':
    case 'invalid-argument-count':
    case 'failed-precondition':
    case 'out-of-range':
    case 'unimplemented':
    case 'invalid-root-operation':
    case 'invalid-format':
      return 'invalid-argument';
    case 'quota-exceeded':
      return 'quota-exceeded';

    // --- transient: the network or the server, not the request ---
    case 'unavailable':
      return 'unavailable';
    case 'deadline-exceeded':
    case 'retry-limit-exceeded':
      return 'timeout';
    case 'canceled':
    case 'cancelled':
      return 'canceled';
    case 'internal':
    case 'aborted':
    case 'data-loss':
    case 'resource-exhausted': // Firestore uses this for throttling too: back off and retry
    case 'invalid-checksum': // bytes corrupted in transit: resend
    case 'server-file-wrong-size':
      return 'server-error';
    default:
      // `unknown` is how the native SDKs report a dropped socket. Sniff the
      // message; if it doesn't look like a network problem we still retry
      // (see classifyError), but keep it labelled `unknown`.
      return NETWORK_MESSAGE.test(message) ? 'network' : 'unknown';
  }
}

export function isObjectNotFound(error: unknown): boolean {
  return readString(error, 'code') === 'storage/object-not-found';
}

function readString(value: unknown, key: string): string | undefined {
  if (typeof value === 'object' && value !== null && key in value) {
    const v = (value as Record<string, unknown>)[key];
    return typeof v === 'string' ? v : undefined;
  }
  return undefined;
}
