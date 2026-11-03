import { Platform } from 'react-native';
import { connectFirestoreEmulator, getFirestore } from '@react-native-firebase/firestore';
import { connectStorageEmulator, getStorage } from '@react-native-firebase/storage';

// The Android emulator reaches the dev machine's localhost via 10.0.2.2.
// A physical device needs the machine's LAN IP (or `adb reverse`, see README).
const EMULATOR_HOST = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
const FIRESTORE_PORT = 8080;
const STORAGE_PORT = 9199;

let configured = false;

/**
 * Points Firebase at the local Emulator Suite in debug builds. Must run once,
 * before the first Firestore/Storage call, otherwise the SDK has already
 * talked to production and the emulator settings are rejected.
 */
export function configureFirebase(): void {
  if (configured) {
    return;
  }
  configured = true;
  if (__DEV__) {
    connectFirestoreEmulator(getFirestore(), EMULATOR_HOST, FIRESTORE_PORT);
    connectStorageEmulator(getStorage(), EMULATOR_HOST, STORAGE_PORT);
  }
}
