import { ReportDocument } from '../core/types';
import {
  RemoteImageInfo,
  UploadImageRequest,
  UploadTransport,
} from './UploadTransport';

/**
 * Photos and the commit marker live in different services (Cloudinary and
 * Firestore). The engine only knows UploadTransport, so this glues the two
 * halves together without the engine caring.
 */
export class HybridTransport implements UploadTransport {
  constructor(
    private readonly images: {
      getRemoteImage(path: string, signal: AbortSignal): Promise<RemoteImageInfo | null>;
      uploadImage(request: UploadImageRequest): Promise<void>;
    },
    private readonly commits: Pick<UploadTransport, 'commitReport'>,
  ) {}

  getRemoteImage(path: string, signal: AbortSignal): Promise<RemoteImageInfo | null> {
    return this.images.getRemoteImage(path, signal);
  }

  uploadImage(request: UploadImageRequest): Promise<void> {
    return this.images.uploadImage(request);
  }

  commitReport(doc: ReportDocument, signal: AbortSignal): Promise<void> {
    return this.commits.commitReport(doc, signal);
  }
}
