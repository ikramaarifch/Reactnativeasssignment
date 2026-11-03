import { NativeModules, Platform } from 'react-native';
import { Scheduler, systemScheduler } from '../core/scheduler';

interface SleepNative {
  sleep(ms: number): Promise<void>;
}

const native = NativeModules.UploadService as SleepNative | undefined;

/**
 * Timers that keep firing while the app is in the background.
 *
 * React Native's setTimeout is driven by the display's frame callback, which
 * stops without a visible window (measured on Android 16: a 5 s interval fired
 * once, then never). A native Handler is unaffected, and its promise resolving
 * wakes the JS side. Cancelling just ignores the late result; callers keep the
 * number of outstanding timers low (see withWatchdog).
 */
export const nativeScheduler: Scheduler =
  Platform.OS === 'android' && native
    ? {
        after(ms, fn) {
          let cancelled = false;
          native.sleep(ms).then(
            () => {
              if (!cancelled) {
                fn();
              }
            },
            () => {},
          );
          return () => {
            cancelled = true;
          };
        },
      }
    : systemScheduler;
