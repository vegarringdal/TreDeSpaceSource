// One tonal scale shared by every feedback surface — Badge, InfoBox, Toast and
// EmptyState — so "warning" looks the same wherever it appears.

/** Semantic colour of a feedback surface. `neutral` is the un-tinted default. */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** Filled chip palette (Badge, Button badge). */
export const TONE_CHIP: Readonly<Record<Tone, string>> = {
  neutral: 'border-slate-700 bg-slate-800 text-slate-300',
  info: 'border-blue-500/40 bg-blue-500/15 text-blue-200',
  success: 'border-green-500/40 bg-green-500/15 text-green-200',
  warning: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  danger: 'border-red-500/40 bg-red-500/15 text-red-200',
};

/** Tinted block palette (InfoBox, Toast). */
export const TONE_BLOCK: Readonly<Record<Tone, string>> = {
  neutral: 'border-slate-700 bg-slate-800/60',
  info: 'border-blue-500/30 bg-blue-500/10',
  success: 'border-green-500/30 bg-green-500/10',
  warning: 'border-amber-500/30 bg-amber-500/10',
  danger: 'border-red-500/30 bg-red-500/10',
};

/** Icon / accent colour matching a block. */
export const TONE_ACCENT: Readonly<Record<Tone, string>> = {
  neutral: 'text-slate-400',
  info: 'text-blue-400',
  success: 'text-green-400',
  warning: 'text-amber-400',
  danger: 'text-red-400',
};
