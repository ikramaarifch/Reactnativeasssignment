import { ReportDocument } from '../core/types';

export interface RemoteImageInfo {
  sizeBytes: number;
  md5Base64: string;
}

export interface UploadImageRequest {
  /** Deterministic destination: re-uploading the same path overwrites. */
  path: string;
  localUri: string;
  sizeBytes: number;
  /** Must be called as bytes move; the engine's watchdog aborts if it goes quiet. */
  onProgress: (bytesTransferred: number, totalBytes: number) => void;
  /** Aborted by the watchdog or by a reset. Implementations must stop and reject, and must check `signal.aborted` up front: it may already be aborted when the call starts. */
  signal: AbortSignal;
}

/**
 * Everything the engine needs from a backend. The engine never imports Firebase,
 * so tests use a fake and failure injection is a wrapper (FaultyTransport).
 */
export interface UploadTransport {
  /** Returns null when the object does not exist. */
  getRemoteImage(path: string, signal: AbortSignal): Promise<RemoteImageInfo | null>;
  uploadImage(request: UploadImageRequest): Promise<void>;
  /** Idempotent (set): writing the same report twice is harmless. */
  commitReport(doc: ReportDocument, signal: AbortSignal): Promise<void>;
}

export type TransportErrorCode =
  | 'network'
  | 'timeout'
  | 'unavailable'
  | 'deadline-exceeded'
  | 'server-error'
  | 'permission-denied'
  | 'unauthenticated'
  | 'invalid-argument'
  | 'quota-exceeded'
  | 'canceled'
  | 'unknown';

/** Normalised error every transport must throw, so the engine never parses SDK errors. */
export class TransportError extends Error {
  constructor(readonly code: TransportErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'TransportError';
  }
}
