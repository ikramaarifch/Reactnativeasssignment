import { CameraCapturePort, DraftService, DraftState } from '../src/app/draft';
import { FakeFileSystem } from '../src/testing/imageFakes';

const DRAFT = '/docs/draft.json';
const CAPTURES = '/docs/captures';

/** Starts a capture whose result never reaches the app (it is not awaited). */
const pendingCapture = (draft: DraftService, s: DraftState): void => {
  draft.capture(s).catch(() => {});
};

/** A camera that writes the file like the real one, then lets the test decide what the app hears. */
class FakeCamera implements CameraCapturePort {
  paths: string[] = [];
  outcome: 'captured' | 'cancelled' = 'captured';
  writeFile = true;
  /** Simulates the process dying while the camera is open: the app never gets the result. */
  neverReturns = false;
  failWith?: Error;
  constructor(private readonly fs: FakeFileSystem) {}

  async capture(path: string): Promise<'captured' | 'cancelled'> {
    this.paths.push(path);
    if (this.failWith) {
      throw this.failWith;
    }
    if (this.writeFile) {
      this.fs.files.set(path, { size: 2_000_000, tag: path });
    }
    if (this.neverReturns) {
      return new Promise<never>(() => {});
    }
    return this.outcome;
  }
}

function setup() {
  const fs = new FakeFileSystem();
  const camera = new FakeCamera(fs);
  const make = () =>
    new DraftService({ fs, camera, draftFile: DRAFT, capturesDir: CAPTURES, now: () => 1000 });
  return { fs, camera, make, draft: make() };
}

const state = (over: Partial<DraftState> = {}): DraftState => ({
  id: 'd1',
  description: '',
  photos: [],
  ...over,
});

describe('DraftService: persistence', () => {
  it('restores the description and photos after a restart', async () => {
    const { fs, make, draft } = setup();
    fs.files.set('/cache/a.jpg', { size: 1, tag: 'a' });
    await draft.save(state({ description: 'Cracked pipe', photos: ['file:///cache/a.jpg'] }));

    const restarted = make();
    expect(await restarted.load()).toEqual({
      id: 'd1',
      description: 'Cracked pipe',
      photos: ['file:///cache/a.jpg'],
    });
  });

  it('writes nothing for an empty form, and removes an old draft that became empty', async () => {
    const { fs, draft } = setup();
    await draft.save(state());
    expect(fs.files.has(DRAFT)).toBe(false);

    await draft.save(state({ description: 'x' }));
    expect(fs.files.has(DRAFT)).toBe(true);
    await draft.save(state());
    expect(fs.files.has(DRAFT)).toBe(false);
  });

  it('drops photos whose files have disappeared, keeps the rest', async () => {
    const { fs, make, draft } = setup();
    fs.files.set('/cache/keep.jpg', { size: 1, tag: 'k' });
    await draft.save(
      state({ description: 'x', photos: ['file:///cache/keep.jpg', 'file:///cache/gone.jpg'] }),
    );
    const loaded = await make().load();
    expect(loaded?.photos).toEqual(['file:///cache/keep.jpg']);
  });

  it('treats a corrupt or foreign draft file as no draft instead of crashing', async () => {
    const { fs, make } = setup();
    for (const bad of ['{not json', '[]', '{"id":1}', 'null']) {
      fs.files.set(DRAFT, { size: bad.length, tag: bad });
      expect(await make().load()).toBeNull();
    }
  });

  it('returns null when there is no draft', async () => {
    expect(await setup().draft.load()).toBeNull();
  });
});

describe('DraftService: the camera', () => {
  it('hands back the photo and keeps it on disk', async () => {
    const { fs, camera, draft } = setup();
    const result = await draft.capture(state({ description: 'Leak' }));
    expect(result).toEqual({ kind: 'captured', uri: `file://${camera.paths[0]}` });
    expect(camera.paths[0]).toBe(`${CAPTURES}/d1-1000.jpg`);
    expect(fs.files.has(camera.paths[0] as string)).toBe(true);
  });

  it('saves the draft BEFORE the camera opens, so a kill cannot lose what was typed', async () => {
    const { fs, camera, draft } = setup();
    camera.neverReturns = true;
    pendingCapture(draft, state({ description: 'typed before the camera' }));
    await new Promise(r => setTimeout(r, 0));
    const onDisk = JSON.parse(fs.files.get(DRAFT)?.tag ?? '{}');
    expect(onDisk.description).toBe('typed before the camera');
    expect(onDisk.pendingCapture).toBe(`${CAPTURES}/d1-1000.jpg`);
  });

  it('RECOVERS a photo taken while the app was killed (the reported bug)', async () => {
    const { camera, make, draft } = setup();
    camera.neverReturns = true; // the app is killed while the camera is open; the camera still writes the file
    pendingCapture(draft, state({ description: 'Rust on beam', photos: [] }));
    await new Promise(r => setTimeout(r, 0));

    const restarted = make(); // a new process: nothing in memory
    const loaded = await restarted.load();
    expect(loaded).toEqual({
      id: 'd1',
      description: 'Rust on beam',
      photos: [`file://${CAPTURES}/d1-1000.jpg`],
    });
  });

  it('does not add the same recovered photo twice on a second restart', async () => {
    const { camera, make, draft } = setup();
    camera.neverReturns = true;
    pendingCapture(draft, state({ description: 'x' }));
    await new Promise(r => setTimeout(r, 0));
    await make().load();
    const again = await make().load();
    expect(again?.photos).toHaveLength(1);
  });

  it('ignores a pending photo the camera never wrote (killed before the shutter)', async () => {
    const { camera, make, draft } = setup();
    camera.neverReturns = true;
    camera.writeFile = false;
    pendingCapture(draft, state({ description: 'x' }));
    await new Promise(r => setTimeout(r, 0));
    expect((await make().load())?.photos).toEqual([]);
  });

  it('ignores an empty (0-byte) file left by an aborted capture', async () => {
    const { fs, camera, make, draft } = setup();
    camera.neverReturns = true;
    pendingCapture(draft, state({ description: 'x' }));
    await new Promise(r => setTimeout(r, 0));
    fs.files.set(`${CAPTURES}/d1-1000.jpg`, { size: 0, tag: 'empty' });
    expect((await make().load())?.photos).toEqual([]);
  });

  it('does not recover into a full report (max 5 photos)', async () => {
    const { fs, camera, make, draft } = setup();
    const five = ['1', '2', '3', '4', '5'].map(n => {
      fs.files.set(`/cache/${n}.jpg`, { size: 1, tag: n });
      return `file:///cache/${n}.jpg`;
    });
    camera.neverReturns = true;
    pendingCapture(draft, state({ description: 'x', photos: five }));
    await new Promise(r => setTimeout(r, 0));
    expect((await make().load())?.photos).toEqual(five);
  });

  it('cancel: no photo, the empty capture file is removed, nothing pending remains', async () => {
    const { fs, camera, draft } = setup();
    camera.outcome = 'cancelled';
    expect(await draft.capture(state({ description: 'x' }))).toEqual({ kind: 'cancelled' });
    expect(fs.files.has(`${CAPTURES}/d1-1000.jpg`)).toBe(false);
    expect(JSON.parse(fs.files.get(DRAFT)?.tag ?? '{}').pendingCapture).toBeNull();
  });

  it('camera failure is reported with a readable message, and nothing is left pending', async () => {
    const { fs, camera, draft } = setup();
    camera.failWith = Object.assign(new Error('x'), { code: 'E_CAMERA_UNAVAILABLE' });
    expect(await draft.capture(state({ description: 'x' }))).toEqual({
      kind: 'error',
      message: 'No camera is available on this device.',
    });
    expect(JSON.parse(fs.files.get(DRAFT)?.tag ?? '{}').pendingCapture).toBeNull();
  });

  it('a normal return does not leave the photo to be added a second time on restart', async () => {
    const { make, draft } = setup();
    const result = await draft.capture(state({ description: 'x' }));
    if (result.kind !== 'captured') {
      throw new Error('expected a photo');
    }
    await draft.save(state({ description: 'x', photos: [result.uri] })); // what the UI does next
    expect((await make().load())?.photos).toEqual([result.uri]);
  });
});

describe('DraftService: clear', () => {
  it('removes the draft file and every camera photo', async () => {
    const { fs, draft } = setup();
    await draft.capture(state({ description: 'x' }));
    await draft.clear();
    expect([...fs.files.keys()]).toEqual([]);
  });
});
