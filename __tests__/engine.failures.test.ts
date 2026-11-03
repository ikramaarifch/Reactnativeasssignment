import { backoffDelayMs, classifyError, NoProgressError } from '../src/core/retryPolicy';
import { MAX_UPLOAD_BYTES } from '../src/core/types';
import { hangForever } from '../src/testing/fakes';
import { Harness, newReport, reportIs, until } from '../src/testing/harness';
import { TransportError, TransportErrorCode } from '../src/transport/UploadTransport';
import { ImagePrepareError } from '../src/images/ImagePreparer';

describe('retryable vs non-retryable errors', () => {
  const retryable: TransportErrorCode[] = [
    'network',
    'timeout',
    'unavailable',
    'deadline-exceeded',
    'server-error',
    'canceled',
  ];
  const permanent: TransportErrorCode[] = [
    'permission-denied',
    'unauthenticated',
    'invalid-argument',
    'quota-exceeded',
  ];

  it.each(retryable)('%s -> failed_retrying, and succeeds once the fault clears', async code => {
    const h = new Harness();
    let failures = 2;
    h.transport.beforeUpload = () => {
      if (failures-- > 0) {
        throw new TransportError(code);
      }
    };
    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'failed_retrying'));
    expect(engine.getState().reports[0]?.failure?.reason).toMatch(/retry automatically/i);
    await until(engine, reportIs('r1', 'uploaded'));
    expect(h.transport.uploadCalls.length).toBe(3);
    await h.stopAll();
  });

  it.each(permanent)('%s -> failed_permanent, never retried blindly', async code => {
    const h = new Harness();
    h.transport.beforeUpload = () => {
      throw new TransportError(code);
    };
    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'failed_permanent'));
    await engine.idle();
    await new Promise(r => setTimeout(r, 50));

    const failure = engine.getState().reports[0]?.failure;
    expect(failure?.reason.length).toBeGreaterThan(10);
    expect(failure?.reason).not.toMatch(/automatically/i);
    expect(h.transport.uploadCalls).toHaveLength(1); // exactly one attempt
    await h.stopAll();
  });

  it('manual retry of a failed_permanent report works once the cause is fixed', async () => {
    const h = new Harness();
    let refuse = true;
    h.transport.beforeUpload = () => {
      if (refuse) {
        throw new TransportError('permission-denied');
      }
    };
    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'failed_permanent'));

    refuse = false; // e.g. rules fixed
    await engine.retry('r1');
    await until(engine, reportIs('r1', 'uploaded'));
    expect(engine.getState().reports[0]?.failure).toBeNull();
    await h.stopAll();
  });

  it('a permanently failed report does not block the ones behind it', async () => {
    const h = new Harness();
    h.transport.beforeUpload = req => {
      if (req.path.startsWith('reports/bad/')) {
        throw new TransportError('invalid-argument');
      }
    };
    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('bad', 1, 1_000));
    await engine.enqueue(newReport('good', 1, 2_000));
    await until(engine, reportIs('good', 'uploaded'));
    expect(engine.getState().reports.find(r => r.id === 'bad')?.status).toBe('failed_permanent');
    await h.stopAll();
  });

  it('a missing source photo is permanent with a clear reason', async () => {
    const h = new Harness();
    h.preparer.missing.add('file:///docs/r1-0.jpg');
    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'failed_permanent'));
    expect(engine.getState().reports[0]?.failure?.code).toBe('source_missing');
    await h.stopAll();
  });

  it('kick({skipBackoff}) retries immediately instead of waiting out the backoff', async () => {
    const h = new Harness();
    let down = true;
    h.transport.beforeUpload = () => {
      if (down) {
        throw new TransportError('network');
      }
    };
    const engine = h.engine({ backoff: { baseMs: 600_000, capMs: 600_000 }, random: () => 0.99 });
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'failed_retrying'));

    down = false; // network came back (NetInfo)
    engine.kick({ skipBackoff: true });
    await until(engine, reportIs('r1', 'uploaded'));
    await h.stopAll();
  });

  it('classifyError treats unknown errors as retryable (unattended uploader)', () => {
    expect(classifyError(new Error('???')).retryable).toBe(true);
    expect(classifyError(new NoProgressError(1)).retryable).toBe(true);
    expect(classifyError(new ImagePrepareError('corrupt')).retryable).toBe(false);
  });
});

describe('backoff', () => {
  const cfg = { baseMs: 1_000, capMs: 10_000 };
  it('grows exponentially, is capped, and jitters within [0, ceiling]', () => {
    expect(backoffDelayMs(0, () => 0.999, cfg)).toBeLessThanOrEqual(1_000);
    expect(backoffDelayMs(2, () => 0.999, cfg)).toBeLessThanOrEqual(4_000);
    expect(backoffDelayMs(2, () => 0.999, cfg)).toBeGreaterThan(3_000);
    expect(backoffDelayMs(30, () => 0.999, cfg)).toBeLessThanOrEqual(10_000); // cap
    expect(backoffDelayMs(5, () => 0, cfg)).toBe(0);
  });
});

describe('no-progress watchdog', () => {
  it('cuts a request that hangs forever (even one that ignores the abort signal)', async () => {
    const h = new Harness();
    let hang = true;
    h.transport.beforeUpload = () => {
      if (hang) {
        hang = false; // second attempt behaves
        return hangForever();
      }
    };
    const engine = h.engine({ uploadStallMs: 60 });
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'failed_retrying'));
    expect(engine.getState().reports[0]?.failure?.code).toBe('no_progress');
    await until(engine, reportIs('r1', 'uploaded'));
    await h.stopAll();
  });

  it('does NOT abort a slow upload as long as bytes keep moving (2G)', async () => {
    const h = new Harness();
    // 400 ms total, far beyond the 100 ms stall limit, but progress every 30 ms.
    h.transport.beforeUpload = async req => {
      for (let sent = 0; sent < 10; sent++) {
        await new Promise(r => setTimeout(r, 40));
        req.onProgress(sent * 1000, 10_000);
      }
    };
    const engine = h.engine({ uploadStallMs: 100 });
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'uploaded'), 5_000);
    expect(h.transport.uploadCalls).toHaveLength(1); // never aborted/retried
    await h.stopAll();
  });

  it('a hung metadata check or commit is also cut (plain timeout)', async () => {
    const h = new Harness();
    let hangCommit = true;
    h.transport.beforeCommit = () => {
      if (hangCommit) {
        hangCommit = false;
        return new Promise<void>(() => {});
      }
    };
    const engine = h.engine({ requestTimeoutMs: 60 });
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'failed_retrying'));
    await until(engine, reportIs('r1', 'uploaded'));
    expect(h.server.docs.size).toBe(1);
    await h.stopAll();
  });
});

describe('the 5 MB guarantee', () => {
  it('never uploads an image at or above 5 MB; fails permanently instead', async () => {
    const h = new Harness();
    h.preparer.sizes.set('file:///docs/r1-1.jpg', MAX_UPLOAD_BYTES); // exactly 5 MiB: rejected
    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('r1', 2));
    await until(engine, reportIs('r1', 'failed_permanent'));

    expect(engine.getState().reports[0]?.failure?.code).toBe('image_too_large');
    expect(h.transport.uploadCalls).toEqual([]); // not even the small image went out
    expect(h.server.docs.size).toBe(0);
    await h.stopAll();
  });

  it('accepts an image just under the limit', async () => {
    const h = new Harness();
    h.preparer.sizes.set('file:///docs/r1-0.jpg', MAX_UPLOAD_BYTES - 1);
    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'uploaded'));
    await h.stopAll();
  });

  it('every request the transport sees is under the limit', async () => {
    const h = new Harness();
    const sizes: number[] = [];
    h.transport.beforeUpload = req => {
      sizes.push(req.sizeBytes);
    };
    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('r1', 5));
    await until(engine, reportIs('r1', 'uploaded'));
    expect(sizes).toHaveLength(5);
    expect(sizes.every(s => s < MAX_UPLOAD_BYTES)).toBe(true);
    await h.stopAll();
  });
});
