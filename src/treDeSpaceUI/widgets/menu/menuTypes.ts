import type { ReactNode } from 'react';

export type MenuItem = Readonly<{
  /** Stable identity of the entry. */
  id: string;
  label: ReactNode;
  onSelect: () => void;
  /** Leading icon (locked to 14×14). */
  icon?: ReactNode;
  /** Styled tooltip (data-tooltip). */
  tooltip?: string;
  /** Hotkey id (data-shortcut) — the tooltip gets a combo footer. */
  shortcut?: string;
  disabled?: boolean;
  /** Destructive entry — rendered in the danger tone. */
  danger?: boolean;
}>;

export type MenuSeparator = Readonly<{ separator: true }>;

/** An entry, a rule between groups, or nothing — so a caller can write
 *  `cond && { …item }` inline without filtering the list first. */
export type MenuEntry = MenuItem | MenuSeparator | null | false | undefined;

export const isSeparator = (e: MenuEntry): e is MenuSeparator => e != null && e !== false && 'separator' in e;
