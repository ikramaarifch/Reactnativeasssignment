/** A report as it exists on the SERVER (never local state). */
export interface ServerReport {
  id: string;
  description: string;
  createdAt: number;
  /** Storage paths, in order. Download URLs are resolved lazily per image. */
  imagePaths: string[];
}

export interface ReviewPage {
  reports: ServerReport[];
  hasMore: boolean;
  /** Opaque: pass back to fetch the next page. */
  cursor: unknown;
}

export interface ReviewRepository {
  /** Newest first, `status == "complete"` only, read from the server (not a cache). */
  fetchPage(params: { limit: number; after: unknown }): Promise<ReviewPage>;
  /** Resolves a Storage path to a downloadable URL. */
  getImageUrl(path: string): Promise<string>;
}

export type ReviewErrorKind = 'offline' | 'refused' | 'unknown';

export interface ReviewError {
  kind: ReviewErrorKind;
  /** Human-readable, shown as-is. */
  message: string;
}

/**
 * idle     - nothing requested yet
 * loading  - first load, nothing to show yet (skeleton)
 * ready    - have data (maybe refreshing / loading more in the background)
 * error    - first load failed and there is nothing to show
 */
export interface ReviewState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  reports: readonly ServerReport[];
  hasMore: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  /** Set when status is 'error', or when a refresh failed but old data is still shown. */
  error: ReviewError | null;
  loadMoreFailed: boolean;
}
