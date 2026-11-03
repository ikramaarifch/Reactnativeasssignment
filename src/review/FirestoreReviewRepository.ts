import type { Firestore } from '@react-native-firebase/firestore';
import {
  collection,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
} from '@react-native-firebase/firestore';
import { parseReportDoc } from './parseReport';
import { ReviewPage, ReviewRepository, ServerReport } from './types';

/**
 * Reads reports from the server. `getDocsFromServer` (source: 'server') never
 * answers from a local cache, so this screen shows only what really is on the
 * server.
 *
 * Only `createdAt` is ordered on (an automatic single-field index, so no manual
 * index is needed on a real project). "Complete only" is enforced by
 * parseReportDoc, which drops anything without status == "complete": that is
 * the commit marker, so a half-written report can never be shown. The security
 * rules already refuse to create anything else, so pages are not left short.
 */
export class FirestoreReviewRepository implements ReviewRepository {
  constructor(
    private readonly firestore: Firestore,
    /** Maps a stored image key to a URL (Cloudinary thumbnail). */
    private readonly imageUrl: (path: string) => string,
  ) {}

  async fetchPage({ limit: pageSize, after }: { limit: number; after: unknown }): Promise<ReviewPage> {
    const reports = collection(this.firestore, 'reports');
    const q = after
      ? query(reports, orderBy('createdAt', 'desc'), startAfter(after), limit(pageSize + 1))
      : query(reports, orderBy('createdAt', 'desc'), limit(pageSize + 1));

    const snapshot = await getDocsFromServer(q);
    const docs = snapshot.docs;
    const pageDocs = docs.slice(0, pageSize);
    const parsed = pageDocs.flatMap(d => {
      const report: ServerReport | null = parseReportDoc(d.id, d.data());
      return report ? [report] : [];
    });
    return {
      reports: parsed,
      hasMore: docs.length > pageSize,
      cursor: pageDocs[pageDocs.length - 1] ?? null,
    };
  }

  async getImageUrl(path: string): Promise<string> {
    return this.imageUrl(path);
  }
}
