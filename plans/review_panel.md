# Review panel — markup reviews with a locked view (PLANNED, not scheduled)

> **Status: plan, 2026-11-17. The director has decided the main questions**
> (see Decisions). Nothing is built. Six smaller questions are still **open**
> (see Open questions at the end). File and function names were accurate when
> this was written; **check them again before building**.

## Goal

A **Review** is one numbered remark on the model: a title, a long
description, a status, the exact view it was made in, and markup drawn on top
of that view. The user keeps many reviews in one set, saves the set to a file,
loads it again and never loses unsaved work. A set can be stepped through
review by review, as in a meeting, and exported as a PDF with one page per
review. A host page can put its own bookmark button in the panel and receive
the review when the user clicks it.

## Decisions (director, 2026-11-17)

| # | Decision |
|---|---|
| D1 | **Reviews are their own domain** and panel, not markup added to viewpoints. The *view* part reuses the viewpoint's type and capture/apply code (one shared module), so the two never drift apart. |
| D2 | **Draw and Pen are the same thing:** the freehand tool. |
| D3 | **On Exit, the markup is hidden.** Nothing is restored: the camera unlocks where it is, and clipping, colours and selection stay as they are. |
| D4 | **While a review is open, the scene can still be worked on:** select, colour, hide, invert and the resets all work. Only the camera is locked. |
| D5 | **Panel only for now**, opened from the **Panels** ribbon like the other panels. No ribbon group of its own. |
| D6 | **Status Open / Closed** per review: in scope. |
| D7 | **Previous / Next step mode:** in scope. |
| D8 | **More markup kinds** (arrow, rectangle, cloud, text): in scope. |
| D9 | **A PDF**, not a thumbnail image: one page per review. |

## Already in the codebase — reuse it

| Need | Already there | Where |
|---|---|---|
| Camera + clipping | `Viewpoint.camera` (target, azimuth, elevation, orbitDistance, ortho, sketch), `clipBox`, `clipPlanes`, `clipShapes`; `captureCamera` / `captureClipBox` and the apply half of `activate` | `src/state/viewer/viewpoints.state.ts`, `viewpoints.actions.ts` |
| Labels / Measurements / Set Color | `Viewpoint.labels / measurements / colorRules`; the scene ↔ viewpoint stash (`liveSide`, `stash`) | same |
| Title + description | `Viewpoint.name` / `description` (rendered with **bold** + newlines by `richTextHtml`) | same |
| Host bookmark button | `viewpoints.setBookmarkButton` → `viewpoints.bookmark`, and its twin `animation.setBookmarkButton` → `animation.bookmark` | `api/tredespace-client.ts`, `EVENTS.md` |
| Recover / Discard | `animation_draft.json` in OPFS, autosaved every 5 s while dirty; `checkDraft` / `recoverDraft` / `discardDraft`; `DraftBanner.tsx` (ALT 981 / 982) | `src/state/animation/animationDoc.actions.ts`, `animation-timeline/DraftBanner.tsx` |
| Camera lock | `camera.inputLocked` — the animation player's kiosk lock (mouse, touch, keys, wheel) | `src/lib/render/camera.ts` |
| Banner on the viewport | `ViewportFrame.tsx` — the Auto-key frame and the "not keyed" banner | `animation-playbar/` |
| Markup surface | SVG overlays under the viewport host; `svgCapture.ts` bakes them into screenshots and video | `src/lib/overlay/` |
| PDF | `buildPdf(pages)` — one page per picture: title, then wrapped text below it. Used by Animation's *Step stills* | `src/lib/video/pdfWriter.ts`, `src/state/animation/stills.actions.ts` |
| Stills | `beginCapture` / `grabFrame` / `endCapture` — a quiet capture state (fixed size, no view cube or hover, converged in Best quality, overlays composited) | `src/state/animation/captureSession.ts` |
| Panel toggle | `PANEL_TOGGLES` (id, title, ALT code in the 6xx block) → the Panels ribbon button and its hotkey | `ribbon-panels/panelToggle.ts` |
| Collapse all | Transform Objects list: close / open every row (ALT 138 / 139) | `transform-objects/` |
| Zip (later, BCF) | `zipStored` / `zipDeflated`, no dependency | `src/lib/zip.ts` |

## Data model

```ts
// src/state/reviews/reviews.state.ts — JSON-serializable
type ReviewStatus = 'open' | 'closed';

interface Review {
  id: string;
  /** 1, 2, 3 … in creation order; never reused within a set */
  number: number;
  title: string;
  /** long free text, **bold** + newlines (richTextHtml, as viewpoints) */
  description: string;
  status: ReviewStatus;
  /** ISO times; author is free text from Settings (no accounts) */
  created: string;
  modified: string;
  author: string;
  /** the shared view snapshot: camera (+ fovY), clip box, planes, shapes */
  view: ViewSnapshot;
  /** only the sets the user ticked at Add; absent = not part of the review */
  labels?: SceneLabel[];
  measurements?: Measurement[];
  colorRules?: Viewpoint['colorRules'];
  /** fullnames selected when the review opens (as viewpoints) */
  fullnames: string[];
  markup: Markup[];
}

/** width and text size are in view units (see below) */
type MarkupStyle = Readonly<{ color: string; width: number }>;
type Markup =
  | Readonly<{ kind: 'pen'; style: MarkupStyle; points: number[] }>    // freehand (= draw), x,y pairs
  | Readonly<{ kind: 'line'; style: MarkupStyle; points: [number, number, number, number] }>
  | Readonly<{ kind: 'arrow'; style: MarkupStyle; points: [number, number, number, number] }> // head at the end
  | Readonly<{ kind: 'path'; style: MarkupStyle; points: number[] }>   // polyline, ≥ 2 points
  | Readonly<{ kind: 'rect'; style: MarkupStyle; box: [number, number, number, number] }>   // x0,y0,x1,y1
  | Readonly<{ kind: 'cloud'; style: MarkupStyle; box: [number, number, number, number] }>  // revision cloud
  | Readonly<{ kind: 'text'; style: MarkupStyle; at: [number, number]; size: number; text: string }>;

interface ReviewsState {
  doc: { version: 1; name: string; models: ModelRef[]; reviews: Review[] };
  /** the review whose view is applied, markup shown and camera locked */
  openId: string | null;
  /** step mode: Previous / Next walk the set, a step bar sits in the banner */
  stepping: boolean;
  /** step mode skips Closed reviews */
  stepOpenOnly: boolean;
  /** collapsed rows (UI only, not saved) */
  collapsed: Record<string, true>;
  tool: 'none' | Markup['kind'] | 'eraser';
  style: MarkupStyle;
  dirty: boolean;
  fileName: string | null;
  draftAvailable: boolean;
  bookmarkButton: { label: string; tooltip: string } | null; // SESSION-ONLY
}
```

`ModelRef` = name + md5 of each model loaded when the set was saved. When a
set is opened, models that are not loaded are listed, so the user knows why
markup points at nothing. Loading them by md5 from Model Assets can come
later.

### Markup coordinates: in view units, not pixels

A review is redrawn in other window sizes: another screen, a resized docked
panel, the PDF. Points are stored **relative to the viewport height, from the
centre**:

- `u = (2·px − w) / h`
- `v = (h − 2·py) / h`

The vertical field of view is fixed at 55°, and an orthographic view's
half-height follows the same angle (`camera.ts`). So with the same camera, a
stored (u, v) always lands on the same model point, whatever the window's
shape. A wider window shows more at the sides. A narrower one can cut off
markup near the edges; the row then says "markup outside the view". Stroke
width and text size use the same units, so the PDF looks like the screen. The
view stores `fovY`, because scan look-around changes it (Q6).

## Opening a review: lock and banner

**Open** (a row's Open button, Previous / Next, the host, or right after
Add):

1. Only one review is open at a time. Opening another switches to it.
2. Apply the review's view with `applyView()`: the camera glides there, then
   clipping, Set Color rules if included, and the selection.
3. If the review includes labels or measurements, put the scene's own aside
   and show the review's. This reuses the viewpoint stash (Q1).
4. **Show the markup layer and lock the camera.** Set `camera.inputLocked`,
   and also block moves made by code: fit, home, view cube, viewpoint
   activation, animation playback, the host's camera commands,
   double-click / Alt+click re-pivot and the touch pads.
   - Today `inputLocked` only covers user input. Every place that moves the
     camera must go through one gate, for example `camera.lockedBy: 'review'
     | null` plus a `canMove()` check, so a new camera feature cannot slip
     past the lock.
   - A blocked move shows a toast ("Viewport locked by review 3 — Exit
     first"), and the host API returns a `locked` error.
5. **Banner** at the top of the viewport, in the ViewportFrame style:
   `Review 3 · <title> — viewport locked · Exit (Esc)`, with a thin amber
   frame round the view. In step mode the banner also holds `◀ 3 / 12 ▶`.
   The banner is DOM, outside the captured SVG, so it never shows in a PDF.

**While a review is open (D4):**

- **Select, colour, hide, invert and reset all work**: everything on the
  Selection Color ribbon and the Color Panel, plus selection in the view and
  in the Hierarchy. None of them moves the camera, so the markup still lines
  up.
- These edits change the **scene**, not the review (D3, Q5). What the review
  stores is changed only by explicit buttons: *Update view* (clipping and
  selection, plus the camera when the review is not open) and *Update from
  scene* per included set. This is the same rule as the viewpoint's
  Save-to-viewpoint.
- Clipping may change too (Q2). Window resize is fine (see the coordinate
  system above).

**Exit (D3)** — the Exit button, Esc, or closing step mode:

- Hide the markup layer and unlock the camera.
- **Nothing else is restored.** The camera stays where it is; clipping,
  colours, hidden items and the selection stay as they are.
- If the review brought its own labels or measurements, the scene's own come
  back. They are part of the review layer, like the markup (Q1).

**Add review** = capture the current view, a fresh number, status Open, an
empty title; then open it at once, ready to draw. The *Include* ticks (Labels
/ Measurements / Set Color) sit next to Add and are remembered per user.

## Markup tools (D2, D8)

The tools act on the **open** review only. With no review open, they are
greyed out.

| Tool | Gesture |
|---|---|
| **Pen** (= draw) | Freehand. The pointer path is thinned (drop points closer than ~0.003 view units) and smoothed. |
| **Line** | Press, drag, release. Shift snaps to 15°. |
| **Arrow** | As Line; the head sits at the end. |
| **Path** | Click, click, … then double-click or Enter ends it; Esc ends it too. Backspace removes the last point. This is the measurement Path tool's feel. |
| **Rectangle** | Drag a box. |
| **Cloud** | Drag a box; drawn as a revision cloud of arcs, which marks "this area changed". |
| **Text** | Click to place, type in a field over the view, Enter (or click away) to finish. Double-click a text to edit it. |
| **Eraser** | A click deletes the markup under the pointer. |

- **Style:** colour (the quick-colour swatches plus a picker) and width (S /
  M / L); text size S / M / L.
- **Undo / Redo** for markup is per domain, like the app's other undo stacks.
  **Clear markup** asks for confirmation.
- **Touch:** strokes come from pointer events, so pen, finger and mouse all
  work.

The SVG layer is new (`ReviewOverlay.ts` in `src/lib/overlay/`). It sits above
the measurement and label layers, uses system fonts as the animation
overlays do, and goes through `svgCapture` for the PDF.

## Panel (D5)

Opened only from the **Panels** ribbon: one `PANEL_TOGGLES` entry, with a
free code in the 6xx block (ALT 697 looks clean today; check it in the live
app). No ribbon group.

`src/components/panels/review/` (files ≤ ~120 lines; state and actions in
`src/state/reviews/` from day one, because the panel, hotkeys, the viewport
banner and the host API all use them):

- **Header:** Add review · Include ▾ (Labels / Measurements / Set Color) ·
  Step (toggle) · Export PDF… · Save… · Load… · New · Collapse all / Expand
  all · [host bookmark button when set] · Exit review (only while one is
  open).
- **Draft banner** (the DraftBanner pattern): "Recover the unsaved reviews
  from your last session?" Recover / Discard.
- **Tool row** (while a review is open): Pen · Line · Arrow · Path ·
  Rectangle · Cloud · Text · Eraser · colour · width · Undo · Redo · Clear.
- **Rows:** collapsed = number, title, status (Open / Closed chip) and
  markup count. Expanded = title field, description (multi-line), status,
  author and dates, the included sets (with *Update from scene* per set),
  Update view, Open / Exit, move up / down, Delete.
- **Every button, checkbox and stepper gets a hotkey and a tooltip.** Use a
  free ALT block, proposed **ALT 1800–1849**: the 3-digit codes 180–189 are
  free, so the block needs no prefix wait. Check it against the live app's
  `HOTKEYS` at build time, not by grepping. Exit = Esc while a review is open
  (`context` guard).

## Step mode (D7)

- **Step** in the header turns it on. It opens the first review (or the
  selected one) and adds `◀ n / total ▶` to the viewport banner.
- **Previous / Next** (banner buttons and hotkeys) open the neighbouring
  review: its view, its markup, the lock. **Open only** (on by default) skips
  Closed reviews (Q3).
- The panel can stay docked or be closed: the banner is enough to walk the
  set. Turning Step off, or Exit, leaves the last review as D3 says.
- Hotkeys: ALT codes from the review block, with a `context` guard (step
  mode on). Left / Right arrows are tempting, but check first that the
  navigation keys don't already own them.

## PDF export (D9)

**Export PDF…** → choose *All* / *Open only* / *This review* → one page per
review, built with the existing `buildPdf`:

- **Picture:** the review's view with its markup, at 1080 px height, in Best
  quality — the Step stills recipe. For each review in turn: open it, let it
  converge, grab, and go on. The export reuses Open, so it shows exactly what
  step mode shows.
- **Title:** `3. <title>`. **Text:** a meta line (Open / Closed · author ·
  created · modified), then the description. Today `PdfPage` has only
  `title` + `text`; add an optional `meta` line if the plain text reads
  badly.
- `captureSession.ts` lives in `src/state/animation/`, and `grabFrame` seeks
  animation time. Split out a `grabStill(session)` that grabs the view as it
  stands, and move the module to a shared place, so the review export and
  Step stills share it.
- At the end, reopen the review that was open before (or none). Show a
  progress dialog with a Cancel button. Warn first when models listed in
  `ModelRef` are not loaded.
- The PDF captures images at export time and stores none in the review
  file, so files stay small, but exporting needs the models loaded.

## Files and Recover / Discard

- **File:** `*.tdreview.json`, `version: 1`; newer or older versions give an
  error and change nothing (as animation files). The parser is pure, has no
  store imports and returns `{ error }` (vitest has no aliases). Treat the
  file as **untrusted input** (DESIGN.md › Untrusted input & CSP): it goes
  through the shared label and measurement readers, with caps on the number
  of reviews, markup per review, points per stroke and string / text length.
- **Save / Load / New:** Load and New ask before they replace unsaved work.
  Save downloads the file, clears `dirty` and removes this tab's draft.
- **Autosave:** to OPFS every 5 s while dirty, and on `pagehide`. Check
  whether animation has a `beforeunload` prompt while dirty; reviews should
  have one either way.
- **Recover / Discard** on the next start, kept untouched until the user
  picks one (no autosave over it, no delete on New / Load / Save), the same
  rules as the animation draft.
- **Drafts per tab.** The animation draft is "one document per origin,
  last-save-wins" (DESIGN.md › Several tabs on one library), so two tabs that
  both review would overwrite each other's draft. Reviews use
  `review_drafts/<tabId>.json`, with the tab's id taken from `tabSession.ts`
  (the Web Lock every tab holds while it lives). A starting tab offers only
  drafts whose tab is gone, newest first. Add `review_drafts` to
  `VIEWER_OPFS_ENTRIES` so *Clear all local data* removes them.

## Host API

The third twin of the bookmark pattern, the same shape so a host that already
does viewpoints reuses its code:

- `reviews.setBookmarkButton({ button: { label, tooltip } | null })`: a
  SESSION-ONLY button in the panel header. Clicking it fires
  **`reviews.bookmark`** with `{ review, doc }` — the open review (or the
  selected one) plus the whole set as Save writes it — so the host stores
  either one (Q4).
- `reviews.get()` → the set as Save writes it; `reviews.set({ doc })`
  replaces it, with no dialogs (the host owns that choice). Without `set`, a
  host could store a bookmark but never give it back.
- `reviews.open({ id })` / `reviews.close()`: the host's way to show a
  stored review (and to drive Previous / Next itself).
- Events: `reviews.bookmark`; `reviews.changed` only when a host asks for it
  (DESIGN.md: commands land on real host demand).
- When the camera is locked, camera commands return `locked`.
- Every new SDK method needs JSDoc **and** an `EVENTS.md` `### command`
  section with a ```js example; `vite build` fails without them.

## Later (not in this plan)

1. **BCF export / import** (`.bcfzip`, BCF 2.1 / 3.0) — the open format
   Revit, Navisworks, Solibri, BIMcollab and ACC use for exactly this. It maps
   almost field for field: topic = title, description, status, author,
   dates; viewpoint = camera, clipping planes, selected and coloured
   components; snapshot.png; markup lines (BCF 3). The gaps: BCF names
   components by IFC GlobalId, which only IFC imports have (fullnames
   elsewhere), and clip boxes / shapes have no BCF form. `src/lib/zip.ts`
   already writes zips, so it needs no new dependency. The data model above
   is shaped so it fits.
2. **Comments / replies** per review.
3. **3D-anchored pins:** a numbered marker stuck to a model point, visible
   from any camera. Labels already do world-anchored text.
4. **The look in the review:** hidden items, manual colours, transform poses
   (a `.tdsnap` holds them, but it is a streamed binary file — too heavy per
   review). See Q5.
5. **A Review ribbon group**, if the panel alone turns out not to be enough
   (D5 says panel only for now).

## Phases

1. **Shared view snapshot.** Move capture and apply out of
   `viewpoints.actions.ts` into `src/state/viewer/viewSnapshot.ts` (add
   `fovY`). Viewpoints behave exactly as before; their file format does not
   change. Unit tests for the round trip.
2. **Store, panel, files and draft.** Reviews state and actions; the panel
   (add, title, description, status, collapse / collapse all, reorder,
   delete); the Panels-ribbon toggle; Save / Load / New; autosave; Recover /
   Discard with per-tab drafts. The draft is in **this** phase because
   losing work is what the brief calls important.
3. **Open, lock, banner, Exit.** applyView, the single camera gate (check
   every place that moves the camera), the banner and frame, Exit as D3, D4's
   allowed edits checked one by one, Update view, Include sets.
4. **Markup.** Overlay layer, all tools in the table, style, eraser,
   undo / redo.
5. **Step mode and PDF.** Previous / Next with the banner step bar;
   `grabStill` split out of the capture session; Export PDF.
6. **Host API.** setBookmarkButton / bookmark / get / set / open / close,
   SDK JSDoc and EVENTS.md, and the demo host page.
7. **Tests and docs.** A headless e2e suite in the `test:anim` mould
   (`test:review`: add, draw, exit hides markup, step, PDF, save, reload,
   recover, discard, two tabs); vitest for the parser and the coordinate
   maths; a user-guide page; the DESIGN.md section; the widget gallery if a
   new library widget appears.

## Open questions (undecided)

The director has not decided these yet (2026-11-17). Until then, the plan
above follows the recommended answer and marks each place with **(Qn)**.
Settle each one before the phase that needs it; Q1–Q2 and Q5 matter from
phase 3, Q3 from phase 5, Q4 from phase 6 and Q6 from phase 2 (Add).

1. **Included labels / measurements on Exit:** do they leave with the markup
   so the scene's own come back (recommended), or stay on screen like
   colours and clipping?
2. **Clipping while a review is open:** allowed like colours, and saved into
   the review only through Update view (recommended), or locked with the
   camera?
3. **Step mode:** skip Closed reviews by default (recommended), or walk them
   all?
4. **Bookmark payload:** the one review, the whole set, or both (recommended:
   both — the host picks)?
5. **Colours / hidden items made while a review is open:** they stay in the
   scene and are not saved into the review (recommended for v1), or should a
   review be able to keep them?
6. **Scan look-around** (zoomable FOV, standing on a station): store fovY
   plus the station and allow it, or refuse Add in that mode for v1?
