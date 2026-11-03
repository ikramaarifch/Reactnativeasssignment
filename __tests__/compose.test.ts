import { addPhotos, removePhoto } from '../src/app/photoList';
import { saveReport, SaveReportDeps, SaveReportError } from '../src/app/saveReport';
import { ReportValidationError } from '../src/core/report';
import { uuidV4 } from '../src/core/uuid';
import { PermissionController, PermissionPort } from '../src/permissions/PermissionController';
import { hangForever } from '../src/testing/fakes';
import { Harness, reportIs, until } from '../src/testing/harness';
import { FakeFileSystem } from '../src/testing/imageFakes';

describe('uuidV4', () => {
  const fixed = (b: Uint8Array) => b.fill(0xff);
  it('produces RFC 4122 v4 format with the version and variant bits set', () => {
    expect(uuidV4(fixed)).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(uuidV4(b => b.fill(0))).toBe('00000000-0000-4000-8000-000000000000');
  });
  it('is different on every call with real randomness', () => {
    const rnd = (b: Uint8Array) => b.map(() => Math.floor(Math.random() * 256));
    expect(new Set(Array.from({ length: 50 }, () => uuidV4(rnd))).size).toBe(50);
  });
});

describe('photoList', () => {
  it('never exceeds 5 photos and counts what was dropped', () => {
    const current = ['a', 'b', 'c'];
    expect(addPhotos(current, ['d', 'e', 'f', 'g'])).toEqual({
      photos: ['a', 'b', 'c', 'd', 'e'],
      dropped: 2,
    });
  });
  it('skips duplicates and supports removal', () => {
    expect(addPhotos(['a'], ['a', 'b'])).toEqual({ photos: ['a', 'b'], dropped: 1 });
    expect(removePhoto(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('saveReport', () => {
  const PICKED = ['file:///cache/pick-1.jpg', 'file:///cache/pick-2.png'];

  function setup() {
    const h = new Harness();
    const fs = new FakeFileSystem();
    PICKED.forEach(u => fs.files.set(u.replace('file://', ''), { size: 18e6, tag: u }));
    const engine = h.engine();
    const deps: SaveReportDeps = { fs, engine, imagesDir: '/docs/images', now: () => 42 };
    return { h, fs, engine, deps };
  }

  it('copies photos into app storage and persists a saved_locally report', async () => {
    const { h, fs, deps } = setup();
    const report = await saveReport(deps, { id: 'r1', description: '  Cracked pipe ', photoUris: PICKED });

    expect(report.status).toBe('saved_locally');
    expect(report.description).toBe('Cracked pipe');
    expect(report.images.map(i => i.sourceUri)).toEqual([
      'file:///docs/images/r1/0.jpg',
      'file:///docs/images/r1/1.png',
    ]);
    expect(fs.files.has('/docs/images/r1/0.jpg')).toBe(true);
    expect((await h.store.get('r1'))?.images).toHaveLength(2);
  });

  it('survives the picker temp files disappearing right after saving', async () => {
    const { fs, deps } = setup();
    const report = await saveReport(deps, { id: 'r1', description: 'x', photoUris: PICKED });
    PICKED.forEach(u => fs.files.delete(u.replace('file://', ''))); // OS cleans the cache
    for (const image of report.images) {
      expect(fs.files.has(image.sourceUri.replace('file://', ''))).toBe(true);
    }
  });

  it('is instant and offline: resolves while the network hangs forever', async () => {
    const { h, deps, engine } = setup();
    h.transport.beforeUpload = hangForever;
    h.transport.beforeGetRemote = hangForever;
    await engine.start();
    await saveReport(deps, { id: 'r1', description: 'x', photoUris: PICKED }); // does not hang
    expect(await h.store.get('r1')).not.toBeNull();
    expect(h.server.docs.size).toBe(0); // nothing is "uploaded"
    await h.stopAll();
  });

  it.each([
    ['blank description', { description: '   ', photoUris: PICKED }, 'description'],
    ['zero photos', { description: 'x', photoUris: [] }, 'images'],
    ['six photos', { description: 'x', photoUris: Array(6).fill('file:///a.jpg') }, 'images'],
  ])('rejects %s before touching the disk', async (_name, input, field) => {
    const { h, fs, deps } = setup();
    const copiesBefore = fs.copies;
    await expect(saveReport(deps, { id: 'r1', ...input })).rejects.toBeInstanceOf(
      ReportValidationError,
    );
    await expect(saveReport(deps, { id: 'r1', ...input })).rejects.toMatchObject({
      errors: [expect.objectContaining({ field })],
    });
    expect(fs.copies).toBe(copiesBefore);
    expect(await h.store.get('r1')).toBeNull();
  });

  it('a failed copy leaves no files and no queue entry, and a retry then works', async () => {
    const { h, fs, deps } = setup();
    fs.failCopyNumber = 2; // second photo fails: disk full
    await expect(
      saveReport(deps, { id: 'r1', description: 'x', photoUris: PICKED }),
    ).rejects.toMatchObject({ code: 'copy_failed' });
    expect([...fs.files.keys()].some(k => k.startsWith('/docs/images/r1'))).toBe(false);
    expect(await h.store.get('r1')).toBeNull();

    await expect(
      saveReport(deps, { id: 'r1', description: 'x', photoUris: PICKED }),
    ).resolves.toBeDefined();
    expect(await h.store.get('r1')).not.toBeNull();
  });

  it('cleans up copied files if writing the report fails', async () => {
    const { h, fs, deps } = setup();
    jest.spyOn(h.store, 'put').mockRejectedValueOnce(new Error('disk I/O error'));
    await expect(
      saveReport(deps, { id: 'r9', description: 'x', photoUris: PICKED }),
    ).rejects.toBeInstanceOf(SaveReportError);
    expect([...fs.files.keys()].some(k => k.startsWith('/docs/images/r9'))).toBe(false);
    expect(await h.store.get('r9')).toBeNull();
  });

  it('double-tap Save (same draft id) never resets a report already uploading', async () => {
    const { h, deps, engine } = setup();
    await engine.start();
    await saveReport(deps, { id: 'r1', description: 'first', photoUris: PICKED });
    await until(engine, reportIs('r1', 'uploaded'));

    await saveReport(deps, { id: 'r1', description: 'second tap', photoUris: PICKED });
    expect((await h.store.get('r1'))?.status).toBe('uploaded');
    expect((await h.store.get('r1'))?.description).toBe('first');
    expect(h.server.docWrites.get('r1')).toBe(1);
    await h.stopAll();
  });
});

describe('PermissionController', () => {
  function setup(initial: { granted: boolean; request?: 'granted' | 'denied' | 'blocked' }) {
    const state = { ...initial, requests: 0 };
    const port: PermissionPort = {
      isGranted: async () => state.granted,
      request: async () => {
        state.requests++;
        const r = state.request ?? 'denied';
        state.granted = r === 'granted';
        return r;
      },
    };
    return { state, controller: new PermissionController(port) };
  }

  it('already granted: no dialog', async () => {
    const { state, controller } = setup({ granted: true });
    expect(await controller.ensure()).toBe(true);
    expect(controller.getStatus()).toBe('granted');
    expect(state.requests).toBe(0);
  });

  it('denied -> can ask again; granted afterwards', async () => {
    const { state, controller } = setup({ granted: false, request: 'denied' });
    expect(await controller.ensure()).toBe(false);
    expect(controller.getStatus()).toBe('denied');
    state.request = 'granted';
    expect(await controller.ensure()).toBe(true);
    expect(controller.getStatus()).toBe('granted');
  });

  it('blocked is remembered across rechecks', async () => {
    const { controller } = setup({ granted: false, request: 'blocked' });
    await controller.ensure();
    expect(controller.getStatus()).toBe('blocked');
    await controller.recheck();
    expect(controller.getStatus()).toBe('blocked'); // still needs Settings
  });

  it('permission granted in Settings is picked up by recheck() on foreground, no restart', async () => {
    const { state, controller } = setup({ granted: false, request: 'blocked' });
    await controller.ensure();
    expect(controller.getStatus()).toBe('blocked');

    state.granted = true; // user flipped it in system Settings
    const seen: string[] = [];
    controller.subscribe(() => seen.push(controller.getStatus()));
    await controller.recheck(); // AppState -> active
    expect(controller.getStatus()).toBe('granted');
    expect(seen).toEqual(['granted']);
  });

  it('revoked in Settings while the app was in the background', async () => {
    const { state, controller } = setup({ granted: true });
    await controller.recheck();
    state.granted = false;
    await controller.recheck();
    expect(controller.getStatus()).toBe('denied');
  });
});
