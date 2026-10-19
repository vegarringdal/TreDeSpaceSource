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

This guide ships inside the package as `GUIDE.md`. All examples below use the
in-repo `@treDeSpaceUI/*` form — external consumers substitute
`@tredespace/ui/*`. (`lib` is the one entry whose in-repo form the
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

`styles.css` is global: besides the light remap it lifts Tailwind's three
darkest slates (`--color-slate-950/900/800`) half a step in the dark default,
and it styles every scrollbar in the document (square, theme-tinted, a
"floating" thumb) — for the whole page you import it into, not only the
library's widgets.

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
  fight: `2000`–`2020` dialogs (`DialogFrame` 2000, error 2010, loading
  2020), `2500` popovers and dropdowns (Select, color picker, field
  popovers — above the dialogs, which open them from their fields), `2600`
  toasts, `2700` InfoButton, `3000` Menu, `4000` the tooltip bubble.
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
  composing conditionally. Most widgets merge with `cn()`, so your utility
  wins over a built-in one it conflicts with; RadioGroup, InlinePanel,
  VerticalTabs, Ribbon / RibbonSection / RibbonButton and the Date/Time
  pickers only append the string, so there a conflicting utility (`bg-*`,
  `border-*`, `px-*`) is not guaranteed to win.
- **Empty = `null`.** Clearable single-value pickers (Select, DatePicker,
  TimePicker, DateTimePicker) use `null` for "nothing picked" and call
  `onChange(null)` when cleared.
- **Discriminated unions** for variants: `range: true` switches Date/Time
  pickers into range mode, `multiple: true` switches Select into multi mode —
  TypeScript narrows the `value`/`onChange` types accordingly.
- **Labelled fields.** Every field widget — `TextInput`, `TextArea`,
  `NumberInput`, `Select`, `ColorSelect`, `TimeInput`, `ImagePicker` — takes
  the same label props, so a panel never hand-rolls a
  `<label><span>…</span><field/></label>` row:
  - `label` — the caption;
  - `labelPosition: 'top' | 'left' | 'split'` (default `'top'`) — `'left'`
    gives the LABEL a fixed column (`labelWidth`, px, default 60) and lets the
    field fill, for stacked form fields that must line up; `'split'` is the
    settings-row inverse, where the label takes the free space and the FIELD
    keeps a fixed width (`fieldWidth`, px, default 112);
  - the row is `w-full`, so a labelled field placed in a flex row next to a
    button shrinks to leave room for it.

  The layout itself lives in one place (`Labelled`, exported) if you need it
  for something that is not a field widget — the Date/Time pickers take no
  label props, so wrap one in `<Labelled label="Due" labelPosition="left">`.
  `Vec3Input`, `RotationInput` and `BoxSidesInput` take only `label` +
  `labelWidth` (a fixed label column, default 48); `TemplateTextInput` takes
  only `label` (on top).
- **Generic over the value union.** `Select`, `RadioGroup`,
  `SegmentedControl` and `EasingSelect` are generic over `T extends string`.
  Type the option list (`readonly SelectOption<Mode>[]`) and `onChange` hands
  back `Mode`, not `string` — no `as` cast at the call site.

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
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';   // md = 24px, lines up with the inputs; lg = 40px touch target

type ButtonProps = {
  children?: ReactNode;
  icon?: ReactNode;                       // leading icon, locked to 14×14 (20×20 at size lg)
  onClick?: (e: ReactMouseEvent) => void; // event passed so handlers can read modifiers (Alt…)
  disabled?: boolean;
  active?: boolean;                       // highlighted / selected look — a STATE, wins over variant
  variant?: ButtonVariant;                // emphasis: confirming / destructive / borderless (default 'default')
  size?: ButtonSize;                      // default 'md'
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
  labelPosition?: 'top' | 'left' | 'split'; // default 'top' — see §2
  labelWidth?: number;      // px, for 'left' (default 60) — share across stacked fields to align
  fieldWidth?: number;      // px, for 'split' (default 112)
  disabled?: boolean;
  className?: string;
};

type TextInputProps = LabelledProps & {
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;  // fires on Enter and blur
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void; // runs first; preventDefault() skips the Enter commit
  placeholder?: string;
  type?: 'text' | 'password' | 'email' | 'url' | 'search';
  maxLength?: number;
  spellCheck?: boolean;                // default false
  autoFocus?: boolean;                 // focus + select on mount (a dialog's single field)
  tooltip?: string;
  shortcut?: string;
  clearable?: boolean;                 // in-field ✕ (default true)
  onClear?: () => void;                // override ✕ (e.g. reset-to-default); shows even when empty
};

type TextAreaProps = LabelledProps & {
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;  // fires on blur
  placeholder?: string;
  rows?: number;                       // default 3
  maxLength?: number;
  spellCheck?: boolean;                // default false
  resizable?: boolean;                 // user vertical resize (default true)
  minHeight?: number;                  // px floor, also while resizing
  tooltip?: string;
  shortcut?: string;
  clearable?: boolean;                 // in-field ✕ (default true)
  onClear?: () => void;
};
```

### NumberInput

Stepper buttons (− / +), direct typing (Enter or blur commits, Escape
reverts, ↑ / ↓ step from what you typed), the mouse wheel over the field, and
pointer-drag scrubbing (press and drag sideways, one step per 4 px; a plain
click focuses for typing). Every change is clamped to `min` / `max` and
rounded to `precision`.

```tsx
<NumberInput value={scale} onChange={setScale} min={0.1} max={10} step={0.1} unit="×" />
```

```ts
type NumberInputProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;           // per − / +, ↑ / ↓, wheel notch or 4 px of drag (default 1)
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
//         clearable? (default true), disabled?, className? + the label props from §2
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

Keyboard: Enter / Space / ↓ open the list, ↑ / ↓ move, Enter picks, Escape
closes; with `searchable` the filter box takes focus as the list opens. A
single pick closes the list; in `multiple` mode it stays open and each chip
carries its own ×. `placeholder` defaults to "Select…".

The trigger shows a × on hover that clears the selection (`onChange(null)` /
`[]`). Pass `clearable={false}` for a fixed choice that can never be empty — a
mode, an operator, a level — the × is not rendered at all, so the label gets
its column back in a narrow row.

### ColorSelect

A swatch button that opens a full picker popover (SV square, hue slider,
hex/RGB fields, a grid of quick swatches).

```tsx
<ColorSelect value={color} onChange={setColor} swatches={['#ff0000', '#00ff00']} />
```

```ts
type ColorSelectProps = {
  value: string;                       // #rrggbb; another CSS colour paints the swatch but the picker opens at black
  onChange: (color: string) => void;   // always lowercase #rrggbb
  swatches?: string[];                 // quick-pick grid (8 per row) — replaces the default/store grid
  disabled?: boolean;
  className?: string;
  tooltip?: string;
  shortcut?: string;
  flush?: boolean;                     // fill parent height exactly (ribbon slots)
  compact?: boolean;                   // swatch only, no hex text (toolbars)
  // + the shared label props (see §2)
};
```

In a toolbar, `compact` keeps the trigger to the swatch and the arrow:
`<ColorSelect compact value={c} onChange={setC} tooltip="Highlight colour" />`.

The default swatch grid is a module-level store the host app can replace with
a live one (e.g. recent colors); any `createStore` instance satisfies it
structurally:

```ts
import { createStore } from '@treDeSpaceUI/lib';
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

The three pickers take no label props — wrap one in
`<Labelled label="Due" labelPosition="left">…</Labelled>` (exported) to put it
in a form row. TimePicker and DateTimePicker call `onChange` on every pick
(the day, each hour / minute step), so the value is complete from the first
pick: the parts not picked yet come from the current value, or the current
time when it is empty.

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
  defaultOpen?: boolean;  // uncontrolled initial state (default true)
  open?: boolean;         // controlled — pair with onToggle
  onToggle?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  bodyClassName?: string; // merged over the body's default `flex flex-col gap-2 p-2`
  fill?: boolean;         // fill remaining panel height while open; the body clips — put a scroller
                          // inside (FileTree, TreeView, a min-h-0 flex-1 overflow-y-auto div)
  fillMinClass?: string;  // height floor for a fill section, e.g. "min-h-64"
};
```

Closed, a Collapsible unmounts its body (local state inside resets); an
`InlinePanel` keeps its body mounted and animates it shut.

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
  defaultOpen?: boolean;      // uncontrolled initial state (default true)
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
  label?: string;       // accessible label / hover tooltip for the trigger (default 'More info')
  className?: string;
};
```

`Tone` is the library's one semantic scale — `InfoBox` and `Badge` take it as
`tone`, and the toast methods map onto it (`toast.error` is `danger`; there is
no neutral toast) — so "warning" looks the same wherever it appears. Use
`danger` for a failure the user must act on, not a red text span.

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
  size?: ButtonSize;   // matches Button (default 'md')
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
  variant?: 'label' | 'title' | 'band';        // dim caption / panel name / tinted mode bar (default 'label')
  className?: string;
};

type EmptyStateProps = {
  children: ReactNode;
  icon?: ReactNode;                 // 'center' layout only
  layout?: 'note' | 'center';       // dim line in the flow / centred in the space left (default 'note')
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
  tooltip?: string;     // opens beside the menu, never over the entries
  shortcut?: string;    // hotkey id — the combo shows in the entry's tooltip footer, not in the row
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
on Escape. To open it from a button, anchor it under the button:
`onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAnchor({ x: r.left, y: r.bottom + 2 }); }}`.

### TreeView

The app's tree list: indent, twisty, selection and partial-selection
highlighting over a **flat list of the rows that are visible right now**.
Each row is a focusable `role="treeitem"` (not a `<button>`, so `trailing` may
hold buttons); Enter and Space click it, and a `disabled` row is plain,
unfocusable chrome. A click on a button inside `trailing` still bubbles to the
row — call `e.stopPropagation()` in its handler when it must not also select
the row. The widget draws; it never owns the model — so a lazily-loaded tree
costs nothing until it is expanded, and the caller keeps whatever data source
it has.

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
  trailing?: ReactNode;      // right-aligned node after the label — may hold buttons (stopPropagation in them)
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
  rowProps?: (row: TreeViewRow) => TreeRowExtras | undefined;  // drag-and-drop, data-* markers
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
Give it a height (`className`); the strip scrolls when its tabs don't fit.

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
  defaultValue?: string;          // uncontrolled start (default: the first tab)
  onChange?: (id: string) => void;
  side?: 'left' | 'right';        // which side the strip sits on (default 'left')
  className?: string;
};
```

Only the active tab's `content` is mounted — switching unmounts the others, so
state that must survive a tab switch lives outside them. The strip narrows to
an icon rail only when EVERY tab omits `label`.

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
  onMove?: (paths: string[], dirPath: string) => void;         // files dropped on a folder ('' = root); dragging a selected row moves the whole selection
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

Selection works like a desktop file manager: click selects one file,
Ctrl/Cmd+click toggles, Shift+click selects the range over the VISIBLE rows; a
folder row selects (Ctrl: toggles) every file under it and highlights when all
of them are selected — expansion is the chevron's job. `selected` holds FILE
paths only.

Omitting a callback hides that capability (no `onMove` → files don't drag, no
`onMoveFolder` → folders don't). The right-click menu exists only when
`onAddFolder` is given: Rename / Delete (`onRenameFolder` / `onDeleteFolder`)
are entries in that same menu, so they need `onAddFolder` too, and a
`variant: 'section'` dir offers New folder only. A target path of `''` (in
`onMove` / `onMoveFolder`) and a `null` parent (in `onAddFolder`, a right-click
outside any folder row) mean the root.

### SqlCodeEditor

A lightweight SQL editor with syntax highlighting and the usual editor keys:
**Tab / Shift+Tab** indent and outdent every line a multi-line selection
touches; with a caret or a selection inside one line, Tab inserts two spaces
(replacing that selection) and Shift+Tab removes one indent from the line.
**Enter** keeps the current line's indentation, **Ctrl/Cmd+Enter** fires
`onRun`. Edits go through the browser's insert command, so **Ctrl+Z** undoes
them like typing.

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
  role?: 'dialog' | 'alertdialog';    // default 'dialog'
  z?: number;                         // default 2000 (the dialog floor)
  bodyClassName?: string;             // replaces the default body padding + text style
                                      // (px-3 py-4 text-xs leading-relaxed); flex column + scroll stay
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
                                onResult: (ok: boolean) => void;  // true = OK, false = Cancel / Escape / backdrop / ✕
                                z?: number };                     // default 2000
type ErrorDialogCoreProps   = { title: string; message: string;
                                onDismiss: () => void;            // OK, Escape, backdrop and ✕
                                z?: number };                     // default 2010
type LoadingDialogCoreProps = { title: string; label: string;
                                progress?: number | null;         // 0..1 bar; null/undefined hides it
                                z?: number };                     // default 2020
type PromptDialogCoreProps  = { title: string; message: string; value: string; okLabel: string;
                                cancelLabel?: string;             // default 'Cancel'
                                onChange: (value: string) => void;
                                onResult: (ok: boolean) => void;  // true = OK/Enter, false = Cancel / Escape / backdrop / ✕
                                z?: number };                     // default 2000
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
type ToastOptions = { title?: string; duration?: number };  // ms, default 4000; 0 = until dismissed

const toast: {
  info(message: string, opts?: ToastOptions): string;      // returns the id
  success(message: string, opts?: ToastOptions): string;
  warning(message: string, opts?: ToastOptions): string;
  error(message: string, opts?: ToastOptions): string;     // 'danger' tone; stays until dismissed (unless opts.duration)
  dismiss(id: string): void;
  hold(id: string): void;                                   // pause one toast's countdown (the Toaster does it on hover)…
  resume(id: string, duration: number): void;               // …and restart it with the full duration
  clear(): void;
};

type ToasterProps = { z?: number; className?: string };     // default z 2600 — above the modal layer

// toastState — the createStore behind it ({ items: readonly ToastItem[] }), for a host drawing its own stack
type ToastItem = { id: string; tone: Tone; title?: string; message: string; duration: number };
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

```ts
type LinkProps = {
  href: string; children: ReactNode;
  external?: boolean;          // new tab + rel="noreferrer noopener" (default true)
  tooltip?: string; className?: string;
};
type SwatchProps = {
  color: string;               // any CSS colour, rendered as-is
  onClick?: () => void;        // omit for a static read-out (shortcut / disabled then ignored)
  active?: boolean;            // ring as the current pick
  size?: number;               // px (default 16)
  tooltip?: string; shortcut?: string; disabled?: boolean; className?: string;
};
type SpinnerProps = { size?: number /* px, default 14 */; label?: string /* a11y + hover, default "Loading" */; className?: string };
type ProgressBarProps = { value?: number | null /* 0..1; omit / null = indeterminate */; height?: number /* px, default 6 */; className?: string };
type CopyButtonProps = {
  value: string | (() => string);  // a getter runs on click
  children?: ReactNode;            // idle label (default "Copy")
  copiedLabel?: string;            // shown 1.2 s after a successful copy (default "Copied")
  size?: ButtonSize; iconOnly?: boolean; disabled?: boolean;
  tooltip?: string; shortcut?: string; className?: string;
};
type Vec3 = readonly [number, number, number];
type Vec3InputProps = {
  value: Vec3; onChange: (value: [number, number, number]) => void;
  label?: ReactNode; labelWidth?: number;         // fixed label column, px (default 48)
  step?: number;                                  // default 0.5
  min?: number; max?: number; precision?: number; // per component
  unit?: string;                                  // suffix on each field, e.g. "m"
  tooltips?: readonly [string, string, string];   // per-axis tooltips, x/y/z
  disabled?: boolean; className?: string;
};
```

### Ribbon (toolbar family)

An Office-style ribbon. `Ribbon` is the bar; `RibbonSection` is a titled group
that packs children into columns by their `size` (big = 1 per column,
medium = 2 stacked, mini = 3 stacked); `RibbonSlot` puts arbitrary content
(a Select, a ColorSelect…) into the same sizing system. The section reads
`size` off each direct child *element* (a `RibbonSlot` or `RibbonNumber`
without one packs as the `medium` it draws, anything else as `big`), so a
component of your own that wraps a `RibbonButton` must accept `size` as a prop
and be given it at the call site — a size chosen inside the wrapper is
invisible to the packer and the child lands in its own column as `big`.

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
  size?: RibbonSize;        // default 'big'
  selected?: boolean;       // on / selected look (a toggle's state)
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
  size?: RibbonSize;        // default 'medium'
  className?: string;
};
```

### TransportControls / SplitButton

Media transport — previous · play/pause/continue · next · stop — for anything
that plays (an animation, a walkthrough, a recording). The main button's label
and icon follow `status`: Play when stopped, Pause while playing, Continue when
paused or waiting. Prev, next and stop are drawn only when you pass their
callback, and Stop is disabled while `status` is `'stopped'`. Give it a
`playMenu` and the main button becomes a SplitButton whose chevron (tooltip
"Continue options") offers "continue how?" alternatives.

```tsx
import { TransportControls, type TransportStatus } from '@treDeSpaceUI/widgets';

const [status, setStatus] = useState<TransportStatus>('stopped');

<TransportControls
  status={status}
  onPlayPause={() => setStatus((s) => (s === 'playing' ? 'paused' : 'playing'))}
  onStop={() => setStatus('stopped')}
  onPrev={prevPart}
  onNext={nextPart}
  playMenu={status === 'paused' ? [{ id: 'keep', label: 'Continue — keep my view', onSelect: keepView }] : undefined}
  shortcuts={{ playPause: 'player.playPause', next: 'player.next' }}
/>
```

```ts
type TransportStatus = 'stopped' | 'playing' | 'paused' | 'waiting';

type TransportControlsProps = {
  status: TransportStatus;
  onPlayPause: () => void;
  onStop?: () => void;           // omitted → no stop button (same for prev/next); disabled while stopped
  onPrev?: () => void;
  onNext?: () => void;
  shortcuts?: { playPause?: string; stop?: string; prev?: string; next?: string };  // hotkey ids
  tooltips?: { playPause?: string; stop?: string; prev?: string; next?: string };
  playMenu?: readonly MenuEntry[];   // turns play/pause into a SplitButton
  size?: 'md' | 'lg';                // lg = 40px touch targets (kiosk / tablet)
  disabled?: boolean;                // every transport button (not children)
  children?: ReactNode;              // extra controls after the transport (speed, loop…)
  className?: string;
};

type SplitButtonProps = {
  label: ReactNode; icon?: ReactNode;
  onClick: () => void;               // the default action
  menu: readonly MenuEntry[];        // the alternatives behind the chevron
  tooltip?: string; shortcut?: string;   // the main part
  menuTooltip?: string;              // the chevron (default "More options")
  variant?: ButtonVariant; size?: ButtonSize; disabled?: boolean;   // both halves
  active?: boolean;                  // "on" look, main part only
  grow?: boolean;                    // fill a flex row
  className?: string;
};
```

SplitButton on its own is a default action plus a chevron menu sharing one
edge — use it when one choice is the usual one and the rest are rare; use a
plain `Menu` when no option is the default.

```tsx
<SplitButton
  icon={<IconDownload />}
  label="Export"
  tooltip="Export the view as a PDF"
  menuTooltip="Other formats"
  onClick={exportPdf}
  menu={[{ id: 'png', label: 'As PNG', onSelect: exportPng }]}
/>
```

### ChapterList

An ordered list of chapters — the parts of a sequence, the steps of a guide:
number (✓ once done), title, length, the current row with an accent edge and
an optional progress bar, a warning badge, and hover actions. Rows are
numbered among the rows of their `depth` through the whole list (the count
does not restart under a new parent). The `expanded` row also shows its
`subtitle` and `renderDetail`. A row's `heading` prints a small chapter title
above it (group consecutive rows under one). ↑/↓ move, Enter activates; pass
`onReorder` to allow drag-to-reorder — a row dropped on another moves before
it (any row onto any row: keep moves inside one parent yourself; nothing
drops after the last row).

```tsx
<ChapterList
  rows={parts.map((p, i) => ({
    id: p.id, depth: 0, title: p.name, duration: fmt(p.length),
    status: i < cur ? 'done' : i === cur ? 'current' : 'upcoming',
    progress: i === cur ? partProgress : null,
  }))}
  expanded={parts[cur]?.id}
  onActivate={goToPart}
  renderActions={(row) => <Button iconOnly size="sm" variant="ghost" icon={<IconPlayerPlay />}
                                  tooltip="Play from here" onClick={() => playFrom(row.id)} />}
/>
```

```ts
type ChapterListRow = {
  id: string; depth: number;          // depth indents nested chapters
  title: string; subtitle?: string; duration?: string;
  status: 'done' | 'current' | 'upcoming';
  progress?: number | null;           // 0..1, current row only
  warning?: boolean; note?: string;   // badge / small dim text before the duration ("paused")
  heading?: string;                   // a chapter title above this row (first of a group)
};

type ChapterListProps = {
  rows: readonly ChapterListRow[];
  expanded?: string | null;
  renderActions?: (row) => ReactNode;
  renderDetail?: (row) => ReactNode;
  onActivate: (id: string) => void;
  onReorder?: (id: string, to: { beforeId: string }) => void;
  emptyText?: ReactNode;
  className?: string;
};
```

### TimeInput / EasingSelect / RotationInput

Fields for motion. **TimeInput** holds seconds and shows them as seconds
(`format="seconds"`, the default — a stepper in s, `step` 0.1), frames
(`"frames"` — a stepper in whole frames at `fps`, default 30) or an `m:ss.s`
clock (`"mmss"` — a typed field that also accepts plain seconds, commits on
Enter or blur and reverts text it cannot parse; focus merely passing through
leaves the value alone). The two stepper formats scrub like NumberInput; the
clock does not. Every value is clamped to `[min, max]`, and `min` defaults to
0. **EasingSelect** picks one easing from a row of curve glyphs; it is
generic over *your* easing union and you supply the curves, so the library
carries no easing vocabulary. Give an option a `shortcut` (a hotkey id) and
its segment's tooltip shows the combo, like any button. **RotationInput**
stores a quaternion `[x, y, z, w]` and edits it as X/Y/Z Euler degrees
(`mode="euler"`, the default) or as an axis + angle (`"axisAngle"`); the
value it emits is always normalised.

```tsx
type Ease = 'linear' | 'inOut';
const EASES: readonly EasingOption<Ease>[] = [
  { value: 'linear', label: 'Linear', curve: (u) => u },
  { value: 'inOut', label: 'Ease in-out', curve: (u) => u * u * (3 - 2 * u), shortcut: 'key.easeInOut' },
];

<TimeInput label="Start" labelPosition="left" format="mmss" value={t} onChange={setT} />
<EasingSelect value={ease} options={EASES} onChange={setEase} />
<RotationInput label="Rotate" value={q} onChange={setQ} />
```

```ts
type TimeInputProps = LabelledProps & {
  value: number; onChange: (seconds: number) => void;  // clamped to [min, max]
  min?: number;                              // default 0
  max?: number;
  step?: number;                             // s per step (default 0.1); 'frames' always steps 1 frame
  format?: 'seconds' | 'mmss' | 'frames';    // default 'seconds'
  fps?: number;                              // for 'frames' (default 30)
  tooltip?: string; shortcut?: string;
};

type EasingOption<E extends string> = {
  value: E; label: string; curve: (u: number) => number;
  shortcut?: string; // hotkey id: the segment's tooltip gets a combo footer
};
type EasingSelectProps<E extends string> = {
  value: E; options: readonly EasingOption<E>[]; onChange: (value: E) => void;
  showLabels?: boolean; disabled?: boolean; className?: string;
};

type Quaternion = [number, number, number, number];
type RotationInputProps = {
  value: Quaternion; onChange: (q: Quaternion) => void;
  mode?: 'euler' | 'axisAngle';              // default 'euler'
  label?: ReactNode; labelWidth?: number;    // label column, px (default 48)
  step?: number;                             // degrees (default 5)
  disabled?: boolean; className?: string;
};
```

The conversions behind them are exported too: `parseClock(text)` (`"75"`,
`"1:15"`, `"1:15.5"` → seconds, else `null`) and `formatClock(seconds)`
(→ `"m:ss.s"`, negatives clamp to 0); `eulerToQuat([x, y, z])`,
`quatToEuler(q)` (XYZ degrees, R = Rz·Ry·Rx) and `quatToAxisAngle(q)`
(→ `{ axis, degrees }`, 0–180°, identity = +Z at 0°).

### Timeline / TimeRuler / Breadcrumbs

A multi-lane timeline editor. Rows (a label column on the left) are `group`s
or `lane`s — `kind` changes only the look (a group is a darker band); any row
can be `collapsible` and `tint`ed. Items are span bars (`span: true`, a
group's extent) or clip blocks; points are key diamonds (filled, or `hollow` —
a key that holds, say) or markers. The timeline is **pure presentation** — it
never moves anything itself. Item, edge and point drags come back with a
`phase` (`'drag'` while moving, `'end'` on release), and their `dt` is
measured from the press, not per event — so you preview `base + dt` on
`drag` and commit (one undo step) on `end`. Seek, view, range and
label-width changes stream without a phase: store each and pass it back.

- Drag clips (pressing a selected one takes every selected, movable item
  along) with snapping: an edge within 8 px of one of `snap.targets` snaps to
  it, else to a `snap.step` grid line within 8 px — the widget adds no targets
  of its own. A drop near another item (any row) proposes a **magnetic link**
  (`dropHint`: its end → `after`, its start → `with`, end on end →
  `endsWith`; the target is outlined while you drag). Alt while dragging = no
  link.
- A click selects (Shift/Ctrl/⌘ = `additive`; merging or toggling is yours);
  a click on empty lane space seeks there and clears the selection
  (Shift/Ctrl keep it); a drag there box-selects (Ctrl/Shift = additive).
- A `locked` item is dimmed and never click-selects, drags or resizes (a
  double-click, right-click or box-select still reports it); a `fixed` one
  still selects and opens but never drags or resizes — for bars whose time
  follows something else. Neither is ever a link target.
- Drag a clip block's edge to resize (`t` is the edge's new time; `shift` is
  passed through for your own meaning) — span bars have no edges; drag
  points to retime them.
- Click/drag the ruler to seek. With `onRangeChange`, Shift+drag the ruler
  reports an in/out range and Shift+click clears it — keep it and pass it
  back as `range`.
- A drag held at or past the lanes' (or the ruler's) left / right edge pans
  the view through `onViewChange` — a scrub, a range, clips, clip edges and
  keys — faster the further past (an 8 px zone inside the edge starts it);
  what is dragged rides on that edge, so its `dt` / time keep following. A
  box-select does not pan.
- Ctrl+wheel zooms at the pointer (the page itself does not zoom),
  Shift+wheel pans (over the ruler a plain wheel pans too); ←/→ move the
  playhead 0.1 s (Shift = 1 s) and pan the view to keep it in sight, +/−
  zoom about it; double-click an item or
  a row's name opens it; a right-click in the rows calls `onContextMenu` with
  what was hit and the time under the pointer.
- A `collapsible` row shows a twisty that calls `onToggleRow(id)`: flip the
  row's `collapsed` and leave its children out of `rows` — the widget hides
  nothing itself.
- `dimOutside` greys the lanes outside a window (e.g. "you are inside this
  group") and a row's `locked` dims that row — both are display only: lock
  the items to stop edits. `endMark` draws a dashed line where playback ends.
- `onLabelWidthChange` makes the name column's right edge draggable (and
  ←/→ when focused): it reports the new width (80–600 px) — keep it in your
  state and pass it back as `labelWidth`.
- Rows are virtualized: only the lanes in view (plus a few either side) are
  mounted, so thousands of rows stay cheap. Every row is `rowHeight` tall
  (+1 px rule) — there are no per-row heights.

```tsx
const [view, setView] = useState<TimelineView>({ pxPerSec: 50, offset: 0 });
const [range, setRange] = useState<{ from: number; to: number } | null>(null);

<Timeline
  rows={visibleRows} items={items} points={keys}     // a collapsed row's children left out
  playhead={t} duration={total} view={view} endMark={end} range={range}
  snap={{ enabled: snapOn, step: 0.5, targets: keyTimes }}
  labelWidth={labelWidth} onLabelWidthChange={setLabelWidth}
  onViewChange={setView}
  onSeek={seek}
  onRangeChange={setRange}
  onToggleRow={toggleCollapsed}
  onItemsMove={(ids, dt, hint, phase) => (phase === 'end' ? commitMove(ids, dt, hint) : previewMove(ids, dt))}
  onItemResize={(id, edge, t, shift, phase) => resizeClip(id, edge, t, phase)}
  onPointsMove={(ids, dt, phase) => retimeKeys(ids, dt, phase)}
  onSelect={(sel, additive) => select(sel, additive)}
  onOpen={(target) => open(target)}
  onContextMenu={(target, at) => openMenu(target, at)}
/>
```

```ts
type TimelineProps = {
  rows: readonly TimelineRow[]; items: readonly TimelineItem[]; points: readonly TimelinePoint[];
  playhead: number; duration: number;              // s; the ruler dims past `duration`
  view: TimelineView; onViewChange: (view: TimelineView) => void;
  onSeek: (t: number) => void;
  onItemsMove: (ids: readonly string[], dt: number, dropHint: DropHint | null, phase: 'drag' | 'end') => void;
  onItemResize: (id: string, edge: 'start' | 'end', t: number, shift: boolean, phase: 'drag' | 'end') => void;
  onPointsMove: (ids: readonly string[], dt: number, phase: 'drag' | 'end') => void;
  onSelect: (sel: { items: string[]; points: string[] }, additive: boolean) => void;
  onOpen: (target: { kind: 'item' | 'row'; id: string }) => void;
  onContextMenu: (target: { kind: 'item' | 'row' | 'point' | 'empty'; id?: string; t: number },
                  at: { x: number; y: number }) => void;   // at = viewport px (a Menu anchor)
  onToggleRow?: (id: string) => void;              // a twisty was clicked
  range?: { from: number; to: number } | null;     // drawn on the ruler
  onRangeChange?: (range: { from: number; to: number } | null) => void;  // Shift+drag / Shift+click the ruler
  dimOutside?: { from: number; to: number } | null;
  endMark?: number | null;
  snap?: TimelineSnap;                             // absent = no snapping
  labelWidth?: number;                             // px, default 150
  onLabelWidthChange?: (px: number) => void;       // given → the name column's edge drags (80–600)
  rowHeight?: number;                              // px, default 22
  format?: (t: number) => string;                  // ruler + tooltips, default defaultTimeFormat
  className?: string;
};
type TimelineView = { pxPerSec: number; offset: number };    // offset = seconds at the left edge
type TimelineRow  = { id; kind: 'group' | 'lane'; depth; label: ReactNode;
                      collapsed?; collapsible?; tint?; locked? };
type TimelineItem = { id; row; start; end; label; tint?; selected?; hatched?; icon?;
                      span?: boolean; linkFrom?: { id: string; kind: string }; locked?; fixed?;
                      minWidth?: number };   // px drawn at least (instant clips stay clickable)
type TimelinePoint = { id; row; t; shape: 'diamond' | 'marker'; selected?; label?;
                       hollow?: boolean };   // an outlined diamond
type DropHint = { kind: 'after' | 'with' | 'endsWith'; target: string };
type TimelineSnap = { enabled: boolean; step: number; targets: readonly number[] };
```

`zoomTimelineView(view, factor, anchorX)` is the zoom the wheel and the +/−
keys use — call it from toolbar +/− buttons so they zoom the same way. The
time at `anchorX` (px from the lanes' left edge) stays put: `0` zooms about
the left edge, `(playhead - view.offset) * view.pxPerSec` about the playhead;
`pxPerSec` stays within 4–2000 and `offset` ≥ 0. **TimeRuler** is the ruler
alone (`view`, `duration`, `playhead`, `onSeek`, `onViewChange`, optional
`range`/`onRangeChange`, `format`) for a scrubber that is not a full editor —
a plain wheel pans it, Ctrl+wheel zooms, a scrub held at an edge pans;
`defaultTimeFormat` is its label format. **Breadcrumbs** (`items: {id, label}[]`, `onSelect`) shows a
drill-down path — the last crumb is the current place, earlier ones are
buttons back.

### CardFlow

A flow of cards — a storyboard. Cards run left to right and wrap; between two
consecutive cards a chip names how they connect (`connectors[].label`, e.g.
"then" / "together" / "+1.5s"; `branch: true` — runs together with `from` —
draws it as a dashed chip; a pair with no connector reads "then"). You render
the cards; CardFlow owns the layout and the gestures: click selects,
double-click or Enter opens, drag a card to reorder, drop it on another card's
lower edge (`onDropOnto`, the bottom 30 %) to attach it, `+` between cards or
the trailing `+` inserts, a chip click hands you the click's viewport position
for your own link popover. `onReorder(id, toIndex)` means "before the card at
`toIndex`" in the list as it is now, the dragged card included (the trailing
`+` gives `cards.length`) — so a card moving right lands at `toIndex - 1`
once you remove it:

```ts
const move = (id: string, toIndex: number) =>
  setParts((ps) => {
    const from = ps.findIndex((p) => p.id === id);
    const rest = ps.filter((p) => p.id !== id);
    const at = from < toIndex ? toIndex - 1 : toIndex;
    return [...rest.slice(0, at), ps[from], ...rest.slice(at)];
  });
```

```tsx
<CardFlow
  cards={parts}
  getId={(p) => p.id}
  renderCard={(p, { selected, dragging }) => <PartCard part={p} selected={selected} faded={dragging} />}
  connectors={links}
  selected={current}
  onSelect={select}
  onOpen={focus}
  onReorder={move}
  onInsert={(index) => insertPart(index)}
  onDropOnto={(id, target) => joinPart(id, target)}
  onConnectorClick={(from, to, at) => openLinkMenu(from, to, at)}
/>
```

```ts
type CardFlowConnector = { from: string; to: string; label: string; branch?: boolean };
type CardFlowProps<T> = {
  cards: readonly T[]; getId: (card: T) => string;
  renderCard: (card: T, state: { selected: boolean; dragging: boolean }) => ReactNode;
  connectors: readonly CardFlowConnector[];
  selected: string | null;
  onSelect; onOpen; onReorder: (id, toIndex) => void; onInsert: (index) => void;
  onDropOnto?: (id, target, zone: 'bottom') => void;
  onConnectorClick?: (from, to, at: { x: number; y: number }) => void;
  className?: string;
};
```

### BoxSidesInput / BorderInput / IconSelect / ImagePicker

Style fields for a visual editor.

- **BoxSidesInput** — four sides `[top, right, bottom, left]` (CSS order) as
  one linked value or four; the link toggles.
- **BorderInput** — `null` = no border, else `{ width, color, style: 'solid' | 'dashed' }`;
  ticking its checkbox starts from 1 px solid `#94a3b8`, width runs 0–40 px.
  A colour that is not a hex (a theme token `$accent`, a `{{value}}`) shows as
  text; give the user your own field to change it.
- **IconSelect** — one icon from a fixed set you pass (`{ name, label?, node }`);
  the value is the name, so documents store a string, not a component.
- **ImagePicker** — picks an image from disk into a **data: URI** (never a URL,
  so the value stays self-contained and safe to serialise), refusing files over
  `maxBytes`; shows a thumbnail and a clear button.

```tsx
<BoxSidesInput label="Padding" value={pad} onChange={setPad} min={0} unit="px" />
<BorderInput value={border} onChange={setBorder} />
<IconSelect value={icon} icons={ICONS} onChange={setIcon} />
<ImagePicker label="Logo" value={logo} maxBytes={1 << 20} onChange={setLogo} />
```

```ts
type BoxSides = [number, number, number, number];
type BoxSidesInputProps = { value: BoxSides; onChange; label?; labelWidth? /* 48 */; min? /* 0 */; max? /* 400 */;
                            step? /* 1 */; unit? /* 'px' */; disabled?; className? };
type BorderValue = { width: number; color: string; style: 'solid' | 'dashed' };
type BorderInputProps = { value: BorderValue | null; onChange; label? /* checkbox caption, default 'Border' */;
                          disabled?; className? };
type IconSelectProps = { value: string; icons: readonly { name: string; label?: string; node: ReactNode }[]; onChange; disabled?; className? };
type ImagePickerProps = LabelledProps & { value: string | null; onChange: (dataUri: string | null) => void;
                                          maxBytes: number; accept?: string; tooltip?: string };
```

### TemplateTextInput / ParamListEditor

Template authoring. **TemplateTextInput** is a text field (one line, or
`multiline`) where `{{key}}` placeholders are highlighted — keys in
`placeholders` blue, unknown keys red — with a `{}` menu that inserts a
placeholder at the caret (replacing any selection). **ParamListEditor** edits
an ordered list of named, typed parameters (key, label, type): rename, retype,
reorder, remove, add. Keys stay unique — a clashing key gets a number
appended — and typed keys are cleaned (anything but letters, digits and `_`
becomes `_`). It is generic over your parameter shape; `make(type, key)`
builds a new one (and is called on retype, which keeps the label). **Add
parameter** uses the first entry of `types`, and is off while `types` is
empty.

```tsx
<TemplateTextInput
  label="Title"
  value={text}
  placeholders={[...params.map((p) => ({ key: p.key, label: p.label })), { key: 'part.index', label: 'Part number' }]}
  onChange={setText}
/>
<ParamListEditor value={params} types={TYPES} make={(type, key) => ({ key, label: key, type })} onChange={setParams} />
```

```ts
type TemplateTextInputProps = {
  value: string; onChange: (value: string) => void;
  placeholders: readonly { key: string; label: string }[];
  multiline?: boolean; label?: ReactNode; placeholder?: string; disabled?: boolean; className?: string;
};
type ParamLike = { key: string; label: string; type: string };
type ParamListEditorProps<P extends ParamLike> = {
  value: readonly P[]; onChange: (value: P[]) => void;
  types: readonly { value: P['type']; label: string }[];
  make: (type: P['type'], key: string) => P;
  disabled?: boolean; className?: string;
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
  `data-tooltip`, the hotkey's `description` is used as the tooltip body; an
  id with no binding and no `data-tooltip` shows nothing.
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
const open = ui.useSelect((s) => s.sidebarOpen);     // …re-render only when this value changes
const unsub = ui.subscribe(() => { /* plain DOM / three.js / timers */ });
```

`set` is a shallow merge and no-ops when nothing actually changed (reference
equality per key). `use()` re-renders on every change of the store;
`useSelect(selector)` only when the selected value changes (`Object.is`) —
use it for a store that changes often (a playhead time) when the component
needs one field. The selector must return a primitive or a reference that
stays the same while its inputs do (never a freshly built object / array). `Store<T>` is the exported handle type for code
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

`TreeView` and `Timeline` use this internally — reach for `useVirtualRows`
directly only for a list that is neither (a log, a grid body).

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
  onStart?: (d: PointerDragDelta) => void;   // fires once past `threshold` — never with the default 0
  onEnd?: (moved: boolean) => void;          // moved=false → it was a click (needs a threshold > 0)
  threshold?: number;                        // px before it counts as a drag (default 0)
};

type PointerDrag = { start: (e: ReactPointerEvent<HTMLElement>) => void; isDragging: () => boolean };
```

With a `threshold`, `onEnd(false)` tells you the press never moved — that is
how NumberInput distinguishes a scrub from a click that should focus the field.

### `useElementWidth(ref)`

The live content width of an element (a ResizeObserver; 0 before mount). Use it
for widgets that lay out in pixels — TimeRuler (also the Timeline's ruler)
computes its visible ticks from it.

```tsx
const ref = useRef<HTMLDivElement>(null);
const width = useElementWidth(ref);
<div ref={ref}>{width > 0 && <Chart width={width} />}</div>
```

### `useWheel(ref, onWheel)`

A wheel listener that may call `preventDefault()`. React's `onWheel` is
passive, so it can neither stop the panel scrolling under a field that steps
on the wheel nor stop Ctrl+wheel from zooming the whole page — NumberInput,
Timeline and TimeRuler use this instead. The handler is read fresh on every
event; the element must mount with the component (the ref is read once).

```tsx
const ref = useRef<HTMLDivElement>(null);
useWheel(ref, (e) => {
  if (e.ctrlKey) {
    e.preventDefault();               // this zoom, not the page's
    zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2);
  }
});
<div ref={ref}>…</div>
```

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
A+B        together, same instant (no spaces)           "CTRL+Z", "E+R"
A B / A,B  then (release, press next)                   "G X"
[X], [A+B] hold a key/group across the rest of the seq  "[F1] 2"
AA / 101   runs expand to taps (A A, 1 0 1)             "ALT 101"
ALT, A+B   modifier-only step: tap and release just      "ALT 101", "ALT+SHIFT 2"
           those modifiers (a leader)
PLUS       the =/+ key (code Equal; COMMA: the comma key)
```

Modifiers: `CTRL`, `ALT`, `SHIFT`, `META`/`CMD`. Named keys: `ESC`, `ENTER`,
`SPACE`, `TAB`, `UP/DOWN/LEFT/RIGHT`, `PAGEUP/PAGEDOWN`, `HOME`, `END`,
`DELETE`, `BACKSPACE`, `PLUS`, `COMMA`, `F1`–`F12`. `formatSequence` writes
steps separated by a space; `parseSequence` also accepts commas, and rejects
spaces around `+` (`CTRL + Z`) so the old notation — `&` together,
` + ` then — fails loudly instead of being misread. A shorter binding may be
a prefix of a longer one (`F` alongside `F F`) — the short one fires on
timeout. Exported keymap files are `version: 2`; older files are rejected.
Keys match by physical position (`KeyboardEvent.code`, named after the US
layout): `Z` is the key in the US Z spot and `PLUS` the `Equal` key, whatever
glyph the user's layout prints on them.

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
    defaultKeys: 'CTRL+Z',
    run: () => undo(),
    // allowInInput?: boolean       — fire even inside text fields (default: true for
    //                                 a pure F-key combo, else false — see "Text fields")
    // timeout?: number             — ms between sequence steps (default 1500)
    // context?: () => boolean      — extra guard, checked at every key step; while false the
    //                                 binding is out of the match and its keys pass through (two
    //                                 defs still may not share keys — validateBindings flags it)
    // trigger?: 'press' | 'tap'    — 'tap' fires on key-UP, only if nothing else happened
    //                                 while held (see below)
    // tapMaxMs?: number            — 'tap': held longer than this = a hold (default 1000)
  },
];

hotkeysActions.register(defs);     // once at boot; also starts the engine
```

**Tap bindings.** `trigger: 'tap'` lets one key mean two things: Space *held*
(with a mouse drag) is a camera modifier, Space *tapped* is play/pause. The
keydown is not claimed — other listeners still see the key go down — and the
binding fires on a clean key-up: no pointer press, wheel or other key while it
was held, held no longer than `tapMaxMs`, and focus not in a text field. Only
single-combo bindings can be taps — a multi-step `trigger: 'tap'` binding
never fires.

### One definition drives the whole UI

A `HotkeyDef` is the **single source of truth** for a shortcut. Define it once
in a central bindings table; everything else only references the `id`:

| Consumer | What it reads from the def |
| --- | --- |
| Key engine | `defaultKeys` (or the user's override) + `run`, `context`, `timeout`, `allowInInput`, `trigger`, `tapMaxMs` |
| Tooltips | any control with `shortcut="<id>"` gets a footer showing the **current** combo; when the control has no `tooltip` of its own, the def's `description` becomes the tooltip body |
| Settings / hotkeys panel | `category` groups the defs (one collapsible section per category, in registration order), `label` + `description` are the display text, `isCustom(id)` drives the Reset button |
| Announcements | `label` + the formatted combo, via `setHotkeyAnnouncer` (fired) and `setHotkeyMutedNotifier` (pressed inside a text field, where it is muted) |

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

### Text fields

Inside any focused `<input>` (checkboxes and sliders included), `<textarea>`
or contentEditable element a shortcut is **muted** unless it is
`allowInInput` — the keys type as usual. Two rules keep
that from being a dead end:

- **F-key combos are never muted.** `allowInInput` defaults to `true` when the
  live combo is all `F1`–`F12` (any modifiers): pressing it types nothing, so
  the field has no claim on it. The default follows the *effective* combo — a
  binding rebound to letters is muted in fields again, one rebound onto F-keys
  is not. An explicit `allowInInput` on the def, or the user's override, wins.
  This default is the registry's: a page-local `HotkeyEngine` lets a binding
  fire in a field only when its `Registered` entry sets `allowInInput: true`.
- **A muted press is reported, not swallowed.** The engine keeps matching the
  muted bindings as a shadow (never claiming the key), and when a full sequence
  completes it calls the host's `setHotkeyMutedNotifier` hook with
  `{ id, label, keys }` — show a toast saying why nothing happened. Only
  sequences carrying Ctrl, Alt or Meta are reported: bare letters and digits,
  Shift chords and the editing keys (Tab, Escape, PageUp…) are what typing
  looks like, so a muted hit on those stays silent. A page-local
  `HotkeyEngine` gets the same through `engine.setMutedListener(fn)`.

### The actions API

```ts
hotkeysActions.register(defs)             // the WHOLE table; a second call replaces it (ids not in it are gone)
hotkeysActions.setStorageKey(key)         // move the localStorage overrides (see "Storage key")
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
hotkeysActions.importJson(text)           // → { applied, skipped, conflicts }; THROWS on invalid JSON or a non-v2 file
hotkeysActions.list()                     // HotkeyInfo[]: every def as plain data + its LIVE combo (`keys`), registration order
hotkeysActions.run(id)                    // fire an action by id (honours `context`) → 'ran' | 'blocked' | 'unknown'
```

`list()` / `run(id)` are how the table reaches things outside React — a
command palette, a host API. `run` is fire-and-forget (a def's `run` returns
nothing), and once ids are exposed that way they are a public contract: rename
one and every caller breaks.

`hotkeysState` is the underlying `createStore` — `hotkeysState.use()` in a
settings panel re-renders on any registry change (`defs`, `order`,
`overrides`).

### Engine / helper functions

```ts
parseSequence('CTRL+Z')       // display grammar → canonical Sequence (throws HotkeyParseError)
formatSequence(seq)           // Sequence → display string ("ALT+F1 101")
formatCombo(combo)            // one step → display
isValidKeys(str)              // does it parse?
validateBindings(defs)        // boot/test check: parse+round-trip+exact-duplicate report
recordSequence({ idleMs? })   // capture keys for a "Record" button (idleMs default 900):
                              //   resolves on idle-pause or Enter, rejects on Escape;
                              //   suspends the live engine while recording
suspendHotkeys() / resumeHotkeys() // manual engine suspension (nested-safe)
isFunctionKeySequence(seq)    // every step F1–F12 (any modifiers) — the allowInInput default
hasCommandModifier(seq)       // some step carries Ctrl/Alt/Meta — what a muted press must have to be reported
setHotkeyAnnouncer(fn | null) // host hook: gets "⌨ label · combo" whenever a shortcut fires
setHotkeyMutedNotifier(fn | null) // host hook: gets { id, label, keys } for a shortcut pressed
                              //   inside a text field where it is muted (see "Text fields")

const engine = new HotkeyEngine(); // a page-local matcher, independent of the registry
engine.setBindings(list)      // Registered[]: { id, sequence, run, timeout?, allowInInput?, context?, trigger?, tapMaxMs? }
engine.setProgressListener(fn)// the steps matched so far (a "G …" indicator)
engine.setMutedListener(fn)   // see "Text fields"
engine.start(); engine.stop()
DEFAULT_TIMEOUT (1500), DEFAULT_TAP_MAX_MS (1000), KEYMAP_VERSION (2)
// types: HotkeyDef, HotkeyInfo (list()), MutedHotkey (the muted notifier's arg), Registered, Sequence, Combo
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
- Tabs-node only: `hideTabs` (single-panel toolbars — no strip, so no chevron
  or padlock), `collapsed`, `collapsible` (default true, but a `locked` node
  collapses only with an explicit `collapsible: true`; `false` also hides the
  size-lock padlock), `activePanel` (default: the first panel), and
  `sizeLocked` + `lockedSize` — the padlock: `sizeLocked` alone only shows it
  ON; the minimum comes from `lockedSize`, which clicking the padlock /
  `toggleSizeLock` captures, so declare both for a floor from the start.

### Panel definitions

```ts
type PanelDefinition = {
  id: string;
  title: string;
  minWidth?: number;            // content minimum, px (default 120); useMinSize/setMinSize replace it at runtime
  minHeight?: number;           // excludes the tab strip (default 60)
  closable?: boolean;           // default true
  floatable?: boolean;          // default true
  dockableIn?: string | string[]; // pin to node id(s) — no floating/splitting elsewhere
  home?: string;                // soft default node to reopen into (does NOT pin)
  tabMinWidth?: number;         // align a strip of tabs (replaces the dock's tabMinWidth)
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
useMinSize(w?, h?)     // how small the content may be squeezed — replaces the def's minWidth/minHeight (an omitted axis keeps it)
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
lifetime) or `new DockManager(options)` outside React — then call
`manager.mount(containerEl)` / `manager.unmount()` yourself (`DockView` does
that for you). The manager adopts `options.layout` and mutates it in place
(drags write sizes into it), so build the tree inside the factory rather than
sharing one module-level object; `resetLayout()` uses a copy taken at
construction.

```ts
type DockManagerOptions = {
  panels: PanelDefinition[];
  layout: LayoutNode;
  windows?: FloatingWindow[];
  headerHeight?: number;      // ONE tab ROW, px, default 22 — a strip whose tabs
                              // wrap keeps every row this tall, and the taller
                              // strip is folded into the group's minimum size
  tabMinWidth?: number;       // every tab; a panel's own tabMinWidth replaces it
  splitterSize?: number;      // default 6; hit area widens on touch
  windowBarHeight?: number;   // default 26
  defaultWindowSize?: Size;   // window from dragging a tab out; default 340×260
};
```

Commonly used methods:

```ts
// open/close
manager.openPanel(id, targetNodeId?)   // open — or focus, when already open. Lands in targetNodeId, else its
                                       // last location, else `home`, else a `dockableIn` node, else the first
                                       // unlocked tabs node ('left'/'right'/'bottom' are recreated if pruned)
manager.openPanelBeside(id, siblingId, zone, { force? }) // split it off the node panel siblingId lives in
                                       // (zone 'left'|'right'|'top'|'bottom'); a remembered spot wins unless force
manager.openPanelBelow(id, siblingId)  // = openPanelBeside(id, siblingId, 'bottom')
manager.closePanel(id, { silent? })    // silent: skip beforeClose / onClose (what unregisterPanel and solo use)
manager.togglePanel(id)
manager.remountPanel(id)               // re-run render() in the same host (restart a panel's
                                       // contents in place — layout/tab/window state untouched)
manager.openPanels(); manager.closedPanels(); manager.isOpen(id)
manager.allDefs(); manager.getPanel(id); manager.title(id) // every definition / one / its live tab title
manager.focusPanel(id)                 // activate its tab, expand its group if collapsed, raise its window

// floating windows
manager.floatPanel(id, rect?)          // → FloatingWindow | null
manager.dockWindow(windowId, targetNodeId?)
manager.closeWindow(windowId)          // closes every panel in it (real closes — onClose fires)
manager.minimizeWindow(windowId, minimized?)
manager.isFloating(id)

// layout state
manager.saveLayout()                   // → DockState (plain JSON: { root, windows })
manager.loadLayout(stateOrRoot)        // restore (accepts DockState or bare LayoutNode)
manager.resetLayout()                  // back to the constructor layout
manager.subscribe(cb)                  // any change; → unsubscriber

// node-level controls
manager.toggleCollapse(nodeId); manager.setCollapsed(nodeId, c); manager.isCollapsed(nodeId)
manager.toggleSizeLock(nodeId)         // padlock: capture current size as the node's minimum (again: unlock)
manager.toggleSolo(); manager.isSolo() // hide every unlocked panel outside the biggest group / restore —
                                       // a layout swap: no beforeClose / onClose
manager.nodeOf(panelId)                // containing tabs-node id, or null
manager.registerPanel(def)             // add a panel definition at runtime, or replace one (an OPEN
                                       // panel keeps its mounted content until remountPanel(id))
manager.unregisterPanel(id)            // forget one (closes it first, silently)
manager.dragPanelFrom(e.nativeEvent, panelId) // start a dock-drag from your own onPointerDown (a NATIVE
                                       // PointerEvent — e.g. dragging a button out of a ribbon) …
manager.consumeDragClick()             // … and in that button's onClick: true (once) when the press
                                       // was a real drag — skip the click then
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

`onClose` fires only on a REAL close — the tab ×, `closePanel`, `togglePanel`,
`ctx.close()`, a floating window's × (`closeWindow`). A layout swap
(`loadLayout`, `resetLayout`, solo) unmounts panel content too, but that is not
a close and must not delete anything; that is why the render disposer is the
wrong hook for this.

`beforeClose` runs on the same routes, BEFORE the close. Return a promise to
defer it: the panel vanishes at once (tab gone, content `display:none` but
still mounted, in place — an iframe inside keeps its page) and is detached and
disposed when the promise settles. Use it to give content a moment to flush
state; the viewer's external-app panels let the hosted page ask for exactly
this. Layout swaps still unmount immediately, and `unregisterPanel` (which
closes an open panel silently) skips both hooks. While the wait lasts,
`saveLayout` already omits the panel.

Persistence example:

```ts
localStorage.setItem('layout', JSON.stringify(manager.saveLayout()));
// later…
manager.loadLayout(JSON.parse(saved));
```

A saved layout that names a panel the app no longer defines loads without it
(its tab goes; a floating window left empty closes), so removing a panel never
breaks a stored layout. `loadLayout` also puts back locked furniture (a toolbar
strip) that the saved tree lost, using the constructor layout as the template,
and normalizes the tree — a persisted state needs no pre-processing.

Pure layout helpers are exported too: `allPanels`, `findNode`,
`findTabsWithPanel`, `cloneLayout`, `isEmpty`, `measureMin`, and
`normalizeLayout` — structural flattening only (hoists single-child splits,
merges same-axis nested splits, replaces non-positive weights with 1); it
mutates its argument, so pass it a `cloneLayout` copy if you keep the original.

### Behavior notes

- **Collapse** detaches (not destroys) panel content — React state and WebGL
  contexts survive; the group shrinks to a header (column) or rail (row).
- **Size lock** (tab-strip padlock) captures the group's current size as its
  minimum only — it can still grow; divider drags cascade past it.
- **Drop targets**: dragging a tab shows a compass over the panel under the
  pointer — its centre joins that panel's tabs, the inner arrows split that
  panel, the outer ring docks beside the top-level column/row holding it (or
  at the dock edge); away from any panel the compass docks against the whole
  dock area. Dropping on a tab strip inserts at that position. Releasing
  anywhere else — a panel body included — floats the panel; Escape cancels.
  Double-click a tab to float it, a window's title bar to dock it back.

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
- **Don't** mutate a saved `DockState` by hand and feed it to the manager
  directly — go through `manager.loadLayout` (which drops unknown panels,
  restores locked furniture and normalizes the tree).
- **Don't** use `as` casts to force widget props — the unions (Select,
  DatePicker, TimePicker) narrow correctly when you set the discriminant
  (`multiple`, `range`) literally, and Select / RadioGroup / SegmentedControl /
  EasingSelect are generic, so a typed option list gives you the literal union
  back.
- **Don't** hand-roll something the library already has. Before writing markup,
  check for: a labelled field row (`label` + `labelPosition`), an empty-list
  message (`EmptyState`), a panel's top strip (`PanelHeader`), a status chip
  (`Badge`), a key/value read-out (`PropertyList`), a right-click menu
  (`Menu`), a tree (`TreeView`), a dialog box (`DialogFrame`), a toast
  (`toast`), a copy button (`CopyButton`), or a drag gesture
  (`usePointerDrag`). A hand-rolled copy is a second visual language.
- **Don't** restyle a Button with a class string to change its size or tone —
  `size`, `variant`, `wrap` and `grow` exist so every button stays one control.
