import { TransportError } from './UploadTransport';

/**
 * Makes a non-cancellable promise (e.g. a metadata read) respect an AbortSignal.
 * The underlying call keeps running in the background, but the caller stops
 * waiting immediately. Also handles a signal that is ALREADY aborted, because
 * the 'abort' event fires only once and would otherwise be missed.
 */
export function abortable<T>(signal: AbortSignal, promise: Promise<T>): Promise<T> {
  if (signal.aborted) {
    // Avoid an unhandled rejection from the promise we are abandoning.
    promise.catch(() => {});
    return Promise.reject(new TransportError('canceled', 'aborted'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new TransportError('canceled', 'aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
