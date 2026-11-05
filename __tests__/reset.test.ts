import { DraftService } from '../src/app/draft';
import { resetAll, ResetDeps, ResetError } from '../src/app/reset';
import { planReset } from '../src/core/resetPlan';
import { Report, ReportStatus } from '../src/core/types';
import { hangUntilAborted } from '../src/testing/fakes';
import { MemoryQueueStore } from '../src/storage/MemoryQueueStore';
import { Harness, newReport, reportIs, until } from '../src/testing/harness';
import { FakeFileSystem } from '../src/testing/imageFakes';
import { TransportError } from '../src/transport/UploadTransport';

const withStatus = (id: string, status: ReportStatus): Report => ({ ...newReport(id, 1), status });

describe('planReset: exact wording and counts', () => {
  it('warns with the exact count of reports that are not uploaded', () => {
    const plan = planReset([
      withStatus('a', 'uploaded'),
      withStatus('b', 'saved_locally'),
      withStatus('c', 'failed_permanent'),
      withStatus('d', 'failed_retrying'),
    ]);
    expect(plan).toMatchObject({ total: 4, notUploaded: 3, uploaded: 1, destructive: true });
    expect(plan.body).toContain('3 reports have NOT been uploaded');
    expect(plan.confirmLabel).toBe('Delete 3 reports and start over');
    expect(plan.body).toMatch(/nothing is deleted there/i);
  });

  it('uses the singular for one report', () => {
    const plan = planReset([withStatus('a', 'uploading')]);
    expect(plan.body).toContain('1 report has NOT been uploaded');
    expect(plan.confirmLabel).toBe('Delete 1 report and start over');
  });

  it('is calm and non-destructive when everything is already uploaded', () => {
    const plan = planReset([withStatus('a', 'uploaded'), withStatus('b', 'uploaded')]);
    expect(plan.destructive).toBe(false);
    expect(plan.confirmLabel).toBe('Start over');
    expect(plan.body).toMatch(/not affected/i);
    expect(plan.body).not.toMatch(/NOT been uploaded/);
  });
});

describe('engine.reset: no queue entries or in-flight work survive', () => {
  it('reset while an upload is hanging: aborts it, clears the queue, nothing comes back', async () => {
    const h = new Harness();
    h.transport.beforeUpload = req => hangUntilAborted(req.signal);
    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('r1', 2));
    await until(engine, reportIs('r1', 'uploading'));

    await engine.reset();
    expect(await h.store.list()).toEqual([]);
    expect(engine.getState()).toEqual({ reports: [], progress: null });

    h.transport.beforeUpload = undefined; // network "recovers"
    await engine.start();
    await engine.idle();
    await new Promise(r => setTimeout(r, 50));
    expect(await h.store.list()).toEqual([]); // still empty: the old report did not resurrect
    expect(h.server.docs.size).toBe(0);
    expect(h.server.objects.size).toBe(0);
    await h.stopAll();
  });

  it('reset while compressing: no row is written after the clear', async () => {
    const h = new Harness();
    h.preparer.beforePrepare = hangUntilAborted;
    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('r1', 3));
    await until(engine, reportIs('r1', 'preparing'));
    await engine.reset();
    h.preparer.beforePrepare = undefined;
    await new Promise(r => setTimeout(r, 30));
    expect(await h.store.list()).toEqual([]);
    await h.stopAll();
  });

  it('a skip-backoff kick racing the reset cannot resurrect a row (slow database)', async () => {
    // A real SQLite read takes time: model it, so the kick's list() resolves
    // AFTER reset() has issued its clear(). That is the window where a stray
    // put would bring a deleted report back.
    const store = new MemoryQueueStore();
    const h = new Harness(store);
    h.transport.beforeUpload = () => {
      throw new TransportError('network');
    };
    const engine = h.engine({ backoff: { baseMs: 600_000, capMs: 600_000 }, random: () => 0.99 });
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'failed_retrying'));

    const realList = store.list.bind(store);
    store.list = async () => {
      const snapshot = await realList();
      await new Promise(r => setTimeout(r, 30)); // slow I/O: result arrives late
      return snapshot;
    };
    engine.kick({ skipBackoff: true }); // connectivity returned...
    await engine.reset(); // ...at the same moment the user hits Start over
    await new Promise(r => setTimeout(r, 80)); // let the late list() result land
    store.list = realList;
    expect(await store.list()).toEqual([]);
    await h.stopAll();
  });

  it('work that ignores the abort and finishes late never uploads after the reset', async () => {
    const h = new Harness();
    let release: () => void = () => {};
    h.preparer.beforePrepare = () => new Promise<void>(r => (release = r)); // ignores abort
    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('r1', 2));
    await until(engine, reportIs('r1', 'preparing'));
    while (h.preparer.calls.length === 0) {
      await new Promise(r => setTimeout(r, 5)); // wait until the stuck step is really running
    }

    const resetting = engine.reset();
    release(); // the stuck native step finally completes, after the abort
    await resetting;

    expect(h.transport.uploadCalls).toEqual([]);
    expect(h.server.objects.size).toBe(0);
    expect(h.server.docs.size).toBe(0);
    expect(await h.store.list()).toEqual([]);
    await h.stopAll();
  });

  it('does not touch the server: already-uploaded reports stay there', async () => {
    const h = new Harness();
    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('r1', 2));
    await until(engine, reportIs('r1', 'uploaded'));
    const writesBefore = [...h.server.objectWrites.entries()];

    await engine.reset();
    expect(h.server.docs.has('r1')).toBe(true);
    expect(h.server.objects.size).toBe(2);
    expect([...h.server.objectWrites.entries()]).toEqual(writesBefore);
    await h.stopAll();
  });

  it('the engine works normally after a reset', async () => {
    const h = new Harness();
    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('old', 1));
    await until(engine, reportIs('old', 'uploaded'));
    await engine.reset();
    await engine.start();
    await engine.enqueue(newReport('new', 1));
    await until(engine, reportIs('new', 'uploaded'));
    expect(engine.getState().reports.map(r => r.id)).toEqual(['new']);
    await h.stopAll();
  });
});

describe('resetAll: no orphan files', () => {
  const DIRS = {
    imagesDir: '/docs/images',
    preparedDir: '/docs/prepared',
    cacheDir: '/cache',
    draftFile: '/docs/draft.json',
    capturesDir: '/docs/captures',
  };

  function setup() {
    const h = new Harness();
    const fs = new FakeFileSystem();
    const put = (p: string) => fs.files.set(p, { size: 1, tag: p });
    put('/docs/images/r1/0.jpg');
    put('/docs/images/r1/1.jpg');
    put('/docs/prepared/r1_0.jpg');
    put('/docs/draft.json');
    put('/docs/captures/d1-1.jpg');
    put('/cache/rn_image_picker_lib_temp_aaa.jpg');
    put('/cache/rn_image_picker_lib_temp_bbb.jpg');
    put('/cache/unrelated-cache-file.bin'); // not ours: must survive
    const engine = h.engine();
    const started = jest.spyOn(engine, 'start');
    const draft = new DraftService({
      fs,
      camera: { capture: async () => 'cancelled' },
      draftFile: DIRS.draftFile,
      capturesDir: DIRS.capturesDir,
      now: () => 0,
    });
    const deps: ResetDeps = { engine, store: h.store, fs, draft, ...DIRS };
    return { h, fs, engine, started, deps };
  }

  it('removes copies, prepared files and picker temp files, keeps unrelated files', async () => {
    const { h, fs, engine, deps } = setup();
    await engine.start();
    await engine.enqueue(newReport('r1', 2));
    await until(engine, reportIs('r1', 'uploaded'));

    await resetAll(deps);
    // includes the unsaved draft and the camera photos taken for it
    expect([...fs.files.keys()]).toEqual(['/cache/unrelated-cache-file.bin']);
    expect(await h.store.list()).toEqual([]);
    await h.stopAll();
  });

  it('restarts the engine afterwards', async () => {
    const { started, deps, h } = setup();
    await resetAll(deps);
    expect(started).toHaveBeenCalled();
    await h.stopAll();
  });

  it('is safe to run with nothing to delete', async () => {
    const { deps, fs, h } = setup();
    fs.files.clear();
    await expect(resetAll(deps)).resolves.toBeUndefined();
    await h.stopAll();
  });

  it('reports leftovers instead of claiming success, and still restarts the engine', async () => {
    const { deps, fs, started, h } = setup();
    const realRemove = fs.remove.bind(fs);
    fs.remove = async path => {
      if (!path.startsWith('/docs/prepared')) {
        await realRemove(path); // pretend the prepared dir cannot be deleted
      }
    };
    await expect(resetAll(deps)).rejects.toMatchObject({
      constructor: ResetError,
      leftovers: ['prepared files'],
    });
    expect(started).toHaveBeenCalled();
    await h.stopAll();
  });

  it('works while an upload is in flight', async () => {
    const { h, deps, engine, fs } = setup();
    h.transport.beforeUpload = req => hangUntilAborted(req.signal);
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'uploading'));
    h.transport.beforeUpload = undefined;
    await resetAll(deps);
    expect(await h.store.list()).toEqual([]);
    expect(fs.files.has('/docs/images/r1/0.jpg')).toBe(false);
    await h.stopAll();
  });
});
