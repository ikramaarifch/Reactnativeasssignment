import { TARGET_UPLOAD_BYTES } from '../core/types';
import { hexToBase64 } from './encoding';
import { ImagePrepareError, ImagePreparer, PreparedImage } from './ImagePreparer';
import { FileSystemPort, ResizerPort } from './ports';

export interface PipelineConfig {
  /** Directory (plain path) where prepared files live. Must be persistent, not a cache. */
  workDir: string;
  /** Long-edge sizes to try, largest first. */
  maxEdges: readonly number[];
  /** JPEG qualities to try at each size, highest first. */
  qualities: readonly number[];
  /** A result at or below this is accepted. */
  targetBytes: number;
}

export const DEFAULT_PIPELINE: Omit<PipelineConfig, 'workDir'> = {
  maxEdges: [2560, 2048, 1600, 1280],
  qualities: [80, 70, 60, 50, 40],
  targetBytes: TARGET_UPLOAD_BYTES,
};

/** Accepts both `file:///x/y.jpg` and `/x/y.jpg`. */
export function toPath(uri: string): string {
  return uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri;
}

/** `/.../images/<reportId>/<n>.jpg` -> `<reportId>_<n>.jpg`: stable, so re-preparing overwrites. */
export function preparedFileName(sourcePath: string): string {
  const parts = sourcePath.split('/').filter(Boolean);
  const last = (parts[parts.length - 1] ?? 'image').replace(/\.[^.]*$/, '');
  const parent = parts.length > 1 ? parts[parts.length - 2] : undefined;
  const base = parent ? `${parent}_${last}` : last;
  return `${base.replace(/[^A-Za-z0-9_-]/g, '_')}.jpg`;
}

const DECODE_FAILURE = /decode|bitmap|corrupt|invalid|unsupported|format|not an image/i;

/**
 * Turns any picked photo into a JPEG that is safely under the upload limit.
 *
 * Strategy: start at the target size/quality and walk DOWN a fixed ladder
 * (quality first, then smaller dimensions) until the file measured on disk
 * fits. Resizing runs in native code, so the JS thread never touches pixels.
 * The resizer applies EXIF orientation and strips metadata (including GPS).
 */
export class ImagePipeline implements ImagePreparer {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly resizer: ResizerPort,
    private readonly config: PipelineConfig,
  ) {}

  async prepare(sourceUri: string, _index: number, signal: AbortSignal): Promise<PreparedImage> {
    const sourcePath = toPath(sourceUri);
    if (!(await this.fs.exists(sourcePath))) {
      throw new ImagePrepareError('source_missing', sourcePath);
    }
    await this.fs.ensureDir(this.config.workDir);
    const finalPath = `${this.config.workDir}/${preparedFileName(sourcePath)}`;

    for (const maxEdge of this.config.maxEdges) {
      for (const quality of this.config.qualities) {
        if (signal.aborted) {
          throw new ImagePrepareError('failed', 'aborted');
        }
        const outputPath = await this.resizeOnce(sourcePath, maxEdge, quality);
        // Size comes from the file system, not from the resizer's own report.
        const sizeBytes = await this.fs.sizeOf(outputPath);
        if (sizeBytes <= this.config.targetBytes) {
          await this.fs.move(outputPath, finalPath);
          const md5Base64 = hexToBase64(await this.fs.md5Hex(finalPath));
          return { uri: `file://${finalPath}`, sizeBytes, md5Base64 };
        }
        await this.fs.remove(outputPath);
      }
    }
    throw new ImagePrepareError('too_large', 'Could not get under the size target');
  }

  private async resizeOnce(sourcePath: string, maxEdge: number, quality: number): Promise<string> {
    try {
      const { path } = await this.resizer.resize({
        sourcePath,
        maxEdge,
        quality,
        outputDir: this.config.workDir,
      });
      return toPath(path);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Only a decode problem is a property of the photo (permanent). Anything
      // else (out of memory, disk busy) may succeed on a later attempt.
      throw new ImagePrepareError(DECODE_FAILURE.test(message) ? 'corrupt' : 'failed', message);
    }
  }
}
