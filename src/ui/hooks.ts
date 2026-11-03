import { useEffect, useState, useSyncExternalStore } from 'react';
import { ConnectivityMonitor } from '../network/ConnectivityMonitor';

/** true / false, or undefined until the OS has reported once. */
export const useOnline = (monitor: ConnectivityMonitor): boolean | undefined =>
  useSyncExternalStore(monitor.subscribe, monitor.isOnline);

/**
 * Current time, refreshed every second while `active`. Only used to count down
 * "Next try in 12 s"; when nothing is waiting there is no timer at all.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
