import { ImagePrepareError, ImagePreparer, PreparedImage } from '../images/ImagePreparer';
import { ReportDocument } from '../core/types';
import {
  RemoteImageInfo,
  UploadImageRequest,
  UploadTransport,
} from '../transport/UploadTransport';

/** Stand-in for Storage + Firestore: keyed by path/id, so duplicates are impossible to hide. */
export class FakeServer {
  objects = new Map<string, RemoteImageInfo>();
  docs = new Map<string, ReportDocument>();
  /** How many times each path/doc was written, to prove nothing is sent twice needlessly. */
  objectWrites = new Map<string, number>();
  docWrites = new Map<string, number>();
}

export type Hook = (signal: AbortSignal) => Promise<void> | void;

/** A promise that never resolves by itself but rejects when aborted (a "dead" request). */
export const hangUntilAborted = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject) => {
    // The signal may already be aborted: 'abort' fires only once, so check first.
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });

/** A promise that ignores the abort signal entirely (worst-case transport). */
export const hangForever = (): Promise<never> => new Promise(() => {});

/**
 * Fake transport with hooks at each point where real networks misbehave:
 *  - beforeUpload / beforeCommit: fail or hang before the server saw anything
 *  - afterUploadStored / afterCommitStored: server saved it, then the reply is lost
 */
export class FakeTransport implements UploadTransport {
  uploadCalls: string[] = [];
  commitCalls = 0;
  getRemoteCalls = 0;

  beforeUpload?: (req: UploadImageRequest) => Promise<void> | void;
  afterUploadStored?: (req: UploadImageRequest) => Promise<void> | void;
  beforeCommit?: Hook;
  afterCommitStored?: Hook;
  beforeGetRemote?: Hook;

  constructor(readonly server: FakeServer, private readonly md5ByUri: Map<string, string>) {}

  async getRemoteImage(path: string, signal: AbortSignal): Promise<RemoteImageInfo | null> {
    this.getRemoteCalls++;
    await this.beforeGetRemote?.(signal);
    return this.server.objects.get(path) ?? null;
  }

  async uploadImage(req: UploadImageRequest): Promise<void> {
    this.uploadCalls.push(req.path);
    await this.beforeUpload?.(req);
    req.onProgress(req.sizeBytes, req.sizeBytes);
    this.server.objects.set(req.path, {
      sizeBytes: req.sizeBytes,
      md5Base64: this.md5ByUri.get(req.localUri) ?? 'unknown',
    });
    this.server.objectWrites.set(req.path, (this.server.objectWrites.get(req.path) ?? 0) + 1);
    await this.afterUploadStored?.(req);
  }

  async commitReport(doc: ReportDocument, signal: AbortSignal): Promise<void> {
    this.commitCalls++;
    await this.beforeCommit?.(signal);
    this.server.docs.set(doc.id, doc);
    this.server.docWrites.set(doc.id, (this.server.docWrites.get(doc.id) ?? 0) + 1);
    await this.afterCommitStored?.(signal);
  }
}

/** Deterministic preparer: size per source URI is configurable, md5 is derived from the URI. */
export class FakePreparer implements ImagePreparer {
  sizes = new Map<string, number>();
  missing = new Set<string>();
  calls: string[] = [];
  beforePrepare?: Hook;
  readonly md5ByUri = new Map<string, string>();

  constructor(private readonly defaultSize = 1_000_000) {}

  async prepare(sourceUri: string, index: number, signal: AbortSignal): Promise<PreparedImage> {
    this.calls.push(sourceUri);
    await this.beforePrepare?.(signal);
    if (this.missing.has(sourceUri)) {
      throw new ImagePrepareError('source_missing');
    }
    const uri = `prepared://${index}-${sourceUri}`;
    const md5Base64 = `md5(${sourceUri})`;
    this.md5ByUri.set(uri, md5Base64);
    return { uri, sizeBytes: this.sizes.get(sourceUri) ?? this.defaultSize, md5Base64 };
  }
}
