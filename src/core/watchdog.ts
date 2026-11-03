import { NoProgressError } from './retryPolicy';
import { Cancel, Scheduler, systemScheduler } from './scheduler';

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
  scheduler: Scheduler = systemScheduler,
  now: () => number = Date.now,
): Promise<T> {
  const controller = new AbortController();
  let cancelTimer: Cancel | undefined;
  let lastProgress = now();
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

  // touch() only records the time; ONE timer re-checks it. Progress events can
  // arrive many times a second, and re-creating a timer for each would be wasteful
  // (and, with a native timer, a bridge call each).
  const touch = () => {
    lastProgress = now();
  };
  const check = () => {
    const quiet = now() - lastProgress;
    if (quiet >= stallMs) {
      stalled = true;
      controller.abort();
      rejectStall(new NoProgressError(stallMs));
    } else {
      cancelTimer = scheduler.after(stallMs - quiet, check);
    }
  };

  cancelTimer = scheduler.after(stallMs, check);
  try {
    // Race so a transport that ignores the abort signal still can't hang us.
    return await Promise.race([run(controller.signal, touch), stallPromise]);
  } catch (e) {
    if (stalled) {
      throw new NoProgressError(stallMs);
    }
    throw e;
  } finally {
    cancelTimer?.();
    parent.removeEventListener('abort', onParentAbort);
  }
}
