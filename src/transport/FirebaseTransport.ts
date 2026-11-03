import { toPath } from '../images/ImagePipeline';
import { ReportDocument } from '../core/types';
import type { Firestore } from '@react-native-firebase/firestore';
import { doc, setDoc } from '@react-native-firebase/firestore';
import type { FirebaseStorage } from '@react-native-firebase/storage';
import { getMetadata, putFile, ref } from '@react-native-firebase/storage';
import { abortable } from './abortable';
import { isObjectNotFound, mapFirebaseError } from './firebaseErrors';
import {
  RemoteImageInfo,
  TransportError,
  UploadImageRequest,
  UploadTransport,
} from './UploadTransport';

/**
 * The real backend. Idempotency lives in the choices made here:
 *  - deterministic object path => re-upload overwrites, never duplicates
 *  - getMetadata => the engine can see what the server already has
 *  - setDoc (not addDoc) with the report's own id => commit is repeatable
 *
 * We do NOT use Firestore offline persistence or Storage's own retry as a
 * queue (see configureFirebase): the engine owns durability and retries.
 */
export class FirebaseTransport implements UploadTransport {
  constructor(
    private readonly storage: FirebaseStorage,
    private readonly firestore: Firestore,
  ) {}

  async getRemoteImage(path: string, signal: AbortSignal): Promise<RemoteImageInfo | null> {
    try {
      const meta = await abortable(signal, getMetadata(ref(this.storage, path)));
      return { sizeBytes: meta.size, md5Base64: meta.md5Hash ?? '' };
    } catch (error) {
      if (isObjectNotFound(error)) {
        return null;
      }
      throw mapFirebaseError(error);
    }
  }

  async uploadImage(request: UploadImageRequest): Promise<void> {
    const { path, localUri, signal, onProgress } = request;
    if (signal.aborted) {
      throw new TransportError('canceled', 'aborted');
    }
    const task = putFile(ref(this.storage, path), toPath(localUri), {
      // Matches the Storage rule that only accepts JPEGs.
      contentType: 'image/jpeg',
    });
    const unsubscribe = task.on('state_changed', snapshot => {
      onProgress(snapshot.bytesTransferred, snapshot.totalBytes);
    });
    const onAbort = () => {
      task.cancel();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await task;
    } catch (error) {
      throw mapFirebaseError(error);
    } finally {
      unsubscribe();
      signal.removeEventListener('abort', onAbort);
    }
  }

  async commitReport(document: ReportDocument, signal: AbortSignal): Promise<void> {
    try {
      await abortable(
        signal,
        setDoc(doc(this.firestore, 'reports', document.id), {
          description: document.description,
          imagePaths: document.imagePaths,
          createdAt: document.createdAt,
          status: document.status,
        }),
      );
    } catch (error) {
      throw mapFirebaseError(error);
    }
  }
}
