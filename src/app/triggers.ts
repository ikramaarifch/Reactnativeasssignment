import { UploadEngine } from '../core/UploadEngine';
import { ConnectivityMonitor } from '../network/ConnectivityMonitor';

export interface AppStatePort {
  /** Calls back with true each time the app returns to the foreground. */
  onForeground(listener: () => void): () => void;
}

/**
 * Wakes the engine immediately (skipping backoff) when something that could
 * unblock uploads happens: connectivity returns, or the user comes back to the
 * app. Without this, a report in a long backoff would sit idle while the
 * network is already back. Returns a function that removes the triggers.
 */
export function startRetryTriggers(
  engine: Pick<UploadEngine, 'kick'>,
  connectivity: ConnectivityMonitor,
  appState: AppStatePort,
): () => void {
  const wake = () => engine.kick({ skipBackoff: true });
  connectivity.start();
  const offRestored = connectivity.onRestored(wake);
  const offForeground = appState.onForeground(wake);
  return () => {
    offRestored();
    offForeground();
    connectivity.stop();
  };
}
