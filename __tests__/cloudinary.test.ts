import { classifyError } from '../src/core/retryPolicy';
import { UploadEngine } from '../src/core/UploadEngine';
import { hexToBase64 } from '../src/images/encoding';
import { MemoryQueueStore } from '../src/storage/MemoryQueueStore';
import { CloudinaryPreparer, FakeCloudinary, md5Hex } from '../src/testing/fakeCloudinary';
import { newReport, reportIs, until } from '../src/testing/harness';
import { CloudinaryImageStore, errorForStatus } from '../src/transport/cloudinary/CloudinaryImageStore';
import { originalUrl, publicIdFor, thumbnailUrl } from '../src/transport/cloudinary/urls';
import { HybridTransport } from '../src/transport/HybridTransport';
import { ReportDocument } from '../src/core/types';

const CONFIG = { cloudName: 'democloud', uploadPreset: 'demopreset' };
const live = () => new AbortController().signal;

describe('cloudinary urls', () => {
  it('maps our logical key to a public_id (no extension) and delivery URLs', () => {
    expect(publicIdFor('reports/abc/0.jpg')).toBe('reports/abc/0');
    expect(originalUrl('c', 'reports/abc/0.jpg')).toBe(
      'https://res.cloudinary.com/c/image/upload/reports/abc/0.jpg',
    );
    expect(thumbnailUrl('c', 'reports/abc/0.jpg', 300)).toBe(
      'https://res.cloudinary.com/c/image/upload/c_limit,w_300,h_300,q_auto/reports/abc/0.jpg',
    );
  });
});

describe('CloudinaryImageStore.getRemoteImage', () => {
  it('404 -> null (not uploaded yet)', async () => {
    const store = new CloudinaryImageStore(new FakeCloudinary(), CONFIG);
    expect(await store.getRemoteImage('reports/a/0.jpg', live())).toBeNull();
  });

  it('200 -> size and MD5 (ETag hex converted to the base64 our pipeline uses)', async () => {
    const cloud = new FakeCloudinary();
    const hex = md5Hex('photo');
    cloud.assets.set('reports/a/0', { size: 12345, md5: hex });
    const info = await new CloudinaryImageStore(cloud, CONFIG).getRemoteImage('reports/a/0.jpg', live());
    expect(info).toEqual({ sizeBytes: 12345, md5Base64: hexToBase64(hex) });
    expect(cloud.headCalls[0]).toBe('https://res.cloudinary.com/democloud/image/upload/reports/a/0.jpg');
  });

  it('an ETag that is not an MD5 never matches, so the engine re-uploads instead of trusting it', async () => {
    const cloud = new FakeCloudinary();
    cloud.head = async () => ({ status: 200, headers: { etag: 'W/"abc-123"', 'content-length': '10' } });
    const info = await new CloudinaryImageStore(cloud, CONFIG).getRemoteImage('reports/a/0.jpg', live());
    expect(info).toEqual({ sizeBytes: 10, md5Base64: '' });
  });

  it.each([
    [500, 'server-error'],
    [503, 'server-error'],
    [403, 'permission-denied'],
  ])('HTTP %i -> %s', async (status, code) => {
    const cloud = new FakeCloudinary();
    cloud.forcedHeadStatus = status;
    await expect(
      new CloudinaryImageStore(cloud, CONFIG).getRemoteImage('reports/a/0.jpg', live()),
    ).rejects.toMatchObject({ code });
  });

  it('no network -> network error; aborted -> canceled without calling out', async () => {
    const cloud = new FakeCloudinary();
    cloud.failHeads = 1;
    const store = new CloudinaryImageStore(cloud, CONFIG);
    await expect(store.getRemoteImage('p.jpg', live())).rejects.toMatchObject({ code: 'network' });

    const c = new AbortController();
    c.abort();
    cloud.headCalls = [];
    await expect(store.getRemoteImage('p.jpg', c.signal)).rejects.toMatchObject({ code: 'canceled' });
    expect(cloud.headCalls).toHaveLength(0);
  });
});

describe('CloudinaryImageStore.uploadImage', () => {
  function setup() {
    const cloud = new FakeCloudinary();
    cloud.localFiles.set('/docs/prepared/x.jpg', { size: 2000, md5: md5Hex('x') });
    const store = new CloudinaryImageStore(cloud, CONFIG);
    const progress: number[] = [];
    const request = (signal = live()) => ({
      path: 'reports/r1/2.jpg',
      localUri: 'file:///docs/prepared/x.jpg',
      sizeBytes: 2000,
      signal,
      onProgress: (b: number) => {
        progress.push(b);
      },
    });
    return { cloud, store, progress, request };
  }

  it('posts preset + public_id (no extension) and streams the local file path', async () => {
    const { cloud, store, request, progress } = setup();
    await store.uploadImage(request());
    const sent = cloud.uploadCalls[0]!;
    expect(sent.url).toBe('https://api.cloudinary.com/v1_1/democloud/image/upload');
    expect(sent.fields).toEqual({ upload_preset: 'demopreset', public_id: 'reports/r1/2' });
    expect(sent.file).toEqual({ path: '/docs/prepared/x.jpg', name: '2.jpg', mimeType: 'image/jpeg' });
    expect(progress).toEqual([2000]);
    expect(cloud.assets.has('reports/r1/2')).toBe(true);
  });

  it('an existing public_id (a retry) counts as success and creates nothing new', async () => {
    const { cloud, store, request } = setup();
    await store.uploadImage(request());
    await store.uploadImage(request());
    expect(cloud.uploadCalls).toHaveLength(2);
    expect(cloud.creates.get('reports/r1/2')).toBe(1);
  });

  it.each([
    [400, 'invalid-argument', true],
    [401, 'permission-denied', true],
    [403, 'permission-denied', true],
    [404, 'invalid-argument', true],
    [408, 'timeout', false],
    [420, 'server-error', false],
    [429, 'server-error', false],
    [500, 'server-error', false],
    [503, 'server-error', false],
  ])('HTTP %i -> %s (permanent: %s)', async (status, code, permanent) => {
    const { cloud, store, request } = setup();
    cloud.forcedUploadResponse = {
      status,
      body: JSON.stringify({ error: { message: 'nope' } }),
    };
    const error = await store.uploadImage(request()).catch((e: unknown) => e);
    expect(error).toMatchObject({ code });
    expect(classifyError(error).retryable).toBe(!permanent);
  });

  it('a 200 without a public_id is treated as a server fault, not success', async () => {
    const { cloud, store, request } = setup();
    cloud.forcedUploadResponse = { status: 200, body: '<html>captive portal</html>' };
    await expect(store.uploadImage(request())).rejects.toMatchObject({ code: 'server-error' });
  });

  it('a dropped connection is a retryable network error', async () => {
    const { cloud, store, request } = setup();
    cloud.failUploadsBefore = 1;
    const error = await store.uploadImage(request()).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'network' });
    expect(classifyError(error).retryable).toBe(true);
  });

  it('abort mid-flight -> canceled; already aborted -> canceled without any request', async () => {
    const { cloud, store, request } = setup();
    cloud.hangUploads = true;
    const c = new AbortController();
    const pending = store.uploadImage(request(c.signal));
    c.abort();
    await expect(pending).rejects.toMatchObject({ code: 'canceled' });

    cloud.uploadCalls = [];
    await expect(store.uploadImage(request(c.signal))).rejects.toMatchObject({ code: 'canceled' });
    expect(cloud.uploadCalls).toHaveLength(0);
  });

  it('errorForStatus puts the server message in the error for diagnostics', () => {
    expect(errorForStatus(400, JSON.stringify({ error: { message: 'Invalid image file' } })).message).toContain(
      'Invalid image file',
    );
  });
});

describe('engine + Cloudinary + Firestore commit (real engine, faked network)', () => {
  function setup() {
    const cloud = new FakeCloudinary();
    const docs = new Map<string, ReportDocument>();
    const commits = { calls: 0, failNext: 0 };
    const transport = new HybridTransport(new CloudinaryImageStore(cloud, CONFIG), {
      async commitReport(doc) {
        commits.calls++;
        if (commits.failNext > 0) {
          commits.failNext--;
          throw Object.assign(new Error('unavailable'), { code: 'firestore/unavailable' });
        }
        docs.set(doc.id, doc);
      },
    });
    const store = new MemoryQueueStore();
    const engine = new UploadEngine({
      store,
      transport,
      preparer: new CloudinaryPreparer(cloud),
      random: () => 0,
      uploadStallMs: 2_000,
      requestTimeoutMs: 2_000,
    });
    return { cloud, docs, commits, engine, store };
  }

  it('uploads photos to Cloudinary, then writes the commit marker once', async () => {
    const { cloud, docs, engine } = setup();
    await engine.start();
    await engine.enqueue(newReport('r1', 3));
    await until(engine, reportIs('r1', 'uploaded'));
    expect([...cloud.assets.keys()].sort()).toEqual(['reports/r1/0', 'reports/r1/1', 'reports/r1/2']);
    expect(docs.get('r1')?.imagePaths).toEqual(['reports/r1/0.jpg', 'reports/r1/1.jpg', 'reports/r1/2.jpg']);
    await engine.stop();
  });

  it('LOST RESPONSE: server stored it, client heard nothing -> retry skips the bytes (HEAD match)', async () => {
    const { cloud, engine } = setup();
    cloud.loseResponseAfterStore = 1;
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'uploaded'));
    expect(cloud.uploadCalls).toHaveLength(1); // the bytes were sent exactly once
    expect(cloud.creates.get('reports/r1/0')).toBe(1);
    expect(cloud.headCalls.length).toBeGreaterThanOrEqual(2);
    await engine.stop();
  });

  it('a HEAD that cannot be trusted still cannot duplicate: re-upload returns the existing asset', async () => {
    const { cloud, engine, store } = setup();
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'uploaded'));
    // pretend the HEAD check lies (404) on a second pass over the same id
    cloud.forcedHeadStatus = 404;
    await engine.stop();
    const second = new UploadEngine({
      store,
      transport: new HybridTransport(new CloudinaryImageStore(cloud, CONFIG), { commitReport: async () => {} }),
      preparer: new CloudinaryPreparer(cloud),
    });
    await second.start();
    await second.idle();
    expect(cloud.creates.get('reports/r1/0')).toBe(1);
    await second.stop();
  });

  it('server error then recovery: retries and uploads each image once', async () => {
    const { cloud, engine } = setup();
    cloud.forcedUploadResponse = { status: 503, body: '' };
    await engine.start();
    await engine.enqueue(newReport('r1', 2));
    await until(engine, reportIs('r1', 'failed_retrying'));
    cloud.forcedUploadResponse = undefined;
    await until(engine, reportIs('r1', 'uploaded'));
    expect(cloud.creates.get('reports/r1/0')).toBe(1);
    expect(cloud.creates.get('reports/r1/1')).toBe(1);
    await engine.stop();
  });

  it('rate limited (429) is retried, never given up on', async () => {
    const { cloud, engine } = setup();
    cloud.forcedUploadResponse = { status: 429, body: JSON.stringify({ error: { message: 'Rate limit' } }) };
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'failed_retrying'));
    cloud.forcedUploadResponse = undefined;
    await until(engine, reportIs('r1', 'uploaded'));
    await engine.stop();
  });

  it('a rejected preset / bad request is permanent with a human reason, and no commit marker', async () => {
    const { cloud, docs, engine } = setup();
    cloud.forcedUploadResponse = { status: 401, body: JSON.stringify({ error: { message: 'Invalid' } }) };
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'failed_permanent'));
    expect(engine.getState().reports[0]?.failure?.reason).toMatch(/refused/i);
    expect(docs.size).toBe(0);
    await engine.stop();
  });

  it('commit fails after all images are up: images are not re-sent on the retry', async () => {
    const { cloud, commits, docs, engine } = setup();
    commits.failNext = 1;
    await engine.start();
    await engine.enqueue(newReport('r1', 2));
    await until(engine, reportIs('r1', 'uploaded'));
    expect(commits.calls).toBe(2);
    expect(cloud.uploadCalls).toHaveLength(2); // 2 images, once each
    expect(docs.size).toBe(1);
    await engine.stop();
  });
});
