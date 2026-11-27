import { cn } from '@treDeSpaceUI/lib/cn';
import { Menu } from '@treDeSpaceUI/widgets';
import { FilterListEditor } from './FilterListEditor';
import { DEFAULT_OPERATOR, isListOperator, listValues, OPERATORS, uniqueValues } from './filterOperators';
import { operatorMenuItems } from './operatorMenu';
import { useFilterCell } from './useFilterCell';
import { filterOf, type TableView } from './useTableView';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type FilterCellProps = Readonly<{
  view: TableView;
  col: number;
  column: string;
  width: number;
}>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const PLACEHOLDER = 'filter';
const MENU_MIN_WIDTH = 200;
const TEXT_TOOLTIP =
  'Filter this column. The = button picks how: equals (the default — * or % match any text, so PIPE* starts with), not equal, contains, in list… Alt+↓ opens it. Typing >=, <=, >, <, != or <> first switches it too. Paste cells copied from a spreadsheet for an in-list filter. Filters in several columns must all match.';
const LIST_TOOLTIP = 'Click to edit the list';

/** One column's filter: the input plus its operator button (on the right for
 *  text, on the left for numbers, whose value is right-aligned like the
 *  numbers below), the operator menu and, for in-list filters, the list
 *  editor. Underlined in blue while it filters. */
export function FilterCell({ view, col, column, width }: FilterCellProps) {
  const cell = useFilterCell(view, col);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const filter = filterOf(view.filters, col);
  const kind = view.kinds[col] ?? 'text';
  const { symbol, label, hasValue } = OPERATORS[filter.op];
  const isList = isListOperator(filter.op);
  const values = isList ? uniqueValues(listValues(filter.text)) : [];
  const isChanged = filter.op !== DEFAULT_OPERATOR;
  const items = operatorMenuItems(kind, filter.op, cell.handlePick);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={cell.list.rootRef}
      className={cn(
        'flex items-center border-slate-800 border-r bg-slate-950/60',
        kind === 'number' && 'flex-row-reverse',
        view.isFiltering[col] && 'shadow-[inset_0_-2px_0_var(--color-blue-400)]',
      )}
      style={{ width }}
    >
      <input
        ref={cell.inputRef}
        value={isList ? values.join('; ') : filter.text}
        placeholder={hasValue ? PLACEHOLDER : undefined}
        disabled={!hasValue}
        readOnly={isList}
        aria-label={`Filter ${column}`}
        data-tooltip={isList ? LIST_TOOLTIP : TEXT_TOOLTIP}
        spellCheck={false}
        className={cn(
          'h-full min-w-0 flex-1 bg-transparent px-1.5 text-[11px] text-slate-200 outline-none placeholder:text-slate-500 read-only:cursor-pointer focus:bg-slate-950 disabled:cursor-default',
          kind === 'number' && 'text-right',
        )}
        onChange={cell.handleInputChange}
        onClick={cell.handleInputClick}
        onKeyDown={cell.handleInputKeyDown}
        onPaste={cell.handlePaste}
      />
      <button
        ref={cell.buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-label={`How ${column} is filtered: ${label}`}
        data-tooltip={`Filter operator: ${label}. Click (or Alt+↓ in the filter) to change it.`}
        className={cn(
          'mx-0.5 flex h-4 min-w-6 shrink-0 cursor-pointer items-center justify-center border px-1 font-mono text-[10px] leading-none',
          isChanged
            ? 'border-blue-400 bg-blue-950 text-blue-100 hover:border-blue-300'
            : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200',
        )}
        onPointerDown={cell.handleButtonPointerDown}
        onClick={cell.handleButtonClick}
      >
        {isList ? `${symbol} ${values.length.toLocaleString()}` : symbol}
      </button>
      <Menu
        anchor={cell.menuAnchor}
        items={items}
        focusId={filter.op}
        minWidth={MENU_MIN_WIDTH}
        onClose={cell.handleMenuClose}
      />
      {cell.list.open && isList && (
        <FilterListEditor
          anchor={cell.list}
          column={column}
          isNotIn={filter.op === 'NOT_IN'}
          text={filter.text}
          onChange={cell.handleListChange}
          onClose={cell.handleListClose}
        />
      )}
    </div>
  );
}
