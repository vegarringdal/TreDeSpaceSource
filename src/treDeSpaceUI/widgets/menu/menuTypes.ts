import type { ReactNode } from 'react';

export type MenuItem = Readonly<{
  /** Stable identity of the entry. */
  id: string;
  /** Entry text. */
  label: ReactNode;
  /** Runs after the menu has closed (so it may open a dialog). */
  onSelect: () => void;
  /** Leading icon (locked to 14×14). */
  icon?: ReactNode;
  /** Styled tooltip (data-tooltip) — it opens beside the menu, never over the entries. */
  tooltip?: string;
  /** Hotkey id (data-shortcut) — the tooltip gets a combo footer (the row shows no combo). */
  shortcut?: string;
  /** Greyed out; not clickable. */
  disabled?: boolean;
  /** Destructive entry — rendered in the danger tone. */
  danger?: boolean;
}>;

export type MenuSeparator = Readonly<{ separator: true }>;

/** An entry, a rule between groups, or nothing — so a caller can write
 *  `cond && { …item }` inline without filtering the list first. */
export type MenuEntry = MenuItem | MenuSeparator | null | false | undefined;

export const isSeparator = (e: MenuEntry): e is MenuSeparator => e != null && e !== false && 'separator' in e;
