import { Report } from './types';

export interface ResetPlan {
  total: number;
  /** Reports whose commit marker is NOT on the server: deleting these loses data. */
  notUploaded: number;
  uploaded: number;
  title: string;
  body: string;
  confirmLabel: string;
  /** True when confirming destroys reports that exist nowhere else. */
  destructive: boolean;
}

const reports = (n: number): string => `${n} ${n === 1 ? 'report' : 'reports'}`;

const SERVER_NOTE = 'Reports already on the server are not affected: nothing is deleted there.';

/**
 * What "Start over" will do, in plain words with the exact numbers. Anything
 * that is not `uploaded` (including permanently failed reports) exists only on
 * this phone, so it is counted as lost.
 */
export function planReset(all: readonly Report[]): ResetPlan {
  const notUploaded = all.filter(r => r.status !== 'uploaded').length;
  const uploaded = all.length - notUploaded;

  if (notUploaded > 0) {
    return {
      total: all.length,
      notUploaded,
      uploaded,
      destructive: true,
      title: 'Delete reports that are not uploaded?',
      body:
        `${reports(notUploaded)} ${notUploaded === 1 ? 'has' : 'have'} NOT been uploaded yet. ` +
        'Starting over permanently deletes them and their photos from this phone. ' +
        'This cannot be undone.\n\n' +
        SERVER_NOTE,
      confirmLabel: `Delete ${reports(notUploaded)} and start over`,
    };
  }
  return {
    total: all.length,
    notUploaded,
    uploaded,
    destructive: false,
    title: 'Start over?',
    body:
      `This clears the list of ${reports(all.length)} and their photos from this phone. ` +
      SERVER_NOTE,
    confirmLabel: 'Start over',
  };
}
