import { NoProgressError } from './retryPolicy';

/**
 * No-progress watchdog. Aborts if `touch()` has not been called for `stallMs`.
 *
 * Deliberately NOT a total timeout: on 2G a 4 MB image can legitimately take
 * minutes, so as long as bytes keep moving we keep waiting. A request that
 * hangs forever sends nothing, so it is cut after `stallMs`.
 *
 * Small calls that have no progress events (metadata check, Firestore commit)
 * use the same helper and never touch(), which makes it a plain timeout.
 */
export async function withWatchdog<T>(
  stallMs: number,
  parent: AbortSignal,
  run: (signal: AbortSignal, touch: () => void) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stalled = false;

  const onParentAbort = () => controller.abort();
  if (parent.aborted) {
    controller.abort();
  }
  parent.addEventListener('abort', onParentAbort);

  let rejectStall: (e: Error) => void = () => {};
  const stallPromise = new Promise<never>((_, reject) => {
    rejectStall = reject;
  });

  const arm = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      stalled = true;
      controller.abort();
      rejectStall(new NoProgressError(stallMs));
    }, stallMs);
  };

  arm();
  try {
    // Race so a transport that ignores the abort signal still can't hang us.
    return await Promise.race([run(controller.signal, arm), stallPromise]);
  } catch (e) {
    if (stalled) {
      throw new NoProgressError(stallMs);
    }
    throw e;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    parent.removeEventListener('abort', onParentAbort);
  }
}
