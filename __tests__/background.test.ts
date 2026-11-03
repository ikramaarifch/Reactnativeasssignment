import { BackgroundController, ForegroundServicePort } from '../src/background/BackgroundController';
import { describeBackground, ServiceInfo } from '../src/background/describeBackground';
import { ImageProgress } from '../src/core/UploadEngine';
import { Report, ReportStatus } from '../src/core/types';
import { newReport } from '../src/testing/harness';

const rep = (id: string, status: ReportStatus, images = 5): Report => ({
  ...newReport(id, images),
  status,
});

describe('describeBackground: when the service exists and what it says', () => {
  it('is null when nothing needs the background (all uploaded or permanently failed)', () => {
    expect(describeBackground([], null, true, 0)).toBeNull();
    expect(describeBackground([rep('a', 'uploaded')], null, true, 0)).toBeNull();
    expect(
      describeBackground([rep('a', 'uploaded'), rep('b', 'failed_permanent')], null, true, 0),
    ).toBeNull();
  });

  it('shows progress for the report being uploaded, with a real percentage', () => {
    const active = rep('a', 'uploading');
    active.images[0]!.status = 'uploaded';
    const progress: ImageProgress = { reportId: 'a', imageIndex: 1, bytesTransferred: 50, totalBytes: 100 };
    const info = describeBackground([active, rep('b', 'saved_locally')], progress, true, 0);
    expect(info).toMatchObject({ title: 'Uploading 2 reports' });
    expect(info?.text).toBe('Uploading 2 of 5 · 1 more waiting');
    expect(info?.progress).toEqual({ current: 30, max: 100 }); // (1 + 0.5) / 5
  });

  it('has no progress bar when there is no real number (never an endless bar)', () => {
    const info = describeBackground([rep('a', 'preparing')], null, true, 0);
    expect(info?.text).toBe('Preparing photos');
    expect(info?.progress).toBeUndefined();
  });

  it('says what is wrong while waiting', () => {
    expect(describeBackground([rep('a', 'saved_locally')], null, false, 0)?.text).toBe(
      'Waiting for network',
    );
    expect(describeBackground([rep('a', 'failed_retrying')], null, true, 0)?.text).toBe(
      'Connection problem – retrying',
    );
    expect(describeBackground([rep('a', 'saved_locally')], null, true, 0)?.title).toBe(
      'Uploading 1 report',
    );
  });

  it('never claims a report is "uploaded" while it is still waiting', () => {
    const info = describeBackground([rep('a', 'finalizing')], null, true, 0);
    expect(`${info?.title} ${info?.text}`).not.toMatch(/uploaded/i);
  });
});

describe('BackgroundController', () => {
  class FakePort implements ForegroundServicePort {
    log: string[] = [];
    running = false;
    failStart = false;
    infos: ServiceInfo[] = [];
    async start(info: ServiceInfo) {
      this.log.push('start');
      if (this.failStart) {
        throw new Error('ForegroundServiceStartNotAllowedException');
      }
      this.running = true;
      this.infos.push(info);
    }
    async update(info: ServiceInfo) {
      this.log.push('update');
      this.infos.push(info);
    }
    async stop() {
      this.log.push('stop');
      this.running = false;
    }
    async isRunning() {
      return this.running;
    }
    async prepare() {
      this.log.push('prepare');
    }
  }

  let reports: Report[];
  let progress: ImageProgress | null;
  let online: boolean | undefined;
  let port: FakePort;
  let controller: BackgroundController;

  const flush = () => jest.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    jest.useFakeTimers();
    reports = [];
    progress = null;
    online = true;
    port = new FakePort();
    controller = new BackgroundController(
      port,
      { getReports: () => reports, getProgress: () => progress, isOnline: () => online },
      () => Date.now(),
    );
  });
  afterEach(() => {
    controller.dispose();
    jest.useRealTimers();
  });

  it('does nothing while there is nothing to upload', async () => {
    controller.notify();
    await flush();
    expect(port.log).toEqual([]);
  });

  it('starts once when work appears (asking for notification permission first, once)', async () => {
    reports = [rep('a', 'saved_locally')];
    controller.notify();
    controller.notify();
    await flush();
    expect(port.log).toEqual(['prepare', 'start']);
  });

  it('stops as soon as everything is uploaded', async () => {
    reports = [rep('a', 'uploading')];
    controller.notify();
    await flush();
    reports = [rep('a', 'uploaded')];
    controller.notify();
    await flush();
    expect(port.log).toEqual(['prepare', 'start', 'stop']);
    expect(port.running).toBe(false);
  });

  it('stops when only permanently failed reports remain (they need the user)', async () => {
    reports = [rep('a', 'uploading')];
    controller.notify();
    await flush();
    reports = [rep('a', 'failed_permanent')];
    controller.notify();
    await flush();
    expect(port.running).toBe(false);
  });

  it('keeps running while a report waits to retry', async () => {
    reports = [rep('a', 'failed_retrying')];
    controller.notify();
    await flush();
    controller.notify();
    await flush();
    expect(port.running).toBe(true);
    expect(port.log).toEqual(['prepare', 'start']);
  });

  it('throttles progress updates: a burst becomes one update plus one trailing update', async () => {
    reports = [rep('a', 'uploading')];
    controller.notify();
    await flush(); // start at t=0
    for (let pct = 1; pct <= 40; pct++) {
      progress = { reportId: 'a', imageIndex: 0, bytesTransferred: pct, totalBytes: 100 };
      controller.notify();
    }
    await flush();
    expect(port.log.filter(l => l === 'update')).toHaveLength(0); // all too soon after start

    await jest.advanceTimersByTimeAsync(1_000);
    const updates = port.log.filter(l => l === 'update').length;
    expect(updates).toBe(1); // exactly one trailing update, carrying the LATEST state
    expect(port.infos[port.infos.length - 1]?.progress?.current).toBeGreaterThan(5);
  });

  it('does not update when nothing visible changed', async () => {
    reports = [rep('a', 'uploading')];
    controller.notify();
    await flush();
    await jest.advanceTimersByTimeAsync(5_000);
    controller.notify();
    controller.notify();
    await flush();
    expect(port.log).toEqual(['prepare', 'start']);
  });

  it('if Android refuses to start (app in background), it does not crash and retries on sync()', async () => {
    port.failStart = true;
    reports = [rep('a', 'saved_locally')];
    controller.notify();
    await flush();
    expect(port.running).toBe(false);

    port.failStart = false; // app is foregrounded again
    controller.sync();
    await flush();
    expect(port.running).toBe(true);
  });

  it('sync() notices the OS stopped the service (e.g. Android 15 time limit) and restarts it', async () => {
    reports = [rep('a', 'uploading')];
    controller.notify();
    await flush();
    port.running = false; // system killed it behind our back
    controller.sync();
    await flush();
    expect(port.log.filter(l => l === 'start')).toHaveLength(2);
    expect(port.running).toBe(true);
  });

  it('a failing port call never breaks later operations', async () => {
    reports = [rep('a', 'uploading')];
    controller.notify();
    await flush();
    port.update = async () => {
      throw new Error('boom');
    };
    progress = { reportId: 'a', imageIndex: 0, bytesTransferred: 90, totalBytes: 100 };
    await jest.advanceTimersByTimeAsync(2_000);
    controller.notify();
    await flush();
    reports = [rep('a', 'uploaded')];
    controller.notify();
    await flush();
    expect(port.running).toBe(false); // still able to stop
  });
});
