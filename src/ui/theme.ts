import type { Tone } from '../core/statusView';

export const colors = {
  bg: '#ffffff',
  surface: '#f4f6f8',
  text: '#111827',
  muted: '#5b6472',
  border: '#c9ced6',
  primary: '#1a56db',
  primaryText: '#ffffff',
  danger: '#b42318',
  dangerBg: '#fdecea',
  warnBg: '#fff4e0',
  warnText: '#8a4b00',
  successBg: '#e7f6ec',
  successText: '#14532d',
};

/** Minimum touch target (points), per platform guidelines. */
export const HIT = 48;

/** Colours for each status tone. Always paired with text, never colour alone. */
export const toneColors: Record<Tone, { bg: string; fg: string; bar: string }> = {
  neutral: { bg: colors.surface, fg: colors.text, bar: colors.muted },
  progress: { bg: '#e8f0fe', fg: '#1d3f8f', bar: colors.primary },
  success: { bg: colors.successBg, fg: colors.successText, bar: '#2e7d32' },
  warning: { bg: colors.warnBg, fg: colors.warnText, bar: '#d97706' },
  danger: { bg: colors.dangerBg, fg: colors.danger, bar: colors.danger },
};
