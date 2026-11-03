import { CLOUDINARY } from '../../config/cloudinary';
import { hexToBase64 } from '../../images/encoding';
import { toPath } from '../../images/ImagePipeline';
import {
  RemoteImageInfo,
  TransportError,
  UploadImageRequest,
} from '../UploadTransport';
import { CloudinaryHttp } from './CloudinaryHttp';
import { originalUrl, publicIdFor, uploadEndpoint } from './urls';

export interface CloudinaryConfig {
  cloudName: string;
  uploadPreset: string;
}

const MD5_HEX = /^[0-9a-f]{32}$/i;

const canceled = (): TransportError => new TransportError('canceled', 'aborted');

/**
 * The image half of the backend, on Cloudinary. Idempotency rests on two facts
 * verified against the real account (see README):
 *  - uploading an existing public_id returns the ORIGINAL asset (`existing:
 *    true`), so a retry can never duplicate or overwrite;
 *  - a public HEAD on the delivery URL returns the file's MD5 as ETag and its
 *    byte size, so we can skip re-sending bytes after a lost response (2G!).
 */
export class CloudinaryImageStore {
  constructor(
    private readonly http: CloudinaryHttp,
    private readonly config: CloudinaryConfig = CLOUDINARY,
  ) {}

  async getRemoteImage(path: string, signal: AbortSignal): Promise<RemoteImageInfo | null> {
    if (signal.aborted) {
      throw canceled();
    }
    let response;
    try {
      response = await this.http.head(originalUrl(this.config.cloudName, path), signal);
    } catch (e) {
      throw asTransportError(e, signal);
    }
    if (response.status === 404) {
      return null;
    }
    if (response.status < 200 || response.status >= 300) {
      throw errorForStatus(response.status, '');
    }
    const etag = (response.headers.etag ?? '').replace(/^W\//, '').replace(/"/g, '');
    const size = Number(response.headers['content-length']);
    return {
      sizeBytes: Number.isFinite(size) ? size : -1,
      // An ETag that is not an MD5 can never match, so the engine simply re-uploads.
      md5Base64: MD5_HEX.test(etag) ? hexToBase64(etag.toLowerCase()) : '',
    };
  }

  async uploadImage(request: UploadImageRequest): Promise<void> {
    const { path, localUri, signal, onProgress } = request;
    if (signal.aborted) {
      throw canceled();
    }
    let result;
    try {
      result = await this.http.upload({
        url: uploadEndpoint(this.config.cloudName),
        fields: { upload_preset: this.config.uploadPreset, public_id: publicIdFor(path) },
        file: { path: toPath(localUri), name: path.split('/').pop() ?? 'image.jpg', mimeType: 'image/jpeg' },
        onProgress,
        signal,
      });
    } catch (e) {
      throw asTransportError(e, signal);
    }
    if (result.status >= 200 && result.status < 300) {
      // `existing: true` is success too: the server already has this image.
      if (!hasPublicId(result.body)) {
        throw new TransportError('server-error', 'Unexpected response from the image server');
      }
      return;
    }
    throw errorForStatus(result.status, result.body);
  }
}

function hasPublicId(body: string): boolean {
  try {
    const json: unknown = JSON.parse(body);
    return typeof json === 'object' && json !== null && 'public_id' in json;
  } catch {
    return false;
  }
}

function messageOf(body: string): string {
  try {
    const json = JSON.parse(body) as { error?: { message?: unknown } };
    return typeof json.error?.message === 'string' ? json.error.message : '';
  } catch {
    return '';
  }
}

/** HTTP status -> the vocabulary the retry policy understands. */
export function errorForStatus(status: number, body: string): TransportError {
  const detail = messageOf(body);
  const text = `HTTP ${status}${detail ? `: ${detail}` : ''}`;
  if (status === 401 || status === 403) {
    return new TransportError('permission-denied', text);
  }
  if (status === 400 || status === 404 || status === 413 || status === 415) {
    // Bad image, unknown preset/cloud, too large: retrying the same request cannot help.
    return new TransportError('invalid-argument', text);
  }
  if (status === 408) {
    return new TransportError('timeout', text);
  }
  if (status === 420 || status === 429 || status >= 500) {
    // 420/429 are rate limits: back off and try again.
    return new TransportError('server-error', text);
  }
  return new TransportError('unknown', text);
}

function asTransportError(e: unknown, signal: AbortSignal): TransportError {
  if (signal.aborted) {
    return canceled();
  }
  if (e instanceof TransportError) {
    return e;
  }
  return new TransportError('network', e instanceof Error ? e.message : 'Network request failed');
}
