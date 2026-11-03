import ReactNativeBlobUtil from 'react-native-blob-util';
import { createReport } from '../core/report';
import { UploadEngine } from '../core/UploadEngine';

const { fs } = ReactNativeBlobUtil;
const DOCS = fs.dirs.DocumentDir;

/** Where `npm run test-images` puts the sample photos on the phone. */
export const TEST_DATA_DIR = `${DOCS}/testdata`;

export type SmokeSource = 'big' | 'small';

// Dev-only id; the real compose flow (step 5) uses a proper UUID generator.
const devId = (): string =>
  'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

/**
 * Creates a report the same way the real save flow will: copy photos into the
 * app's own directory, then write the report to the local queue.
 */
export async function enqueueSmokeReport(
  engine: UploadEngine,
  source: SmokeSource,
  photoCount: number,
): Promise<string> {
  const sourcePath = `${TEST_DATA_DIR}/${source}.jpg`;
  if (!(await fs.exists(sourcePath))) {
    throw new Error(`Missing ${sourcePath}. Run: npm run test-images`);
  }
  const id = devId();
  const dir = `${DOCS}/images/${id}`;
  await fs.mkdir(dir);
  const imageUris: string[] = [];
  for (let i = 0; i < photoCount; i++) {
    const target = `${dir}/${i}.jpg`;
    await fs.cp(sourcePath, target);
    imageUris.push(`file://${target}`);
  }
  await engine.enqueue(
    createReport({ description: `Smoke test (${source} x${photoCount})`, imageUris }, id, Date.now()),
  );
  return id;
}
