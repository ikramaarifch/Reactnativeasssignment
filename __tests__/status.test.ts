import { startRetryTriggers } from '../src/app/triggers';
import { describeReport, formatCountdown, pendingCount, queueBanner } from '../src/core/statusView';
import { Report, ReportStatus } from '../src/core/types';
import { ConnectivityMonitor, ConnectivityPort } from '../src/network/ConnectivityMonitor';
import { newReport } from '../src/testing/harness';

const withStatus = (status: ReportStatus, patch: Partial<Report> = {}): Report => ({
  ...newReport('r1', 5),
  status,
  ...patch,
});
const ctx = { now: 10_000, isOnline: true as boolean | undefined, progress: null };

describe('describeReport: one glance, one answer', () => {
  it('saved_locally: offline vs waiting its turn', () => {
    expect(describeReport(withStatus('saved_locally'), { ...ctx, isOnline: false }).title).toBe(
      'Saved on this phone – waiting for network',
    );
    expect(describeReport(withStatus('saved_locally'), ctx).title).toMatch(/^Saved on this phone/);
  });

  it('preparing', () => {
    const r = withStatus('preparing');
    r.images[0]!.status = 'prepared';
    r.images[1]!.status = 'prepared';
    expect(describeReport(r, ctx)).toMatchObject({ title: 'Preparing photos', detail: '2 of 5 ready' });
  });

  it('uploading shows "Uploading N of M" and a real progress fraction', () => {
    const r = withStatus('uploading');
    r.images[0]!.status = 'uploaded';
    r.images[1]!.status = 'uploaded';
    const view = describeReport(r, {
      ...ctx,
      progress: { reportId: 'r1', imageIndex: 2, bytesTransferred: 500, totalBytes: 1000 },
    });
    expect(view.title).toBe('Uploading 3 of 5');
    expect(view.progress).toBeCloseTo((2 + 0.5) / 5);
  });

  it('uploading ignores progress that belongs to another report', () => {
    const view = describeReport(withStatus('uploading'), {
      ...ctx,
      progress: { reportId: 'other', imageIndex: 0, bytesTransferred: 900, totalBytes: 1000 },
    });
    expect(view.progress).toBe(0);
  });

  it('uploaded is the only state that says "Uploaded"', () => {
    const all: ReportStatus[] = [
      'saved_locally', 'preparing', 'uploading', 'finalizing',
      'uploaded', 'failed_retrying', 'failed_permanent',
    ];
    for (const s of all) {
      const view = describeReport(
        withStatus(s, { failure: { code: 'network', reason: 'No connection.', at: 0 } }),
        ctx,
      );
      const text = `${view.title} ${view.detail ?? ''}`;
      expect(/uploaded/i.test(text)).toBe(s === 'uploaded');
      // "Saved" and "uploaded" never share a sentence.
      expect(/saved/i.test(text) && /uploaded/i.test(text)).toBe(false);
    }
  });

  it('failed_retrying gives the reason and what happens next (countdown, or offline)', () => {
    const r = withStatus('failed_retrying', {
      nextAttemptAt: 22_000,
      failure: { code: 'network', reason: 'No connection to the server.', at: 0 },
    });
    const online = describeReport(r, ctx);
    expect(online).toMatchObject({ tone: 'warning', canRetry: false });
    expect(online.detail).toContain('No connection to the server.');
    expect(online.detail).toContain('Next try in 12 s');
    expect(describeReport(r, { ...ctx, isOnline: false }).detail).toContain('network returns');
  });

  it('failed_retrying does not repeat "will retry automatically" that the title already says', () => {
    const r = withStatus('failed_retrying', {
      nextAttemptAt: 12_000,
      failure: { code: 'network', reason: 'No connection to the server. Will retry automatically.', at: 0 },
    });
    const view = describeReport(r, ctx);
    expect(view.title).toMatch(/will retry automatically/i);
    expect(view.detail).toBe('No connection to the server. Next try in 2 s.');
  });

  it('failed_permanent shows the reason and allows Try again', () => {
    const view = describeReport(
      withStatus('failed_permanent', {
        failure: { code: 'permission_denied', reason: 'The server refused this report (not allowed).', at: 0 },
      }),
      ctx,
    );
    expect(view).toMatchObject({ tone: 'danger', canRetry: true });
    expect(view.detail).toContain('refused');
    expect(view.detail).toContain('Try again');
  });

  it('formatCountdown', () => {
    expect(formatCountdown(12_000)).toBe('12 s');
    expect(formatCountdown(61_000)).toBe('2 min');
    expect(formatCountdown(-5)).toBe('0 s');
  });
});

describe('queueBanner', () => {
  const r = (s: ReportStatus) => withStatus(s);
  it('offline with waiting reports', () => {
    expect(queueBanner([r('saved_locally'), r('failed_retrying'), r('saved_locally')], false)).toEqual({
      tone: 'warning',
      text: 'Offline – 3 reports waiting',
    });
    expect(queueBanner([r('saved_locally')], false)?.text).toBe('Offline – 1 report waiting');
  });
  it('offline with nothing waiting still tells the user saving is safe', () => {
    expect(queueBanner([r('uploaded')], false)?.text).toMatch(/kept on this phone/);
  });
  it('online: sending / retrying / needs attention / nothing', () => {
    expect(queueBanner([r('uploading')], true)?.text).toBe('Sending 1 report…');
    expect(queueBanner([r('failed_retrying')], true)?.text).toMatch(/retrying 1 report/);
    expect(queueBanner([r('failed_permanent'), r('uploaded')], true)?.text).toBe(
      '1 report needs your attention',
    );
    expect(queueBanner([r('uploaded')], true)).toBeNull();
    expect(queueBanner([], undefined)).toBeNull();
  });
  it('pendingCount excludes only uploaded', () => {
    expect(pendingCount([r('uploaded'), r('failed_permanent'), r('saved_locally')])).toBe(2);
  });
});

describe('ConnectivityMonitor + retry triggers', () => {
  function setup() {
    let emit: (online: boolean) => void = () => {};
    let unsubscribed = 0;
    const port: ConnectivityPort = {
      subscribe: listener => {
        emit = listener;
        return () => {
          unsubscribed++;
        };
      },
    };
    const monitor = new ConnectivityMonitor(port);
    const kicks: unknown[] = [];
    let foreground: () => void = () => {};
    const stop = startRetryTriggers(
      {
        kick: o => {
          kicks.push(o);
        },
      },
      monitor,
      {
        onForeground: l => {
          foreground = l;
          return () => {};
        },
      },
    );
    return { monitor, kicks, emit: (o: boolean) => emit(o), foreground: () => foreground(), stop, unsub: () => unsubscribed };
  }

  it('kicks (skipping backoff) when connectivity returns, not on first report or while online', () => {
    const { kicks, emit } = setup();
    emit(true); // first report: unknown -> online, not a "return"
    expect(kicks).toHaveLength(0);
    emit(false);
    expect(kicks).toHaveLength(0);
    emit(true);
    expect(kicks).toEqual([{ skipBackoff: true }]);
    emit(true);
    expect(kicks).toHaveLength(1);
  });

  it('kicks when the app returns to the foreground', () => {
    const { kicks, foreground } = setup();
    foreground();
    expect(kicks).toEqual([{ skipBackoff: true }]);
  });

  it('exposes state and stops cleanly', () => {
    const { monitor, emit, stop, unsub } = setup();
    expect(monitor.isOnline()).toBeUndefined();
    emit(false);
    expect(monitor.isOnline()).toBe(false);
    stop();
    expect(unsub()).toBe(1);
  });
});
