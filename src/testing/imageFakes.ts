import { FileSystemPort, ResizeRequest, ResizerPort } from '../images/ports';

/** In-memory file system: path -> size and content tag (md5 is derived from the tag). */
export class FakeFileSystem implements FileSystemPort {
  files = new Map<string, { size: number; tag: string }>();
  dirs = new Set<string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async sizeOf(path: string): Promise<number> {
    const f = this.files.get(path);
    if (!f) {
      throw new Error(`ENOENT ${path}`);
    }
    return f.size;
  }
  async md5Hex(path: string): Promise<string> {
    const f = this.files.get(path);
    if (!f) {
      throw new Error(`ENOENT ${path}`);
    }
    // Deterministic 32-hex "digest" of the tag, enough to compare contents.
    let h = '';
    for (let i = 0; i < 16; i++) {
      h += (f.tag.charCodeAt(i % f.tag.length) * (i + 7) % 256).toString(16).padStart(2, '0');
    }
    return h;
  }
  async ensureDir(path: string): Promise<void> {
    this.dirs.add(path);
  }
  async move(from: string, to: string): Promise<void> {
    const f = this.files.get(from);
    if (!f) {
      throw new Error(`ENOENT ${from}`);
    }
    this.files.delete(from);
    this.files.set(to, f);
  }
  /** Set to make the Nth copy (1-based) fail, to test cleanup. */
  failCopyNumber?: number;
  copies = 0;
  async copy(from: string, to: string): Promise<void> {
    this.copies++;
    if (this.copies === this.failCopyNumber) {
      throw new Error('ENOSPC: no space left on device');
    }
    const f = this.files.get(from);
    if (!f) {
      throw new Error(`ENOENT ${from}`);
    }
    this.files.set(to, { ...f });
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(path + '/')) {
        this.files.delete(key);
      }
    }
  }
}

/**
 * Scriptable resizer. `sizeFor(maxEdge, quality)` models how big the output
 * is; the call log records every attempt in order.
 */
export class FakeResizer implements ResizerPort {
  calls: Array<{ maxEdge: number; quality: number }> = [];
  private counter = 0;
  failWith?: Error;

  constructor(
    private readonly fs: FakeFileSystem,
    private readonly sizeFor: (maxEdge: number, quality: number) => number,
  ) {}

  async resize(req: ResizeRequest): Promise<{ path: string }> {
    this.calls.push({ maxEdge: req.maxEdge, quality: req.quality });
    if (this.failWith) {
      throw this.failWith;
    }
    const path = `${req.outputDir}/tmp-${this.counter++}.jpg`;
    this.fs.files.set(path, {
      size: this.sizeFor(req.maxEdge, req.quality),
      tag: `${req.sourcePath}@${req.maxEdge}/${req.quality}`,
    });
    return { path };
  }
}
