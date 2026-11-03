/**
 * Where timers come from. The engine's no-progress watchdog and its retry
 * backoff must keep firing while the app is in the background, but React
 * Native's own timers are driven by the display's frame callback and stop when
 * the app is not visible (verified on Android 16). So timing is injectable:
 * tests and the foreground use setTimeout, the app plugs in a native timer.
 */
export type Cancel = () => void;

export interface Scheduler {
  /** Runs `fn` once after `ms`. Returns a function that cancels it. */
  after(ms: number, fn: () => void): Cancel;
}

export const systemScheduler: Scheduler = {
  after(ms, fn) {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
};
