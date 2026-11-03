import { describeReport } from '../core/statusView';
import { Report } from '../core/types';
import { ImageProgress } from '../core/UploadEngine';

export interface ServiceInfo {
  title: string;
  text: string;
  /** Notification progress bar; absent when there is no real number to show. */
  progress?: { current: number; max: number };
}

const PERCENT_MAX = 100;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * What the foreground service (and its notification) should say, or null when
 * the service should not be running. The service exists only while at least one
 * report still has to reach the server: reports that are `uploaded`, or
 * permanently failed (they need the user, not the background), do not keep it alive.
 */
export function describeBackground(
  reports: readonly Report[],
  progress: ImageProgress | null,
  isOnline: boolean | undefined,
  now: number,
): ServiceInfo | null {
  const waiting = reports.filter(r => r.status !== 'uploaded' && r.status !== 'failed_permanent');
  if (waiting.length === 0) {
    return null;
  }

  const title = `Uploading ${plural(waiting.length, 'report', 'reports')}`;
  // The report the engine is working on, if any (oldest first, one at a time).
  const active = waiting.find(r => r.status === 'preparing' || r.status === 'uploading' || r.status === 'finalizing');

  if (active) {
    const view = describeReport(active, { now, isOnline, progress });
    const more = waiting.length > 1 ? ` · ${waiting.length - 1} more waiting` : '';
    return {
      title,
      text: `${view.title}${more}`,
      progress:
        view.progress === undefined
          ? undefined
          : { current: Math.round(view.progress * PERCENT_MAX), max: PERCENT_MAX },
    };
  }

  const retrying = waiting.some(r => r.status === 'failed_retrying');
  if (isOnline === false) {
    return { title, text: 'Waiting for network' };
  }
  return { title, text: retrying ? 'Connection problem – retrying' : 'Starting…' };
}

/** Changes that justify touching the notification again (avoids spamming updates). */
export const infoKey = (info: ServiceInfo): string =>
  `${info.title}|${info.text}|${info.progress ? Math.floor(info.progress.current / 2) : '-'}`;
