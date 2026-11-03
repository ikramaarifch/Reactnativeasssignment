export const MAX_IMAGES = 5;
export const MIN_IMAGES = 1;
/** Hard server limit (Storage rule) and the safety target the pipeline aims for. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const TARGET_UPLOAD_BYTES = 4.5 * 1024 * 1024;

export type ReportStatus =
  | 'saved_locally'
  | 'preparing'
  | 'uploading'
  | 'finalizing'
  | 'uploaded'
  | 'failed_retrying'
  | 'failed_permanent';

export type ImageStatus = 'pending' | 'prepared' | 'uploaded';

export interface ImageRecord {
  index: number;
  /** Our own copy in the app document directory (survives temp-URI expiry). */
  sourceUri: string;
  /** Compressed file that is actually uploaded. Set once verified < 5 MB. */
  preparedUri: string | null;
  sizeBytes: number | null;
  /** Base64 MD5 of the prepared file, comparable to Firebase Storage metadata. */
  md5Base64: string | null;
  status: ImageStatus;
}

export type FailureCode =
  | 'network'
  | 'timeout'
  | 'no_progress'
  | 'server_error'
  | 'permission_denied'
  | 'invalid_argument'
  | 'quota_exceeded'
  | 'source_missing'
  | 'image_corrupt'
  | 'image_too_large'
  | 'unknown';

export interface FailureInfo {
  code: FailureCode;
  /** Human-readable, safe to show the user. */
  reason: string;
  at: number;
}

export interface Report {
  id: string;
  description: string;
  images: ImageRecord[];
  status: ReportStatus;
  createdAt: number;
  /** Consecutive failed attempts; drives backoff. Reset on success/manual retry. */
  attempt: number;
  /** When a failed_retrying report may next be tried (epoch ms). */
  nextAttemptAt: number | null;
  failure: FailureInfo | null;
}

/** Document written to Firestore once every image is confirmed: the commit marker. */
export interface ReportDocument {
  id: string;
  description: string;
  imagePaths: string[];
  createdAt: number;
  status: 'complete';
}

export const imagePath = (reportId: string, index: number): string =>
  `reports/${reportId}/${index}.jpg`;
