export interface PreparedImage {
  uri: string;
  /** Measured on disk after compression, not estimated. */
  sizeBytes: number;
  md5Base64: string;
}

export type ImagePrepareErrorCode = 'source_missing' | 'corrupt' | 'too_large' | 'failed';

export class ImagePrepareError extends Error {
  constructor(readonly code: ImagePrepareErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ImagePrepareError';
  }
}

/** Compression pipeline contract (real implementation arrives in the images step). */
export interface ImagePreparer {
  prepare(sourceUri: string, index: number, signal: AbortSignal): Promise<PreparedImage>;
}
