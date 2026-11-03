import ReactNativeBlobUtil from 'react-native-blob-util';
import { Report } from '../core/types';
import { UploadEngine } from '../core/UploadEngine';
import { uuidV4 } from '../core/uuid';
import { getFirestoreInstance, getStorageInstance } from '../config/firebase';
import { createImagePipeline } from '../images/createImagePipeline';
import { rnFileSystem } from '../images/RnFileSystem';
import { openQueueDatabase } from '../storage/openQueueDatabase';
import { SqliteQueueStore } from '../storage/SqliteQueueStore';
import { FaultController, FaultyTransport } from '../transport/FaultyTransport';
import { FirebaseTransport } from '../transport/FirebaseTransport';
import { saveReport, SaveReportInput } from './saveReport';

export interface Services {
  engine: UploadEngine;
  faults: FaultController;
  /** A fresh report id for a new draft (UUID v4, generated on the phone). */
  newReportId: () => string;
  save: (input: SaveReportInput) => Promise<Report>;
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
      new FirebaseTransport(getStorageInstance(), getFirestoreInstance()),
      faults,
    );
    const engine = new UploadEngine({
      store: new SqliteQueueStore(openQueueDatabase()),
      transport,
      preparer: createImagePipeline(),
    });
    const imagesDir = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/images`;
    services = {
      engine,
      faults,
      newReportId: () =>
        uuidV4(bytes => {
          // Polyfilled by react-native-get-random-values (see index.js).
          globalThis.crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
          return bytes;
        }),
      save: input => saveReport({ fs: rnFileSystem, engine, imagesDir, now: Date.now }, input),
    };
  }
  return services;
}
