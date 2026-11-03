import { AppStatePort } from '../app/triggers';
import { UploadEngine } from '../core/UploadEngine';
import { ConnectivityMonitor } from '../network/ConnectivityMonitor';
import { BackgroundController } from './BackgroundController';

/**
 * Connects the controller to the things that change what the notification says.
 * Returns a function that removes every subscription.
 */
export function startBackground(
  controller: BackgroundController,
  engine: Pick<UploadEngine, 'subscribe'>,
  connectivity: Pick<ConnectivityMonitor, 'subscribe'>,
  appState: AppStatePort,
): () => void {
  const offEngine = engine.subscribe(() => controller.notify());
  const offNet = connectivity.subscribe(() => controller.notify());
  // Back in the foreground: the only moment Android lets us start a service,
  // and the moment to trust the OS over our own memory.
  const offForeground = appState.onForeground(() => controller.sync());
  controller.sync();
  return () => {
    offEngine();
    offNet();
    offForeground();
    controller.dispose();
  };
}
