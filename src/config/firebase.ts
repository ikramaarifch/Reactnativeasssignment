import { getApp } from '@react-native-firebase/app';
import {
  connectFirestoreEmulator,
  Firestore,
  initializeFirestore,
} from '@react-native-firebase/firestore';
import {
  connectStorageEmulator,
  FirebaseStorage,
  getStorage,
} from '@react-native-firebase/storage';

// Debug builds talk to the Firebase Emulator Suite through `adb reverse`
// (npm run adb:reverse), which forwards the phone's 127.0.0.1 ports to this PC.
// It works the same for a USB phone and for an Android Studio emulator.
const EMULATOR_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8080;
const STORAGE_PORT = 9199;

let firestoreInstance: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;

/**
 * Must run once, before the first Firestore/Storage call.
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
  storageInstance = getStorage();
  if (__DEV__) {
    connectFirestoreEmulator(firestoreInstance, EMULATOR_HOST, FIRESTORE_PORT);
    connectStorageEmulator(storageInstance, EMULATOR_HOST, STORAGE_PORT);
  }
}

export function getFirestoreInstance(): Firestore {
  if (!firestoreInstance) {
    configureFirebase();
  }
  return firestoreInstance as Firestore;
}

export function getStorageInstance(): FirebaseStorage {
  if (!storageInstance) {
    configureFirebase();
  }
  return storageInstance as FirebaseStorage;
}
