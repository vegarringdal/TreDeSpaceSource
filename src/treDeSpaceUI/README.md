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
- **`className`** merges extra Tailwind utilities onto the root element. Use
  `cn()` when composing conditionally.
- **Empty = `null`.** Clearable single-value pickers (Select, DatePicker,
  TimePicker, DateTimePicker) use `null` for "nothing picked" and call
  `onChange(null)` when cleared.
- **Discriminated unions** for variants: `range: true` switches Date/Time
  pickers into range mode, `multiple: true` switches Select into multi mode —
  TypeScript narrows the `value`/`onChange` types accordingly.
- **Labelled fields.** `TextInput`/`TextArea` accept `label`,
  `labelPosition: 'top' | 'left'` and `labelWidth` (px, only for `'left'`;
  share one value across stacked fields so they align).

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
type ButtonProps = {
  children?: ReactNode;
  icon?: ReactNode;                       // leading icon, locked to 14×14
  onClick?: (e: ReactMouseEvent) => void; // event passed so handlers can read modifiers (Alt…)
  disabled?: boolean;
  active?: boolean;                       // highlighted / selected look
  readOnly?: boolean;                     // static display chip — no hover, not focusable
  iconOnly?: boolean;                     // square icon-only button (e.g. a reset ✕)
  title?: string;
  tooltip?: string;
  shortcut?: string;
  className?: string;
};
```

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
  disabled?: boolean;
  tooltip?: string;
  shortcut?: string;
  className?: string;
};
```

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
type RadioOption = { value: string; label: string; hint?: string; info?: ReactNode; shortcut?: string };
type RadioGroupProps = {
  value: string;
  options: RadioOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
};
```

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
  decShortcut?: string;    // hotkey ids for the − / + steppers
  incShortcut?: string;
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
type SelectOption = { value: string; label: string; hint?: string; disabled?: boolean };

// shared: options?, placeholder?, searchable?, loadOptions?, disabled?, className?
type SingleSelectProps = { multiple?: false; value: string | null; onChange: (value: string | null) => void; /* +shared */ };
type MultiSelectProps  = { multiple: true;  value: string[];      onChange: (value: string[]) => void;      /* +shared */ };
type SelectProps = SingleSelectProps | MultiSelectProps;
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
  flush?: boolean;                     // fill parent height exactly (ribbon slots)
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
<Collapsible title="Rendering" aside="12 options" defaultOpen>
  <Checkbox checked={taa} onChange={setTaa} label="TAA" />
</Collapsible>
```

```ts
type CollapsibleProps = {
  title: ReactNode;
  aside?: ReactNode;      // right-aligned note in the header (count, badge…)
  info?: ReactNode;       // explanation behind an info icon in the header
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  fill?: boolean;         // fill remaining panel height while open; the BODY scrolls
  fillMinClass?: string;  // height floor for a fill section, e.g. "min-h-64"
};
```

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

### InfoBox / InfoButton

`InfoBox` is an always-visible informational callout (`children`,
`className?`). `InfoButton` is its compact replacement: an ⓘ icon that shows
the explanation in a popover.

```ts
type InfoButtonProps = {
  children: ReactNode;  // the explanation shown in the popover
  label?: string;       // accessible label / hover tooltip for the trigger
  className?: string;
};
```

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

### Modal, TitleBar and the dialog cores

`Modal` is the raw overlay: a centered dialog above a dimmed backdrop at
z-index `z` (stack multiple dialogs by increasing `z`). `TitleBar` is the
standard header row. The `*DialogCore` widgets are complete, presentation-only
dialog bodies — you own the open/close state:

```tsx
{confirming && (
  <ConfirmDialogCore
    title="Delete model" message="This cannot be undone." okLabel="Delete" cancelLabel="Cancel"
    onResult={(ok) => { setConfirming(false); if (ok) { doDelete(); } }}
  />
)}
```

```ts
type ModalProps = { z: number; children: ReactNode; onKeyDown?: (e: React.KeyboardEvent) => void };
type TitleBarProps = { icon: ReactNode; children: ReactNode };

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
usePanelTitle(title)   // rename the tab from inside
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
reused later starts clean. Pair them with `onClose` for panels that should not
outlive their tab:

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
  (`multiple`, `range`) literally.
