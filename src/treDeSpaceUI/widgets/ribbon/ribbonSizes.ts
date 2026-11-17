export type RibbonSize = 'big' | 'medium' | 'mini';

export const RIBBON_ROWS: Record<RibbonSize, number> = { big: 6, medium: 3, mini: 2 };

// Heights that stack 1 / 2 / 3 per column (2px gaps accounted for) — when a
// column is only partly filled, justify-center keeps its content centred.
export const RIBBON_HEIGHT: Record<RibbonSize, string> = {
  big: 'h-full',
  medium: 'h-[calc((100%-2px)/2)]',
  mini: 'h-[calc((100%-4px)/3)]',
};
