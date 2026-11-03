import { UploadEngine } from '../core/UploadEngine';
import { FileSystemPort } from '../images/ports';
import { QueueStore } from '../storage/QueueStore';

export interface ResetDeps {
  engine: Pick<UploadEngine, 'reset' | 'start'>;
  store: QueueStore;
  fs: FileSystemPort;
  /** Our copies of picked photos (`images/{reportId}/...`). */
  imagesDir: string;
  /** Compressed files waiting to upload. */
  preparedDir: string;
  /** The OS/app cache dir, where the photo picker leaves temp copies. */
  cacheDir: string;
}

/** Files the photo picker library leaves in the cache directory. */
export const PICKER_TEMP_PREFIX = 'rn_image_picker_lib_temp_';

export class ResetError extends Error {
  constructor(readonly leftovers: string[]) {
    super(`Reset incomplete: ${leftovers.join(', ')}`);
    this.name = 'ResetError';
  }
}

/**
 * "Start over". Order is the whole point:
 *   1. engine.reset(): abort in-flight uploads, WAIT for them to settle (so no
 *      row or file can be written afterwards), then clear the queue
 *   2. delete every directory/file we ever created for reports
 *   3. VERIFY nothing is left (rows, directories, picker temp files)
 *   4. restart the engine, even if verification failed, so the app keeps working
 * The server is never contacted: nothing there is touched.
 */
export async function resetAll(deps: ResetDeps): Promise<void> {
  const { engine, fs } = deps;
  let leftovers: string[] = [];
  try {
    await engine.reset();

    await fs.remove(deps.imagesDir);
    await fs.remove(deps.preparedDir);
    for (const name of await fs.list(deps.cacheDir)) {
      if (name.startsWith(PICKER_TEMP_PREFIX)) {
        await fs.remove(`${deps.cacheDir}/${name}`);
      }
    }

    leftovers = await findLeftovers(deps);
  } finally {
    await engine.start();
  }
  if (leftovers.length > 0) {
    throw new ResetError(leftovers);
  }
}

async function findLeftovers({ store, fs, imagesDir, preparedDir, cacheDir }: ResetDeps): Promise<string[]> {
  const left: string[] = [];
  if ((await store.list()).length > 0) {
    left.push('queue entries');
  }
  if (await fs.exists(imagesDir)) {
    left.push('photo copies');
  }
  if (await fs.exists(preparedDir)) {
    left.push('prepared files');
  }
  if ((await fs.list(cacheDir)).some(n => n.startsWith(PICKER_TEMP_PREFIX))) {
    left.push('picker temp files');
  }
  return left;
}
