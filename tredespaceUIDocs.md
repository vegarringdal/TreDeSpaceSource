# TreDeSpace UI — complete usage guide

**Package:** `@tredespace/ui` (MIT) — React 19 component library: widgets,
dialogs, attribute tooltips, a hotkey registry, and a dockable panel shell.

This file is the whole contract. It is written to be handed to an AI assistant
(or a developer) at the start of a new project so the library is used correctly
from the first file — setup, every widget, every variant, and a light/dark
theme that is complete rather than half-mapped.

- Live gallery with runnable demos: `/docs/widgets.html` on any TreDeSpace deployment.
- In-repo source: `src/treDeSpaceUI/`.

---

## 0. Agent contract — read before writing any UI code

If you are an AI working from this file, these are hard rules. They are not
style preferences; breaking them produces a UI that looks wrong, breaks in
light mode, or silently loses functionality.

1. **Never hand-roll a control this library already has.** Before writing any
   `<div>`/`<button>` markup, check §6 (the variant cheat-sheet). A hand-rolled
   copy is a second visual language.
2. **Never write a raw hex colour, `rgb()`, or an off-palette Tailwind class**
   (`bg-zinc-800`, `text-gray-500`, `#1e1e1e`) in a component. Only the 36
   tokens in §3.3 exist. Anything else will not flip with the theme.
3. **Never restyle a widget with `className` to change its size or tone.** Use
   `size`, `variant`, `tone`, `grow`, `wrap`. `className` is for layout only
   (`flex-1`, `min-w-0`, `mt-2`).
4. **Everything is controlled.** Every input takes `value` + `onChange`. The
   widget never owns the value.
5. **Never hard-code a key combo in UI text.** Pass a hotkey *id* to
   `shortcut`; the library renders the live combo, including user rebinds.
6. **Never use `as` casts on widget props.** The unions narrow when you set the
   discriminant literally (`multiple`, `range`), and `Select`/`RadioGroup`/
   `SegmentedControl` are generic over `T extends string`.
7. **Components never call `store.set()`** — they call actions (§7).
8. **Call `initTooltips()` and `hotkeysActions.register()` exactly once**, at boot.
9. **Import only from the four entry points** (§1). Never deep-import internals.
10. **Apply §3.4 verbatim in every new project.** The stock light theme leaves
    18 tokens unmapped; without that block, badges, toasts and danger buttons
    are low-contrast in light mode.

Definition of done for any UI task: it renders correctly in **both** themes,
every interactive control has a `tooltip`, and any control worth a keyboard
user's time has a `shortcut` id.

---

## 1. What you get

| Entry point | Contents |
| --- | --- |
| `@tredespace/ui/widgets` | ~40 widgets, dialogs, toasts, tooltips, file pickers |
| `@tredespace/ui/dockable` | `DockManager`, `DockView`, layout builders, panel hooks |
| `@tredespace/ui/hotkeys` | key engine, registry store, overrides, keymap import/export |
| `@tredespace/ui/lib` | `createStore`, `cn`, `useVirtualRows`, `usePointerDrag` |
| `@tredespace/ui/styles.css` | theme palette + scrollbar skin (import once) |

Ships compiled ESM + `.d.ts`. A bundler (Vite, webpack, Parcel…) is required —
internal imports are extensionless and CSS is imported from JS.

**Peer dependencies:** `react` and `react-dom` ≥ 19.
**Build requirement:** Tailwind CSS v4 (the widgets style themselves with
Tailwind utilities; a build tool cannot ship inside a package).
**Bundled runtime deps** (installed automatically): `lit-html`,
`@tabler/icons-react`, `clsx`, `tailwind-merge`.

> In-repo (inside the TreDeSpace monorepo) the same modules are reached through
> the `@treDeSpaceUI/*` path alias: `@treDeSpaceUI/widgets`, `…/dockable`,
> `…/hotkeys`, `…/lib`. Every example below uses the package form; substitute
> the alias when working in-repo.

---

## 2. Setting up a NEW project

### 2.1 Scaffold

```bash
npm create vite@latest my-app -- --template react-ts
cd my-app
npm i
```

### 2.2 Install

```bash
# put the tarball in ./libs/ first (downloaded from /docs/widgets.html)
npm i ./libs/tredespace-ui-0.0.130.tgz
npm i -D tailwindcss @tailwindcss/vite
```

`package.json` ends up with:

```json
{
  "dependencies": {
    "@tredespace/ui": "file:./libs/tredespace-ui-0.0.130.tgz",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

> React 19 is a **peer** dependency. npm 7+ installs it if missing; an older
> React already in the project is a hard conflict, not a warning — upgrade it.

### 2.3 `vite.config.ts`

```ts
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

### 2.4 `src/index.css` — the single most error-prone file

```css
@import "tailwindcss";

/* The library's theme variables + scrollbar skin. REQUIRED. */
@import "@tredespace/ui/styles.css";

/* Tailwind does not scan node_modules by default. Without this line every
   widget renders completely unstyled. REQUIRED. */
@source "../node_modules/@tredespace/ui";

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  background: var(--color-slate-950);
  color: var(--color-slate-200);
  font: 12px / 1.45 ui-sans-serif, system-ui, sans-serif;
}
```

The `@source` path is **relative to this CSS file**. From `src/index.css` that
is `../node_modules/@tredespace/ui`. Getting it wrong is the #1 setup failure
(§10).

### 2.5 `src/main.tsx` — the boot file

```tsx
import '@tredespace/ui/dockable'; // side-effect: dock chrome CSS
import { initTooltips, Toaster } from '@tredespace/ui/widgets';
import { hotkeysActions } from '@tredespace/ui/hotkeys';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { BINDINGS } from './hotkeys/bindings';
import { initTheme } from './state/theme/theme.actions';
import './index.css';

initTheme();                     // stamp data-theme BEFORE first paint
initTooltips();                  // data-tooltip / data-shortcut everywhere
hotkeysActions.setStorageKey('myapp:hotkeys'); // before register()
hotkeysActions.register(BINDINGS);             // also starts the key engine

createRoot(document.getElementById('root')!).render(
  <>
    <App />
    <Toaster />
  </>,
);
```

Order matters: `setStorageKey` before `register`, and `initTheme` before the
first render so there is no dark-to-light flash.

### 2.6 Non-Vite builds (webpack, Next, Parcel)

```bash
npm i -D tailwindcss @tailwindcss/postcss postcss
```

```js
// postcss.config.js
export default { plugins: { '@tailwindcss/postcss': {} } };
```

The CSS file is identical. Everything in this library is client-side (it reads
`document` at module scope in places), so under a server-rendering framework
load the UI in a client-only boundary.

### 2.7 Working inside the TreDeSpace repo instead

```jsonc
// tsconfig.json
{ "compilerOptions": { "paths": { "@treDeSpaceUI/*": ["./src/treDeSpaceUI/*"] } } }
```

```ts
// vite.config.ts
resolve: { alias: { '@treDeSpaceUI': path.resolve(__dirname, 'src/treDeSpaceUI') } }
```

The library must stay self-contained: a widget may never import an app style,
or it renders broken in the standalone gallery and in the published package.

### 2.8 Setup checklist

- [ ] `@import "tailwindcss"` present
- [ ] `@import "@tredespace/ui/styles.css"` present
- [ ] `@source "../node_modules/@tredespace/ui"` present and the path resolves
- [ ] `initTooltips()` called once
- [ ] `<Toaster />` mounted once at the root
- [ ] `initTheme()` called before first render
- [ ] React 19 in `dependencies`, not a hoisted older copy
- [ ] a container with a **real height** wraps `<DockView>` (§4)

---

## 3. Theming — light, dark, and your own

### 3.1 The model

There is no theme provider, no context, no JS API. A theme is **one attribute
on `<html>`** that remaps CSS custom properties:

```ts
document.documentElement.dataset.theme = 'light'; // light
delete document.documentElement.dataset.theme;    // dark (the default)
```

Everything downstream follows automatically because all three style systems
read the same variables:

```
data-theme on <html>
        │
        ├─ Tailwind utilities in the widgets   (bg-slate-900 → var(--color-slate-900))
        ├─ dockable.css dock chrome            (--dock-panel → var(--color-slate-900))
        └─ your own app CSS                    (background: var(--color-slate-950))
```

That is the whole mechanism. **A component that reads a token themes itself;
a component that writes a hex value never will.**

### 3.2 What the library ships

`@tredespace/ui/styles.css` contains:

```css
:root {
  color-scheme: dark;
  /* dark = stock Tailwind slate, with the three darkest surfaces lifted half a
     step so ground / bars / borders read as layers instead of one near-black */
  --color-slate-950: #080f21;  /* ground */
  --color-slate-900: #172033;  /* panel / field */
  --color-slate-800: #283548;  /* raised / border */
}

[data-theme="light"] {
  color-scheme: light;
  /* the slate ramp inverted, plus a handful of accents */
  --color-slate-950: #f1f5f9;  --color-slate-900: #f8fafc;
  --color-slate-800: #e2e8f0;  --color-slate-700: #cbd5e1;
  --color-slate-600: #94a3b8;  --color-slate-500: #64748b;
  --color-slate-400: #475569;  --color-slate-300: #334155;
  --color-slate-200: #1e293b;  --color-slate-100: #0f172a;
  --color-blue-400: #2563eb;   --color-blue-100: #1e3a8a;
  --color-blue-900: #bfdbfe;   --color-blue-950: #dbeafe;
  --color-amber-400: #b45309;  --color-amber-300: #b45309;
  --color-amber-200: #92400e;  --color-amber-700: #d97706;
  --color-amber-950: #fef3c7;  --color-red-400:   #dc2626;

  /* …and the tone/accent sets: the blue, green and red ramps that the chips,
     the danger button, the Menu's danger entry and the SQL editor read.
     §3.4 explains which way each one moves and why. */
  --color-blue-200: #1e40af;   --color-green-200: #166534;
  --color-red-200:  #991b1b;   --color-red-950:   #fef2f2;
  --color-red-900:  #fee2e2;   --color-red-800:   #fca5a5;
  --color-red-600:  #dc2626;   --color-red-300:   #b91c1c;
  --color-red-100:  #7f1d1d;   --color-green-400: #15803d;
  --color-blue-300: #1d4ed8;   --color-sky-400:   #0284c7;
  --color-sky-300:  #0369a1;   --color-emerald-400: #047857;
}
```

Plus the flat "floating" scrollbar skin and the `tdsSweep` keyframe used by the
indeterminate `ProgressBar`. Every token the library uses is covered in both
themes, so a widget — and any component of yours that sticks to the palette —
needs no per-theme code.

Note the inversion trick: in light mode `slate-950` becomes the *lightest*
value and `slate-100` the *darkest*. So a widget written as
`bg-slate-900 text-slate-200` is "panel background, primary text" in **both**
themes without a single conditional class. Always write tokens by their
**role**, never by their apparent lightness.

**Role map (memorize this):**

| Token | Role | Dark | Light |
| --- | --- | --- | --- |
| `slate-950` | app ground, tab strip | `#080f21` | `#f1f5f9` |
| `slate-900` | panel surface, field background | `#172033` | `#f8fafc` |
| `slate-800` | raised surface, hairline border | `#283548` | `#e2e8f0` |
| `slate-700` | control border | stock | `#cbd5e1` |
| `slate-600` | hover border | stock | `#94a3b8` |
| `slate-500` | placeholder, disabled text | stock | `#64748b` |
| `slate-400` | secondary / label text | stock | `#475569` |
| `slate-300` | body text on chrome | stock | `#334155` |
| `slate-200` | primary text | stock | `#1e293b` |
| `slate-100` | emphasis / heading text | stock | `#0f172a` |
| `blue-400` | accent: focus ring, active tab, links | stock | `#2563eb` |
| `blue-950` / `blue-100` | primary button fill / its text | stock | inverted |

### 3.3 The complete token inventory

These are the **only** colour tokens the library uses. Nothing else is allowed
in your components either.

| Family | Tokens in use |
| --- | --- |
| slate | `100 200 300 400 500 600 700 800 900 950` |
| blue | `100 200 300 400 500 900 950` |
| red | `100 200 300 400 500 600 800 900 950` |
| amber | `200 300 400 500` |
| green | `200 400 500` |
| sky | `300 400` |
| emerald | `400` |

36 tokens total. The slate ramp is structure; blue is the accent; red / amber /
green / sky / emerald are the semantic tones (§5.5).

### 3.4 How the light map is built (and how to extend it)

The `[data-theme="light"]` block covers **every token the library uses**, so
light mode needs nothing from you. What matters is the rule it follows, because
you will need it the moment you add a token of your own.

**A token's role decides whether it flips:**

| Token role | Example use | Light behaviour |
| --- | --- | --- |
| structure (`slate-*`) | `bg-slate-900`, `text-slate-200` | the whole ramp **inverts** — `950` becomes the lightest, `100` the darkest |
| text on a tint (`*-100/200/300`) | `text-blue-200` on a blue chip | goes **dark** |
| solid fill (`*-900/950`) | `bg-red-950` on the danger button | goes **light** |
| border (`*-600/800`) | `border-red-800` | moves to a mid value |
| tint source (`*-500`) | `bg-blue-500/15`, `border-green-500/40` | **unchanged** — it is only ever used at 10–40% alpha, which reads the same over either ground |
| accent (`*-400`) | `text-blue-400`, `text-green-400` | darkens enough to clear 4.5:1 on a light ground |

**A ramp flips as a set, not a token at a time.** The clearest example is red:
`text-red-200` is used *both* as the danger `Badge`'s label (on a 15% red tint)
and as the danger `Button`'s label (on a solid `bg-red-950` fill). Darkening
`red-200` alone fixes the chip and breaks the button — dark text on a dark
fill. The fills have to come up as the text goes down:

```css
[data-theme="light"] {
  --color-red-950: #fef2f2;  /* fill:   near-black → near-white */
  --color-red-900: #fee2e2;  /* hover fill */
  --color-red-800: #fca5a5;  /* border */
  --color-red-600: #dc2626;  /* hover border */
  --color-red-300: #b91c1c;  /* Menu danger entry */
  --color-red-200: #991b1b;  /* text:   near-white → near-black */
  --color-red-100: #7f1d1d;  /* hover text */
}
```

So: before changing one token, grep for every class that uses it. A token is
shared across widgets, and the theme is only correct when the whole set moves
together.

**Adding your own token.** If a component needs a colour the 36 do not cover,
define it in **both** themes next to the library's, and pick the light value by
the role table above:

```css
:root                 { --color-violet-400: #a78bfa; }
[data-theme="light"]  { --color-violet-400: #6d28d9; }
```

Then use it as an ordinary Tailwind utility (`text-violet-400`). Never inline
the hex in a component — that is the one thing that cannot follow the theme.

> **History.** Until 2026-09-22 this block left 18 tokens at their stock
> Tailwind values, which made the info/success/danger chips render as pale-on-pale (the
> label effectively invisible) and left the danger button a near-black block in
> an otherwise light UI. Only `warning` survived, because `amber-200` was
> already remapped. If you are pinned to an older tarball, paste the red set
> above plus `blue-200: #1e40af`, `green-200: #166534`, `green-400: #15803d`,
> `blue-300: #1d4ed8`, `sky-400: #0284c7`, `sky-300: #0369a1` and
> `emerald-400: #047857` into your own stylesheet.

### 3.5 Adding a third theme

Themes are pure CSS — copy a block and pick a new attribute value.

```css
[data-theme="high-contrast"] {
  color-scheme: dark;
  --color-slate-950: #000000;
  --color-slate-900: #0a0a0a;
  --color-slate-800: #1f1f1f;
  --color-slate-700: #4d4d4d; /* borders must be visible */
  --color-slate-400: #b3b3b3;
  --color-slate-200: #ffffff;
  --color-blue-400: #4cc2ff; /* accent must clear 4.5:1 on #000 */
}
```

```ts
type Theme = 'dark' | 'light' | 'high-contrast';
document.documentElement.dataset.theme = 'high-contrast';
```

You only need to override what differs from the `:root` (dark) baseline —
unspecified variables inherit. Widen the `Theme` union, add the option to your
theme `Select`, done: **no widget changes, ever.**

### 3.6 Rebranding the accent

The accent is `blue-400` (plus `blue-950`/`blue-100` for the primary button and
`blue-500` for tints). Point them at your brand colour in both themes:

```css
:root {
  --color-blue-400: #7c5cff; /* focus ring, active tab, links, splitter hover */
  --color-blue-500: #6d4aff; /* tint source for info surfaces */
  --color-blue-950: #1b1140; /* primary button fill */
  --color-blue-100: #ded5ff; /* primary button text */
}
[data-theme="light"] {
  --color-blue-400: #5b3fd6;
  --color-blue-950: #ece7ff;
  --color-blue-100: #2e1c6b;
}
```

The dock chrome accent (`--dock-accent`) is derived from `--color-blue-400`, so
active tabs, splitter hovers and the drop compass follow with no extra work.

### 3.7 The theme switch — complete implementation

Use the library's own state pattern (§7) so the theme is readable outside React
and survives a reload.

```ts
// src/state/theme/theme.state.ts — the store and its type ONLY
import { createStore } from '@tredespace/ui/lib';

export type Theme = 'dark' | 'light';

export type ThemeState = Readonly<{ theme: Theme }>;

const STORAGE_KEY = 'myapp:theme';

function initial(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {
    /* storage blocked (private mode / sandboxed iframe) — fall through */
  }

  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export const themeState = createStore<ThemeState>({ theme: initial() });
export { STORAGE_KEY };
```

```ts
// src/state/theme/theme.actions.ts — ALL mutation, persistence, DOM effects
import { STORAGE_KEY, type Theme, themeState } from './theme.state';

function apply(theme: Theme): void {
  if (theme === 'dark') {
    delete document.documentElement.dataset.theme;
    return;
  }

  document.documentElement.dataset.theme = theme;
}

/** Stamp the stored theme on <html>. Call before the first render — a theme
 *  applied in an effect shows one frame of the wrong palette. */
export function initTheme(): void {
  apply(themeState.get().theme);
}

export const themeActions = {
  set(theme: Theme): void {
    themeState.set({ theme });
    apply(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  },
  toggle(): void {
    themeActions.set(themeState.get().theme === 'dark' ? 'light' : 'dark');
  },
};
```

```tsx
// src/components/ThemeToggle.tsx
import { SegmentedControl, type SegmentedOption } from '@tredespace/ui/widgets';
import { IconMoon, IconSun } from '@tabler/icons-react';
import { themeActions } from '../state/theme/theme.actions';
import { type Theme, themeState } from '../state/theme/theme.state';

const OPTIONS: readonly SegmentedOption<Theme>[] = [
  { value: 'dark', icon: <IconMoon size={14} />, tooltip: 'Dark theme', shortcut: 'app.theme' },
  { value: 'light', icon: <IconSun size={14} />, tooltip: 'Light theme', shortcut: 'app.theme' },
];

export function ThemeToggle() {
  const { theme } = themeState.use();

  return <SegmentedControl value={theme} options={OPTIONS} onChange={themeActions.set} />;
}
```

```ts
// src/hotkeys/bindings.ts — one entry, and the tooltip footer comes free
{
  id: 'app.theme',
  category: 'Application',
  label: 'Toggle theme',
  description: 'Switch between the light and dark theme.',
  defaultKeys: 'CTRL&ALT&T',
  run: () => themeActions.toggle(),
}
```

Optional — follow the OS while the user has not chosen explicitly:

```ts
matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
  if (localStorage.getItem(STORAGE_KEY) === null) {
    themeActions.set(e.matches ? 'light' : 'dark');
  }
});
```

### 3.8 Rules for your own components

- **Only the 36 tokens of §3.3.** `bg-slate-900`, `text-slate-200`,
  `border-slate-700`, `text-blue-400`. Never `bg-gray-800`, never `#1b1b1b`.
- **Write roles, not lightness.** Panel = `bg-slate-900`. Text = `text-slate-200`.
  Do not "fix" light mode by adding a second class — the ramp already inverts.
- **Never `dark:` variants.** Tailwind's `dark:` keys off `prefers-color-scheme`
  / a `dark` class, which this system does not use. A `dark:` class will
  desynchronize from `data-theme`.
- **No conditional palettes in JS.** `theme === 'dark' ? '#fff' : '#000'` in a
  component is the anti-pattern this whole design exists to remove.
- **Canvas / WebGL / charts** are the one legitimate exception — they cannot
  read CSS variables. Read them once and re-read on theme change:

  ```ts
  const css = getComputedStyle(document.documentElement);
  const ground = css.getPropertyValue('--color-slate-950').trim();
  themeState.subscribe(() => { /* re-read and repaint */ });
  ```

- **`color-scheme` is already set per theme**, so native scrollbars, form
  controls and the caret match without extra work. Do not override it.

### 3.9 Dock chrome tokens

`dockable.css` derives its own variables from the palette, each with a fallback
so the dock stays usable even without Tailwind:

| Dock variable | Source token | What it paints |
| --- | --- | --- |
| `--dock-bg` | `slate-950` | dock ground, splitters |
| `--dock-panel` | `slate-900` | tab group body, floating window |
| `--dock-strip` | `slate-950` | tab strip, locked/collapsed groups |
| `--dock-raised` | `slate-800` | tab hover, window title bar, compass buttons |
| `--dock-line` | `slate-800` | borders |
| `--dock-line-hi` | `slate-700` | strong borders, hover fills |
| `--dock-text` | `slate-200` | tab text |
| `--dock-text-hi` | `slate-100` | emphasis |
| `--dock-text-dim` | `slate-400` | inactive tabs, window title |
| `--dock-accent` | `blue-400` | active tab underline, focus, drop zones |
| `--dock-radius` | — | `4px`, override for a rounder shell |

Override any of them on `.dock-root` for a dock-only tweak:

```css
.dock-root { --dock-radius: 0px; }
```

### 3.10 Verifying a theme

Flip to light and check, in this order — these are where problems concentrate:

1. A `Badge` of every tone (`neutral info success warning danger`).
2. A `Button` of every variant, including `danger` and `active`.
3. A toast of every level (`info success warning error`).
4. A focused text field (the `blue-400` focus border).
5. The dock: active tab underline, splitter hover, a collapsed rail, a floating window.
6. Scrollbars (the thumb is a `blue-400`/`slate-800` mix).
7. `InfoBox` of every tone, and a `Menu` with a `danger` item.

If 1–3 look washed out — pale chips with invisible labels, a near-black danger
button — you are on a build from before the light map was completed; see §10.

---

## 4. The panel shell — a theme-ready workspace

The dockable shell is a VS-Code-style workspace: splits with draggable
dividers, tab groups, drag-to-dock with a drop compass, floating windows,
collapse-to-rail, size locking, and JSON-serializable layouts.

Panel content is **plain DOM in your document** — no shadow root, so Tailwind
and the theme work inside panels. React content mounts once and **survives
docking, tab switching, floating and re-splitting**: the dock reparents the
host element, it never re-creates it. React state, scroll positions and WebGL
contexts live through every move.

### 4.1 A complete, theme-ready `App.tsx`

```tsx
import {
  definePanel,
  DockView,
  normalizeLayout,
  split,
  tabs,
  useDockManager,
  type DockState,
  type PanelDefinition,
} from '@tredespace/ui/dockable';
import { useEffect } from 'react';
import { ExplorerPanel } from './panels/ExplorerPanel';
import { InspectorPanel } from './panels/InspectorPanel';
import { StatusBar } from './panels/StatusBar';
import { Toolbar } from './panels/Toolbar';
import { ViewportPanel } from './panels/ViewportPanel';

const LAYOUT_KEY = 'myapp:layout';

const PANELS: PanelDefinition[] = [
  // locked furniture — cannot be dragged out, closed or floated
  definePanel({ id: 'toolbar', title: 'Toolbar', component: Toolbar }),
  definePanel({ id: 'status', title: 'Status', component: StatusBar }),
  // real panels
  definePanel({ id: 'explorer', title: 'Explorer', minWidth: 180, home: 'left', component: ExplorerPanel }),
  definePanel({ id: 'viewport', title: 'Viewport', minWidth: 240, closable: false, component: ViewportPanel }),
  definePanel({ id: 'inspector', title: 'Inspector', minWidth: 220, home: 'right', component: InspectorPanel }),
];

/** Toolbar and status bar are locked, fixed-size, tabless furniture; the middle
 *  row is the user's to rearrange. Node ids are stable so `home` can target them. */
const DEFAULT_LAYOUT = split('column', [
  tabs(['toolbar'], { id: 'top', hideTabs: true, locked: true, fixedSize: 44 }),
  split('row', [
    tabs(['explorer'], { id: 'left' }),
    tabs(['viewport'], { id: 'center' }),
    tabs(['inspector'], { id: 'right' }),
  ], [22, 56, 22]),
  tabs(['status'], { id: 'bottom', hideTabs: true, locked: true, fixedSize: 24 }),
]);

function loadSaved(): DockState | undefined {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) {
      return undefined;
    }

    const state: DockState = JSON.parse(raw);
    return { ...state, root: normalizeLayout(state.root) }; // heal a stale tree
  } catch {
    return undefined;
  }
}

export function App() {
  const saved = loadSaved();
  const manager = useDockManager(() => ({
    panels: PANELS,
    layout: saved?.root ?? DEFAULT_LAYOUT,
    windows: saved?.windows,
    headerHeight: 22,
  }));

  useEffect(() => {
    return manager.subscribe(() => {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(manager.saveLayout()));
      } catch {
        /* ignore */
      }
    });
  }, [manager]);

  // h-screen: the dock fills its container and the container MUST have a height
  return <DockView manager={manager} className="h-screen" />;
}
```

```tsx
// panels/InspectorPanel.tsx — panel content is ordinary themed React
import { Collapsible, NumberInput, PanelHeader, Select, Badge } from '@tredespace/ui/widgets';
import { PanelBody, useMinSize } from '@tredespace/ui/dockable';

export function InspectorPanel() {
  useMinSize(200, 120); // how small the content may be squeezed

  return (
    <PanelBody className="flex h-full flex-col bg-slate-900 text-slate-200">
      <PanelHeader variant="title" title="Inspector" aside={<Badge>3</Badge>} />
      <div className="min-h-0 flex-1 overflow-auto">
        <Collapsible title="Transform" defaultOpen>
          <NumberInput label="Scale" labelPosition="split" value={1} onChange={() => {}} step={0.1} />
        </Collapsible>
      </div>
    </PanelBody>
  );
}
```

Why this is theme-ready: the panel uses `bg-slate-900 text-slate-200` (roles,
not hexes), the chrome comes from `PanelHeader`, and the dock paints itself
from `--dock-*`. Flipping `data-theme` restyles all of it with no panel code.

### 4.2 Layout builders

```ts
tabs(panelIds: string[], extra?)                          // a leaf: panels sharing a tab strip
split(direction: 'row' | 'column', children, sizes?, extra?) // sizes are WEIGHTS — only ratios matter
```

Node options (`extra`):

| Option | Applies to | Effect |
| --- | --- | --- |
| `id: string` | both | **Stable id** — required when other code targets the node (`home`, `dockableIn`, `openPanel(id, nodeId)`) |
| `locked: true` | both | Frozen: no drag-out, no float, no drops in, no close buttons, adjacent splitters inert. **Inherited** by everything inside. Toolbars, status bars, fixed rails |
| `fixedSize: px` | both | Pixel size along the parent split's axis; beats the content minimum |
| `hideTabs: true` | tabs | Hide the strip (only sensible with one panel) |
| `collapsed: true` | tabs | Start collapsed — a header (column) or rail (row) |
| `collapsible: false` | tabs | Hide the chevron; `toggleCollapse` refuses |
| `sizeLocked: true` | tabs | Padlock: current size becomes the node's **minimum** (it can still grow); divider drags cascade past it |
| `activePanel: id` | tabs | Which tab starts active |

### 4.3 `PanelDefinition`

| Field | Default | Meaning |
| --- | --- | --- |
| `id` | — | Stable identity; used everywhere |
| `title` | — | Tab label |
| `component` | — | React component (via `definePanel`); gets `{ ctx }` |
| `render` | — | Raw `(host, ctx) => disposer?` for plain-DOM panels |
| `minWidth` / `minHeight` | — | Content minimum in px (height excludes the strip); content may raise it at runtime |
| `closable` | `true` | `false` removes the tab ×. Locked nodes never show one anyway |
| `floatable` | `true` | `false` keeps the panel docked |
| `dockableIn` | — | Pin to node id(s): no floating, no splitting, no docking elsewhere |
| `home` | — | Soft default node to reopen into. Does **not** pin |
| `tabMinWidth` | — | Minimum tab button width, to align a strip |
| `onClose` | — | Fires on a **real** close (tab ×, `closePanel`, `togglePanel`) — not on layout swaps |
| `beforeClose` | — | Return a promise to defer the close: the tab vanishes at once, content stays mounted and hidden until it settles |

### 4.4 Inside a panel

```ts
usePanelContext()               // the enclosing PanelContext (throws outside a panel)
useMinSize(w?, h?)              // declare the content minimum
usePanelTitle(title)            // rename the tab from inside
useIsFloating(manager, panelId) // reactive: true while in a floating window
useDockLayout(manager)          // re-render on ANY layout change

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

`<PanelBody>` is a thin themed wrapper (`{ children, className?, ref? }`);
the default `className` is `"panel-body"`. Pass Tailwind classes to style it.

### 4.5 `DockManager` API

```ts
// construction
useDockManager(() => options)   // in React — lives for the component's lifetime
new DockManager(options)        // outside React

// options
{ panels, layout, windows?, headerHeight = 22, tabMinWidth?, splitterSize = 6,
  windowBarHeight = 26, defaultWindowSize = { width: 340, height: 260 } }

// open / close
manager.openPanel(id, targetNodeId?)  // 'left' | 'right' | 'bottom' recreate a pruned side
manager.closePanel(id); manager.togglePanel(id); manager.isOpen(id)
manager.openPanels(); manager.closedPanels()
manager.focusPanel(id)                // activate its tab, raise its window
manager.remountPanel(id)              // re-run render() in place (layout untouched)

// floating windows
manager.floatPanel(id, rect?); manager.dockWindow(windowId, targetNodeId?)
manager.closeWindow(windowId); manager.minimizeWindow(windowId, minimized?)
manager.isFloating(id)

// layout
manager.saveLayout()                  // → DockState (plain JSON)
manager.loadLayout(stateOrRoot)
manager.resetLayout()
manager.subscribe(cb)                 // → unsubscriber

// nodes
manager.toggleCollapse(nodeId); manager.setCollapsed(nodeId, c); manager.isCollapsed(nodeId)
manager.toggleSizeLock(nodeId)        // capture current size as the minimum
manager.toggleSolo(); manager.isSolo()
manager.nodeOf(panelId)

// runtime panels
manager.registerPanel(def); manager.unregisterPanel(id)
manager.dragPanelFrom(e, panelId)     // start a dock-drag from your own pointerdown
```

Pure helpers: `allPanels`, `findNode`, `findTabsWithPanel`, `cloneLayout`,
`isEmpty`, `measureMin`, `normalizeLayout`.

### 4.6 Runtime panels

One tab per opened document, a host-driven report view:

```ts
manager.registerPanel(
  definePanel({
    id: `report:${reportId}`,
    title: report.name,
    component: ReportPanel,
    onClose: (id) => manager.unregisterPanel(id), // a closed tab is gone for good
  }),
);
manager.openPanel(`report:${reportId}`);
```

Both calls notify layout subscribers, so a toggle bar built from the panel list
follows without a layout change.

### 4.7 Standard layout recipes

```ts
// fixed toolbar over a viewport
split('column', [
  tabs(['ribbon'], { id: 'top', hideTabs: true, locked: true, fixedSize: 108 }),
  tabs(['viewport']),
])

// classic IDE: rail | editor | inspector, over a console
split('row', [
  tabs(['explorer'], { id: 'left', collapsed: true }),
  split('column', [tabs(['editor']), tabs(['console'], { id: 'bottom' })], [3, 1]),
  tabs(['inspector'], { id: 'right', sizeLocked: true }),
], [1, 4, 1])

// a panel that may only ever live in the bottom dock
definePanel({ id: 'log', title: 'Log', dockableIn: 'bottom', floatable: false, component: LogPanel })
```

### 4.8 Panel behaviour notes

- **Collapse detaches, never destroys** — React state and WebGL contexts return exactly as they were.
- **Size lock is a minimum only** — the group can still grow; drags cascade past it.
- **Divider drags cascade**: when the shrinking panel hits its minimum, the next one yields, until the side is exhausted.
- **Drop compass**: centre joins as a tab, edges split, outer ring docks against the whole area; release over nothing dockable and the panel floats.
- **The `DockView` container needs a real height** (`h-screen`, `h-full` inside a sized parent, or a fixed px height). A dock inside an auto-height div renders as a zero-height strip — the single most common integration bug.

---

## 5. Widget reference — every widget, every variant

### 5.0 Conventions that apply to all of them

- **Controlled**: `value` + `onChange`. (`Collapsible`, `InlinePanel`, `VerticalTabs` also support uncontrolled via `defaultOpen`/`defaultValue`.)
- **`tooltip?: string`** — styled bubble; `"\n"` for multiple lines.
- **`shortcut?: string`** — a hotkey **id**; the tooltip gains a live combo footer. With no `tooltip`, the hotkey's `description` becomes the body.
- **`className`** merges onto the outermost element — for a field that is the labelled **row**. Use `cn()` to compose.
- **Empty = `null`** for clearable single-value pickers.
- **Discriminated unions** for modes: `multiple: true`, `range: true`.
- **Generic over `T extends string`** for `Select`, `RadioGroup`, `SegmentedControl` — a typed option list gives you the literal union back in `onChange`.

**Labelled-field props** — shared by `TextInput`, `TextArea`, `NumberInput`,
`Select`, `ColorSelect`:

| Prop | Values | Effect |
| --- | --- | --- |
| `label` | `ReactNode` | the caption |
| `labelPosition` | `'top'` (default) | label above the field |
| | `'left'` | label gets a fixed column (`labelWidth`), field fills — for stacked form fields that must align |
| | `'split'` | label takes the free space, field keeps a fixed width (`fieldWidth`) — the settings-row look |
| `labelWidth` | px (default 60) | `'left'` only — share one value across stacked fields |
| `fieldWidth` | px (default 112) | `'split'` only |

The row is `w-full`, so a labelled field in a flex row next to a button shrinks
to leave room for it. `Labelled` is exported if you need the layout for
something that is not a field widget.

**Stacking floors** — keep any floating layer of your own on one of these:

| z-index | Layer |
| --- | --- |
| 1000 | popovers and dropdowns (Select, colour picker, date/time popovers) |
| 2000 | `InfoButton` popover, `DialogFrame` default |
| 2600 | `Toaster` default |
| 3000 | `Menu` |
| 4000 | tooltip bubble (always topmost) |

Give equal-priority layers *different* values: two fixed siblings at the same
z-index resolve by DOM order, which for a portal means "whichever mounted last".

### 5.1 Button

```tsx
<Button icon={<IconRefresh />} onClick={(e) => reload(e.altKey)} tooltip="Reload" shortcut="app.reload">
  Reload
</Button>
```

**Every variant:**

| `variant` | Use for | Look |
| --- | --- | --- |
| `default` | ordinary actions | slate fill, slate border |
| `primary` | the confirming action of a dialog or form | blue fill, blue border |
| `danger` | a destructive action | red fill, red border |
| `ghost` | a borderless action inside dense chrome | transparent until hover |

**Every size:**

| `size` | Height | Text |
| --- | --- | --- |
| `xs` | 16px | 10px |
| `sm` | 20px | 11px |
| `md` (default) | 24px — lines up with every input | 12px |

**Every modifier:**

| Prop | Effect |
| --- | --- |
| `active` | highlighted/selected look — a **state**, wins over `variant` |
| `disabled` | dimmed, not clickable |
| `loading` | icon becomes a spinner, clicks blocked |
| `readOnly` | static display chip — no hover, not focusable |
| `iconOnly` | square icon-only button (a reset ✕) |
| `wrap` | long label runs to a second line; height grows from the size floor |
| `grow` | takes the free space of a flex row (`flex-1`) |
| `icon` | leading icon, locked to 14×14 |
| `badge` | count/status chip after the label |

```ts
type ButtonProps = {
  children?: ReactNode; icon?: ReactNode; onClick?: (e: ReactMouseEvent) => void;
  disabled?: boolean; active?: boolean; variant?: ButtonVariant; size?: ButtonSize;
  readOnly?: boolean; iconOnly?: boolean; wrap?: boolean; grow?: boolean;
  loading?: boolean; badge?: ReactNode; title?: string;
  tooltip?: string; shortcut?: string; className?: string;
};
```

The `onClick` event is passed through so handlers can read modifiers (Alt for
"apply to all", etc.).

### 5.2 Checkbox / RadioGroup / SegmentedControl — the choice family

**Pick the right one:**

| Widget | When |
| --- | --- |
| `Checkbox` | an independent on/off |
| `RadioGroup` | an exclusive choice **in a form** (vertical, native radios) |
| `SegmentedControl` | the same exclusive choice **in a toolbar** (horizontal, joined) |
| `Select` | more than ~5 options, or options that need searching |

```tsx
<Checkbox checked={on} onChange={setOn} label="Enable TAA" hint="temporal AA" />
<Checkbox checked={all} indeterminate={some} onChange={selectAll} label="Select all" />

<RadioGroup value={mode} onChange={setMode} options={[
  { value: 'orbit', label: 'Orbit' },
  { value: 'fly', label: 'Fly', hint: 'WASD', info: 'First-person navigation.' },
]} />

<SegmentedControl value={unit} onChange={setUnit} options={[
  { value: 'mm', label: 'mm', tooltip: 'Millimeters' },
  { value: 'm', label: 'm', tooltip: 'Meters' },
]} />
```

| Widget | Variants |
| --- | --- |
| `Checkbox` | `indeterminate` (tri-state — visual only, `checked` still decides what a click reports), `hint` (small dimmed note), `info` (explanation behind an ⓘ — replaces `hint`), `disabled` |
| `RadioOption` | `hint`, `info`, `shortcut` per option |
| `SegmentedOption` | `label`, `icon`, label+icon, or icon-only (omit `label`, pair with `tooltip`); `disabled` per option |
| `SegmentedControl` | `size` (`ButtonSize`, matches Button), `grow` (split the row evenly), `fill` (fill the parent's height — a ribbon slot) |

A run of `<Button active={…}>` is **not** a SegmentedControl: no shared edges,
no group semantics. Use SegmentedControl whenever the choice is exclusive and
lives on one row.

### 5.3 Text, number and colour fields

```tsx
<TextInput label="Name" value={name} onChange={setName} onCommit={save} placeholder="Untitled" />
<TextArea label="Notes" labelPosition="left" labelWidth={70} value={notes} onChange={setNotes} rows={4} />
<NumberInput label="Scale" labelPosition="split" value={s} onChange={setS} min={0.1} max={10} step={0.1} unit="×" />
<ColorSelect label="Tint" value={color} onChange={setColor} swatches={['#ff0000', '#00ff00']} />
<Vec3Input label="Center" value={shape.center} onChange={(center) => update({ center })} />
```

| Widget | Variants / notable props |
| --- | --- |
| `TextInput` | `type`: `text` \| `password` \| `email` \| `url` \| `search`; `clearable` (in-field ✕, default true); `onClear` (override the ✕ — e.g. reset-to-default; shows even when empty); `onCommit` (Enter **and** blur); `maxLength`, `spellCheck`, `placeholder` |
| `TextArea` | `rows`, `resizable` (default true), `minHeight` (px floor, also while resizing), `clearable`, `onClear`, `onCommit` (blur only) |
| `NumberInput` | stepper buttons + typing + **pointer-drag scrubbing**; `min`, `max`, `step`, `precision` (derived from `step` when omitted), `unit` (suffix, hidden while typing), `decShortcut`/`incShortcut` (hotkey ids for the − / + steppers) |
| `ColorSelect` | full picker popover (SV square, hue slider, hex/RGB fields, swatch rows); `swatches` (quick-pick row); `flush` (fill parent height exactly — ribbon slots) |
| `Vec3Input` | three steppers on one row for a point/size/axis, with an aligned label column; `Vec3 = readonly [number, number, number]` |

The `ColorSelect` default swatch grid is a module-level store you can replace
with a live one (recent colours):

```ts
import { DEFAULT_PICKER_SWATCHES, setColorSelectSwatchesStore } from '@tredespace/ui/widgets';

const recent = createStore({ colors: DEFAULT_PICKER_SWATCHES });
setColorSelectSwatchesStore(recent); // null restores the default
```

### 5.4 Select — four modes

```tsx
// 1. single — value: T | null; onChange gets null on clear
<Select value={fmt} onChange={setFmt} placeholder="Format…" options={[
  { value: 'glb', label: 'GLB' },
  { value: 'ifc', label: 'IFC', hint: '.ifc' },
]} />

// 2. searchable — adds a filter box
<Select searchable value={fmt} onChange={setFmt} options={formats} />

// 3. multiple — value: readonly T[]; selections render as removable chips
<Select multiple searchable value={tags} onChange={setTags} options={tagOptions} />

// 4. async — loadOptions replaces local filtering (debounced; implies searchable)
<Select value={item} onChange={setItem} loadOptions={async (q) => searchServer(q)} />
```

```ts
type SelectOption<T extends string = string> =
  { value: T; label: string; hint?: string; disabled?: boolean };

type SingleSelectProps<T> = { multiple?: false; value: T | null; onChange: (v: T | null) => void };
type MultiSelectProps<T>  = { multiple: true;  value: readonly T[]; onChange: (v: T[]) => void };
// + shared: options?, placeholder?, searchable?, loadOptions?, disabled?,
//           tooltip?, shortcut?, className? and the label props
```

Type the option list and the union flows through — no cast at the call site:

```tsx
const MODES: readonly SelectOption<'reset' | 'append' | 'hide'>[] = [ … ];
<Select options={MODES} value={mode} onChange={(m) => m && setMode(m)} />
//                                             ^ 'reset' | 'append' | 'hide' | null
```

Throw or reject inside `loadOptions` to surface the error inside the dropdown.

### 5.5 Date and time pickers

Three fields, one flow each. All values are **plain strings that sort
correctly as strings** — no `Date` objects, no timezone, no library.

```tsx
// DatePicker — ISO "yyyy-mm-dd"
<DatePicker value={day} onChange={setDay} min="2026-01-01" max="2026-12-31" />
<DatePicker range value={span} onChange={setSpan} />

// TimePicker — 24-hour "HH:MM", picked on a clock dial (hour → minute)
<TimePicker value={time} onChange={setTime} minuteStep={5} />
<TimePicker range value={window} onChange={setWindow} />

// DateTimePicker — ISO local "yyyy-mm-ddTHH:MM", staged: calendar → hour → minute
<DateTimePicker value={when} onChange={setWhen} min="2026-01-01" minuteStep={15} />
```

| Widget | Value format | Modes | Extra props |
| --- | --- | --- | --- |
| `DatePicker` | `"yyyy-mm-dd"` | single · `range` | `min` / `max` (ISO day, inclusive) |
| `TimePicker` | `"HH:MM"` (24h) | single · `range` | `minuteStep` (default 1) |
| `DateTimePicker` | `"yyyy-mm-ddTHH:MM"` | single only | `min` / `max` (bound the **calendar** only), `minuteStep` |

All three also take `placeholder`, `disabled`, `className`, `tooltip`,
`shortcut`, and clear to `null`.

```ts
type DateRange = Readonly<{ start: string | null; end: string | null }>;
type TimeRange = Readonly<{ start: string | null; end: string | null }>;

type DatePickerProps =
  | { range?: false; value: string | null; onChange: (v: string | null) => void }
  | { range: true;   value: DateRange;     onChange: (v: DateRange) => void };
// TimePickerProps is the same shape with TimeRange
```

Range behaviour:

- **Date range** — the first click picks the start, the second the end; clicked
  backwards they are auto-swapped, and hovering previews the span. Either edge
  may still be `null` while the user is picking.
- **Time range** — an end **before** the start is legal: the range crosses
  midnight. Do not "correct" it.

Set the discriminant literally (`range` / `range={true}`) and TypeScript
narrows `value` and `onChange` for you — never cast.

### 5.6 Tone — the one semantic scale

`Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'` is shared by
`Badge`, `InfoBox` and `Toast` (and the `badge` slot of `Button`), so
"warning" looks the same wherever it appears.

| Tone | Colour family | Use for |
| --- | --- | --- |
| `neutral` | slate | un-tinted default; a count, a plain marker |
| `info` | blue | a neutral fact worth noticing |
| `success` | green | a completed operation |
| `warning` | amber | a caution the user should read |
| `danger` | red | a failure the user must act on |

Never express a tone with a red text span — use the tone prop, so it themes.

### 5.7 Feedback — Badge, Kbd, InfoBox, InfoButton, EmptyState

```tsx
<Badge>{rows} rows</Badge>
<Badge tone="warning">unsaved edits</Badge>
<span>Run with <Kbd>Ctrl + Enter</Kbd></span>
<InfoBox tone="danger">The GPU device was lost.</InfoBox>
<InfoButton label="What is this?">Longer explanation in a popover.</InfoButton>
<EmptyState layout="center" icon={<IconInbox />}>No rows — run the report.</EmptyState>
```

| Widget | Variants |
| --- | --- |
| `Badge` | `tone` (5), `tooltip` |
| `Kbd` | — (the key-cap sibling of Badge) |
| `InfoBox` | `tone` (5, default `warning`), `icon` (`ReactNode` replaces the tone icon, `null` drops it) |
| `InfoButton` | `label` (accessible label / hover tooltip); children are the popover body |
| `EmptyState` | `layout`: `'note'` (dim line in the flow) \| `'center'` (centred in the space left, supports `icon`) |

`EmptyState` replaces every hand-written "nothing here" paragraph — it is the
only place that wording gets its styling.

### 5.8 Containers — Collapsible, InlinePanel, VerticalTabs, PanelHeader

```tsx
<Collapsible title="Rendering" aside="12 options" defaultOpen
  actions={<Button iconOnly icon={<IconRestore size={14} />} tooltip="Reset" onClick={reset} />}>
  <Checkbox checked={taa} onChange={setTaa} label="TAA" />
</Collapsible>

<InlinePanel dense title="Filter #1" titleUppercase={false}
  actions={<Button iconOnly size="sm" icon={<IconTrash />} tooltip="Remove" />}>…</InlinePanel>

<VerticalTabs defaultValue="general" tabs={[
  { id: 'general', label: 'General', content: <GeneralTab /> },
  { id: 'colors', icon: <IconPalette />, tooltip: 'Colors', content: <ColorsTab /> },
]} />

<PanelHeader variant="title" title={report.name} aside={<Badge>{n}</Badge>} actions={<Button>Run</Button>} />
```

| Widget | Variants |
| --- | --- |
| `Collapsible` | `defaultOpen` (uncontrolled) **or** `open` + `onToggle` (controlled); `aside` (right-aligned header note); `actions` (header buttons, outside the toggle — clicking one never collapses); `info` (ⓘ in the header); `fill` (fill remaining panel height while open; the **body** scrolls) + `fillMinClass` (height floor, e.g. `"min-h-64"`); `bodyClassName` |
| `InlinePanel` | `defaultOpen` / `open`+`onToggle`; `actions`; `titleUppercase` (default true); `titleClassName`; `dense` (tight header/body for long stacks — pair with `size="sm"` icon buttons) |
| `VerticalTabs` | `value`+`onChange` (controlled) or `defaultValue`; `side`: `'left'` \| `'right'`; per-tab `label`, `icon`, `tooltip` (icon-only = omit `label`) |
| `PanelHeader` | `variant`: `'label'` (dim caption) \| `'title'` (panel name) \| `'band'` (tinted mode bar); `aside`, `actions`. Already `shrink-0`, so only the content under it scrolls |

With several `fill` Collapsibles in one panel, give each a `fillMinClass` so
they stop shrinking and the panel scrolls instead. Never force a section open by
remounting it with a changing `key` — use the controlled form.

### 5.9 Data display — PropertyList, TreeView, FileTree, SqlCodeEditor

```tsx
<PropertyList divided rows={fields.map((f) => ({ key: f.key, label: f.label, value: <Value f={f} /> }))} />
<PropertyList numeric rows={stats} />
<PropertyList layout="fill" rows={keys.map((k) => ({ key: k.id, label: k.desc, value: <Kbd>{k.combo}</Kbd> }))} />
```

| Widget | Variants |
| --- | --- |
| `PropertyList` | `layout`: `'fixed'` (label column + filling value, `labelWidth` px, default 128) \| `'fill'` (filling label + natural value); `numeric` (monospace, right-aligned values); `divided` (rule under every row). Per row: `tooltip` (on the label cell), `leading` (a checkbox/swatch before the label) |

**TreeView** draws a **flat list of the rows that are visible right now** — it
never owns the model, so a lazily-loaded tree costs nothing until expanded.

```tsx
<TreeView
  rows={rows}            // TreeViewRow[]
  rowHeight={22}         // px — turns on virtualization
  onToggle={(row) => toggleOpen(row.key)}
  onRowClick={(row, e) => select(row.key, e)}
  onRowContextMenu={(row, e) => openMenu(row, e)}
/>
```

| Row state | Effect |
| --- | --- |
| `expandable` / `expanded` | renders the twisty; a leaf keeps its width so levels line up |
| `selected` | selection highlight |
| `partial` (+ `partialTooltip`) | SOME rows beneath are selected — a bar at the left edge |
| `band` | grouping chrome (a store, a section) — dimmed full-width band |
| `muted` | dim, italic label — hidden or unavailable content |
| `disabled` | not clickable (a band that is pure chrome) |
| `icon` / `trailing` | leading icon / right-aligned node after the label |

Props: `indent` (px per level, default 14), `padLeft` (default 6),
`scrollerRef` (to scroll a row into view), `rowProps` (the escape hatch for
`draggable`, drop-highlight classes and `data-*` markers), `emptyText`.

The twisty toggles expansion **only** — it never touches selection, so a folder
can be opened without selecting its subtree.

**FileTree** is TreeView plus a file model: virtual file/folder tree with
multi-select, drag-to-move and a built-in context menu. Paths are the identity.

```ts
type TreeFile = { kind: 'file'; name: string; path: string; handle?: FileSystemFileHandle; note?: string };
type TreeDir  = { kind: 'dir'; name: string; path: string; children: TreeNode[];
                  variant?: 'section';   // dimmed full-width category band (still collapsible)
                  icon?: ReactNode };
```

Omitting a callback hides that capability — no `onMove` → no drag; no
`onAddFolder` → no "New folder" entry. Control expansion with
`defaultCollapsed`, `expandAll` (e.g. while a search filter is active), and the
`collapseAllSignal` / `expandAllSignal` counters.

**SqlCodeEditor** — syntax highlighting plus the usual editor keys: Tab /
Shift+Tab indent and outdent, Enter keeps indentation, Ctrl/Cmd+Enter fires
`onRun`. Edits go through the browser's insert command, so Ctrl+Z undoes them
like typing. `onSelect(start, end)` lets you run only the highlighted text;
`resizable` adds a drag handle (set the start height via `className`).

### 5.10 Overlays — Menu, dialogs, toasts

**Menu** — portaled to the body so panel scroll clipping can never cut it off.
It opens at the press position and is then measured and nudged back inside the
viewport.

```tsx
const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

<div onContextMenu={(e) => { e.preventDefault(); setAnchor({ x: e.clientX, y: e.clientY }); }}>…</div>

<Menu anchor={anchor} onClose={() => setAnchor(null)} items={[
  { id: 'copy', label: 'Copy name', onSelect: () => copy(row.name) },
  canEdit && { id: 'rename', label: 'Rename…', onSelect: () => rename(row) },
  { separator: true },
  { id: 'del', label: 'Remove', danger: true, onSelect: () => remove(row) },
]} />
```

`anchor: null` renders nothing. A falsy entry is skipped, so a conditional item
can be written inline. Picking an entry closes the menu **before** running
`onSelect`, so a handler that opens a dialog never leaves the menu behind it.
Item variants: `icon`, `tooltip`, `shortcut` (hotkey id), `disabled`, `danger`.

**Dialog stack** — four layers, use the highest one that fits:

| Layer | Use |
| --- | --- |
| `Modal` | raw centred overlay above a dimmed backdrop at z-index `z`. Escape reaches only the **top** open modal (they register in a stack); backdrop press closes unless `closeOnBackdrop={false}`. **No `onClose` = undismissable** — what a blocking progress overlay wants |
| `TitleBar` | the standard header row; give it `onClose` for the ✕ |
| `DialogFrame` | the dialog **window**: backdrop, bordered box, title bar + ✕, a body that scrolls inside `maxHeight` (default `80vh`), a footer rule. Build every new dialog from this |
| `*DialogCore` | complete, presentation-only dialog bodies — you own the open/close state |

```tsx
<DialogFrame icon={<IconLicense size={16} className="text-blue-400" />} title="License"
  width="min(560px, 92vw)" onClose={() => setOpen(false)}
  footer={<Button variant="primary" onClick={accept}>Accept</Button>}>
  {body}
</DialogFrame>

{confirming && (
  <ConfirmDialogCore title="Delete model" message="This cannot be undone."
    okLabel="Delete" cancelLabel="Cancel"
    onResult={(ok) => { setConfirming(false); if (ok) { doDelete(); } }} />
)}
```

| Core | Props | Result |
| --- | --- | --- |
| `ConfirmDialogCore` | `title, message, okLabel, cancelLabel, z?` | `onResult(ok)` — `true` = OK, `false` = Cancel/Escape |
| `ErrorDialogCore` | `title, message, z?` | `onDismiss()` |
| `LoadingDialogCore` | `title, label, progress?` (0..1; `null`/omitted hides the bar), `z?` | — (undismissable) |
| `PromptDialogCore` | `title, message, value, okLabel, cancelLabel?, onChange, z?` | `onResult(ok)` — `true` = OK/Enter |

`DialogFrame` also takes `width` / `height` / `maxHeight` (number = px, default
width 320), `role` (`'dialog'` \| `'alertdialog'`), `z`, `bodyClassName`.

**Toasts** — the non-blocking alternative to a confirm the user can only
acknowledge. Render `<Toaster />` once at the root; everything else calls
`toast.*`, from React or not (a worker callback, an action, a hotkey).

```tsx
<Toaster />                       // once, at the app root (default z 2600)

toast.info('Cooking started.');
toast.success(`Loaded ${n} label(s).`);
toast.warning('Import finished: 3 tags not found.');
toast.error('GPU device lost.', { title: 'Renderer' });  // stays until dismissed
toast.dismiss(id); toast.clear();
```

`ToastOptions = { title?: string; duration?: number }` — `duration: 0` means
until dismissed. Each call returns the toast id. They stack bottom-right,
newest at the bottom, hold while the pointer is over them, and cap at four so a
burst of failures cannot bury the screen.

### 5.11 Ribbon — the toolbar family

`Ribbon` is the bar; `RibbonSection` is a titled group that packs children into
columns **by their `size`**; `RibbonSlot` puts arbitrary content (a Select, a
ColorSelect) into the same sizing system.

| `RibbonSize` | Per column | Use for |
| --- | --- | --- |
| `big` | 1 | the headline action of a group |
| `medium` | 2 stacked | the common case |
| `mini` | 3 stacked | dense secondary actions |

```tsx
<Ribbon>
  <RibbonSection title="Camera">
    <RibbonButton icon={<IconHome />} label="Home" size="big" onClick={goHome}
      tooltip="Reset camera" shortcut="camera.home" />
    <RibbonButton icon={<IconLock />} label="Lock" size="medium" selected={locked} onClick={toggleLock} />
    <RibbonNumber label="FOV" value={fov} onChange={setFov} min={20} max={120} unit="°" size="medium" />
  </RibbonSection>
  <RibbonSection title="Style">
    <RibbonSlot size="medium"><Select value={style} onChange={setStyle} options={styles} /></RibbonSlot>
  </RibbonSection>
</Ribbon>
```

`RibbonButton` variants: `selected`, `selectedColor` (icon/label colour while
selected, default the theme blue), `background` (fixed background for
swatch-style buttons; hover brightens), `badge` (small counter above a big
button), `disabled`, `onPointerDown` (raw pointer-down, e.g. to start a drag).
Icons are locked to 18×18 regardless of size; omit the icon for text-only.

`RibbonNumber` = `NumberInput` + `label`, `fieldWidth` (default 116),
`labelWidth` (default 34 — stacked RibbonNumbers share it to align), `size`.

### 5.12 Small parts

```tsx
<Link href="https://example.com/docs">Read the docs</Link>
<Swatch color={rule.color} active={picked} onClick={() => pick(rule.color)} />
<Spinner />
<ProgressBar value={0.4} />   <ProgressBar />   {/* no value = indeterminate sweep */}
<CopyButton value={() => toTsv(rows)}>Copy rows</CopyButton>
```

| Widget | Notes |
| --- | --- |
| `Link` | one look for every out-of-app link; external by default (`target="_blank"` + `noreferrer noopener`) |
| `Swatch` | colour chip — clickable in a palette (`active` rings the current pick), static read-out with no `onClick` |
| `Spinner` / `ProgressBar` | the busy indicators the loading dialog is built from; `ProgressBar` with no `value` is indeterminate |
| `CopyButton` | owns its own "Copied" confirmation — no panel hand-rolls that timer. `value` may be a **getter** for something expensive to build |

### 5.13 Tooltips

Attribute-driven — no wrapper component, works in React and plain DOM alike:

```tsx
initTooltips(); // once at boot; singleton, returns a disposer

<button data-tooltip={'Fit view\nZooms to the selection'}>Fit</button>
<button data-tooltip="Undo" data-shortcut="transform.undo">Undo</button>
```

- Multi-line via real newlines or a literal `"\n"` in the attribute.
- `data-shortcut="<hotkey id>"` appends a footer with the binding's **current**
  combo. With `data-shortcut` and no `data-tooltip`, the hotkey's `description`
  becomes the body.
- The widgets' `tooltip` / `shortcut` props render exactly these attributes.
- The bubble is z-index 4000 — always topmost. Inside a `role="menu"` or
  `role="listbox"` it places itself **beside** the list rather than over the
  entries below the hovered one.

### 5.14 File pickers

```tsx
const picker = useFilePicker('.json', (file) => readFileText(file, importJson));

<>
  {picker.element}                          {/* the hidden input, anywhere in the tree */}
  <Button onClick={picker.open}>Load…</Button>
</>
```

```ts
useFilePicker(accept, onFile): { element: ReactNode; open: () => void; ref: RefObject<HTMLInputElement | null> }
useMultiFilePicker(accept, onFiles)   // same shape; onFiles never gets an empty list
readFileText(file, onText)
```

---

## 6. Variant cheat-sheet

Every enum in the library, in one place.

| Type | Values |
| --- | --- |
| `ButtonVariant` | `default` `primary` `danger` `ghost` |
| `ButtonSize` | `xs` (16px) `sm` (20px) `md` (24px, default) |
| `Tone` | `neutral` `info` `success` `warning` `danger` |
| `labelPosition` | `top` `left` `split` |
| `PanelHeader variant` | `label` `title` `band` |
| `EmptyState layout` | `note` `center` |
| `PropertyList layout` | `fixed` `fill` |
| `RibbonSize` | `big` `medium` `mini` |
| `VerticalTabs side` | `left` `right` |
| `TextInput type` | `text` `password` `email` `url` `search` |
| `DialogFrame role` | `dialog` `alertdialog` |
| `Select` modes | single · searchable · `multiple` · `loadOptions` (async) |
| `DatePicker` / `TimePicker` modes | single · `range` |
| `DropZone` | `center` `left` `right` `top` `bottom` `float` |
| Split direction | `row` `column` |
| Toast levels | `info` `success` `warning` `error` |

**Widget → "what it replaces" index.** Before writing markup, check this list:

| Need | Widget |
| --- | --- |
| a labelled field row | `label` + `labelPosition` on the field |
| "nothing here" text | `EmptyState` |
| a panel's top strip | `PanelHeader` |
| a status chip / count | `Badge` |
| a key/value read-out | `PropertyList` |
| a right-click menu | `Menu` |
| a tree | `TreeView` / `FileTree` |
| a dialog box | `DialogFrame` |
| a transient notification | `toast` |
| copy-to-clipboard | `CopyButton` |
| a drag gesture | `usePointerDrag` |
| a long list | `useVirtualRows` |
| a titled settings section | `Collapsible` |
| an exclusive toolbar choice | `SegmentedControl` |
| shared state | `createStore` (§7) |

---

## 7. State architecture

`createStore` is not just a utility — it is the intended state design.

```ts
const ui = createStore({ sidebarOpen: false });

ui.set({ sidebarOpen: true });                          // shallow-merge patch…
ui.set((prev) => ({ sidebarOpen: !prev.sidebarOpen }));  // …or updater fn
ui.get();                                                // read outside React
const { sidebarOpen } = ui.use();                        // subscribe inside a component
const unsub = ui.subscribe(() => { /* plain DOM, timers, render loops */ });
```

`set` no-ops when nothing actually changed (reference equality per key).
`Store<T>` is the exported handle type.

**Shared state always comes as a pair of files per domain:**

```
viewer.state.ts    — the store + its state type. NOTHING else.
viewer.actions.ts  — ALL mutation, side effects, persistence.
```

The rules:

- **Components never call `store.set()`** — they call actions. The actions
  module is the one place mutation, validation, persistence and side effects
  live, so every write path is auditable.
- **State stays JSON-serializable.** Live handles — resolvers, DOM nodes, GPU
  objects, callbacks — are module-level variables in the actions file.
- **Placement follows the readers.** One component uses it → the pair sits next
  to that `.tsx`. The moment a second consumer appears (another panel, a hotkey
  `run`, a worker) → move the pair to `src/state/<domain>/`. Don't pre-place it
  there, and don't reach into another component folder's state file.
- **Not everything needs a store.** Single-component state stays in `useState`.
  Reach for a store when the state outlives the component, must be read outside
  React, or has more than one reader.
- **Persist selectively, in actions** — never in a component effect.

This pairs with the rest of the library: hotkey `run` callbacks and dock
`PanelRenderer`s live outside React and can call `store.get()` and actions
directly; panels in separate React roots (floating windows) stay in sync
because they all subscribe to the same module-level store.

**Other lib utilities:**

- `cn(...inputs)` — merge conditional class lists and resolve conflicting
  Tailwind utilities (later class wins).
- `useVirtualRows(scroller, count, rowH, overscan?)` — fixed-height row
  virtualization. Render the scroller yourself, mount only `[first, last)`,
  each row absolutely positioned inside a `position: relative` spacer of
  `totalH`. Call `v.onScroll()` after setting `scrollTop` from code.
- `usePointerDrag({ onMove, onStart?, onEnd?, threshold? })` — one
  press-and-drag gesture on pointer **capture**, so the drag survives the
  pointer crossing an iframe, another panel or the window edge. With a
  `threshold`, `onEnd(false)` means the press never moved (a click).

---

## 8. Hotkeys

A dependency-free system: sequence grammar, matcher engine, a registry store
with user overrides + `localStorage` persistence, keymap import/export, and a
recorder. Tooltips read this registry for their `data-shortcut` footers.

### Key grammar

```
X          tap (press & release)                   "Z"
A&B        together, same instant                  "CTRL&Z", "E&R"
A + B      then (release, press next)              "G + X"
[X], [A&B] hold across the rest of the sequence    "[F1] + 2"
AA / 101   runs expand to taps                     "ALT + 101"
++         the literal + key
```

Modifiers: `CTRL` `ALT` `SHIFT` `META`/`CMD`. Named keys: `ESC` `ENTER` `SPACE`
`TAB` `UP/DOWN/LEFT/RIGHT` `PAGEUP/PAGEDOWN` `HOME` `END` `DELETE` `BACKSPACE`
`F1`–`F12`. A shorter binding may be a prefix of a longer one (`F` alongside
`F+F`) — the short one fires on timeout.

### One definition drives the whole UI

```ts
// src/hotkeys/bindings.ts — the ONE place shortcuts are defined
export const BINDINGS: HotkeyDef[] = [
  {
    id: 'camera.home',            // stable dotted id — a public contract once exposed
    category: 'Camera',           // groups the settings panel
    label: 'Home view',
    description: 'Reset the camera to the home position.', // shown verbatim as a tooltip
    defaultKeys: 'H',
    run: () => cameraActions.goHome(),
    // allowInInput?: boolean — fire even inside text fields (default false)
    // timeout?: number       — ms between sequence steps (default 1500)
    // context?: () => boolean — extra guard; must return true to fire
  },
];

hotkeysActions.register(BINDINGS); // once at boot; also starts the engine
```

```tsx
// anywhere — nothing duplicated:
<Button shortcut="camera.home" onClick={() => cameraActions.goHome()}>Home</Button>
// tooltip body = the def's description; footer = the LIVE combo ("H", or the rebind)
```

| Consumer | Reads |
| --- | --- |
| key engine | `defaultKeys` (or the override) + `run`, `context`, `timeout`, `allowInInput` |
| tooltips | the current combo for any control with `shortcut="<id>"`; `description` as the body when the control has no `tooltip` |
| settings panel | `category` groups, `label` + `description` display, `isCustom(id)` drives Reset |
| announcements | `label` + the formatted combo, via `setHotkeyAnnouncer` |

Overrides persist under the `localStorage` key `hotkeys`; namespace it with
`hotkeysActions.setStorageKey('myapp:hotkeys')` **before** registering.

### API

```ts
hotkeysActions.sequenceFor(id)               // effective Sequence (override or default), or null
hotkeysActions.describe(id)                  // description text
hotkeysActions.isCustom(id)
hotkeysActions.conflictsFor(seq, excludeId?) // other ids bound to EXACTLY seq
hotkeysActions.setOverride(id, keys)         // rebind (persists)
hotkeysActions.setAllowInInput(id, allow); hotkeysActions.setTimeout(id, ms)
hotkeysActions.resetOne(id); hotkeysActions.resetAll()
hotkeysActions.exportJson(); hotkeysActions.importJson(text) // → { applied, skipped, conflicts }
hotkeysActions.list()                        // every def as data + its LIVE combo
hotkeysActions.run(id)                       // fire by id → 'ran' | 'blocked' | 'unknown'

parseSequence('CTRL&Z'); formatSequence(seq); formatCombo(combo); isValidKeys(str)
validateBindings(defs)                       // boot/test check: parse + round-trip + duplicates
recordSequence({ idleMs? })                  // for a "Record" button; resolves on idle/Enter,
                                             // rejects on Escape, suspends the live engine
suspendHotkeys(); resumeHotkeys()            // nested-safe
setHotkeyAnnouncer(fn | null)                // gets "⌨ label · combo" whenever a shortcut fires
```

A settings panel is built entirely from `hotkeysState.use()` →
`{ defs, order, overrides }`: group `order` by `defs[id].category`, render the
combo with `formatSequence(hotkeysActions.sequenceFor(id))`, rebind with
`recordSequence()` → `conflictsFor()` → `setOverride()`.

**Rules:** never hard-code a combo in UI text; write `description` so it works
as a tooltip (one or two sentences, ending with a period); give every new
button and toggle a binding + tooltip as you add it — the bindings table is the
feature inventory. Run `validateBindings(BINDINGS)` in a test.

---

## 9. Migrating an existing project

### 9.1 Component mapping

| Coming from | Use |
| --- | --- |
| MUI `Button` / Chakra `Button` / shadcn `Button` | `Button` + `variant` + `size` |
| MUI `TextField` | `TextInput` with `label` + `labelPosition` |
| MUI `Select` / react-select | `Select` (single / `multiple` / `searchable` / `loadOptions`) |
| MUI `Autocomplete` async | `Select loadOptions={…}` |
| MUI `Switch` | `Checkbox` (there is no switch — one toggle affordance) |
| MUI `ToggleButtonGroup` / Radix `ToggleGroup` | `SegmentedControl` |
| MUI `Accordion` | `Collapsible` |
| MUI `Chip` | `Badge` |
| MUI `Alert` | `InfoBox` (persistent) or `toast` (transient) |
| MUI `Dialog` | `DialogFrame`, or a `*DialogCore` |
| MUI `Snackbar` / react-hot-toast | `toast` + one `<Toaster />` |
| MUI `Tabs orientation="vertical"` | `VerticalTabs` |
| Radix `Tooltip` / Tippy | `data-tooltip` (or the `tooltip` prop) + `initTooltips()` |
| Radix `DropdownMenu` (context) | `Menu` with an `{x, y}` anchor |
| react-virtualized / TanStack Virtual | `useVirtualRows`, or `TreeView rowHeight` |
| Zustand / Redux / Jotai | `createStore` + the state/actions pair (§7) |
| react-hotkeys-hook | the hotkeys registry (§8) |
| golden-layout / rc-dock / FlexLayout | the dockable shell (§4) |
| MUI `ThemeProvider` + `useTheme()` | `data-theme` on `<html>` + CSS variables (§3) |
| `styled-components` / `sx` / emotion | Tailwind utilities from the 36 tokens |

### 9.2 Order of work

1. **Setup first** (§2), including the §3.4 light-theme completion. Verify one
   `Button` renders styled before touching anything else — that proves the
   `@source` line is right.
2. **Theme second.** Land `theme.state.ts` / `theme.actions.ts` and the toggle
   before porting screens, so every ported screen is checked in both themes as
   it lands. Retro-fitting a theme is far more work.
3. **Shell third** (§4) if the app has panels. Get `DockView` mounting in a
   full-height container with placeholder panels.
4. **State fourth.** Port the store to `createStore` pairs. This is mechanical
   and unblocks panels reading shared state.
5. **Screens last**, one at a time, each verified in both themes.
6. **Hotkeys throughout** — add the binding when you add the control, not after.
7. **Delete the old library** only once nothing imports it; two component
   libraries in one bundle is two visual languages and double the CSS.

### 9.3 What has no equivalent (decide before you start)

- **No data grid.** Build one from `useVirtualRows` + `PropertyList`, or bring a
  headless grid and style it with the tokens.
- **No form library.** Everything is controlled; pair it with your own
  validation (`Result<T>`-style, not thrown errors) or react-hook-form.
- **No router, no i18n, no charts.** Bring your own; theme them with the tokens.
- **No switch/toggle component** — `Checkbox` is the one on/off affordance.
- **No breadcrumb, stepper, pagination, avatar, skeleton.** Compose from
  `Button`, `Badge`, `Link`, `Spinner`.
- **No `dark:` variant support** — theming is variables only (§3.8).

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Widgets render completely unstyled | Tailwind is not scanning the package | Add `@source "../node_modules/@tredespace/ui"` with a path relative to **that CSS file** |
| Everything is styled but the palette is wrong / too dark | `@tredespace/ui/styles.css` not imported | Import it after `@import "tailwindcss"` |
| Badge/Toast labels invisible and the danger button near-black in light mode | a tarball built before the light map was completed (CHANGELOG 2026.09.22) — it left 18 tokens at their stock values | Upgrade, or paste the tokens from §3.4 into your own CSS |
| One frame of dark before light on load | theme applied in an effect | Call `initTheme()` before `createRoot().render()` |
| Dock is a thin strip / invisible | `DockView`'s container has no height | Give it `h-screen`, or `h-full` inside a sized parent |
| Tooltips never appear | `initTooltips()` not called | Call it once at boot |
| Tooltip shows but no shortcut footer | hotkeys not registered, or an unknown id | `hotkeysActions.register(...)` at boot; check the id |
| Toasts do nothing | no `<Toaster />` mounted | Mount one at the app root |
| Dropdown clipped by a panel | a custom popover that is not portaled | Portal it and use a z-floor from §5.0 |
| Two overlays fight | equal z-index — DOM order decides | Give them different values |
| `onChange` gives `string`, not the union | untyped option list | Type it: `readonly SelectOption<Mode>[]` |
| Hooks/"invalid hook call" errors | two React copies | One React 19 at the root; check `npm ls react` |
| TS can't resolve `.css` imports from the package | — | Already handled: `.css` imports are stripped from the `.d.ts` files |
| A panel resets when re-docked | content remounted by your own `key` | The dock reparents; never key panel content on layout state |
| Layout restore throws / looks broken | a stale persisted tree | Run it through `normalizeLayout` before `loadLayout` |
| Custom colours don't flip with the theme | hex values or off-palette classes | Use the 36 tokens (§3.3) |

---

## 11. Review checklist

Before calling any UI task done:

- [ ] Renders correctly in **dark and light** (walk §3.10)
- [ ] No raw hex, `rgb()`, or off-palette Tailwind class anywhere
- [ ] No `dark:` variants
- [ ] Nothing hand-rolled that §6 already provides
- [ ] Every interactive control has a `tooltip`
- [ ] Every meaningful action has a `shortcut` id in the bindings table
- [ ] `className` used for layout only — never to change size or tone
- [ ] Inputs are controlled; no `as` casts on widget props
- [ ] Shared state is a `*.state.ts` / `*.actions.ts` pair; no `store.set()` in a component
- [ ] Async paths return a result object rather than throwing expected errors
- [ ] `initTooltips()`, `hotkeysActions.register()`, `<Toaster />`, `initTheme()` each exactly once
- [ ] Dock layout persists and reloads through `normalizeLayout`
