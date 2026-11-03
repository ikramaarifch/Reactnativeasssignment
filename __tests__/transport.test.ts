import { classifyError } from '../src/core/retryPolicy';
import { MAX_UPLOAD_BYTES } from '../src/core/types';
import { FakeServer, FakeTransport } from '../src/testing/fakes';
import { Harness, newReport, reportIs, until } from '../src/testing/harness';
import { abortable } from '../src/transport/abortable';
import { FaultController, FaultyTransport, Sleep } from '../src/transport/FaultyTransport';
import { isObjectNotFound, mapFirebaseError } from '../src/transport/firebaseErrors';
import { TransportError } from '../src/transport/UploadTransport';

const err = (code: string, message = '') => Object.assign(new Error(message), { code });

describe('mapFirebaseError', () => {
  it.each([
    ['storage/unauthorized', 'permission-denied'],
    ['firestore/permission-denied', 'permission-denied'],
    ['storage/unauthenticated', 'unauthenticated'],
    ['firestore/invalid-argument', 'invalid-argument'],
    ['firestore/failed-precondition', 'invalid-argument'],
    ['storage/quota-exceeded', 'quota-exceeded'],
    ['firestore/unavailable', 'unavailable'],
    ['firestore/deadline-exceeded', 'timeout'],
    ['storage/retry-limit-exceeded', 'timeout'],
    ['storage/canceled', 'canceled'],
    ['firestore/internal', 'server-error'],
    ['firestore/resource-exhausted', 'server-error'],
    ['storage/invalid-checksum', 'server-error'],
  ])('%s -> %s', (code, expected) => {
    expect(mapFirebaseError(err(code)).code).toBe(expected);
  });

  it('sniffs network failures reported as unknown', () => {
    expect(mapFirebaseError(err('storage/unknown', 'Network error occurred')).code).toBe('network');
    expect(mapFirebaseError(err('storage/unknown', 'something odd')).code).toBe('unknown');
    expect(mapFirebaseError('not even an error').code).toBe('unknown');
  });

  it('feeds the retry policy correctly end to end', () => {
    const retryable = (c: string) => classifyError(mapFirebaseError(err(c))).retryable;
    expect(retryable('storage/unauthorized')).toBe(false);
    expect(retryable('firestore/invalid-argument')).toBe(false);
    expect(retryable('firestore/unavailable')).toBe(true);
    expect(retryable('firestore/deadline-exceeded')).toBe(true);
    expect(retryable('firestore/internal')).toBe(true);
  });

  it('recognises object-not-found and passes TransportErrors through', () => {
    expect(isObjectNotFound(err('storage/object-not-found'))).toBe(true);
    expect(isObjectNotFound(err('storage/unauthorized'))).toBe(false);
    const t = new TransportError('network');
    expect(mapFirebaseError(t)).toBe(t);
  });
});

describe('abortable', () => {
  it('rejects immediately if the signal is already aborted', async () => {
    const c = new AbortController();
    c.abort();
    await expect(abortable(c.signal, new Promise(() => {}))).rejects.toMatchObject({
      code: 'canceled',
    });
  });

  it('rejects when aborted later, and passes results through otherwise', async () => {
    const c = new AbortController();
    const hung = abortable(c.signal, new Promise(() => {}));
    c.abort();
    await expect(hung).rejects.toMatchObject({ code: 'canceled' });
    await expect(abortable(new AbortController().signal, Promise.resolve(7))).resolves.toBe(7);
  });
});

describe('FaultyTransport', () => {
  const fastSleep: Sleep = async () => {};
  function setup() {
    const server = new FakeServer();
    const inner = new FakeTransport(server, new Map());
    const faults = new FaultController({ bytesPerSecond: 1000, dropAfterBytes: 500 });
    const faulty = new FaultyTransport(inner, faults, fastSleep);
    const progress: number[] = [];
    const request = (size = 2000) => ({
      path: 'reports/r/0.jpg',
      localUri: 'file:///x.jpg',
      sizeBytes: size,
      signal: new AbortController().signal,
      onProgress: (b: number) => {
        progress.push(b);
      },
    });
    return { inner, faults, faulty, progress, request };
  }

  it('normal: passes straight through', async () => {
    const { inner, faulty } = setup();
    await faulty.uploadImage(setup().request());
    await faulty.getRemoteImage('p', new AbortController().signal);
    expect(inner.getRemoteCalls).toBe(1);
  });

  it('refuse -> permission-denied on every call, nothing reaches the backend', async () => {
    const { inner, faults, faulty, request } = setup();
    faults.set({ mode: 'refuse' });
    await expect(faulty.uploadImage(request())).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      faulty.commitReport({} as never, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(inner.uploadCalls).toHaveLength(0);
    expect(inner.commitCalls).toBe(0);
  });

  it('server_error -> server-error', async () => {
    const { faults, faulty, request } = setup();
    faults.set({ mode: 'server_error' });
    await expect(faulty.uploadImage(request())).rejects.toMatchObject({ code: 'server-error' });
  });

  it('drop_after_bytes -> progress up to N, then a network error, backend untouched', async () => {
    const { inner, faults, faulty, progress, request } = setup();
    faults.set({ mode: 'drop_after_bytes', dropAfterBytes: 500 });
    await expect(faulty.uploadImage(request(2000))).rejects.toMatchObject({ code: 'network' });
    expect(Math.max(...progress)).toBe(500);
    expect(inner.uploadCalls).toHaveLength(0);
  });

  it('drop_after_bytes does not fire when the file is smaller than N', async () => {
    const { inner, faults, faulty, request } = setup();
    faults.set({ mode: 'drop_after_bytes', dropAfterBytes: 5000 });
    await faulty.uploadImage(request(2000));
    expect(inner.uploadCalls).toHaveLength(1);
  });

  it('slow -> reports gradual progress up to the full size, then succeeds', async () => {
    const { inner, faults, faulty, progress, request } = setup();
    faults.set({ mode: 'slow' });
    await faulty.uploadImage(request(2000));
    expect(progress.length).toBeGreaterThan(3);
    expect(progress[progress.length - 1]).toBeGreaterThanOrEqual(2000);
    expect(inner.uploadCalls).toHaveLength(1);
  });

  it('hang -> never answers, but an abort ends it', async () => {
    const { faults, faulty, request } = setup();
    faults.set({ mode: 'hang' });
    const c = new AbortController();
    const pending = faulty.uploadImage({ ...request(), signal: c.signal });
    let settled = false;
    pending.catch(() => (settled = true));
    await new Promise(r => setTimeout(r, 30));
    expect(settled).toBe(false);
    c.abort();
    await expect(pending).rejects.toMatchObject({ code: 'canceled' });
  });

  it('mode can be switched live', async () => {
    const { faults, faulty, request } = setup();
    faults.set({ mode: 'refuse' });
    await expect(faulty.uploadImage(request())).rejects.toBeDefined();
    faults.set({ mode: 'normal' });
    await expect(faulty.uploadImage(request())).resolves.toBeUndefined();
  });
});

describe('engine + FaultyTransport (the same path real failures take)', () => {
  function setup(sleepMs = 0) {
    const h = new Harness();
    const faults = new FaultController({ bytesPerSecond: 100_000, latencyMs: 0 });
    const sleep: Sleep = (ms, signal) =>
      signal.aborted
        ? Promise.reject(new TransportError('canceled'))
        : new Promise(r => setTimeout(r, sleepMs));
    const faulty = new FaultyTransport(h.transport, faults, sleep);
    return { h, faults, engine: h.engine({ transport: faulty }) };
  }

  it('refuse -> failed_permanent with a reason; flip to normal + Try again -> uploaded', async () => {
    const { h, faults, engine } = setup();
    faults.set({ mode: 'refuse' });
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'failed_permanent'));
    expect(engine.getState().reports[0]?.failure?.reason).toMatch(/refused/i);

    faults.set({ mode: 'normal' });
    await engine.retry('r1');
    await until(engine, reportIs('r1', 'uploaded'));
    await h.stopAll();
  });

  it('server_error -> keeps retrying until fixed, then uploads exactly once', async () => {
    const { h, faults, engine } = setup();
    faults.set({ mode: 'server_error' });
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'failed_retrying'));
    faults.set({ mode: 'normal' });
    await until(engine, reportIs('r1', 'uploaded'));
    expect(h.server.objectWrites.get('reports/r1/0.jpg')).toBe(1);
    await h.stopAll();
  });

  it('hang -> watchdog cuts it, then recovers once the hang clears', async () => {
    const { h, faults } = setup();
    faults.set({ mode: 'hang' });
    const e = h.engine({ transport: new FaultyTransport(h.transport, faults), uploadStallMs: 80, requestTimeoutMs: 80 });
    await e.start();
    await e.enqueue(newReport('r1', 1));
    await until(e, reportIs('r1', 'failed_retrying'));
    expect(e.getState().reports[0]?.failure?.code).toBe('no_progress');
    faults.set({ mode: 'normal' });
    await until(e, reportIs('r1', 'uploaded'));
    await h.stopAll();
  });

  it('slow -> survives a stall limit shorter than the total time (2G behaviour)', async () => {
    const { h, faults } = setup(20);
    faults.set({ mode: 'slow', bytesPerSecond: 50_000 }); // 1 MB file => 20 ticks of 1 s simulated
    const sleep: Sleep = (_ms, signal) =>
      signal.aborted ? Promise.reject(new TransportError('canceled')) : new Promise(r => setTimeout(r, 20));
    const e = h.engine({
      transport: new FaultyTransport(h.transport, faults, sleep),
      uploadStallMs: 100,
      requestTimeoutMs: 1000,
    });
    await e.start();
    await e.enqueue(newReport('r1', 1));
    await until(e, reportIs('r1', 'uploaded'), 8_000);
    expect(e.getState().reports[0]?.attempt).toBe(0); // never failed
    await h.stopAll();
  });

  it('drop_after_bytes -> retries; each attempt re-sends (partial uploads are not trusted)', async () => {
    const { h, faults } = setup();
    faults.set({ mode: 'drop_after_bytes', dropAfterBytes: 10_000, bytesPerSecond: 1_000_000 });
    const e = h.engine({ transport: new FaultyTransport(h.transport, faults, async () => {}) });
    await e.start();
    await e.enqueue(newReport('r1', 1));
    await until(e, reportIs('r1', 'failed_retrying'));
    faults.set({ mode: 'normal' });
    await until(e, reportIs('r1', 'uploaded'));
    expect(h.server.objects.get('reports/r1/0.jpg')?.sizeBytes).toBeLessThan(MAX_UPLOAD_BYTES);
    await h.stopAll();
  });
});
