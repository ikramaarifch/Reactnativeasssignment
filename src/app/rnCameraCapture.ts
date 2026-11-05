import { NativeModules } from 'react-native';
import { CameraCapturePort } from './draft';

interface CameraCaptureNative {
  capture(path: string): Promise<'captured' | 'cancelled'>;
}

const native = NativeModules.CameraCapture as CameraCaptureNative | undefined;

/** Android camera that writes to a path we chose (see CameraCaptureModule.kt for why). */
export const rnCameraCapture: CameraCapturePort = {
  capture: path => {
    if (!native) {
      return Promise.reject(Object.assign(new Error('Camera module missing'), { code: 'E_CAMERA_UNAVAILABLE' }));
    }
    return native.capture(path);
  },
};
