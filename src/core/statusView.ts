import { ImageProgress } from './UploadEngine';
import { Report } from './types';

/**
 * Turns engine state into the words and numbers the UI shows. Pure, so the
 * wording rules ("saved" is never "uploaded") are unit-tested, not eyeballed.
 */

export type Tone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

export interface ReportStatusView {
  tone: Tone;
  /** One glance, one answer. */
  title: string;
  /** Second line: reason, numbers, or what happens next. */
  detail?: string;
  /** 0..1 when a real number is known; undefined means "no bar". */
  progress?: number;
  canRetry: boolean;
}

export interface ViewContext {
  now: number;
  /** undefined = unknown (not yet reported by the network monitor). */
  isOnline?: boolean;
  progress: ImageProgress | null;
}

const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) {
    return `${s} s`;
  }
  const m = Math.ceil(s / 60);
  return `${m} min`;
}

export function describeReport(report: Report, ctx: ViewContext): ReportStatusView {
  const total = report.images.length;
  const done = report.images.filter(i => i.status === 'uploaded').length;

  switch (report.status) {
    case 'saved_locally':
      return {
        tone: 'neutral',
        title:
          ctx.isOnline === false
            ? 'Saved on this phone – waiting for network'
            : 'Saved on this phone – waiting its turn',
        detail: 'It will upload automatically.',
        canRetry: false,
      };

    case 'preparing': {
      const ready = report.images.filter(i => i.status !== 'pending').length;
      return {
        tone: 'progress',
        title: 'Preparing photos',
        detail: `${ready} of ${total} ready`,
        canRetry: false,
      };
    }

    case 'uploading': {
      const current = Math.min(done + 1, total);
      const live =
        ctx.progress && ctx.progress.reportId === report.id && ctx.progress.totalBytes > 0
          ? ctx.progress
          : null;
      const fraction = live ? live.bytesTransferred / live.totalBytes : 0;
      return {
        tone: 'progress',
        title: `Uploading ${current} of ${total}`,
        detail: live ? `${mb(live.bytesTransferred)} of ${mb(live.totalBytes)} MB` : undefined,
        progress: Math.min(1, (done + fraction) / total),
        canRetry: false,
      };
    }

    case 'finalizing':
      return {
        tone: 'progress',
        title: 'Finishing up',
        detail: 'All photos sent. Confirming with the server.',
        progress: 1,
        canRetry: false,
      };

    case 'uploaded':
      return { tone: 'success', title: 'Uploaded to server', canRetry: false };

    case 'failed_retrying': {
      const reason = report.failure?.reason ?? 'Something went wrong.';
      let next: string;
      if (ctx.isOnline === false) {
        next = 'Will try again as soon as the network returns.';
      } else {
        const wait = (report.nextAttemptAt ?? ctx.now) - ctx.now;
        next = wait > 0 ? `Next try in ${formatCountdown(wait)}.` : 'Trying again now.';
      }
      return {
        tone: 'warning',
        title: 'Failed – will retry automatically',
        detail: `${reason} ${next}`,
        canRetry: false,
      };
    }

    case 'failed_permanent':
      return {
        tone: 'danger',
        title: 'Failed – needs your action',
        detail: `${report.failure?.reason ?? 'The report could not be sent.'} Fix the problem, then tap Try again.`,
        canRetry: true,
      };
  }
}

export interface Banner {
  tone: Tone;
  text: string;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The global strip under the header. `waiting` = reports that still have to
 * reach the server (everything except uploaded and permanently failed).
 */
export function queueBanner(reports: readonly Report[], isOnline: boolean | undefined): Banner | null {
  const waiting = reports.filter(r => r.status !== 'uploaded' && r.status !== 'failed_permanent');
  const stuck = reports.filter(r => r.status === 'failed_permanent').length;
  const retrying = reports.filter(r => r.status === 'failed_retrying').length;

  if (isOnline === false) {
    return waiting.length > 0
      ? { tone: 'warning', text: `Offline – ${plural(waiting.length, 'report', 'reports')} waiting` }
      : { tone: 'neutral', text: 'Offline – reports you save are kept on this phone' };
  }
  if (stuck > 0) {
    return {
      tone: 'danger',
      text: `${plural(stuck, 'report needs', 'reports need')} your attention`,
    };
  }
  if (retrying > 0) {
    return {
      tone: 'warning',
      text: `Connection problem – retrying ${plural(retrying, 'report', 'reports')}`,
    };
  }
  if (waiting.length > 0) {
    return { tone: 'progress', text: `Sending ${plural(waiting.length, 'report', 'reports')}…` };
  }
  return null;
}

/** Number shown on the "My reports" tab: reports not yet safely on the server. */
export const pendingCount = (reports: readonly Report[]): number =>
  reports.filter(r => r.status !== 'uploaded').length;
