import { UploadEngine } from '../core/UploadEngine';
import { getFirestoreInstance, getStorageInstance } from '../config/firebase';
import { createImagePipeline } from '../images/createImagePipeline';
import { openQueueDatabase } from '../storage/openQueueDatabase';
import { SqliteQueueStore } from '../storage/SqliteQueueStore';
import { FaultController, FaultyTransport } from '../transport/FaultyTransport';
import { FirebaseTransport } from '../transport/FirebaseTransport';

export interface Services {
  engine: UploadEngine;
  faults: FaultController;
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
    services = { engine, faults };
  }
  return services;
}
