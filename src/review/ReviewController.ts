import { mapFirebaseError } from '../transport/firebaseErrors';
import { ReviewError, ReviewRepository, ReviewState } from './types';

export const PAGE_SIZE = 20;

const INITIAL: ReviewState = {
  status: 'idle',
  reports: [],
  hasMore: false,
  refreshing: false,
  loadingMore: false,
  error: null,
  loadMoreFailed: false,
};

export class ReviewTimeoutError extends Error {
  constructor() {
    super('Server did not answer in time');
    this.name = 'ReviewTimeoutError';
  }
}

export function toReviewError(error: unknown): ReviewError {
  if (error instanceof ReviewTimeoutError) {
    return { kind: 'offline', message: 'The server is not responding. Check your connection.' };
  }
  switch (mapFirebaseError(error).code) {
    case 'network':
    case 'unavailable':
    case 'timeout':
    case 'deadline-exceeded':
      return { kind: 'offline', message: 'Can not reach the server. Check your connection.' };
    case 'permission-denied':
    case 'unauthenticated':
      return { kind: 'refused', message: 'The server did not allow viewing reports.' };
    default:
      return { kind: 'unknown', message: 'Something went wrong loading reports.' };
  }
}

/**
 * Drives the Review screen. Everything shown comes from the server (the
 * repository reads with source: 'server'), never from the local queue.
 * Stale-while-revalidate: a refresh keeps the old list visible, and a failed
 * refresh keeps it too (with an error), so a bad connection never blanks the screen.
 */
export class ReviewController {
  private state: ReviewState = INITIAL;
  private listeners = new Set<() => void>();
  private cursor: unknown = null;
  /** Incremented per request so a slow, stale response can never overwrite a newer one. */
  private generation = 0;

  constructor(
    private readonly repo: ReviewRepository,
    private readonly timeoutMs = 15_000,
  ) {}

  getState = (): ReviewState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** First load, pull-to-refresh and "Try again" all land here. */
  async refresh(): Promise<void> {
    const generation = ++this.generation;
    const hadData = this.state.status === 'ready';
    this.set({
      status: hadData ? 'ready' : 'loading',
      refreshing: hadData,
      loadingMore: false,
      loadMoreFailed: false,
      error: null,
    });
    try {
      const page = await this.withTimeout(this.repo.fetchPage({ limit: PAGE_SIZE, after: null }));
      if (generation !== this.generation) {
        return;
      }
      this.cursor = page.cursor;
      this.set({
        status: 'ready',
        reports: page.reports,
        hasMore: page.hasMore,
        refreshing: false,
      });
    } catch (e) {
      if (generation !== this.generation) {
        return;
      }
      this.set({
        status: hadData ? 'ready' : 'error',
        refreshing: false,
        error: toReviewError(e),
      });
    }
  }

  async loadMore(): Promise<void> {
    const s = this.state;
    if (s.status !== 'ready' || !s.hasMore || s.loadingMore || s.refreshing) {
      return;
    }
    const generation = this.generation;
    this.set({ loadingMore: true, loadMoreFailed: false });
    try {
      const page = await this.withTimeout(
        this.repo.fetchPage({ limit: PAGE_SIZE, after: this.cursor }),
      );
      if (generation !== this.generation) {
        return;
      }
      this.cursor = page.cursor;
      const known = new Set(this.state.reports.map(r => r.id));
      this.set({
        reports: [...this.state.reports, ...page.reports.filter(r => !known.has(r.id))],
        hasMore: page.hasMore,
        loadingMore: false,
      });
    } catch {
      if (generation === this.generation) {
        this.set({ loadingMore: false, loadMoreFailed: true });
      }
    }
  }

  private set(patch: Partial<ReviewState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(l => l());
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new ReviewTimeoutError()), this.timeoutMs);
      promise.then(
        v => {
          clearTimeout(timer);
          resolve(v);
        },
        e => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }
}
