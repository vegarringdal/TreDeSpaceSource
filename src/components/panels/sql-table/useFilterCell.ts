import { type PopoverAnchor, usePopoverAnchor } from '@treDeSpaceUI/widgets';
import {
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from 'react';
import { type FilterOperator, isListOperator, OPERATORS, pastedListValues } from './filterOperators';
import { filterOf, type TableView } from './useTableView';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type MenuAnchor = Readonly<{ x: number; y: number }>;

export type FilterCellState = Readonly<{
  /** Where the operator menu is open, or null. */
  menuAnchor: MenuAnchor | null;
  /** The in-list editor's popover (its `rootRef` goes on the filter cell). */
  list: PopoverAnchor;
  inputRef: RefObject<HTMLInputElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  handleButtonPointerDown: () => void;
  handleButtonClick: () => void;
  handleMenuClose: () => void;
  handlePick: (op: FilterOperator) => void;
  handleInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
  handleInputClick: () => void;
  handleInputKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  handlePaste: (e: ClipboardEvent<HTMLInputElement>) => void;
  handleListChange: (text: string) => void;
  handleListClose: () => void;
}>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const LIST_EDITOR_HEIGHT = 230;
const MENU_GAP_PX = 2;

// -----------------------------------------------------------------------------
// Hooks
// -----------------------------------------------------------------------------

/** One filter cell's behavior: the operator menu (button or `Alt`+`↓`), the
 *  typed text, a spreadsheet paste turning into an in-list filter, and the
 *  list editor an in-list filter is edited in. */
export function useFilterCell(view: TableView, col: number): FilterCellState {
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const list = usePopoverAnchor(LIST_EDITOR_HEIGHT);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // a press on the button while the menu is open closes it (the menu's own
  // outside-press) — the click that follows must not open it again
  const wasMenuOpen = useRef(false);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const filter = filterOf(view.filters, col);
  const isList = isListOperator(filter.op);

  // ---------------------------------------------------------------------------
  // Helper functions
  // ---------------------------------------------------------------------------

  const openMenu = (): void => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) {
      setMenuAnchor({ x: r.left, y: r.bottom + MENU_GAP_PX });
    }
  };

  const focusInput = (): void => {
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  const handleButtonPointerDown = (): void => {
    wasMenuOpen.current = menuAnchor !== null;
  };

  const handleButtonClick = (): void => {
    if (wasMenuOpen.current) {
      wasMenuOpen.current = false;
      return;
    }
    openMenu();
  };

  const handleMenuClose = useCallback(() => setMenuAnchor(null), []);

  const handlePick = (op: FilterOperator): void => {
    view.setOperator(col, op);
    list.setOpen(isListOperator(op));
    if (!isListOperator(op) && OPERATORS[op].hasValue) {
      focusInput();
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>): void => view.setFilterText(col, e.target.value);

  const handleInputClick = (): void => {
    if (isList) {
      list.setOpen(true);
    }
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      openMenu();
      return;
    }
    if (isList && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      list.setOpen(true);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>): void => {
    const values = pastedListValues(e.clipboardData.getData('text'));
    if (!values) {
      return;
    }
    e.preventDefault();
    view.setFilterList(col, values);
    list.setOpen(true);
  };

  const handleListChange = (text: string): void => view.setFilterText(col, text);

  const handleListClose = (): void => {
    list.setOpen(false);
    focusInput();
  };

  return {
    menuAnchor,
    list,
    inputRef,
    buttonRef,
    handleButtonPointerDown,
    handleButtonClick,
    handleMenuClose,
    handlePick,
    handleInputChange,
    handleInputClick,
    handleInputKeyDown,
    handlePaste,
    handleListChange,
    handleListClose,
  };
}
