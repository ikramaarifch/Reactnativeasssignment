# Field Reports

An Android app (bare React Native, TypeScript) for an inspector who files reports from places with 2G or no network at all. A report is a description plus 1–5 photos.

The one promise: **once you tap Save, the report is never lost and never lands twice**, whatever the network, the battery or the OS does to the app.

> Photos are stored in **Cloudinary**, report records in **Firestore**. See [Backend setup](#backend-setup).

## Contents

1. [How to run](#how-to-run)
2. [Backend setup](#backend-setup)
3. [How to make it fail](#how-to-make-it-fail)
4. [How it works](#how-it-works)
5. [Key decisions](#key-decisions)
6. [Knowingly left out, and honest limits](#knowingly-left-out-and-honest-limits)
7. [With another day](#with-another-day)
8. [Tests](#tests)

## How to run

Requirements: Node 22+, JDK 17, Android SDK, a physical Android phone with USB debugging (tested on a Samsung Galaxy A06, Android 16). An emulator also works.

```sh
npm install
npm run adb:reverse     # forwards 8081 (Metro) and 8080 (Firestore emulator) to the phone
npm start               # Metro
npm run android         # builds and installs the debug app
```

Useful extras:

```sh
npm test                # 213 Jest tests, no device needed
npm run typecheck       # tsc --noEmit (strict, no `any`)
npm run lint
npm run test-images     # generates a ~47 MB noise JPEG and pushes it to the phone's gallery
```

`npm run test-images` exists to test the "18 MB original" case: pick that file in the app and it arrives as roughly 2.6 MB.

Only the **debug** build is verified on a device. A release build (`assembleRelease`) was attempted but could not finish on the development PC because the system drive ran out of disk space, so treat release as unverified.

## Backend setup

Nothing secret is in the app. The Cloudinary values are a cloud name and an *unsigned* upload preset (public by design), and `google-services.json` holds a Firebase client key, not a credential.

### Firestore (report records)

1. Create a Firebase project and a Firestore database (production mode).
2. Add an Android app with package `com.ikrama.assignment`, download `google-services.json` and put it in `android/app/`.
3. In the console go to **Firestore → Rules** and publish the contents of [firebase/firestore.rules](firebase/firestore.rules). Without this step every commit is refused with *permission denied* and reports end in the "server refused" state (this really happened during development, and the app handled it as designed: photos uploaded, report not marked done).
4. Set the project id in `.firebaserc` if you use a different project.

The rules only accept a document with `status == 'complete'`, a non-blank description and 1–5 image paths, and forbid deletes.

### Cloudinary (photos)

1. Create an **unsigned** upload preset (Settings → Upload → Upload presets).
2. Put your cloud name and the preset name in [src/config/cloudinary.ts](src/config/cloudinary.ts).

Photos are stored at `reports/<reportId>/<index>.jpg`.

### Optional: Firestore emulator

For destructive tests that must not touch real data, set `USE_FIRESTORE_EMULATOR = true` in [src/config/target.ts](src/config/target.ts), then `npm run emulators` and `npm run adb:reverse`. Photos still go to Cloudinary (there is no emulator for it).

## How to make it fail

The brief asks for failure on demand. There are three ways, from most to least controlled.

**1. In-app failure injection (deterministic).** Tap the **screen title 5 times within 2 seconds** to open (tap 5 times again to close) the developer screen. It wraps the real transport and offers:

| Mode | What the app experiences |
|---|---|
| Normal | pass-through |
| Slow | added latency plus a byte throttle (a 2G stand-in) |
| Drop after N bytes | the connection dies part-way through a photo |
| Refuse | `permission-denied`, a permanent error |
| Server error | a 5xx, retryable |
| Hang | never answers; only the no-progress watchdog can end it |

The same screen can enqueue ready-made test reports (small and big photos). The screen ships in the app on purpose, behind the gesture, because the brief wants failures reproducible on demand; a production build would strip it.

**2. Real network faults.** Airplane mode on and off; Wi-Fi off while uploading; the emulator's network speed/latency setting; stopping the Firestore emulator; or unpublishing the Firestore rules (every commit is then refused).

**3. Process faults.** Force-stop the app mid-upload (`adb shell am force-stop com.ikrama.assignment`, or swipe it away) and reopen it. Unfinished reports resume by themselves.

## How it works

```
src/
  core/       pure TypeScript upload engine, no React, no native code
  storage/    SQLite persistence (op-sqlite on device, better-sqlite3 in tests)
  images/     compression pipeline behind small ports (file system, resizer)
  transport/  UploadTransport interface, Cloudinary+Firestore, FaultyTransport
  ui/         screens; they only observe state and call actions
  app/        composition root: wires everything together
  review/     reads reports back from the server
  background/ Android foreground service and native timer
```

### The state machine

```
saved_locally → preparing → uploading → finalizing → uploaded
                    ↘ failed_retrying ↔ (back to the step that failed)
                    ↘ failed_permanent  (needs the user)
```

**Every transition is written to SQLite before the work it describes starts.** If the app dies at any line, the database says where it was and the engine resumes there. Tests kill and restart the engine at every state.

### Why nothing is lost

- **Save is local and instant.** Photos are copied into the app's own storage first (so deleting them from the gallery cannot hurt), then the report is committed to SQLite with `synchronous=FULL` and WAL. Only then does the UI say "Saved". It never waits for the network.
- **Resume on start.** Startup re-reads the queue and continues anything not `uploaded`.
- **Retries** happen on a timer (exponential backoff with full jitter, 2 s base, 5 min cap) *and* immediately when connectivity returns or the app comes to the foreground.

### Why nothing lands twice

- Photo paths are deterministic (`reports/<id>/<index>.jpg`) and the report id is a UUID made at save time. A retried upload targets the same path; Cloudinary returns the existing asset instead of making a second one.
- Before uploading a photo the engine checks whether it is already there (HEAD, comparing MD5 and size) and skips it if so. This is what makes a **lost response** (server stored it, phone never heard) safe.
- The report record is written with `set()` on the report id, so committing twice is the same as committing once.
- The record is written **last**, after all photos are confirmed. A report on the server therefore always has all its photos; a half-sent report simply does not exist yet.

### Failures: which are retried

| Error | Treatment |
|---|---|
| network, timeout, 5xx, rate limit, unavailable, unknown | retry with backoff |
| permission denied, unauthenticated, invalid argument, quota, corrupt/missing image | **permanent**, stop and tell the user |

A permanently failed report never blocks the ones behind it, and the user can retry it by hand once they fixed the cause.

### 2G behaviour

There is no total upload timeout. A **no-progress watchdog** cancels a request only if no bytes have moved for a while, so a slow link that keeps moving can take as long as it needs while a dead one is cut. It uses a single lazily re-checked timer instead of resetting a timer on every progress event.

### Images

Every photo is re-encoded before upload by a native resizer, walking a ladder (long edge 2560 → 2048 → 1600 → 1280, quality 80 → 40) until the **measured file size on disk** is ≤ 4.5 MB (the hard limit is 5 MB). The engine measures again before uploading and refuses anything at or over 5 MiB. EXIF is stripped (including GPS) and orientation is applied by the encoder. Prepared files live in the app's documents folder so they survive a restart.

### Background

An Android **foreground service** (type `dataSync`) with a visible notification keeps uploads alive when the app is backgrounded and shows progress. It stops itself when the queue is empty. Two non-obvious points:

- React Native's JS timers **stop** when the app is backgrounded (measured on Android 16), so retries and the watchdog run on an injected `Scheduler`. On device that is backed by a small native Kotlin `Handler`; in tests it is a manual clock.
- Honest trade-off: a foreground service is the right tool for "work the user knows is happening", but it can be refused or killed by aggressive vendor battery managers and by the Android 15+ time cap on `dataSync` services (handled via `onTimeout`). If it is killed, nothing is lost: the queue is on disk and resumes next launch.

### Review screen

Reads **from the server** (Firestore, `getDocsFromServer`), not from the local queue, so it shows what really landed. Thumbnails come from Cloudinary (resized server-side). Paged, with loading, empty, error and offline states; it shows the previous result while refreshing.

### Reset ("Start over")

Deletes the local queue, the prepared images, and leftover picker temp files, then **verifies** that nothing remains. The confirmation dialog states the exact counts ("3 reports and 11 photos on this phone"), including unsent ones, because those are the only copies. **It does not touch the server**: reports already uploaded stay there (rules forbid deletes, and a reset must not be able to destroy delivered data). After reset the engine is stopped, the in-flight work is cancelled by an epoch check so nothing can write back and resurrect a deleted report.

## Key decisions

- **Engine as pure TypeScript.** It depends only on interfaces (`QueueStore`, `UploadTransport`, `ImagePreparer`, `Scheduler`), so the whole delivery guarantee is tested in Jest with fakes, with no emulator.
- **SQLite, one row per report** holding the JSON. One atomic write per transition; no partial states.
- **One report and one image at a time.** On 2G, parallel uploads just compete for the same thin pipe and make the no-progress watchdog fire spuriously.
- **Oldest first, but a report in backoff does not block newer ones.**
- **NetInfo is a hint, not a gate.** "Connected" does not mean "reachable"; the only proof is an attempt, so we try rather than refuse.
- **Firestore offline persistence is off.** With it on, an offline write is queued inside the SDK and "succeeds" later, outside our control. Our SQLite queue must be the single source of truth.
- **Cloudinary for photos, Firestore for the record.** I first built on Firebase Storage, then switched to Cloudinary for the photos (the Firebase project here is on the free plan). That swap changed which guarantees were possible, so I verified its behaviour against a real account first (re-upload returns the original; HEAD returns ETag = MD5 and Content-Length), then encoded exactly that into the fake used by tests.
- **Epoch fencing** on reset/stop: every write re-checks that the engine generation is still current, which closes the race where a slow in-flight step finishes after a reset.
- **Wording rules enforced by tests:** only `uploaded` may say "Uploaded"; "Saved" never appears in the same sentence.

## Knowingly left out, and honest limits

- **Uploads are not resumable.** If the link drops mid-photo, that photo restarts from zero (on 2G that can be minutes of lost progress). Cloudinary supports chunked uploads; I did not build it.
- **No server-side 5 MB limit.** Cloudinary's free tier has no hard cap, so the 5 MB rule is enforced on the client (ladder + engine check). A hostile client could send more.
- **The unsigned preset is public.** Anyone who has the preset name can upload to the account. Fine for a test, wrong for production (see another day).
- **Firestore rules are open for reads and creates** (there is no login in scope). The rules validate shape, not identity.
- **Local files are never deleted after upload.** Storage grows until "Start over". A kill between "copy photos" and "save report" can leave orphan files that only a reset removes.
- **Error text does not say which service refused** (Cloudinary vs Firestore).
- **Dev tools ship in the build** behind a 5-tap gesture.
- **A foreground service is not a guarantee** (see Background).
- **Android only.** No iOS work.
- **No dark mode, no localisation, no accessibility audit** beyond sensible tap targets and labels.
- **Not verified on a device:** a real maximum-resolution camera photo and a photo with EXIF rotation (covered by the library and by a synthetic 47 MB image only), the full "airplane → kill → throttle → drop twice" scenario in one unbroken run, the release build.

## With another day

1. **Resumable/chunked uploads** so a dropped link keeps its progress.
2. **WorkManager** for retries when the app is not running at all, with a foreground service only while actively uploading.
3. **Signed uploads via a tiny backend** (per-report signature, enforced size and type), replacing the public preset, plus real authentication and ownership rules in Firestore.
4. **Cleanup of local files** once a report is confirmed on the server, and a startup sweep for orphans.
5. **Service-specific error messages** and an in-app "send logs" action.
6. **Instrumented tests** that kill the real process mid-upload, and a release-build CI job.
7. **Strip the dev screen** from release builds.

## Tests

`npm test` runs 213 tests in 14 suites, covering: the state machine, kill-and-restart at every state, idempotent enqueue, lost responses (server stored it, client never heard), every error classification, the watchdog (including "slow but moving is allowed"), the image pipeline against fake files, the SQLite store (real SQLite), reset (including race conditions that were mutation-checked, meaning the test fails when the guard is removed), background controller behaviour, review paging and states, and the Cloudinary transport against a fake that reproduces the verified server behaviour.
