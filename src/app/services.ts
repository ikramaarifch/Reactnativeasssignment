import ReactNativeBlobUtil from 'react-native-blob-util';
import { Report } from '../core/types';
import { UploadEngine } from '../core/UploadEngine';
import { uuidV4 } from '../core/uuid';
import { CLOUDINARY } from '../config/cloudinary';
import { getFirestoreInstance } from '../config/firebase';
import { createImagePipeline, PREPARED_DIR } from '../images/createImagePipeline';
import { rnFileSystem } from '../images/RnFileSystem';
import { BackgroundController } from '../background/BackgroundController';
import { rnForegroundService } from '../background/rnForegroundService';
import { nativeScheduler } from '../background/rnScheduler';
import { ConnectivityMonitor } from '../network/ConnectivityMonitor';
import { createConnectivityMonitor } from '../network/rnNetInfo';
import { FirestoreReviewRepository } from '../review/FirestoreReviewRepository';
import { ReviewController } from '../review/ReviewController';
import { ReviewRepository } from '../review/types';
import { openQueueDatabase } from '../storage/openQueueDatabase';
import { SqliteQueueStore } from '../storage/SqliteQueueStore';
import { FaultController, FaultyTransport, schedulerSleep } from '../transport/FaultyTransport';
import { CloudinaryImageStore } from '../transport/cloudinary/CloudinaryImageStore';
import { rnCloudinaryHttp } from '../transport/cloudinary/rnCloudinaryHttp';
import { thumbnailUrl } from '../transport/cloudinary/urls';
import { FirestoreCommitter } from '../transport/FirestoreCommitter';
import { HybridTransport } from '../transport/HybridTransport';
import { resetAll, ResetError } from './reset';
import { saveReport, SaveReportInput } from './saveReport';

export interface Services {
  engine: UploadEngine;
  faults: FaultController;
  connectivity: ConnectivityMonitor;
  background: BackgroundController;
  review: ReviewController;
  reviewRepo: ReviewRepository;
  /** A fresh report id for a new draft (UUID v4, generated on the phone). */
  newReportId: () => string;
  save: (input: SaveReportInput) => Promise<Report>;
  /** "Start over": wipes everything local. Never touches the server. */
  reset: () => Promise<void>;
}

let services: Services | null = null;

/**
 * Composition root: the only place that knows which concrete pieces are
 * plugged into the engine. UI code asks for these, never builds its own.
 */
export function getServices(): Services {
  if (!services) {
    const faults = new FaultController();
    const transport = new FaultyTransport(
      // Photos -> Cloudinary; the commit marker -> Firestore.
      new HybridTransport(
        new CloudinaryImageStore(rnCloudinaryHttp),
        new FirestoreCommitter(getFirestoreInstance()),
      ),
      faults,
      schedulerSleep(nativeScheduler),
    );
    const store = new SqliteQueueStore(openQueueDatabase());
    const engine = new UploadEngine({
      store,
      transport,
      preparer: createImagePipeline(),
      scheduler: nativeScheduler, // timers that keep firing while backgrounded
    });
    const reviewRepo = new FirestoreReviewRepository(getFirestoreInstance(), path =>
      thumbnailUrl(CLOUDINARY.cloudName, path),
    );
    const imagesDir = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/images`;
    const connectivity = createConnectivityMonitor();
    services = {
      engine,
      faults,
      connectivity,
      background: new BackgroundController(rnForegroundService, {
        getReports: () => engine.getState().reports,
        getProgress: () => engine.getState().progress,
        isOnline: () => connectivity.isOnline(),
      }, Date.now, nativeScheduler),
      review: new ReviewController(reviewRepo),
      reviewRepo,
      newReportId: () =>
        uuidV4(bytes => {
          // Polyfilled by react-native-get-random-values (see index.js).
          globalThis.crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
          return bytes;
        }),
      save: input => saveReport({ fs: rnFileSystem, engine, imagesDir, now: Date.now }, input),
      reset: async () => {
        try {
          await resetAll({
            engine,
            store,
            fs: rnFileSystem,
            imagesDir,
            preparedDir: PREPARED_DIR,
            cacheDir: ReactNativeBlobUtil.fs.dirs.CacheDir,
          });
        } catch (e) {
          if (e instanceof ResetError) {
            throw new Error(`Some data could not be deleted (${e.leftovers.join(', ')}). Try again.`);
          }
          throw e;
        }
      },
    };
  }
  return services;
}
