import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { ForegroundServicePort } from './BackgroundController';
import { ServiceInfo } from './describeBackground';

interface UploadServiceNative {
  start(title: string, text: string, progress: number, max: number): Promise<void>;
  update(title: string, text: string, progress: number, max: number): Promise<void>;
  stop(): Promise<void>;
  isRunning(): Promise<boolean>;
}

const native = NativeModules.UploadService as UploadServiceNative | undefined;

const args = (info: ServiceInfo): [string, string, number, number] => [
  info.title,
  info.text,
  info.progress?.current ?? 0,
  info.progress?.max ?? 0, // max 0 => no progress bar
];

/** Android adapter. On other platforms every call is a no-op (iOS has no equivalent we rely on). */
export const rnForegroundService: ForegroundServicePort = {
  async start(info) {
    if (Platform.OS === 'android' && native) {
      await native.start(...args(info));
    }
  },
  async update(info) {
    if (Platform.OS === 'android' && native) {
      await native.update(...args(info));
    }
  },
  async stop() {
    if (Platform.OS === 'android' && native) {
      await native.stop();
    }
  },
  async isRunning() {
    return Platform.OS === 'android' && native ? native.isRunning() : false;
  },
  async prepare() {
    // Android 13+ (API 33): without this the progress notification is hidden.
    // The service still works if the user says no, so this is best-effort.
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
    }
  },
};
