# treDeSpaceUI — component library guide

treDeSpaceUI is the React 19 component library the TreDeSpace viewer's UI is
built from: form widgets, dialogs, attribute-driven tooltips, a keyboard-
shortcut system, and a dockable panel shell. This document is the complete
usage reference — it is written so a person (or an AI) can build UI with the
library from this file alone.

A live gallery of every widget with stateful demos and props docs is served at
`/docs/widgets.html` on any TreDeSpace deployment.

- Source: this folder (`src/treDeSpaceUI/`)
- npm package: `@tredespace/ui` (MIT) — never published to the npm registry; a
  `.tgz` built by `npm run pack:ui`, emitted by the app build next to the
  widget gallery and downloadable from it (consumers depend on it via
  `"@tredespace/ui": "file:…"`).

---

## 1. Setup

### Inside this repo

Everything is already wired. Import via the `@treDeSpaceUI` path alias:

```ts
import { Button, Select, initTooltips } from '@treDeSpaceUI/widgets';
import { DockView, definePanel, split, tabs, useDockManager } from '@treDeSpaceUI/dockable';
import { hotkeysActions } from '@treDeSpaceUI/hotkeys';
import { createStore, cn } from '@treDeSpaceUI/lib';
```

### As the `@tredespace/ui` npm package

The package ships compiled ESM + `.d.ts`; a bundler (Vite, webpack, …) is
required. Install from the tarball:

```json
"dependencies": {
  "@tredespace/ui": "file:./libs/tredespace-ui-<version>.tgz"
}
```

Requirements:

- **React 19** — `react` and `react-dom` ≥ 19 are peer dependencies.
- **Tailwind CSS v4 in your build** — the widgets style themselves with
  Tailwind utilities. `npm i -D tailwindcss @tailwindcss/vite` (or
  `@tailwindcss/postcss`), then make Tailwind scan the package and import the
  library stylesheet in your CSS entry:

```css
@import "tailwindcss";
@import "@tredespace/ui/styles.css";
@source "../node_modules/@tredespace/ui";
```

- Runtime deps (`lit-html`, `@tabler/icons-react`, `clsx`, `tailwind-merge`)
  install automatically with the package.

Entry points mirror the in-repo folders:

```ts
import { Button, Select, initTooltips } from '@tredespace/ui/widgets';
import { DockView, definePanel, split, tabs, useDockManager } from '@tredespace/ui/dockable';
import { hotkeysActions } from '@tredespace/ui/hotkeys';
import { createStore, cn } from '@tredespace/ui/lib';   // the store pattern + class helper
```

All examples below use the in-repo `@treDeSpaceUI/*` form — external consumers
substitute `@tredespace/ui/*`. (`lib` is the one entry whose in-repo form the
app itself often deep-imports as `@treDeSpaceUI/lib/createStore`; the package
only exposes the `lib` index, so use `@tredespace/ui/lib`.)

### One-time boot calls

```ts
import { initTooltips } from '@treDeSpaceUI/widgets';

initTooltips(); // enables data-tooltip / data-shortcut everywhere (singleton)
```

If you use hotkeys, register the whole table once at startup
(`hotkeysActions.register(...)`, see §5) — that also starts the key engine.

### Theming

Dark is the default. The library reads Tailwind's `--color-*` variables and
ships a light remap keyed by `data-theme="light"` on `<html>`:

```ts
document.documentElement.dataset.theme = 'light'; // or delete for dark
```

The dock chrome (`dockable/dockable.css`, imported automatically) carries its
own plain CSS with fallback colors and works even without Tailwind.

---

## 2. Conventions shared by all widgets

- **Controlled components.** Every input takes `value` + `onChange`; the
  widget never owns the value. A few container widgets (Collapsible,
  InlinePanel, VerticalTabs) support both controlled and uncontrolled modes.
- **`tooltip` / `shortcut` props.** Most interactive widgets accept
  `tooltip?: string` (rendered as a styled `data-tooltip` bubble; `"\n"`
  makes multiple lines) and `shortcut?: string` (a hotkey **id** from the
  hotkeys registry — the tooltip then gets a footer showing the current key
  combo, live-updated when the user rebinds it; with no `tooltip` given, the
  hotkey's `description` is used as the tooltip body — see "One definition
  drives the whole UI" in §5).
- **Stacking order.** Floating layers sit on fixed floors so they never
  fight: `1000` popovers and dropdowns (Select, color picker, field
  popovers), `2000` InfoButton, `3000` Menu, `4000` the tooltip bubble.
  A tooltip is always topmost — it is the one layer that must be readable
  over anything else — and inside a `role="menu"` or `role="listbox"` it
  places itself BESIDE the list rather than over the entries below the one
  being hovered. Keep any new floating layer of your own on one of these
  floors (or below `4000`), and give equal-priority layers DIFFERENT
  values: two `position: fixed` siblings at the same z-index are resolved
  by DOM order, which for a portal means "whichever mounted last".
- **`className`** merges extra Tailwind utilities onto the widget's outermost
  element. For a field widget that means the labelled ROW (`Labelled`), label
  included — so `className="min-w-0 flex-1"` next to a button sizes the whole
  row, and with no label it is simply the box around the field. Use `cn()` when
  composing conditionally.
- **Empty = `null`.** Clearable single-value pickers (Select, DatePicker,
  TimePicker, DateTimePicker) use `null` for "nothing picked" and call
  `onChange(null)` when cleared.
- **Discriminated unions** for variants: `range: true` switches Date/Time
  pickers into range mode, `multiple: true` switches Select into multi mode —
  TypeScript narrows the `value`/`onChange` types accordingly.
- **Labelled fields.** Every field widget — `TextInput`, `TextArea`,
  `NumberInput`, `Select`, `ColorSelect` — takes the same label props, so a
  panel never hand-rolls a `<label><span>…</span><field/></label>` row:
  - `label` — the caption;
  - `labelPosition: 'top' | 'left' | 'split'` — `'left'` gives the LABEL a
    fixed column (`labelWidth`, px) and lets the field fill, for stacked form
    fields that must line up; `'split'` is the settings-row inverse, where the
    label takes the free space and the FIELD keeps a fixed width
    (`fieldWidth`, px, default 112);
  - the row is `w-full`, so a labelled field placed in a flex row next to a
    button shrinks to leave room for it.

  The layout itself lives in one place (`Labelled`, exported) if you need it
  for something that is not a field widget.
- **Generic over the value union.** `Select`, `RadioGroup` and
  `SegmentedControl` are generic over `T extends string`. Type the option list
  (`readonly SelectOption<Mode>[]`) and `onChange` hands back `Mode`, not
  `string` — no `as` cast at the call site.

---

## 3. Widgets (`@treDeSpaceUI/widgets`)

### Button

```tsx
import { Button } from '@treDeSpaceUI/widgets';
import { IconRefresh } from '@tabler/icons-react';

<Button icon={<IconRefresh />} onClick={(e) => reload(e.altKey)} tooltip="Reload" shortcut="app.reload">
  Reload
</Button>
```

```ts
type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost';
type ButtonSize = 'xs' | 'sm' | 'md';   // md = 24px, lines up with the inputs

type ButtonProps = {
  children?: ReactNode;
  icon?: ReactNode;                       // leading icon, locked to 14×14
  onClick?: (e: ReactMouseEvent) => void; // event passed so handlers can read modifiers (Alt…)
  disabled?: boolean;
  active?: boolean;                       // highlighted / selected look — a STATE, wins over variant
  variant?: ButtonVariant;                // emphasis: confirming / destructive / borderless
  size?: ButtonSize;
  readOnly?: boolean;                     // static display chip — no hover, not focusable
  iconOnly?: boolean;                     // square icon-only button (e.g. a reset ✕)
  wrap?: boolean;                         // long label runs to a second line, height grows from the size floor
  grow?: boolean;                         // takes the free space of a flex row (flex-1)
  loading?: boolean;                      // icon becomes a spinner, clicks blocked
  badge?: ReactNode;                      // count / status chip after the label (a Badge)
  title?: string;
  tooltip?: string;
  shortcut?: string;
  className?: string;
};
```

Never restyle a Button with a class string to get a different size or tone —
use `size` / `variant` / `wrap` / `grow` so every button in the app stays one
control.

### Checkbox

```tsx
<Checkbox checked={on} onChange={setOn} label="Enable TAA" hint="temporal AA" />
```

```ts
type CheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;   // the whole label toggles
  hint?: string;       // small dimmed note after the label
  info?: ReactNode;    // longer explanation behind an info icon (replaces hint)
  indeterminate?: boolean; // tri-state box: some of what it covers is checked
  disabled?: boolean;
  tooltip?: string;
  shortcut?: string;
  className?: string;
};
```

`indeterminate` is purely visual — `checked` still decides what a click
reports. Use it for a select-all that currently covers only some rows.

### RadioGroup

```tsx
<RadioGroup
  value={mode}
  onChange={setMode}
  options={[
    { value: 'orbit', label: 'Orbit' },
    { value: 'fly', label: 'Fly', hint: 'WASD', info: 'First-person navigation.' },
  ]}
/>
```

```ts
type RadioOption<T extends string = string> =
  { value: T; label: string; hint?: string; info?: ReactNode; shortcut?: string };

type RadioGroupProps<T extends string = string> = {
  value: T;
  options: readonly RadioOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
};
```

Vertical native radios — for an exclusive choice in a **form**. For the same
choice in a **toolbar**, use `SegmentedControl` instead.

### TextInput / TextArea

```tsx
<TextInput label="Name" value={name} onChange={setName} onCommit={save} placeholder="Untitled" />
<TextArea label="Notes" labelPosition="left" labelWidth={70} value={notes} onChange={setNotes} rows={4} />
```

Both extend the shared labelled-field props:

```ts
type LabelledProps = {
  label?: ReactNode;
  labelPosition?: 'top' | 'left';
  labelWidth?: number;      // px, for 'left' — share across stacked fields to align
  disabled?: boolean;
  className?: string;
};

type TextInputProps = LabelledProps & {
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;  // fires on Enter and blur
  placeholder?: string;
  type?: 'text' | 'password' | 'email' | 'url' | 'search';
  maxLength?: number;
  spellCheck?: boolean;
  clearable?: boolean;                 // in-field ✕ (default true)
  onClear?: () => void;                // override ✕ (e.g. reset-to-default); shows even when empty
};

type TextAreaProps = LabelledProps & {
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;  // fires on blur
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  spellCheck?: boolean;
  resizable?: boolean;                 // user vertical resize (default true)
  minHeight?: number;                  // px floor, also while resizing
  clearable?: boolean;
  onClear?: () => void;
};
```

### NumberInput

Stepper buttons, direct typing, and pointer-drag scrubbing on the field.

```tsx
<NumberInput value={scale} onChange={setScale} min={0.1} max={10} step={0.1} unit="×" />
```

```ts
type NumberInputProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;      // decimals shown/kept; derived from step when omitted
  unit?: string;           // suffix, e.g. "px", "×" — hidden while typing
  disabled?: boolean;
  className?: string;
  tooltip?: string;        // styled tooltip for the whole field
  shortcut?: string;
  decShortcut?: string;    // hotkey ids for the − / + steppers
  incShortcut?: string;
  // + the shared label props (see §2): label, labelPosition, labelWidth, fieldWidth
};
```

### Select (single / multi / searchable / async)

```tsx
// single — value: string | null, onChange gets null on clear
<Select value={fmt} onChange={setFmt} placeholder="Format…"
  options={[
    { value: 'glb', label: 'GLB' },
    { value: 'ifc', label: 'IFC', hint: '.ifc' },
  ]} />

// multi — value: string[], selections render as removable chips
<Select multiple value={tags} onChange={setTags} options={tagOptions} searchable />

// async — loadOptions replaces local filtering (debounced; implies searchable)
<Select value={item} onChange={setItem}
  loadOptions={async (query) => searchServer(query)} />
```

```ts
type SelectOption<T extends string = string> =
  { value: T; label: string; hint?: string; disabled?: boolean };

// shared: options?, placeholder?, searchable?, loadOptions?, tooltip?, shortcut?,
//         disabled?, className? + the label props from §2
type SingleSelectProps<T extends string = string> =
  { multiple?: false; value: T | null; onChange: (value: T | null) => void; /* +shared */ };
type MultiSelectProps<T extends string = string> =
  { multiple: true; value: readonly T[]; onChange: (value: T[]) => void; /* +shared */ };
type SelectProps<T extends string = string> = SingleSelectProps<T> | MultiSelectProps<T>;
```

Type the option list and the union flows through:

```tsx
const MODES: readonly SelectOption<'reset' | 'append' | 'hide'>[] = [ … ];

<Select options={MODES} value={mode} onChange={(m) => m && setMode(m)} />
//                                              ^ 'reset' | 'append' | 'hide' | null
```

`loadOptions(query)` is called debounced with the current query; resolve with
matching options, or throw/reject to show the error inside the list.

### ColorSelect

A swatch button that opens a full picker popover (SV square, hue slider,
hex/RGB fields, swatch rows).

```tsx
<ColorSelect value={color} onChange={setColor} swatches={['#ff0000', '#00ff00']} />
```

```ts
type ColorSelectProps = {
  value: string;                       // hex color
  onChange: (color: string) => void;
  swatches?: string[];                 // quick-pick row at the bottom of the popover
  disabled?: boolean;
  className?: string;
  tooltip?: string;
  shortcut?: string;
  flush?: boolean;                     // fill parent height exactly (ribbon slots)
  // + the shared label props (see §2)
};
```

The default swatch grid is a module-level store the host app can replace with
a live one (e.g. recent colors); any `createStore` instance satisfies it
structurally:

```ts
import { DEFAULT_PICKER_SWATCHES, setColorSelectSwatchesStore } from '@treDeSpaceUI/widgets';

const recent = createStore({ colors: DEFAULT_PICKER_SWATCHES });
setColorSelectSwatchesStore(recent);   // pass null to restore the default
```

### DatePicker

Values are ISO `"yyyy-mm-dd"` strings (sort correctly as plain strings).

```tsx
// single
<DatePicker value={day} onChange={setDay} min="2026-01-01" max="2026-12-31" />

// range — first click picks the start, second the end (auto-swapped when
// clicked backwards); hovering previews the span
<DatePicker range value={span} onChange={setSpan} />
```

```ts
type DateRange = Readonly<{ start: string | null; end: string | null }>;
// shared: min?/max? (ISO, inclusive), placeholder?, disabled?, className?, tooltip?, shortcut?
type DatePickerProps =
  | { range?: false; value: string | null; onChange: (value: string | null) => void; /* +shared */ }
  | { range: true; value: DateRange; onChange: (value: DateRange) => void; /* +shared */ };
```

### TimePicker

Values are 24-hour `"HH:MM"` strings. Picking uses a clock dial
(hour → minute; header digits re-edit any part).

```tsx
<TimePicker value={time} onChange={setTime} minuteStep={5} />
<TimePicker range value={window} onChange={setWindow} />
```

```ts
type TimeRange = Readonly<{ start: string | null; end: string | null }>;
// end before start is legal: the range crosses midnight
// shared: minuteStep? (default 1), placeholder?, disabled?, className?, tooltip?, shortcut?
type TimePickerProps =
  | { range?: false; value: string | null; onChange: (value: string | null) => void; /* +shared */ }
  | { range: true; value: TimeRange; onChange: (value: TimeRange) => void; /* +shared */ };
```

### DateTimePicker

One field, staged flow: calendar → hour dial → minute dial. Value is ISO local
`"yyyy-mm-ddTHH:MM"` (no timezone; sorts as a plain string).

```tsx
<DateTimePicker value={when} onChange={setWhen} min="2026-01-01" minuteStep={15} />
```

```ts
type DateTimePickerProps = {
  value: string | null;
  onChange: (value: string | null) => void;
  min?: string;          // ISO day, inclusive — bounds the calendar only
  max?: string;
  minuteStep?: number;   // default 1
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  tooltip?: string;
  shortcut?: string;
};
```

### Collapsible

A titled section with a chevron header — the standard building block of a
settings panel.

```tsx
<Collapsible title="Rendering" aside="12 options" defaultOpen
  actions={<Button iconOnly icon={<IconRestore size={14} />} tooltip="Reset" onClick={reset} />}>
  <Checkbox checked={taa} onChange={setTaa} label="TAA" />
</Collapsible>
```

```ts
type CollapsibleProps = {
  title: ReactNode;
  aside?: ReactNode;      // right-aligned note in the header (count, badge…)
  actions?: ReactNode;    // header action buttons (icon-only), before the info icon;
                          // outside the toggle, so clicking one never collapses
  info?: ReactNode;       // explanation behind an info icon in the header
  defaultOpen?: boolean;  // uncontrolled initial state
  open?: boolean;         // controlled — pair with onToggle
  onToggle?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  bodyClassName?: string; // merged over the body's default `flex flex-col gap-2 p-2`
  fill?: boolean;         // fill remaining panel height while open; the BODY scrolls
  fillMinClass?: string;  // height floor for a fill section, e.g. "min-h-64"
};
```

Uncontrolled by default. Pass `open` + `onToggle` when something else owns the
state — an accordion where only one section is open, or a search that must
open every group with a hit. Never force a section open by remounting it with
a changing `key`.

`fill` note: with several `fill` sections in one panel, give each a
`fillMinClass` so they stop shrinking and the panel scrolls instead.

### InlinePanel

A bordered, collapsible box with optional header actions — for embedding a
sub-panel inside other content. Controlled (`open` + `onToggle`) or
uncontrolled (`defaultOpen`).

```ts
type InlinePanelProps = {
  title: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  actions?: ReactNode;        // extra controls at the right end of the header
  titleUppercase?: boolean;   // default true — the dock-panel look
  titleClassName?: string;    // classes merged over the header text styling
  dense?: boolean;            // tight header/body padding for long stacks
  children: ReactNode;
  className?: string;
};
```

The header text is uppercased by default. `titleUppercase={false}` shows the
title as written; `titleClassName` restyles it (`"text-sm normal-case"`), and
a `title` node takes over the rendering entirely:

```tsx
<InlinePanel title="Pump P-101" titleUppercase={false}>…</InlinePanel>
<InlinePanel title={<TagBadge tag="P-101" />}>…</InlinePanel>
```

`dense` shrinks the header to a single tight line and trims the body padding —
for a list of many small sections (one editor per filter). Pair it with
`size="sm"` icon buttons in `actions` so the header stays that height:

```tsx
<InlinePanel dense title="Filter #1" titleUppercase={false}
  actions={<Button iconOnly size="sm" icon={<IconTrash />} tooltip="Remove" />}>
  …
</InlinePanel>
```

### InfoBox / InfoButton

`InfoBox` is an always-visible tinted callout. `InfoButton` is its compact
replacement: an ⓘ icon that shows the explanation in a popover.

```ts
type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

type InfoBoxProps = {
  children: ReactNode;
  tone?: Tone;             // default 'warning' — the hint/caution note
  icon?: ReactNode | null; // replaces the tone's icon; null drops it
  className?: string;
};

type InfoButtonProps = {
  children: ReactNode;  // the explanation shown in the popover
  label?: string;       // accessible label / hover tooltip for the trigger
  className?: string;
};
```

`Tone` is the library's one semantic scale — `InfoBox`, `Badge` and the toasts
all take it, so "warning" looks the same wherever it appears. Use `danger` for
a failure the user must act on, not a red text span.

### SegmentedControl

A run of joined buttons for one exclusive choice — the horizontal sibling of
`RadioGroup`, for a mode switch that belongs in a toolbar rather than a form.

```tsx
const UNITS = [
  { value: 'mm', label: 'mm', tooltip: 'Step unit: millimeters' },
  { value: 'cm', label: 'cm', tooltip: 'Step unit: centimeters' },
  { value: 'm',  label: 'm',  tooltip: 'Step unit: meters' },
] as const;

<SegmentedControl value={unit} options={UNITS} onChange={setUnit} />
```

```ts
type SegmentedOption<T extends string = string> = {
  value: T;
  label?: ReactNode;   // omit for an icon-only segment
  icon?: ReactNode;
  tooltip?: string;
  shortcut?: string;
  disabled?: boolean;
};

type SegmentedControlProps<T extends string = string> = {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  size?: ButtonSize;   // matches Button
  grow?: boolean;      // split the row evenly instead of hugging the labels
  fill?: boolean;      // fill the parent's height (a ribbon slot)
  disabled?: boolean;
  className?: string;
};
```

A run of `<Button active={x === value}>` is not this — it has no shared edges
and no group semantics. Use SegmentedControl whenever the choice is exclusive
and lives on one row; keep Buttons for a grid-shaped group.

### Badge / Kbd

```tsx
<Badge>{rows} rows</Badge>
<Badge tone="warning">unsaved edits</Badge>
<span>Run with <Kbd>Ctrl + Enter</Kbd></span>
```

`Badge` is the one status chip — a count, a license name, a state marker — in
the five `Tone`s. `Kbd` is its key-cap sibling for a shortcut combo. `Button`
takes a `badge` so a count can ride along with an action.

```ts
type BadgeProps = { children: ReactNode; tone?: Tone; tooltip?: string; className?: string };
type KbdProps = { children: ReactNode; className?: string };
```

### PanelHeader / EmptyState

The two pieces of panel chrome.

```tsx
<PanelHeader
  variant="title"
  title={report.name}
  aside={<Badge>{rows.length} rows</Badge>}
  actions={<Button onClick={run}>Run</Button>}
/>
{rows.length === 0 && <EmptyState layout="center">No rows — run the report.</EmptyState>}
```

```ts
type PanelHeaderProps = {
  title: ReactNode;                            // truncates when the panel narrows
  aside?: ReactNode;                           // dim notes between title and actions
  actions?: ReactNode;
  variant?: 'label' | 'title' | 'band';        // dim caption / panel name / tinted mode bar
  className?: string;
};

type EmptyStateProps = {
  children: ReactNode;
  icon?: ReactNode;                 // 'center' layout only
  layout?: 'note' | 'center';       // dim line in the flow / centred in the space left
  className?: string;
};
```

`PanelHeader` is already `shrink-0`, so only the content under it scrolls.
`EmptyState` replaces every hand-written "nothing here" paragraph — it is the
only place that wording gets its styling.

### PropertyList

A label/value read-out: the field list of a record, a stats block, a table of
fixed controls.

```tsx
<PropertyList divided rows={fields.map((f) => ({ key: f.key, label: f.label, value: <Value f={f} /> }))} />
<PropertyList numeric rows={stats} />
<PropertyList layout="fill" rows={controls.map((c) => ({ key: c.id, label: c.desc, value: <Kbd>{c.keys}</Kbd> }))} />
```

```ts
type PropertyRow = {
  key: string;
  label: ReactNode;
  value: ReactNode;
  tooltip?: string;      // on the label cell — for a truncated or renamed key
  leading?: ReactNode;   // cell before the label (a checkbox, a swatch)
};

type PropertyListProps = {
  rows: readonly PropertyRow[];
  layout?: 'fixed' | 'fill';  // label column + filling value / filling label + natural value
  labelWidth?: number;        // px, 'fixed' only (default 128)
  numeric?: boolean;          // monospace, right-aligned values
  divided?: boolean;          // rule under every row
  className?: string;
};
```

### Menu

The right-click menu, portaled to the body so panel scroll clipping can never
cut it off. It opens at the press position and is then measured and nudged
back inside the viewport — no hard-coded size guesses.

```tsx
const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

<div onContextMenu={(e) => { e.preventDefault(); setAnchor({ x: e.clientX, y: e.clientY }); }}>…</div>

<Menu
  anchor={anchor}
  onClose={() => setAnchor(null)}
  items={[
    { id: 'copy', label: 'Copy name', onSelect: () => copy(row.name) },
    canEdit && { id: 'rename', label: 'Rename…', onSelect: () => rename(row) },
    { separator: true },
    { id: 'del', label: 'Remove', danger: true, onSelect: () => remove(row) },
  ]}
/>
```

```ts
type MenuItem = {
  id: string;
  label: ReactNode;
  onSelect: () => void;
  icon?: ReactNode;
  tooltip?: string;
  shortcut?: string;    // hotkey id
  disabled?: boolean;
  danger?: boolean;     // destructive — danger tone
};
type MenuSeparator = { separator: true };
type MenuEntry = MenuItem | MenuSeparator | null | false | undefined;

type MenuProps = {
  anchor: { x: number; y: number } | null;   // null renders nothing
  items: readonly MenuEntry[];
  onClose: () => void;
  minWidth?: number;    // default 160
  className?: string;
};
```

A falsy entry is skipped, so a conditional item can be written inline. Picking
an entry closes the menu **before** running `onSelect`, so a handler that opens
a dialog never leaves the menu floating behind it. Closes on outside press and
on Escape.

### TreeView

The app's tree list: indent, twisty, selection and partial-selection
highlighting over a **flat list of the rows that are visible right now**. The
widget draws; it never owns the model — so a lazily-loaded tree costs nothing
until it is expanded, and the caller keeps whatever data source it has.

```tsx
const rows = visibleRows(model, open).map((n) => ({
  key: n.id,
  depth: n.depth,
  label: n.name,
  icon: <IconCube size={14} />,
  expandable: n.hasChildren,
  expanded: open.has(n.id),
  selected: n.selected,
  partial: n.partiallySelected,
  trailing: <Badge>{n.count}</Badge>,
}));

<TreeView
  rows={rows}
  rowHeight={22}              // turns on virtualization
  onToggle={(row) => toggleOpen(row.key)}
  onRowClick={(row, e) => select(row.key, e)}
  onRowContextMenu={(row, e) => openMenu(row, e)}
/>
```

```ts
type TreeViewRow = {
  key: string;               // React key AND what the callbacks hand back
  depth: number;
  label: ReactNode;
  icon?: ReactNode;
  expandable?: boolean;      // renders the twisty; a leaf keeps its width so levels line up
  expanded?: boolean;
  selected?: boolean;
  partial?: boolean;         // SOME rows beneath are selected — a bar at the left edge
  partialTooltip?: string;
  band?: boolean;            // grouping chrome (a store, a section) — a dimmed full-width band
  muted?: boolean;           // dim, italic label — hidden or unavailable content
  disabled?: boolean;        // not clickable (a band that is pure chrome)
  trailing?: ReactNode;      // right-aligned node after the label
  tooltip?: string;
};

type TreeViewProps = {
  rows: readonly TreeViewRow[];
  onToggle?: (row: TreeViewRow) => void;
  onRowClick?: (row: TreeViewRow, e: ReactMouseEvent) => void;
  onRowContextMenu?: (row: TreeViewRow, e: ReactMouseEvent) => void;
  rowHeight?: number;        // px — virtualizes when given (only rows in view are mounted)
  indent?: number;           // px per depth level (default 14)
  padLeft?: number;          // px before a depth-0 row (default 6)
  scrollerRef?: RefObject<HTMLDivElement | null>;  // to scroll a row into view
  rowProps?: (row: TreeViewRow) => TreeRowExtras;  // drag-and-drop, data-* markers
  emptyText?: ReactNode;
  className?: string;
};
```

The twisty toggles expansion **only** — it never touches the selection, so a
folder can be opened without selecting its subtree. `rowProps` is the escape
hatch for behaviour the tree has no opinion on (`draggable`, the drag
handlers, a drop-highlight class, `data-*` attributes a container-level
handler reads). `FileTree` is this widget plus a file model.

### VerticalTabs

A vertical tab strip with content area — used for settings-style dialogs.

```tsx
<VerticalTabs
  defaultValue="general"
  tabs={[
    { id: 'general', label: 'General', content: <GeneralTab /> },
    { id: 'colors', icon: <IconPalette />, tooltip: 'Colors', content: <ColorsTab /> },
  ]}
/>
```

```ts
type VerticalTab = {
  id: string;
  label?: string;       // omit for icon-only tabs — pair with tooltip
  icon?: ReactNode;
  tooltip?: string;     // "\n" for multiple lines
  content: ReactNode;
};
type VerticalTabsProps = {
  tabs: VerticalTab[];
  value?: string;                 // controlled — pair with onChange
  defaultValue?: string;
  onChange?: (id: string) => void;
  side?: 'left' | 'right';        // which side the strip sits on
  className?: string;
};
```

### FileTree

A virtual file/folder tree with multi-select, drag-to-move, and a built-in
context menu (add / rename / delete folder). Paths are the identity — build
any virtual tree you like.

```tsx
const root: TreeDir = {
  kind: 'dir', name: '', path: '',
  children: [
    { kind: 'dir', name: 'Plant A', path: 'Plant A', children: [
      { kind: 'file', name: 'pipes.tdp', path: 'Plant A/pipes.tdp', note: '12 MB' },
    ]},
  ],
};

<FileTree root={root} selected={sel} onSelect={setSel}
  onMove={(paths, dir) => moveFiles(paths, dir)}
  onAddFolder={(parent) => addFolder(parent)} />
```

```ts
type TreeFile = { kind: 'file'; name: string; path: string; handle?: FileSystemFileHandle; note?: string };
type TreeDir  = { kind: 'dir'; name: string; path: string; children: TreeNode[];
                  variant?: 'section';   // dimmed full-width category band (still collapsible)
                  icon?: ReactNode };    // replaces the default folder icon
type TreeNode = TreeFile | TreeDir;

type FileTreeProps = {
  root: TreeDir;
  selected: Set<string>;
  onSelect: (next: Set<string>) => void;
  onMove?: (paths: string[], dirPath: string) => void;         // files dropped on a folder
  onAddFolder?: (parentDirPath: string | null) => void;        // context menu → New folder
  onRenameFolder?: (dirPath: string) => void;
  onDeleteFolder?: (dirPath: string) => void;
  onMoveFolder?: (dirPath: string, targetDirPath: string) => void;
  emptyText?: string;
  fileIcon?: ReactNode;
  defaultCollapsed?: readonly string[]; // initial state only (re-applied on remount via key)
  expandAll?: boolean;                  // force-expand (e.g. while a search filter is active)
  collapseAllSignal?: number;           // bump to collapse every dir (parent-held counter)
  expandAllSignal?: number;             // bump to expand every dir
  className?: string;                   // overrides the default max-h-64 scroll box
};
```

Omitting a callback hides that capability (no `onMove` → no drag, etc.).

### SqlCodeEditor

A lightweight SQL editor with syntax highlighting and the usual editor keys:
**Tab / Shift+Tab** indent and outdent the selected lines (with a caret, Tab
inserts two spaces and Shift+Tab removes one indent from the line), **Enter**
keeps the current line's indentation, **Ctrl/Cmd+Enter** fires `onRun`. Edits
go through the browser's insert command, so **Ctrl+Z** undoes them like typing.

```tsx
<SqlCodeEditor value={sql} onChange={setSql} onRun={run} resizable className="h-32" />
```

```ts
type SqlCodeEditorProps = {
  value: string;
  onChange: (v: string) => void;
  onRun?: () => void;                              // Ctrl/Cmd+Enter inside the editor
  onSelect?: (start: number, end: number) => void; // caret selection — run only highlighted text
  resizable?: boolean;                             // drag handle; set start height via className
  className?: string;
};
```

### DialogFrame, Modal, TitleBar and the dialog cores

`DialogFrame` is the dialog window: backdrop, bordered box, a title bar with
its ✕, a body that scrolls inside `maxHeight`, and a footer rule for the
buttons. Every dialog in the app is this frame plus its content — build a new
one with it rather than repeating the box classes.

```tsx
<DialogFrame
  icon={<IconLicense size={16} className="text-blue-400" />}
  title="License"
  width="min(560px, 92vw)"
  onClose={() => setOpen(false)}
  footer={<Button variant="primary" onClick={accept}>Accept</Button>}
>
  {body}
</DialogFrame>
```

```ts
type DialogFrameProps = {
  icon: ReactNode;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;                 // right-aligned above the bottom rule
  width?: number | string;            // number = px (default 320)
  height?: number | string;           // omit to hug the content
  maxHeight?: number | string;        // default '80vh' — the body scrolls inside it
  onClose?: () => void;               // Escape, backdrop press and the ✕ all call this
  role?: 'dialog' | 'alertdialog';
  z?: number;
  bodyClassName?: string;             // replaces the default body padding
  className?: string;
};
```

`Modal` is the raw overlay underneath it: a centered window above a dimmed
backdrop at z-index `z` (stack multiple dialogs by increasing `z`). Give it
`onClose` and it handles dismissal for you — Escape reaches only the **top**
open modal (they register in a stack), and a backdrop press closes unless
`closeOnBackdrop={false}`. A modal without `onClose` cannot be dismissed by
the user, which is what a blocking progress overlay wants. `TitleBar` is the
standard header row; give it `onClose` for the ✕.

The `*DialogCore` widgets are complete, presentation-only dialog bodies built
on `DialogFrame` — you own the open/close state:

```tsx
{confirming && (
  <ConfirmDialogCore
    title="Delete model" message="This cannot be undone." okLabel="Delete" cancelLabel="Cancel"
    onResult={(ok) => { setConfirming(false); if (ok) { doDelete(); } }}
  />
)}
```

```ts
type ModalProps = { z: number; children: ReactNode; onClose?: () => void;
                    closeOnBackdrop?: boolean;      // default true
                    onKeyDown?: (e: React.KeyboardEvent) => void };
type TitleBarProps = { icon: ReactNode; children: ReactNode; onClose?: () => void; className?: string };

type ConfirmDialogCoreProps = { title: string; message: string; okLabel: string; cancelLabel: string;
                                onResult: (ok: boolean) => void;  // true = OK, false = Cancel/Escape
                                z?: number };
type ErrorDialogCoreProps   = { title: string; message: string; onDismiss: () => void; z?: number };
type LoadingDialogCoreProps = { title: string; label: string;
                                progress?: number | null;         // 0..1 bar; null/undefined hides it
                                z?: number };
type PromptDialogCoreProps  = { title: string; message: string; value: string; okLabel: string;
                                cancelLabel?: string; onChange: (value: string) => void;
                                onResult: (ok: boolean) => void;  // true = OK/Enter
                                z?: number };
```

### Toast (`toast` + `Toaster`)

Non-blocking notifications — the alternative to stopping the user with a
confirm() they can only acknowledge. Render `<Toaster />` once at the app
root; everything else calls `toast.*`, from React or not.

```tsx
// once, at the app root
<Toaster />

// anywhere — a worker callback, an action, a hotkey
toast.success(`Loaded ${n} label(s).`);
toast.warning('Import failed: 3 tags not found.');
toast.error('GPU device lost.', { title: 'Renderer' });
```

```ts
type ToastOptions = { title?: string; duration?: number };  // duration 0 = until dismissed

const toast: {
  info(message: string, opts?: ToastOptions): string;      // returns the id
  success(message: string, opts?: ToastOptions): string;
  warning(message: string, opts?: ToastOptions): string;
  error(message: string, opts?: ToastOptions): string;     // stays until dismissed
  dismiss(id: string): void;
  clear(): void;
};

type ToasterProps = { z?: number; className?: string };     // default z 2600 — above the modal layer
```

They stack bottom-right, newest at the bottom, hold while the pointer is over
them, and cap at four so a burst of failures cannot bury the screen. An
OK-only dialog is never the right answer for a result the user does not have
to acknowledge — use a toast.

### Link / Swatch / Spinner / ProgressBar / CopyButton / Vec3Input

The small single-purpose parts.

```tsx
<Link href="https://example.com/docs">Read the docs</Link>
<Swatch color={rule.color} active={picked} onClick={() => pick(rule.color)} />
<Spinner /> <ProgressBar value={0.4} /> <ProgressBar />   {/* no value = indeterminate */}
<CopyButton value={() => toTsv(rows)}>Copy rows</CopyButton>
<Vec3Input label="Center" value={shape.center} onChange={(center) => update({ center })} />
```

- **`Link`** — one look for every out-of-app link; external by default
  (`target="_blank"` + `noreferrer noopener`).
- **`Swatch`** — a colour chip: clickable in a palette (`active` rings the
  current pick), static as a read-out when no `onClick` is given.
- **`Spinner` / `ProgressBar`** — the busy indicators the loading dialog is
  built from, available on their own for inline progress.
- **`CopyButton`** — copy-to-clipboard that owns its own "Copied"
  confirmation, so no panel hand-rolls that timer. `value` may be a getter for
  something expensive to build.
- **`Vec3Input`** — three steppers on one row for a point, a size or an axis,
  with a label column that keeps stacked rows aligned.

### Ribbon (toolbar family)

An Office-style ribbon. `Ribbon` is the bar; `RibbonSection` is a titled group
that packs children into columns by their `size` (big = 1 per column,
medium = 2 stacked, mini = 3 stacked); `RibbonSlot` puts arbitrary content
(a Select, a ColorSelect…) into the same sizing system.

```tsx
<Ribbon>
  <RibbonSection title="Camera">
    <RibbonButton icon={<IconHome />} label="Home" size="big" onClick={goHome}
      tooltip="Reset camera" shortcut="camera.home" />
    <RibbonButton icon={<IconLock />} label="Lock" size="medium" selected={locked} onClick={toggleLock} />
    <RibbonNumber label="FOV" value={fov} onChange={setFov} min={20} max={120} step={1} unit="°" size="medium" />
  </RibbonSection>
  <RibbonSection title="Style">
    <RibbonSlot size="medium">
      <Select value={style} onChange={setStyle} options={styleOptions} />
    </RibbonSlot>
  </RibbonSection>
</Ribbon>
```

```ts
type RibbonSize = 'big' | 'medium' | 'mini';

// Ribbon:        { children, className? }
// RibbonSection: { title: ReactNode, children, className? }
// RibbonSlot:    { size?: RibbonSize (default 'medium'), children?, className? }

type RibbonButtonProps = {
  icon?: ReactNode;         // locked to 18×18 regardless of size; omit for text-only
  label?: ReactNode;
  size?: RibbonSize;
  selected?: boolean;
  selectedColor?: string;   // icon/label colour while selected (default theme blue)
  background?: string;      // fixed background for swatch-style buttons; hover brightens
  badge?: ReactNode;        // small counter above a big button
  disabled?: boolean;
  title?: string;
  tooltip?: string;         // "\n" for multiple lines
  shortcut?: string;
  onClick?: () => void;
  onPointerDown?: (e: ReactPointerEvent) => void; // raw pointer-down, e.g. to start a drag
  className?: string;
};

type RibbonNumberProps = Omit<NumberInputProps, 'className'> & {
  label?: ReactNode;        // caption left of the field
  fieldWidth?: number;      // px, default 116
  labelWidth?: number;      // px, default 34 — stacked RibbonNumbers share it to align
  size?: RibbonSize;
  className?: string;
};
```

### Tooltips (`initTooltips`)

Attribute-driven — no wrapper component, works in React and plain DOM alike:

```tsx
initTooltips(); // once at boot; singleton, returns a disposer

<button data-tooltip={'Fit view\nZooms to the selection'}>Fit</button>
<button data-tooltip="Undo" data-shortcut="transform.undo">Undo</button>
```

- Multi-line via real newlines or a literal `"\n"` in the attribute.
- `data-shortcut="<hotkey id>"` appends a footer showing the binding's current
  key combo (from the hotkeys registry). With `data-shortcut` but no
  `data-tooltip`, the hotkey's `description` is used as the tooltip body.
- The widgets' `tooltip`/`shortcut` props render exactly these attributes.

### useFilePicker / useMultiFilePicker / readFileText

A hidden `<input type=file>` plus an `open()` trigger — the shared piece of
every "Load…" button:

```tsx
const picker = useFilePicker('.json', (file) => readFileText(file, importJson));

<>
  {picker.element}   {/* render the hidden input anywhere in the tree */}
  <Button onClick={picker.open}>Load…</Button>
</>
```

```ts
function useFilePicker(accept: string, onFile: (file: File) => void):
  { element: ReactNode; open: () => void; ref: RefObject<HTMLInputElement | null> };

function useMultiFilePicker(accept: string, onFiles: (files: File[]) => void): /* same shape */;
  // onFiles never gets an empty list

function readFileText(file: File, onText: (text: string) => void): void;
```

---

## 4. Utilities (`@treDeSpaceUI/lib`)

### `cn(...inputs)`

Merge conditional class lists and resolve conflicting Tailwind utilities
(later class wins):

```ts
cn('px-2 text-xs', isActive && 'bg-sky-700', className)
```

### `createStore(initial)`

A tiny global store — `useSyncExternalStore` under the hood. This is the
pattern all shared state in the app builds on (`*.state.ts` files):

```ts
const ui = createStore({ sidebarOpen: false });

ui.set({ sidebarOpen: true });                       // patch object…
ui.set((prev) => ({ sidebarOpen: !prev.sidebarOpen })); // …or updater fn
ui.get();                                            // read outside React
const { sidebarOpen } = ui.use();                    // subscribe inside a component
const unsub = ui.subscribe(() => { /* plain DOM / three.js / timers */ });
```

`set` is a shallow merge and no-ops when nothing actually changed (reference
equality per key). `Store<T>` is the exported handle type for code
parameterized over a store instance.

### `useVirtualRows(scroller, count, rowH, overscan?)`

Fixed-height row virtualization for long lists (a log, a grid): rows must all
be `rowH` tall, so the visible window is pure arithmetic — no measuring. You
render the scrolling element yourself and mount only `[first, last)`, each row
absolutely positioned inside a `position: relative` spacer of `totalH`:

```tsx
const scroller = useRef<HTMLDivElement>(null);
const v = useVirtualRows(scroller, rows.length, 20);

<div ref={scroller} className="min-h-0 flex-1 overflow-auto" onScroll={v.onScroll}>
  <div style={{ height: v.totalH, position: 'relative' }}>
    {rows.slice(v.first, v.last).map((row, k) => (
      <div key={row.id} className="absolute left-0" style={{ top: (v.first + k) * 20, height: 20 }}>
        {row.text}
      </div>
    ))}
  </div>
</div>
```

Call `v.onScroll()` yourself after setting `scrollTop` from code (a "follow
the end" jump) so the window updates in the same render.

`TreeView` uses this internally — reach for `useVirtualRows` directly only for
a list that is not a tree (a log, a grid body).

### `usePointerDrag({ onMove, onStart?, onEnd?, threshold? })`

One press-and-drag gesture, on pointer **capture**: every later event retargets
to the handle, so the drag survives the pointer crossing an iframe, another
panel or the window edge — which window-level listeners do not.

```tsx
const from = useRef(0);
const drag = usePointerDrag({
  onMove: ({ dx }) => setWidth(Math.max(48, from.current + dx)),
});

<div
  className="cursor-col-resize"
  onPointerDown={(e) => { from.current = width; drag.start(e); }}
/>
```

```ts
type PointerDragDelta = { dx: number; dy: number; x: number; y: number };

type PointerDragOptions = {
  onMove: (d: PointerDragDelta, e: PointerEvent) => void;
  onStart?: (d: PointerDragDelta) => void;   // fires once past `threshold`
  onEnd?: (moved: boolean) => void;          // moved=false → it was a click
  threshold?: number;                        // px before it counts as a drag (default 0)
};

type PointerDrag = { start: (e: ReactPointerEvent<HTMLElement>) => void; isDragging: () => boolean };
```

With a `threshold`, `onEnd(false)` tells you the press never moved — that is
how NumberInput distinguishes a scrub from a click that should focus the field.

### The state architecture — how apps on this library are designed

`createStore` is not just a utility; it is the intended state design. Shared
state always comes as a **pair of files** per domain:

```
viewer.state.ts    — the store + its state type. NOTHING else.
viewer.actions.ts  — ALL mutation, side effects, persistence.
```

```ts
// viewer.state.ts — JSON-serializable state only; no callbacks, no handles
export type ViewerState = Readonly<{
  clipEnabled: boolean;
  clipHeight: number;
}>;
export const viewerState = createStore<ViewerState>({ clipEnabled: false, clipHeight: 0 });

// viewer.actions.ts — the only module allowed to call viewerState.set()
export const viewerActions = {
  setClipEnabled(enabled: boolean) {
    viewerState.set({ clipEnabled: enabled });
    localStorage.setItem('clip', JSON.stringify(viewerState.get())); // persistence lives HERE
  },
};

// a component — reads via use(), mutates via actions, never set() directly
function ClipToggle() {
  const { clipEnabled } = viewerState.use();
  return <Checkbox checked={clipEnabled} onChange={viewerActions.setClipEnabled} label="Clip plane" />;
}
```

The rules:

- **Components never call `store.set()`** — they call actions. The action
  module is the one place mutation, validation, persistence, and side effects
  (announcing, syncing to a worker) live, so every write path is auditable.
- **State stays JSON-serializable.** Live handles — resolvers, DOM nodes, GPU
  objects, callbacks — belong in the actions module as module-level variables,
  not in the store.
- **Placement follows the readers.** One component/panel uses it → the pair
  sits next to that `.tsx`. The moment a second consumer appears (another
  panel, a hotkey `run`, a worker, the postMessage API) → move the pair to a
  shared `state/` folder, one folder per domain. Don't pre-place it there
  "just in case", and don't reach into another component folder's state file
  instead of moving it.
- **Not everything needs a store.** State used by a single component stays in
  `useState`/a custom hook. Reach for a store when the state outlives the
  component, must be read outside React (hotkey `run` functions, plain-DOM
  panels, render loops), or has more than one reader.
- **Persist selectively, in actions.** Only what should survive a reload goes
  to `localStorage`, written where it is mutated — never in a component
  effect.

This pairs naturally with the rest of the library: hotkey `run` callbacks and
dock `PanelRenderer`s live outside React, and both can read `store.get()` and
call actions directly; panels in separate React roots (floating windows) stay
in sync because they all subscribe to the same module-level store.

---

## 5. Hotkeys (`@treDeSpaceUI/hotkeys`)

A dependency-free keyboard-shortcut system: sequence grammar, matcher engine,
a registry store with user overrides + localStorage persistence, keymap
import/export, and a recorder. The Tooltip widget reads this registry for its
`data-shortcut` footers.

### Key grammar (display strings)

```
X          tap (press & release)                        "Z"
A&B        together, same instant                       "CTRL&Z", "E&R"
A + B      then (release, press next)                   "G + X"
[X], [A&B] hold a key/group across the rest of the seq  "[F1] + 2"
AA / 101   runs expand to taps (A+A, 1+0+1)             "ALT + 101"
++         the literal + key
```

Modifiers: `CTRL`, `ALT`, `SHIFT`, `META`/`CMD`. Named keys: `ESC`, `ENTER`,
`SPACE`, `TAB`, `UP/DOWN/LEFT/RIGHT`, `PAGEUP/PAGEDOWN`, `HOME`, `END`,
`DELETE`, `BACKSPACE`, `F1`–`F12`. A shorter binding may be a prefix of a
longer one (`F` alongside `F+F`) — the short one fires on timeout.

### Storage key

Overrides persist under the localStorage key `hotkeys`. An app that
namespaces its storage moves them with `hotkeysActions.setStorageKey('myapp:hotkeys')`
before registering its shortcuts — the overrides are reloaded from that key.

### Registering shortcuts

```ts
import { hotkeysActions, type HotkeyDef } from '@treDeSpaceUI/hotkeys';

const defs: HotkeyDef[] = [
  {
    id: 'transform.undo',          // stable dotted id
    category: 'Editing',           // UI group
    label: 'Undo',
    description: 'Undo the last transform.',
    defaultKeys: 'CTRL&Z',
    run: () => undo(),
    // allowInInput?: boolean       — fire even inside text fields (default false)
    // timeout?: number             — ms between sequence steps (default 1500)
    // context?: () => boolean      — extra guard; must return true to fire
  },
];

hotkeysActions.register(defs);     // once at boot; also starts the engine
```

### One definition drives the whole UI

A `HotkeyDef` is the **single source of truth** for a shortcut. Define it once
in a central bindings table; everything else only references the `id`:

| Consumer | What it reads from the def |
| --- | --- |
| Key engine | `defaultKeys` (or the user's override) + `run`, `context`, `timeout`, `allowInInput` |
| Tooltips | any control with `shortcut="<id>"` gets a footer showing the **current** combo; when the control has no `tooltip` of its own, the def's `description` becomes the tooltip body |
| Settings / hotkeys panel | `category` groups the defs (one collapsible section per category, in registration order), `label` + `description` are the display text, `isCustom(id)` drives the Reset button |
| Announcements | `label` + the formatted combo, via `setHotkeyAnnouncer` |

The structural recommendation that falls out of this:

```ts
// hotkeys/bindings.ts — the ONE place shortcuts are defined
export const BINDINGS: HotkeyDef[] = [
  {
    id: 'camera.home',
    category: 'Camera',
    label: 'Home view',
    description: 'Reset the camera to the home position.',
    defaultKeys: 'H',
    run: () => cameraActions.goHome(),
  },
  // …
];
hotkeysActions.register(BINDINGS); // at boot

// anywhere in the UI — no label/description/keys duplicated:
<Button shortcut="camera.home" onClick={() => cameraActions.goHome()}>Home</Button>
// tooltip body = the def's description, footer = the live combo ("H", or the
// user's rebind). Pass `tooltip` only when the control needs DIFFERENT text
// than the shortcut's description.
```

Rules of thumb:

- **Never hard-code a key combo in UI text** — combos are user-rebindable;
  always render them via `shortcut`/`data-shortcut` (or
  `formatSequence(hotkeysActions.sequenceFor(id))` when you must inline one).
- **Write `description` to work as a tooltip** — one or two sentences, ending
  with a period; it is shown verbatim in both the tooltip and the settings
  panel.
- Give every new button/toggle a binding + tooltip as you add it, not later —
  the table is the feature inventory.

A settings panel is built entirely from the store: `hotkeysState.use()` gives
`{ defs, order, overrides }`; group `order` by `defs[id].category`, show
`label`/`description`, render the current combo with
`formatSequence(hotkeysActions.sequenceFor(id))`, rebind with
`recordSequence()` → `conflictsFor()` → `setOverride()`, and offer
`exportJson`/`importJson` for sharing keymaps.

### The actions API

```ts
hotkeysActions.sequenceFor(id)            // effective Sequence (override or default), or null
hotkeysActions.describe(id)               // description text, or null
hotkeysActions.isCustom(id)               // has a user override?
hotkeysActions.conflictsFor(seq, excludeId?) // other ids bound to EXACTLY seq
hotkeysActions.setOverride(id, keys)      // rebind (persists to localStorage)
hotkeysActions.setAllowInInput(id, allow)
hotkeysActions.setTimeout(id, ms)
hotkeysActions.resetOne(id)
hotkeysActions.resetAll()
hotkeysActions.exportJson()               // keymap deltas as portable JSON
hotkeysActions.importJson(text)           // → { applied, skipped, conflicts }
```

`hotkeysState` is the underlying `createStore` — `hotkeysState.use()` in a
settings panel re-renders on any registry change (`defs`, `order`,
`overrides`).

### Engine / helper functions

```ts
parseSequence('CTRL&Z')       // display grammar → canonical Sequence (throws HotkeyParseError)
formatSequence(seq)           // Sequence → display string ("ALT&F1 + 101")
formatCombo(combo)            // one step → display
isValidKeys(str)              // does it parse?
validateBindings(defs)        // boot/test check: parse+round-trip+exact-duplicate report
recordSequence({ idleMs? })   // capture keys for a "Record" button:
                              //   resolves on idle-pause or Enter, rejects on Escape;
                              //   suspends the live engine while recording
suspendHotkeys() / resumeHotkeys() // manual engine suspension (nested-safe)
setHotkeyAnnouncer(fn | null) // host hook: gets "⌨ label · combo" whenever a shortcut fires
```

---

## 6. Dockable panels (`@treDeSpaceUI/dockable`)

A dockable/tabbed/floating panel shell (VS-style): splits with draggable
dividers, tab groups, drag-to-dock with drop-zone hints, floating windows,
collapse-to-rail, size locking, and JSON-serializable layout persistence.
Panel content is plain DOM in your document (no shadow root — Tailwind works
inside panels). React content mounts once and **survives docking, tab
switching and re-splitting** — the dock reparents the host element, it never
re-creates it (React state and WebGL contexts live through moves).

### Minimal setup

```tsx
import { definePanel, DockView, PanelBody, split, tabs, useDockManager } from '@treDeSpaceUI/dockable';

const panels = [
  definePanel({ id: 'scene', title: 'Scene', component: ScenePanel }),
  definePanel({ id: 'props', title: 'Properties', minWidth: 220, component: PropsPanel }),
  definePanel({ id: 'console', title: 'Console', component: ConsolePanel }),
];

function App() {
  const manager = useDockManager(() => ({
    panels,
    layout: split('row', [
      tabs(['scene']),
      split('column', [tabs(['props']), tabs(['console'])], [2, 1]),
    ], [3, 1]),
  }));
  return <DockView manager={manager} className="h-screen" />;
}

function PropsPanel() {
  return <PanelBody className="p-2">…any React content…</PanelBody>;
}
```

### Layout builders

```ts
tabs(panelIds, extra?)               // a leaf: panels sharing a tab strip
split(direction, children, sizes?, extra?) // 'row' | 'column'; sizes are weights (ratios only)
```

`extra` sets node options:

- `id: string` — give a **stable id** when other code targets the node
  (`dockableIn`, `home`, `openPanel(_, nodeId)`): `tabs(['a'], { id: 'top' })`.
- `locked: true` — freeze the node: panels can't be dragged out or floated,
  nothing drops into it, no close buttons, adjacent splitters inert.
  Inherited by everything inside. For toolbars, status bars, fixed sidebars.
- `fixedSize: px` — pixel size along the parent split's axis.
- Tabs-node only: `hideTabs` (single-panel toolbars), `collapsed`,
  `collapsible` (default true), `activePanel`.

### Panel definitions

```ts
type PanelDefinition = {
  id: string;
  title: string;
  minWidth?: number;            // content minimum, px (content may raise at runtime)
  minHeight?: number;           // excludes the tab strip
  closable?: boolean;           // default true
  floatable?: boolean;          // default true
  dockableIn?: string | string[]; // pin to node id(s) — no floating/splitting elsewhere
  home?: string;                // soft default node to reopen into (does NOT pin)
  tabMinWidth?: number;         // align a strip of tabs
  onClose?: (panelId) => void;  // the panel was CLOSED (tab ×, closePanel) — see below
  beforeClose?: (panelId) => Promise<void> | undefined; // defer a real close — see below
  render: PanelRenderer;        // (host, ctx) => disposer | undefined  — plain DOM
};

// React sugar (what you normally use):
definePanel({ id, title, ..., component: MyPanel })  // wraps via reactPanel()
reactPanel(Component)                                 // ComponentType<{ ctx: PanelContext }> → PanelRenderer
```

### Inside a panel — context and hooks

```ts
usePanelContext()      // the PanelContext of the enclosing panel (throws outside one)
useMinSize(w?, h?)     // declare how small the content may be squeezed
usePanelTitle(title)   // rename the tab from inside (layout subscribers are notified — read manager.title(id))
useIsFloating(manager, panelId) // reactive: true while in a floating window
useDockLayout(manager) // re-render on ANY layout change; returns the version counter

type PanelContext = {
  readonly id: string;
  readonly manager: DockManager;
  setTitle(title: string): void;
  setMinSize(min: Partial<Size>): void;
  close(): void;
  float(rect?: Partial<Rect>): void;
  isActive(): boolean;
  isFloating(): boolean;
};
```

### DockManager — the imperative API

Created via `useDockManager(makeOptions)` (lives for the component's
lifetime) or `new DockManager(options)` outside React.

```ts
type DockManagerOptions = {
  panels: PanelDefinition[];
  layout: LayoutNode;
  windows?: FloatingWindow[];
  headerHeight?: number;      // ONE tab ROW, px, default 22 — a strip whose tabs
                              // wrap keeps every row this tall, and the taller
                              // strip is folded into the group's minimum size
  tabMinWidth?: number;
  splitterSize?: number;      // default 6; hit area widens on touch
  windowBarHeight?: number;   // default 26
  defaultWindowSize?: Size;   // window from dragging a tab out; default 340×260
};
```

Commonly used methods:

```ts
// open/close
manager.openPanel(id, targetNodeId?)   // reopen a closed panel (home/first node when omitted;
                                       // 'left'/'right'/'bottom' recreate that side column if pruned)
manager.closePanel(id)
manager.togglePanel(id)
manager.remountPanel(id)               // re-run render() in the same host (restart a panel's
                                       // contents in place — layout/tab/window state untouched)
manager.openPanels(); manager.closedPanels(); manager.isOpen(id)
manager.focusPanel(id)                 // activate its tab (and raise its window)

// floating windows
manager.floatPanel(id, rect?)          // → FloatingWindow | null
manager.dockWindow(windowId, targetNodeId?)
manager.closeWindow(windowId)
manager.minimizeWindow(windowId, minimized?)
manager.isFloating(id)

// layout state
manager.saveLayout()                   // → DockState (plain JSON: { root, windows })
manager.loadLayout(stateOrRoot)        // restore (accepts DockState or bare LayoutNode)
manager.resetLayout()                  // back to the constructor layout
manager.subscribe(cb)                  // any change; → unsubscriber

// node-level controls
manager.toggleCollapse(nodeId); manager.setCollapsed(nodeId, c); manager.isCollapsed(nodeId)
manager.toggleSizeLock(nodeId)         // padlock: capture current size as the node's minimum
manager.toggleSolo(); manager.isSolo() // maximize the active group / restore
manager.nodeOf(panelId)                // containing tabs-node id, or null
manager.registerPanel(def)             // add a panel definition at runtime
manager.unregisterPanel(id)            // forget one (closes it first, silently)
manager.dragPanelFrom(e, panelId)      // start a dock-drag from your own pointerdown
                                       // (e.g. dragging a button out of a ribbon)
```

**Runtime panels.** `registerPanel` + `openPanel` create a panel on demand (a
host-driven report view, one tab per opened document); `unregisterPanel` drops
it again, closing it first and forgetting its remembered location, so an id
reused later starts clean. Both notify layout subscribers (`useDockLayout`),
so a toggle bar built from `allDefs()` follows without a layout change. Pair
them with `onClose` for panels that should not outlive their tab:

```ts
manager.registerPanel(
  definePanel({
    id, title, component: ReportPanel,
    onClose: () => manager.unregisterPanel(id), // a closed tab is gone for good
  }),
);
manager.openPanel(id);
```

`onClose` fires only on a REAL close — the tab ×, `closePanel`, `togglePanel`.
A layout swap (`loadLayout`, solo, kiosk) unmounts panel content too, but that
is not a close and must not delete anything; that is why the render disposer is
the wrong hook for this.

`beforeClose` runs on the same routes, BEFORE the close. Return a promise to
defer it: the panel vanishes at once (tab gone, content `display:none` but
still mounted, in place — an iframe inside keeps its page) and is detached and
disposed when the promise settles. Use it to give content a moment to flush
state; the viewer's external-app panels let the hosted page ask for exactly
this. Layout swaps still unmount immediately, and `registerPanel` replacing an
open panel skips the hook. While the wait lasts, `saveLayout` already omits the
panel.

Persistence example:

```ts
localStorage.setItem('layout', JSON.stringify(manager.saveLayout()));
// later…
manager.loadLayout(JSON.parse(saved));
```

Pure layout helpers are exported too: `allPanels`, `findNode`,
`findTabsWithPanel`, `cloneLayout`, `isEmpty`, `measureMin`,
`normalizeLayout` (use it to sanitize a persisted tree before loading).

### Behavior notes

- **Collapse** detaches (not destroys) panel content — React state and WebGL
  contexts survive; the group shrinks to a header (column) or rail (row).
- **Size lock** (tab-strip padlock) captures the group's current size as its
  minimum only — it can still grow; divider drags cascade past it.
- **Drop zones**: dragging a tab shows center (join as tab) / edge (split)
  hints; releasing over nothing dockable floats the panel.

---

## 7. Recipes

**A settings panel** — Collapsible sections of Checkbox/NumberInput/Select
rows, each control with a `shortcut` id (tooltip + combo come free from the
bindings table, §5), state in a `createStore` state/actions pair (§4).

**A confirm flow** — keep a discriminated-union UI state
(`{ step: 'idle' } | { step: 'confirming' }`), render `ConfirmDialogCore`
when confirming, handle both `onResult` branches.

**A toolbar panel** — a locked, fixed-size tabs node with `hideTabs`:

```ts
layout: split('column', [
  tabs(['ribbon'], { id: 'ribbon', hideTabs: true, locked: true, fixedSize: 108 }),
  tabs(['viewport']),
])
```

**Async select over a server** — `<Select loadOptions={q => api.search(q)} …>`;
throw inside `loadOptions` to surface the error in the dropdown.

---

## 8. Do / don't

- **Do** call `initTooltips()` and `hotkeysActions.register()` exactly once at
  boot.
- **Do** pass hotkey **ids** (not key combos) to `shortcut` props — the
  library resolves the current combo, including user overrides.
- **Do** keep `value` state outside the widgets — everything is controlled.
- **Don't** import app-level styles into library components; the library must
  stay self-contained (it ships standalone as `@tredespace/ui`).
- **Don't** mutate a saved `DockState` by hand without running it through
  `normalizeLayout` / `manager.loadLayout` (which heals invalid trees).
- **Don't** use `as` casts to force widget props — the unions (Select,
  DatePicker, TimePicker) narrow correctly when you set the discriminant
  (`multiple`, `range`) literally, and Select / RadioGroup / SegmentedControl
  are generic, so a typed option list gives you the literal union back.
- **Don't** hand-roll something the library already has. Before writing markup,
  check for: a labelled field row (`label` + `labelPosition`), an empty-list
  message (`EmptyState`), a panel's top strip (`PanelHeader`), a status chip
  (`Badge`), a key/value read-out (`PropertyList`), a right-click menu
  (`Menu`), a tree (`TreeView`), a dialog box (`DialogFrame`), a toast
  (`toast`), a copy button (`CopyButton`), or a drag gesture
  (`usePointerDrag`). A hand-rolled copy is a second visual language.
- **Don't** restyle a Button with a class string to change its size or tone —
  `size`, `variant`, `wrap` and `grow` exist so every button stays one control.
