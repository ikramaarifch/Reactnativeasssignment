import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { PermissionController, PermissionStatus } from '../permissions/PermissionController';

/**
 * Observes a permission and re-checks it whenever the app returns to the
 * foreground, so granting it in system Settings works without a restart.
 */
export function usePermission(controller: PermissionController): PermissionStatus {
  useEffect(() => {
    controller.recheck();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        controller.recheck();
      }
    });
    return () => subscription.remove();
  }, [controller]);
  return useSyncExternalStore(controller.subscribe, controller.getStatus);
}
