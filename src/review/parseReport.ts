import { ServerReport } from './types';

/**
 * Turns raw Firestore data into a ServerReport, or null if it is not a
 * complete, well-formed report. Defensive on purpose: a malformed document
 * written by something else must be skipped, never crash the screen.
 */
export function parseReportDoc(id: string, data: unknown): ServerReport | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const d = data as Record<string, unknown>;
  if (d.status !== 'complete' || typeof d.description !== 'string') {
    return null;
  }
  if (!Array.isArray(d.imagePaths) || !d.imagePaths.every(p => typeof p === 'string')) {
    return null;
  }
  return {
    id,
    description: d.description,
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : 0,
    imagePaths: d.imagePaths as string[],
  };
}
