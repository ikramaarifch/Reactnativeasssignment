import type { Firestore } from '@react-native-firebase/firestore';
import {
  collection,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from '@react-native-firebase/firestore';
import type { FirebaseStorage } from '@react-native-firebase/storage';
import { getDownloadURL, ref } from '@react-native-firebase/storage';
import { parseReportDoc } from './parseReport';
import { ReviewPage, ReviewRepository, ServerReport } from './types';

/**
 * Reads reports from the server. `getDocsFromServer` (source: 'server') never
 * answers from a local cache, so this screen shows only what really is on the
 * server. The `status == "complete"` filter matches the commit marker: a report
 * without it is not "uploaded", whatever images happen to exist.
 *
 * The where + orderBy pair needs the composite index in firestore.indexes.json
 * on a real project (the emulator does not enforce indexes).
 */
export class FirebaseReviewRepository implements ReviewRepository {
  /** Download URLs are stable per path; remember them so re-renders cost nothing. */
  private urls = new Map<string, Promise<string>>();

  constructor(
    private readonly firestore: Firestore,
    private readonly storage: FirebaseStorage,
  ) {}

  async fetchPage({ limit: pageSize, after }: { limit: number; after: unknown }): Promise<ReviewPage> {
    const base = [
      where('status', '==', 'complete'),
      orderBy('createdAt', 'desc'),
    ] as const;
    const q = after
      ? query(collection(this.firestore, 'reports'), ...base, startAfter(after), limit(pageSize + 1))
      : query(collection(this.firestore, 'reports'), ...base, limit(pageSize + 1));

    const snapshot = await getDocsFromServer(q);
    const docs = snapshot.docs;
    const pageDocs = docs.slice(0, pageSize);
    const reports = pageDocs.flatMap(d => {
      const parsed: ServerReport | null = parseReportDoc(d.id, d.data());
      return parsed ? [parsed] : [];
    });
    return {
      reports,
      hasMore: docs.length > pageSize,
      cursor: pageDocs[pageDocs.length - 1] ?? null,
    };
  }

  getImageUrl(path: string): Promise<string> {
    let url = this.urls.get(path);
    if (!url) {
      url = getDownloadURL(ref(this.storage, path));
      this.urls.set(path, url);
      // A failure must not be cached, or "retry" could never succeed.
      url.catch(() => this.urls.delete(path));
    }
    return url;
  }
}
