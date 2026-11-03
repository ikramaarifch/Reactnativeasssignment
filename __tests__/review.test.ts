import { PAGE_SIZE, ReviewController, toReviewError } from '../src/review/ReviewController';
import { parseReportDoc } from '../src/review/parseReport';
import { ReviewPage, ReviewRepository, ServerReport } from '../src/review/types';
import { TransportError } from '../src/transport/UploadTransport';

const report = (n: number): ServerReport => ({
  id: `r${n}`,
  description: `report ${n}`,
  createdAt: 1_000 - n,
  imagePaths: [`reports/r${n}/0.jpg`],
});

/** Fake server holding `total` reports, newest first; failures and delays are scriptable. */
class FakeRepo implements ReviewRepository {
  calls: Array<{ limit: number; after: unknown }> = [];
  failWith?: unknown;
  /** Resolve fetches manually to control ordering. */
  gate?: Promise<void>;

  constructor(private readonly total: number) {}

  async fetchPage(params: { limit: number; after: unknown }): Promise<ReviewPage> {
    this.calls.push(params);
    await this.gate;
    if (this.failWith) {
      throw this.failWith;
    }
    const start = typeof params.after === 'number' ? params.after : 0;
    const end = Math.min(this.total, start + params.limit);
    return {
      reports: Array.from({ length: end - start }, (_, i) => report(start + i)),
      hasMore: end < this.total,
      cursor: end,
    };
  }
  async getImageUrl(path: string): Promise<string> {
    return `https://example.test/${path}`;
  }
}

describe('parseReportDoc', () => {
  const ok = { status: 'complete', description: 'x', imagePaths: ['a.jpg'], createdAt: 5 };
  it('accepts a complete report', () => {
    expect(parseReportDoc('id', ok)).toEqual({
      id: 'id', description: 'x', createdAt: 5, imagePaths: ['a.jpg'],
    });
  });
  it.each([
    ['not complete', { ...ok, status: 'pending' }],
    ['no status', { ...ok, status: undefined }],
    ['bad description', { ...ok, description: 42 }],
    ['bad image list', { ...ok, imagePaths: 'a.jpg' }],
    ['non-string image path', { ...ok, imagePaths: [1] }],
    ['null', null],
    ['a string', 'nope'],
  ])('skips a malformed document: %s', (_name, data) => {
    expect(parseReportDoc('id', data)).toBeNull();
  });
  it('tolerates a missing createdAt', () => {
    expect(parseReportDoc('id', { ...ok, createdAt: undefined })?.createdAt).toBe(0);
  });
});

describe('ReviewController', () => {
  it('starts idle, shows loading on first load, then ready', async () => {
    const c = new ReviewController(new FakeRepo(3));
    expect(c.getState().status).toBe('idle');
    const seen: string[] = [];
    c.subscribe(() => seen.push(c.getState().status));
    await c.refresh();
    expect(seen[0]).toBe('loading');
    expect(c.getState()).toMatchObject({ status: 'ready', hasMore: false, error: null });
    expect(c.getState().reports).toHaveLength(3);
  });

  it('empty server -> ready with no reports (a designed empty state, not an error)', async () => {
    const c = new ReviewController(new FakeRepo(0));
    await c.refresh();
    expect(c.getState()).toMatchObject({ status: 'ready', reports: [], hasMore: false });
  });

  it('pages by 20 and appends without duplicates', async () => {
    const repo = new FakeRepo(45);
    const c = new ReviewController(repo);
    await c.refresh();
    expect(c.getState().reports).toHaveLength(PAGE_SIZE);
    expect(c.getState().hasMore).toBe(true);
    await c.loadMore();
    await c.loadMore();
    expect(c.getState().reports).toHaveLength(45);
    expect(c.getState().hasMore).toBe(false);
    expect(new Set(c.getState().reports.map(r => r.id)).size).toBe(45);
    expect(repo.calls.map(x => x.after)).toEqual([null, 20, 40]);
  });

  it('loadMore does nothing when there is no more or one is already running', async () => {
    const repo = new FakeRepo(5);
    const c = new ReviewController(repo);
    await c.refresh();
    await c.loadMore();
    expect(repo.calls).toHaveLength(1);
  });

  it('first load offline -> error state with an offline message, then recovers on retry', async () => {
    const repo = new FakeRepo(2);
    repo.failWith = new TransportError('unavailable');
    const c = new ReviewController(repo);
    await c.refresh();
    expect(c.getState()).toMatchObject({ status: 'error', error: { kind: 'offline' } });
    expect(c.getState().reports).toEqual([]);

    repo.failWith = undefined;
    await c.refresh();
    expect(c.getState()).toMatchObject({ status: 'ready', error: null });
  });

  it('a failed refresh keeps the old list visible (stale-while-revalidate)', async () => {
    const repo = new FakeRepo(3);
    const c = new ReviewController(repo);
    await c.refresh();
    repo.failWith = new TransportError('network');
    await c.refresh();
    expect(c.getState().status).toBe('ready');
    expect(c.getState().reports).toHaveLength(3);
    expect(c.getState().error?.kind).toBe('offline');
    expect(c.getState().refreshing).toBe(false);
  });

  it('a permission error is reported as refused, not offline', async () => {
    const repo = new FakeRepo(1);
    repo.failWith = Object.assign(new Error('no'), { code: 'firestore/permission-denied' });
    const c = new ReviewController(repo);
    await c.refresh();
    expect(c.getState().error?.kind).toBe('refused');
  });

  it('times out a hanging server instead of loading forever', async () => {
    const repo = new FakeRepo(1);
    repo.gate = new Promise(() => {}); // never answers
    const c = new ReviewController(repo, 40);
    await c.refresh();
    expect(c.getState()).toMatchObject({ status: 'error', error: { kind: 'offline' } });
  });

  it('a failed loadMore keeps the list, flags a retry, and succeeds when retried', async () => {
    const repo = new FakeRepo(30);
    const c = new ReviewController(repo);
    await c.refresh();
    repo.failWith = new TransportError('network');
    await c.loadMore();
    expect(c.getState()).toMatchObject({ loadMoreFailed: true, loadingMore: false });
    expect(c.getState().reports).toHaveLength(20);
    repo.failWith = undefined;
    await c.loadMore();
    expect(c.getState()).toMatchObject({ loadMoreFailed: false });
    expect(c.getState().reports).toHaveLength(30);
  });

  it('ignores a slow stale response that arrives after a newer refresh', async () => {
    const repo = new FakeRepo(3);
    let release: () => void = () => {};
    repo.gate = new Promise<void>(r => (release = r));
    const c = new ReviewController(repo);
    const slow = c.refresh(); // gets stuck on the gate
    repo.gate = undefined;
    repo.failWith = undefined;
    await c.refresh(); // newer, completes first
    const newer = c.getState().reports;
    release();
    await slow;
    expect(c.getState().reports).toBe(newer);
  });

  it('toReviewError maps outage codes to offline and anything else to unknown', () => {
    expect(toReviewError(new TransportError('timeout')).kind).toBe('offline');
    expect(toReviewError(new Error('weird')).kind).toBe('unknown');
  });
});
