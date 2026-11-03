import { AppState } from 'react-native';
import { AppStatePort } from './triggers';

export const rnAppState: AppStatePort = {
  onForeground: listener => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        listener();
      }
    });
    return () => subscription.remove();
  },
};
