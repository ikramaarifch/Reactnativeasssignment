export interface HttpHeadResult {
  status: number;
  /** Lower-cased header names. */
  headers: Record<string, string>;
}

export interface HttpUploadRequest {
  url: string;
  /** Plain text form fields. */
  fields: Record<string, string>;
  /** The file part. Streamed from disk, never loaded into JS memory. */
  file: { path: string; name: string; mimeType: string };
  /** Bytes sent so far / total, from the native layer. */
  onProgress: (sent: number, total: number) => void;
  signal: AbortSignal;
}

export interface HttpUploadResult {
  status: number;
  body: string;
}

/** The only network surface CloudinaryImageStore needs, so tests can fake it. */
export interface CloudinaryHttp {
  head(url: string, signal: AbortSignal): Promise<HttpHeadResult>;
  upload(request: HttpUploadRequest): Promise<HttpUploadResult>;
}

/** Thrown by an HttpPort when no HTTP response was obtained (offline, reset, DNS...). */
export class HttpNetworkError extends Error {
  constructor(message = 'Network request failed') {
    super(message);
    this.name = 'HttpNetworkError';
  }
}
