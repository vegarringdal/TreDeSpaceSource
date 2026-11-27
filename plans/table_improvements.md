# SQL Table filters — operators, typed columns, list editor (PHASE 1 DONE, phase 2 open)

> **Status: phase 1 built on branch `table_improvments`, 2026-11-27.** The
> design was worked out on a clickable mock,
> [`table_improvements_mock.html`](table_improvements_mock.html) (open it in a
> browser; the expression bar loads SQLite from cdnjs). The open questions
> were settled with the director: text defaults to **contains** (a value
> with a wildcard still matches the whole value, so `PIPE*` is begins with;
> numbers default to equals; the operator shows as a bare symbol until
> hovered),
> filters still **reset** on every new result, and the **expression bar
> (phase 2) comes later**. What is left is [phase 2](#expression-bar-optional-phase-2).
>
> Phase 1 as built: `filterOperators.ts` (operator ids, symbols, menus, typed
> shortcuts, paste parsing), `cellFilter.ts` (`compileCellFilter(filter,
> kind)`, `detectColumnKinds`), `useTableView.ts`, `FilterCell.tsx` +
> `useFilterCell.ts` + `operatorMenu.tsx`, `FilterListEditor.tsx`. Two library
> additions came with it: `Menu` got `focusId` and arrow-key navigation (so
> `Alt`+`↓` gives a menu you can drive from the keyboard), and
> `usePopoverAnchor` / `PickerPopover` are exported. Deviations from the
> sketch: the list text is stored one value per line (not `; `), repeats are
> dropped when the editor next opens rather than on close, and `BETWEEN`
> allows an open end (`100..`).

## Goal

Make the SQL Table panel's column filters more capable without replacing the
grid: not equal, not contains, in list, number comparisons and blank checks,
picked per column.

This is **option A** (extend the current grid). **Option B**, moving to the
director's own `@simple-html/grid` v6 (branch `v6_maybe`), was looked at and
put off. See [Option B](#option-b-simple-html-grid-v6) for why and when to
look again.

## How it works today

- The filter lives in `src/components/panels/sql-table/cellFilter.ts`
  (`compileCellFilter(text)`, tests in `tests/cellFilter.test.ts`):
  - The default is **equals** on the whole cell, ignoring capitals and
    surrounding spaces.
  - `*` or `%` match any run of characters, so `PIPE*`, `*PIPE` and `*PIPE*`
    give begins-with, ends-with and contains.
- **Everything is filtered as text** (`String(cell).toLowerCase()`). Sorting
  (`useTableView.ts › compare`) does compare numbers as numbers.
- The grid knows no column types. `TablePayload` (`sqlTablePanel.ts`) carries
  only `columns: string[]` and `rows: unknown[][]`, with values as SQLite
  returned them.
- Filters are AND-ed across columns and reset when a new result arrives.
- The filter cells (`TableHeader.tsx`) are bare `<input>`s with the
  placeholder `equals (* = any)`.

## What we agreed (shown in the mock)

### Operator button per filter cell

- **Text columns:** the button is on the **right** of the input.
- **Number columns:** the button is on the **left** and the typed value is
  right-aligned, in line with the right-aligned numbers below.
- The button shows the operator's symbol and turns blue (the app's
  "selected" look) when the column uses anything other than its default. The
  filter cell gets a blue underline while it filters.
- Clicking the button, or `Alt`+`↓` in the input, opens a menu
  (`@treDeSpaceUI` `Menu`) of the operators for that column's type.
- The input's placeholder is just **`filter`**. Blank / not blank take no
  value, so their input is disabled and has no placeholder.

| Button | Operator | Columns |
| --- | --- | --- |
| `=` | Equals the whole value; `*` / `%` wildcards as today | all |
| `≠` | Does not equal; wildcards work | all |
| `*a*` | Contains | text |
| `!*a*` | Does not contain | text |
| `a*` / `*a` | Begins with / ends with | text |
| `∈` / `∉` | In list / not in list (button shows the count: `∈ 12`) | all |
| `>` `≥` `<` `≤` | Compared as numbers | number |
| `a..b` | Between, both ends included (`100..250`) | number |
| `∅` / `!∅` | Is blank / is not blank | all |

Operator ids: use the `@simple-html/grid` v6 names (`EQUAL`, `NOT_EQUAL_TO`,
`CONTAINS`, `DOES_NOT_CONTAIN`, `BEGIN_WITH`, `END_WITH`, `IN`, `NOT_IN`,
`GREATER_THAN`, `GREATER_THAN_OR_EQUAL_TO`, `LESS_THAN`,
`LESS_THAN_OR_EQUAL_TO`, `BETWEEN`, `IS_BLANK`, `IS_NOT_BLANK`) as a string
literal union, so a later move to option B is mostly a swap.

### Column types detected from the values

- A column is **number** when every non-blank value is a JS `number`, which
  means SQLite returned INTEGER or REAL. Everything else is **text**. Reports
  need no setup.
- The header shows a small `123` / `abc` tag.
- Detection is one pass per new result that stops at the first non-number per
  column, so it is cheap even at the 450k-row cap.

### Shortcuts while typing

Starting a filter with `>=`, `<=`, `>`, `<`, `!=` or `<>` switches the
operator and removes the sign. `>` and `<` only switch on number columns.

### Paste from a spreadsheet, and the list editor

- Pasting several cells into any filter makes it **in list**: a copied
  column arrives as one value per line, a copied row as tab-separated
  values. Empty cells are skipped and repeats dropped. A filter already set
  to not-in-list stays not-in-list.
- In-list filters edit in a **list editor**: a resizable box under the cell,
  with one value per line, for reading, typing or pasting values. It
  opens when:
  - you pick In list / Not in list,
  - you click an in-list filter (its input is read-only and shows
    `a; b; c`),
  - you paste several cells.

  The editor:
  - shows a counter that flags repeats ("12 values (3 repeated)"),
  - updates the table as you type,
  - closes with **Done**, `Esc` or a click outside, which removes the
    repeats.

  Build it from the library: anchor it with `usePopoverAnchor` the way the
  pickers do, with a textarea inside, rather than a one-off component.

### Expression bar (optional, phase 2)

- An **Expression…** button in the title bar opens a `WHERE` input with
  **Run** and **Clear**.
- It runs the report again as `SELECT * FROM (<report sql>) WHERE <expr>`,
  and the column filters still apply on top.
- The UI shows only the input, one line of explanation and SQL errors in red.
  The full query sits behind a collapsed **Show full query** link, because
  showing the whole SQL was too much.
- Why it is worth having: it is the only way to filter on a column the report
  does not select, or to use OR.
- The cost: it re-runs the report, so a slow report is slow again.
- Where it plugs in: `sqlReportsActions.runTable` / `execReport`
  (`src/state/sqlReports/sqlReports.actions.ts`). The dropdown filter already
  wraps a report as `SELECT * FROM (<sql>) LIMIT 25`. `TablePayload` would
  grow a `rerun(where)` next to `reload`, and the `truncated` / Load-all cap
  logic stays as it is.

## Implementation sketch (phase 1)

1. `cellFilter.ts`:
   - `compileCellFilter(op, text, kind)` returns a `CellMatcher | null`,
     compiled once per change and never per row.
   - Keep the wildcard rule for `EQUAL` / `NOT_EQUAL_TO` and for the values
     of `IN` / `NOT_IN`.
   - Add `detectColumnKinds(rows)`.
   - Extend `tests/cellFilter.test.ts`.
2. `useTableView.ts`:
   - `filters: { op, text }[]` instead of `string[]`, plus `kinds`.
   - `setFilter(col, text)` handles the typed shortcuts; add
     `setOperator(col, op)`.
3. A new `FilterCell.tsx`: the input and the operator button. Its placement
   depends on the kind, and it handles the paste. `TableHeader.tsx` renders
   one per column.
4. A new `FilterListEditor.tsx`: the list editor described above.
5. Hotkey: `Alt`+`↓` in a filter opens the operator menu. It is local to the
   input, so it needs no binding in `src/hotkeys/bindings.ts` unless a
   global one is wanted.
6. Docs:
   - the SQL Table section of the user guide
   - its screenshots (`npm run docs:shots`)
   - CHANGELOG
7. Phase 2: the expression bar.

**Also check while there:** the row-number column in `TableBody.tsx` must
keep an opaque background. In the mock, see-through striped rows let column
values show through under the row numbers when scrolling sideways.

## Open questions

- **Default for text:** keep **equals** with wildcards (today's behaviour;
  the mock keeps it), or switch to **contains**?
- **Keep operators across a re-run:** should the chosen operators (and
  values) survive a re-run of the same report? Today the filters reset on
  every new result.
- **Expression bar timing:** in the same branch as phase 1, or later?

## Option B: simple-html grid v6

`@simple-html/grid` 6.0.0 (branch `v6_maybe` of `airemote/simple-html`)
already does all of the above and more:

- 15 typed operators, with an operator picker in the filter cell
- text / number / date / boolean column types
- an AND/OR filter editor with nested groups
- sorting by several columns, grouping, xlsx/CSV export, and copy/paste with
  spreadsheets

It is vanilla TypeScript on `lit-html`, which this app already depends on.

Reasons to wait:

- Its changelog says **"6.0.0 (in progress)"**.
- It is **not on npm**: it would need a GitHub Packages token or a git-branch
  dependency in the build.
- The only size seen in its docs is **5,000 rows**. This table loads up to
  450k.
- Moving to it means re-wiring:
  - the selection → 3D link
  - the side menu's "With selection" buttons
  - xlsx export
  - the `sql.table.*` hotkeys

**Look again** once v6 is released and passes a 450k-row test in this app.
