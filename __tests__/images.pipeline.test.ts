import { hexToBase64 } from '../src/images/encoding';
import { ImagePrepareError } from '../src/images/ImagePreparer';
import {
  DEFAULT_PIPELINE,
  ImagePipeline,
  preparedFileName,
  toPath,
} from '../src/images/ImagePipeline';
import { MAX_UPLOAD_BYTES, TARGET_UPLOAD_BYTES } from '../src/core/types';
import { FakeFileSystem, FakeResizer } from '../src/testing/imageFakes';

const MB = 1024 * 1024;
const SRC = '/data/files/images/rep1/0.jpg';
const signal = new AbortController().signal;

function setup(sizeFor: (edge: number, q: number) => number) {
  const fs = new FakeFileSystem();
  fs.files.set(SRC, { size: 18 * MB, tag: 'original-18MB' });
  const resizer = new FakeResizer(fs, sizeFor);
  const pipeline = new ImagePipeline(fs, resizer, { ...DEFAULT_PIPELINE, workDir: '/data/files/prepared' });
  return { fs, resizer, pipeline };
}

describe('ImagePipeline', () => {
  it('turns an 18 MB original into a file under the target, measured on disk', async () => {
    const { fs, pipeline } = setup(() => 2 * MB);
    const out = await pipeline.prepare(`file://${SRC}`, 0, signal);

    expect(out.sizeBytes).toBeLessThanOrEqual(TARGET_UPLOAD_BYTES);
    expect(out.sizeBytes).toBeLessThan(MAX_UPLOAD_BYTES);
    expect(out.uri).toBe('file:///data/files/prepared/rep1_0.jpg');
    expect(await fs.sizeOf('/data/files/prepared/rep1_0.jpg')).toBe(out.sizeBytes);
    expect(out.md5Base64).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it('starts at 2560px / quality 80', async () => {
    const { resizer, pipeline } = setup(() => MB);
    await pipeline.prepare(SRC, 0, signal);
    expect(resizer.calls).toEqual([{ maxEdge: 2560, quality: 80 }]);
  });

  it('lowers quality step by step while the file is still too big', async () => {
    // 6 MB at q80, dropping 1 MB per 10 quality points: 80->6, 70->5, 60->4 (fits)
    const { resizer, pipeline } = setup((_e, q) => (q / 10 - 2) * MB);
    const out = await pipeline.prepare(SRC, 0, signal);
    expect(resizer.calls.map(c => c.quality)).toEqual([80, 70, 60]);
    expect(resizer.calls.every(c => c.maxEdge === 2560)).toBe(true);
    expect(out.sizeBytes).toBe(4 * MB);
  });

  it('shrinks dimensions once the quality ladder is exhausted', async () => {
    const { resizer, pipeline } = setup(edge => (edge === 2560 ? 9 * MB : 3 * MB));
    await pipeline.prepare(SRC, 0, signal);
    const edges = resizer.calls.map(c => c.maxEdge);
    expect(edges.slice(0, 5)).toEqual([2560, 2560, 2560, 2560, 2560]);
    expect(edges[5]).toBe(2048);
    expect(resizer.calls[5]?.quality).toBe(80); // quality resets with the new size
  });

  it('fails with too_large (never returns an oversized file) if nothing fits', async () => {
    const { fs, resizer, pipeline } = setup(() => 8 * MB);
    await expect(pipeline.prepare(SRC, 0, signal)).rejects.toMatchObject({ code: 'too_large' });
    expect(resizer.calls).toHaveLength(
      DEFAULT_PIPELINE.maxEdges.length * DEFAULT_PIPELINE.qualities.length,
    );
    // no leftovers: only the source remains
    expect([...fs.files.keys()]).toEqual([SRC]);
  });

  it('rejects a result of exactly the target + 1 byte', async () => {
    const { resizer, pipeline } = setup(() => TARGET_UPLOAD_BYTES + 1);
    await expect(pipeline.prepare(SRC, 0, signal)).rejects.toBeInstanceOf(ImagePrepareError);
    expect(resizer.calls.length).toBeGreaterThan(1);
  });

  it('accepts a result of exactly the target', async () => {
    const { pipeline } = setup(() => TARGET_UPLOAD_BYTES);
    await expect(pipeline.prepare(SRC, 0, signal)).resolves.toMatchObject({
      sizeBytes: TARGET_UPLOAD_BYTES,
    });
  });

  it('leaves no intermediate files behind after a multi-step run', async () => {
    const { fs, pipeline } = setup((_e, q) => (q / 10 - 2) * MB);
    await pipeline.prepare(SRC, 0, signal);
    expect([...fs.files.keys()].sort()).toEqual(['/data/files/images/rep1/0.jpg', '/data/files/prepared/rep1_0.jpg']);
  });

  it('is idempotent: preparing twice overwrites the same prepared file', async () => {
    const { fs, pipeline } = setup(() => MB);
    const a = await pipeline.prepare(SRC, 0, signal);
    const b = await pipeline.prepare(SRC, 0, signal);
    expect(b.uri).toBe(a.uri);
    expect(fs.files.size).toBe(2);
  });

  it('reports a missing source as source_missing', async () => {
    const { fs, pipeline } = setup(() => MB);
    fs.files.delete(SRC);
    await expect(pipeline.prepare(SRC, 0, signal)).rejects.toMatchObject({ code: 'source_missing' });
  });

  it('classifies decode failures as corrupt and other failures as retryable', async () => {
    const { resizer, pipeline } = setup(() => MB);
    resizer.failWith = new Error('Could not decode bitmap');
    await expect(pipeline.prepare(SRC, 0, signal)).rejects.toMatchObject({ code: 'corrupt' });
    resizer.failWith = new Error('OutOfMemoryError');
    await expect(pipeline.prepare(SRC, 0, signal)).rejects.toMatchObject({ code: 'failed' });
  });

  it('stops between attempts when aborted', async () => {
    const { resizer, pipeline } = setup(() => 9 * MB);
    const controller = new AbortController();
    const original = resizer.resize.bind(resizer);
    resizer.resize = async req => {
      const r = await original(req);
      controller.abort();
      return r;
    };
    await expect(pipeline.prepare(SRC, 0, controller.signal)).rejects.toMatchObject({ code: 'failed' });
    expect(resizer.calls).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('toPath strips file:// and decodes', () => {
    expect(toPath('file:///a/b%20c.jpg')).toBe('/a/b c.jpg');
    expect(toPath('/a/b.jpg')).toBe('/a/b.jpg');
  });

  it('preparedFileName is stable and filesystem-safe', () => {
    expect(preparedFileName('/x/images/rep-1/3.jpg')).toBe('rep-1_3.jpg');
    expect(preparedFileName('/x/images/we ird/3.heic')).toBe('we_ird_3.jpg');
  });

  it('hexToBase64 matches known MD5 vectors (base64 as Firebase reports it)', () => {
    expect(hexToBase64('d41d8cd98f00b204e9800998ecf8427e')).toBe('1B2M2Y8AsgTpgAmY7PhCfg==');
    expect(hexToBase64('900150983cd24fb0d6963f7d28e17f72')).toBe('kAFQmDzST7DWlj99KOF/cg=='); // md5("abc")
    expect(() => hexToBase64('xyz')).toThrow();
  });
});
