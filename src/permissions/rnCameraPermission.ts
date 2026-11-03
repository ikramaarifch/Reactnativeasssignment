import { PermissionsAndroid, Platform } from 'react-native';
import { PermissionController, PermissionPort } from './PermissionController';

const CAMERA = PermissionsAndroid.PERMISSIONS.CAMERA;

const cameraPort: PermissionPort = {
  isGranted: async () => (Platform.OS === 'android' ? PermissionsAndroid.check(CAMERA) : true),
  request: async () => {
    if (Platform.OS !== 'android') {
      return 'granted';
    }
    const result = await PermissionsAndroid.request(CAMERA);
    if (result === PermissionsAndroid.RESULTS.GRANTED) {
      return 'granted';
    }
    return result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied';
  },
};

export const cameraPermission = new PermissionController(cameraPort);
