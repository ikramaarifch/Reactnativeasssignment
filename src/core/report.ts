import { ImageRecord, MAX_IMAGES, MIN_IMAGES, Report } from './types';

export type ValidationError =
  | { field: 'description'; code: 'blank'; message: string }
  | { field: 'images'; code: 'none' | 'too_many'; message: string };

export interface ReportInput {
  description: string;
  /** Local file URIs already copied into app storage. */
  imageUris: readonly string[];
}

export function validateReportInput(input: ReportInput): ValidationError[] {
  const errors: ValidationError[] = [];
  if (input.description.trim().length === 0) {
    errors.push({
      field: 'description',
      code: 'blank',
      message: 'Describe what you found before saving.',
    });
  }
  if (input.imageUris.length < MIN_IMAGES) {
    errors.push({ field: 'images', code: 'none', message: 'Add at least 1 photo.' });
  } else if (input.imageUris.length > MAX_IMAGES) {
    errors.push({
      field: 'images',
      code: 'too_many',
      message: `A report can have at most ${MAX_IMAGES} photos.`,
    });
  }
  return errors;
}

export class ReportValidationError extends Error {
  constructor(readonly errors: ValidationError[]) {
    super(errors.map(e => e.message).join(' '));
    this.name = 'ReportValidationError';
  }
}

/** Builds a fresh `saved_locally` report. Throws ReportValidationError if invalid. */
export function createReport(input: ReportInput, id: string, now: number): Report {
  const errors = validateReportInput(input);
  if (errors.length > 0) {
    throw new ReportValidationError(errors);
  }
  const images: ImageRecord[] = input.imageUris.map((sourceUri, index) => ({
    index,
    sourceUri,
    preparedUri: null,
    sizeBytes: null,
    md5Base64: null,
    status: 'pending',
  }));
  return {
    id,
    description: input.description.trim(),
    images,
    status: 'saved_locally',
    createdAt: now,
    attempt: 0,
    nextAttemptAt: null,
    failure: null,
  };
}
