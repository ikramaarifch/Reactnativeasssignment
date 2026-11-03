import type { Firestore } from '@react-native-firebase/firestore';
import { doc, setDoc } from '@react-native-firebase/firestore';
import { ReportDocument } from '../core/types';
import { abortable } from './abortable';
import { mapFirebaseError } from './firebaseErrors';

/**
 * Writes the commit marker: `reports/{id}` with status "complete". `setDoc` on
 * the report's own id makes it idempotent: a retry after a lost response just
 * overwrites the same document. Offline persistence is off (see configureFirebase),
 * so this promise resolves only when the SERVER has acknowledged the write.
 */
export class FirestoreCommitter {
  constructor(private readonly firestore: Firestore) {}

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
