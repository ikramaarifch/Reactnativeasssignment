import { ReportStatus } from '../src/core/types';
import { TransportError } from '../src/transport/UploadTransport';
import { hangUntilAborted } from '../src/testing/fakes';
import { Harness, newReport, reportIs, statusOf, until } from '../src/testing/harness';

describe('engine lifecycle', () => {
  let h: Harness;
  beforeEach(() => {
    h = new Harness();
  });
  afterEach(() => h.stopAll());

  it('uploads images in order, then commits, and ends uploaded', async () => {
    const order: string[] = [];
    h.transport.beforeUpload = req => {
      order.push(`image:${req.path}`);
    };
    h.transport.afterCommitStored = () => {
      order.push('commit');
    };

    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('r1', 3));
    await until(engine, reportIs('r1', 'uploaded'));

    expect(order).toEqual([
      'image:reports/r1/0.jpg',
      'image:reports/r1/1.jpg',
      'image:reports/r1/2.jpg',
      'commit',
    ]);
    const doc = h.server.docs.get('r1');
    expect(doc?.status).toBe('complete');
    expect(doc?.imagePaths).toEqual([
      'reports/r1/0.jpg',
      'reports/r1/1.jpg',
      'reports/r1/2.jpg',
    ]);
  });

  it('walks the documented states in order', async () => {
    const seen: ReportStatus[] = [];
    const engine = h.engine();
    engine.subscribe(() => {
      const s = statusOf(engine, 'r1') as ReportStatus | undefined;
      if (s && seen[seen.length - 1] !== s) {
        seen.push(s);
      }
    });
    await engine.start();
    await engine.enqueue(newReport('r1'));
    await until(engine, reportIs('r1', 'uploaded'));
    expect(seen).toEqual(['saved_locally', 'preparing', 'uploading', 'finalizing', 'uploaded']);
  });

  it('persists every transition BEFORE acting on it', async () => {
    const statusWhen: Record<string, string | undefined> = {};
    const snap = async (key: string) => {
      statusWhen[key] = (await h.store.get('r1'))?.status;
    };
    h.preparer.beforePrepare = () => snap('prepare');
    h.transport.beforeUpload = () => snap('upload');
    h.transport.beforeCommit = () => snap('commit');

    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'uploaded'));

    expect(statusWhen).toEqual({
      prepare: 'preparing',
      upload: 'uploading',
      commit: 'finalizing',
    });
  });

  it('processes reports oldest first, one at a time', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const started: string[] = [];
    h.transport.beforeUpload = async req => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      started.push(req.path);
      await new Promise(r => setTimeout(r, 5));
      concurrent--;
    };
    const engine = h.engine();
    // Both are on disk before the engine starts, so ordering is by createdAt.
    await h.store.put(newReport('b', 2, 2_000));
    await h.store.put(newReport('a', 2, 1_000));
    await engine.start();
    await until(engine, s => s.reports.every(r => r.status === 'uploaded'));

    expect(maxConcurrent).toBe(1);
    expect(started.map(p => p.split('/')[1])).toEqual(['a', 'a', 'b', 'b']);
  });

  it('reports byte progress for the image being uploaded', async () => {
    const seen: number[] = [];
    const engine = h.engine();
    engine.subscribe(() => {
      const p = engine.getState().progress;
      if (p) {
        seen.push(p.imageIndex);
      }
    });
    await engine.start();
    await engine.enqueue(newReport('r1', 2));
    await until(engine, reportIs('r1', 'uploaded'));
    await engine.idle();
    expect(seen).toContain(0);
    expect(seen).toContain(1);
    expect(engine.getState().progress).toBeNull();
  });
});

describe('kill / restart at every state', () => {
  /**
   * "Kill" = the first engine is aborted at the exact moment the work for that
   * state is in progress and never writes again, exactly like a dead process.
   * A second engine then boots from the same disk and must finish the job
   * with nothing lost and nothing duplicated.
   */
  const scenarios: Array<[ReportStatus, (h: Harness) => void]> = [
    ['preparing', h => (h.preparer.beforePrepare = hangUntilAborted)],
    ['uploading', h => (h.transport.beforeUpload = req => hangUntilAborted(req.signal))],
    ['finalizing', h => (h.transport.beforeCommit = hangUntilAborted)],
  ];

  it.each(scenarios)('killed while %s -> resumes and completes once', async (state, arm) => {
    const h = new Harness();
    const first = h.engine();
    arm(h);
    await first.start();
    await first.enqueue(newReport('r1', 2));
    await until(first, reportIs('r1', state));
    await first.stop(); // the "kill"

    // The disk still says the in-flight state; nothing was lost.
    expect((await h.store.get('r1'))?.status).toBe(state);

    h.preparer.beforePrepare = undefined;
    h.transport.beforeUpload = undefined;
    h.transport.beforeCommit = undefined;

    const second = h.engine();
    await second.start();
    await until(second, reportIs('r1', 'uploaded'));

    expect(h.server.docWrites.get('r1')).toBe(1);
    for (const path of ['reports/r1/0.jpg', 'reports/r1/1.jpg']) {
      expect(h.server.objectWrites.get(path)).toBe(1);
    }
  });

  it('killed while saved_locally (never started) -> uploads after restart', async () => {
    const h = new Harness();
    const first = h.engine();
    await first.enqueue(newReport('r1')); // not started: pure "saved on this phone"
    expect((await h.store.get('r1'))?.status).toBe('saved_locally');

    const second = h.engine();
    await second.start();
    await until(second, reportIs('r1', 'uploaded'));
    expect(h.server.docs.size).toBe(1);
    await h.stopAll();
  });

  it('killed while failed_retrying -> still retried after restart', async () => {
    const h = new Harness();
    let failing = true;
    h.transport.beforeUpload = () => {
      if (failing) {
        throw new TransportError('network');
      }
    };
    const first = h.engine({ backoff: { baseMs: 60_000, capMs: 60_000 }, random: () => 0.99 });
    await first.start();
    await first.enqueue(newReport('r1', 1));
    await until(first, reportIs('r1', 'failed_retrying'));
    await first.stop();

    failing = false;
    const second = h.engine({ random: () => 0 });
    await second.start();
    second.kick({ skipBackoff: true });
    await until(second, reportIs('r1', 'uploaded'));
    await h.stopAll();
  });

  it('a second start() while running does not disturb an in-flight report', async () => {
    const h = new Harness();
    h.transport.beforeUpload = req => hangUntilAborted(req.signal);
    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'uploading'));

    await engine.start(); // e.g. headless task + UI both start the engine
    expect(statusOf(engine, 'r1')).toBe('uploading'); // not knocked back to saved_locally
    expect((await h.store.get('r1'))?.status).toBe('uploading');
    await h.stopAll();
  });

  it('an uploaded report stays uploaded after restart and is not re-sent', async () => {
    const h = new Harness();
    const first = h.engine();
    await first.start();
    await first.enqueue(newReport('r1', 1));
    await until(first, reportIs('r1', 'uploaded'));
    await first.stop();
    const uploadsBefore = h.transport.uploadCalls.length;

    const second = h.engine();
    await second.start();
    await second.idle();
    expect(statusOf(second, 'r1')).toBe('uploaded');
    expect(h.transport.uploadCalls.length).toBe(uploadsBefore);
    expect(h.transport.commitCalls).toBe(1);
    await h.stopAll();
  });

  it('does not re-compress images already prepared before the kill', async () => {
    const h = new Harness();
    const first = h.engine();
    h.transport.beforeUpload = req => hangUntilAborted(req.signal);
    await first.start();
    await first.enqueue(newReport('r1', 2));
    await until(first, reportIs('r1', 'uploading'));
    await first.stop();
    const prepareCalls = h.preparer.calls.length;

    h.transport.beforeUpload = undefined;
    const second = h.engine();
    await second.start();
    await until(second, reportIs('r1', 'uploaded'));
    expect(h.preparer.calls.length).toBe(prepareCalls);
    await h.stopAll();
  });
});

