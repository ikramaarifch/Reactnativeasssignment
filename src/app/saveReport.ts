import { createReport, validateReportInput, ReportValidationError } from '../core/report';
import { Report } from '../core/types';
import { UploadEngine } from '../core/UploadEngine';
import { FileSystemPort } from '../images/ports';

export interface SaveReportDeps {
  fs: FileSystemPort;
  engine: Pick<UploadEngine, 'enqueue'>;
  /** Persistent directory (app documents), NOT a cache: reports must outlive temp URIs. */
  imagesDir: string;
  now: () => number;
}

export interface SaveReportInput {
  /** Draft id, generated when the form opened so a double-tap is idempotent. */
  id: string;
  description: string;
  /** Picker output: temporary URIs that may disappear at any time. */
  photoUris: readonly string[];
}

export class SaveReportError extends Error {
  constructor(readonly code: 'copy_failed' | 'write_failed', cause: unknown) {
    super(
      code === 'copy_failed'
        ? 'Could not store the photos on this phone. Check free space and try again.'
        : 'Could not save the report on this phone. Try again.',
    );
    this.name = 'SaveReportError';
    this.cause = cause;
  }
}

const extensionOf = (uri: string): string => /\.[A-Za-z0-9]{2,5}$/.exec(uri)?.[0] ?? '.jpg';
const toPath = (uri: string): string =>
  uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri;

/**
 * The "Save" flow. Works in airplane mode and never waits for the network:
 *   1. validate (before touching the disk)
 *   2. copy the photos into the app's own directory (picker temp URIs can vanish)
 *   3. write the report to the local DB; only then is it "Saved on this phone"
 * If anything fails, nothing is left half-saved: the copied files are removed
 * and no queue entry exists. Compression and upload happen later, in the engine.
 */
export async function saveReport(deps: SaveReportDeps, input: SaveReportInput): Promise<Report> {
  const errors = validateReportInput({ description: input.description, imageUris: input.photoUris });
  if (errors.length > 0) {
    throw new ReportValidationError(errors);
  }

  const dir = `${deps.imagesDir}/${input.id}`;
  const stored: string[] = [];
  try {
    await deps.fs.ensureDir(dir);
    for (const [i, uri] of input.photoUris.entries()) {
      const target = `${dir}/${i}${extensionOf(uri)}`;
      await deps.fs.copy(toPath(uri), target);
      stored.push(`file://${target}`);
    }
  } catch (e) {
    await deps.fs.remove(dir).catch(() => {});
    throw new SaveReportError('copy_failed', e);
  }

  const report = createReport(
    { description: input.description, imageUris: stored },
    input.id,
    deps.now(),
  );
  try {
    await deps.engine.enqueue(report);
  } catch (e) {
    await deps.fs.remove(dir).catch(() => {});
    throw new SaveReportError('write_failed', e);
  }
  return report;
}
