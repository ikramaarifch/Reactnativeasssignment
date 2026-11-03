import { getApp } from '@react-native-firebase/app';
import {
  connectFirestoreEmulator,
  Firestore,
  initializeFirestore,
} from '@react-native-firebase/firestore';
import { USE_FIRESTORE_EMULATOR } from './target';

// With the emulator, `adb reverse` (npm run adb:reverse) forwards the phone's
// 127.0.0.1 to this PC; RNFB's own host remap is disabled in firebase.json.
const EMULATOR_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8080;

let firestoreInstance: Firestore | null = null;

/**
 * Must run once, before the first Firestore call.
 *
 * Firestore offline persistence is switched OFF on purpose: with it on, a
 * `setDoc` made offline is silently queued by the SDK and "succeeds" later,
 * outside our control. Our own SQLite queue is the only source of truth for
 * what has and has not been delivered.
 */
export function configureFirebase(): void {
  if (firestoreInstance) {
    return;
  }
  firestoreInstance = initializeFirestore(getApp(), { persistence: false });
  if (__DEV__ && USE_FIRESTORE_EMULATOR) {
    connectFirestoreEmulator(firestoreInstance, EMULATOR_HOST, FIRESTORE_PORT);
  }
}

export function getFirestoreInstance(): Firestore {
  if (!firestoreInstance) {
    configureFirebase();
  }
  return firestoreInstance as Firestore;
}
