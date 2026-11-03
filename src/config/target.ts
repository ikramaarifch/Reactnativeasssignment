/**
 * Which Firestore the app talks to.
 *   false -> your real Firebase project (default; this is where reports go)
 *   true  -> the local Firebase emulator, only in debug builds (npm run emulators
 *            + npm run adb:reverse). Handy for destructive tests; data is lost on restart.
 * Photos always go to Cloudinary: there is no Cloudinary emulator.
 */
export const USE_FIRESTORE_EMULATOR = false;
