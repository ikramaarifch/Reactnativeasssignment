import { createHash } from 'crypto';
import { hexToBase64 } from '../images/encoding';
import { ImagePrepareError, ImagePreparer, PreparedImage } from '../images/ImagePreparer';
import {
  CloudinaryHttp,
  HttpHeadResult,
  HttpNetworkError,
  HttpUploadRequest,
  HttpUploadResult,
} from '../transport/cloudinary/CloudinaryHttp';

export const md5Hex = (text: string): string => createHash('md5').update(text).digest('hex');

interface Asset {
  size: number;
  md5: string;
}

/**
 * Behaves like the real Cloudinary account did in our probes:
 *  - upload of an existing public_id returns the ORIGINAL (existing: true), never overwrites
 *  - HEAD on the delivery URL: 200 + ETag(md5) + Content-Length, or 404
 * plus hooks for the ways a real network misbehaves.
 */
export class FakeCloudinary implements CloudinaryHttp {
  /** public_id -> stored asset (the "server"). */
  assets = new Map<string, Asset>();
  /** local file path -> content, i.e. "what is on the phone's disk". */
  localFiles = new Map<string, Asset>();

  uploadCalls: HttpUploadRequest[] = [];
  headCalls: string[] = [];
  /** How many times each public_id was actually CREATED on the server. */
  creates = new Map<string, number>();

  /** Fail the next N uploads before the server sees anything. */
  failUploadsBefore = 0;
  /** After storing, drop the response (server has it, client never hears back). */
  loseResponseAfterStore = 0;
  /** Respond with this status/body instead of processing (e.g. 400, 429, 401). */
  forcedUploadResponse?: HttpUploadResult;
  forcedHeadStatus?: number;
  failHeads = 0;
  /** Hang forever (until aborted) instead of answering. */
  hangUploads = false;

  async head(url: string, _signal: AbortSignal): Promise<HttpHeadResult> {
    this.headCalls.push(url);
    if (this.failHeads > 0) {
      this.failHeads--;
      throw new HttpNetworkError();
    }
    if (this.forcedHeadStatus) {
      return { status: this.forcedHeadStatus, headers: {} };
    }
    const publicId = url.split('/image/upload/')[1]?.replace(/\.[A-Za-z0-9]+$/, '') ?? '';
    const asset = this.assets.get(publicId);
    if (!asset) {
      return { status: 404, headers: {} };
    }
    return {
      status: 200,
      headers: { etag: `"${asset.md5}"`, 'content-length': String(asset.size) },
    };
  }

  async upload(request: HttpUploadRequest): Promise<HttpUploadResult> {
    this.uploadCalls.push(request);
    if (this.hangUploads) {
      await new Promise<never>((_, reject) => {
        if (request.signal.aborted) {
          reject(new Error('aborted'));
          return;
        }
        request.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    if (this.failUploadsBefore > 0) {
      this.failUploadsBefore--;
      throw new HttpNetworkError();
    }
    if (this.forcedUploadResponse) {
      return this.forcedUploadResponse;
    }
    const local = this.localFiles.get(request.file.path);
    if (!local) {
      return { status: 400, body: JSON.stringify({ error: { message: 'Invalid image file' } }) };
    }
    request.onProgress(local.size, local.size);

    const publicId = request.fields.public_id ?? '';
    const existing = this.assets.get(publicId);
    if (!existing) {
      this.assets.set(publicId, local);
      this.creates.set(publicId, (this.creates.get(publicId) ?? 0) + 1);
    }
    if (this.loseResponseAfterStore > 0) {
      this.loseResponseAfterStore--;
      throw new HttpNetworkError('connection reset');
    }
    const stored = existing ?? local;
    return {
      status: 200,
      body: JSON.stringify({ public_id: publicId, bytes: stored.size, etag: stored.md5, existing: !!existing }),
    };
  }
}

/** Preparer whose md5 is a real MD5 (as base64), registered as "on disk" in the fake. */
export class CloudinaryPreparer implements ImagePreparer {
  missing = new Set<string>();
  calls: string[] = [];
  constructor(private readonly cloud: FakeCloudinary, private readonly size = 1_000_000) {}

  async prepare(sourceUri: string, index: number): Promise<PreparedImage> {
    this.calls.push(sourceUri);
    if (this.missing.has(sourceUri)) {
      throw new ImagePrepareError('source_missing');
    }
    const path = `/docs/prepared/${index}-${md5Hex(sourceUri).slice(0, 8)}.jpg`;
    const md5 = md5Hex(sourceUri);
    this.cloud.localFiles.set(path, { size: this.size, md5 });
    return { uri: `file://${path}`, sizeBytes: this.size, md5Base64: hexToBase64(md5) };
  }
}
