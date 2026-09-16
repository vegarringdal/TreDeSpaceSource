# ANIMATION_TOOL — rigid animation, parts, player and 2D overlays

> **Status:** PLANNED — design agreed in discussion, not scheduled.
> **Last updated:** 2026-09-16 · **Plan version:** 1.0
> **Related:** `plans/ANIMATION.md` (engine background: rigid-only, cull
> upgrade). This file is the working plan and supersedes its "Timeline UI" /
> "Persistence" notes.
> File/line references were checked against the repo on 2026-09-16 —
> **re-verify at implementation time.**

### How to maintain this file

- **Decisions** go in §1 with an id (`D#`), date and who decided. Never
  delete a decision; mark it *Superseded by D#*.
- **Open questions** live in §2 (`Q#`). When answered, set the status to
  *Decided → D#* and add the decision to §1.
- **Tasks** in §16 are checkboxes. Tick them in the same commit as the
  code, and add a CHANGELOG entry as usual.
- **Interfaces** in §12 are the contract. If the code has to differ, update
  §12 in the same change so the plan and code don't drift.
- Add a line to **§18 Plan history** for every non-trivial edit.

---

## Contents

0. Summary
1. Decision log
2. Open questions
3. Scope
4. Concepts and glossary
5. Data model
6. Evaluation rules
7. Engine and runtime
8. Player and viewer control
9. Authoring experience
10. User interface specification
11. 2D overlay components
12. Code interfaces
13. Persistence and file format
14. postMessage SDK
15. Testing and verification
16. Phases and tasks
17. Risks
18. Plan history

---

## 0. Summary

A tool for building and playing **rigid item animations** (move + rotate)
in the viewer, aimed at construction/assembly sequences and maintenance
walkthroughs.

- Animations are built from **small parts** (groups) that are **chained**
  ("start where the previous ends"). Each part can be played on its own.
- Motion is authored **directly in the viewport** with the existing gizmo.
  Keys are **relative to the item's resting position**, so "pull it out,
  play it reversed" is the natural way to make assembly motion.
- Viewers use a **Player**: watch a part, **pause, look around freely**,
  then continue. The player never fights the user for the camera.
  **Space tap** = play/pause; Space+click stays fly-to.
- **2D overlays** are reusable, styled **components** with parameters and
  text templates (`{{part.name}}`), designed in an **Overlay Editor**.
- Authoring never changes the scene: the tool takes temporary ownership of
  the animated items' transform slots and gives them back on exit.

---

## 1. Decision log

| ID | Date | Decision | By | Notes |
|---|---|---|---|---|
| D1 | 2026-08-04 | Rigid motion only — **no scale** in animation. | director | Cull radius, normals and cone test stay exact. See ANIMATION.md. |
| D2 | 2026-09-16 | 99 % of use is **move + rotate**; design around that. | director | |
| D3 | 2026-09-16 | Keys store a **delta from the rest pose**, not world matrices. | agreed | Enables reverse authoring, re-targeting, survives committed edits. |
| D4 | 2026-09-16 | Sequences are reusable clips; **instances** carry placement, reverse, speed, holds. | agreed | |
| D5 | 2026-09-16 | **No item fade.** Item opacity is a **stepped value 0–1**. | director | Overlay enter/exit effects are CSS only and stay. |
| D6 | 2026-09-16 | **2D overlays are wanted**, as reusable **components** with an editor, styling and text templates. | director | |
| D7 | 2026-09-16 | **Groups/parts**: an animation is built from parts that can be played on their own and linked ("start where another ends"). | director | |
| D8 | 2026-09-16 | Primary viewer story: **play a part, pause, move the camera freely, continue.** | director | Drives §8. |
| D9 | 2026-09-16 | **Space tap (key-up, clean) = play/pause**; Space held + click = fly-to (unchanged). | director | Built as a generic `trigger: 'tap'` hotkey option. `K` is the second default. |
| D10 | 2026-09-16 | The player **never takes the camera back on its own**; user input switches the camera to *free*. | agreed | |
| D11 | 2026-09-16 | Item identity = **lower-cased fullname** (same as viewpoints and `.tdsnap`). | agreed | |
| D12 | 2026-09-16 | Authoring/playback **does not modify the scene**: enter/exit mode captures and restores `tidx`; no transform-undo entries. | agreed | |
| D13 | 2026-09-16 | Overlays accept **no raw HTML/CSS** from users; structured styles, escaped text, `data:` images only. | agreed | Docs can arrive via postMessage. |
| D14 | 2026-09-16 | The overlay component library is **per user** (OPFS); animation files **embed** the components they use. | agreed | |

---

## 2. Open questions

| ID | Question | Proposal | Status |
|---|---|---|---|
| Q1 | Item fade? | — | *Decided → D5* |
| Q2 | Time base: seconds or frames? | Seconds; frame snapping as a timeline option. | Open |
| Q3 | Several clips on one actor: compose (additive) or last-wins? | Compose in start order. | Open |
| Q4 | Transform pool size / animation band. | Pool 16384, reserve 4096 for animation (§7.2). | Open |
| Q5 | Where do animations live besides JSON files? `.tdsnap`, store sidecar? | JSON only in v1. | Open |
| Q6 | Overlay image size cap. | 1 MB per image, `data:` only. | Open |
| Q7 | Component library shareable per store/plant (team library)? | Per user in v1. | Open |
| Q8 | Can the SDK push components and live values? | Yes, later phase. | Open |
| Q9 | Links across group boundaries? | No — siblings only. | Open |
| Q10 | Isolated part playback: other actors frozen at part start, at rest, or at end? | Frozen at part start. | Open |
| Q11 | Record mode steps the playhead forward after each key? | Yes, by default duration; toggleable. | Open |
| Q12 | Test a clickable mock of flows 2–4 with a user before building the timeline widget? | Yes. | Open |
| Q13 | Continue after the user moved the camera: return or keep? | Return, if the part has a camera track or entry camera; otherwise keep. | Open |
| Q14 | Space tap: cancel after a long hold (~1 s)? | Yes, 1000 ms, tunable. | Open |
| Q15 | Workspace layout presets "Animate" and "Present"? | Yes (§10.1). | Open |
| Q16 | Video export in scope? | Later phase, deterministic stepping. | Open |

---

## 3. Scope

**In scope**

- Rigid move/rotate animation of item sets (actors), including multi-turn
  spins.
- Stepped visibility and opacity per actor.
- Camera track (optional per timeline).
- Parts (groups): nesting, linking, reverse/speed, partial playback.
- Player with pause, free camera, continue, step mode.
- Authoring: record with gizmo, pull-out mode, templates, assembly wizard,
  timeline, storyboard, focus mode, continuity check.
- 2D overlay components with editor, themes and text templates.
- JSON save/load, autosaved draft, postMessage SDK.

**Out of scope (v1)**

- Scale, skinning, vertex deformation, physics.
- Bezier tangent/curve editor (easing presets only).
- Item fades (D5).
- Audio.
- Collaborative editing.

---

## 4. Concepts and glossary

```
AnimationDoc
├── actors[]             named item sets (fullnames) + pivot
├── sequences[]          reusable clips: local time 0..duration, tracks → keys
├── timelines[]
│   ├── groups[]         parts: nestable, linkable, playable on their own
│   ├── clips[]          sequence instances inside a group (or the root)
│   └── markers[]        named time points
├── overlayInstances[]   uses of overlay components (values + anchor)
├── overlayComponents[]  embedded copies of the components used (§11)
└── overlayThemes[]      embedded copies of the themes used
```

| Term | Meaning |
|---|---|
| **Actor** | A named set of items (by fullname) that moves as one rigid body around a pivot. |
| **Rest pose** | The actor's committed pose when animation mode is entered. Keys are deltas from it. |
| **Sequence** | A reusable clip with its own local time and tracks. |
| **Track** | Keys over time for one property: transform, visibility, opacity, overlay, camera. |
| **Key** | A value at a local time, plus the easing of the segment that ends at it. |
| **Clip** | A sequence placed on a timeline (instance): placement, speed, reverse, holds, role bindings. |
| **Part / group** | A named container of clips and child groups, with its own placement, speed and reverse. Parts marked `part: true` appear in the Player. |
| **Link** | How a clip or group is placed relative to a sibling: `after`, `with`, `endsWith`, or fixed `at`. |
| **Role** | A placeholder actor in a sequence (`part`, `bolt`), bound to a real actor per clip. |
| **Scope** | What the player plays: everything, a time range, or one part (timeline or isolated). |
| **Animation mode** | The state in which the tool owns the animated items' transform slots. Variants: playback-only and authoring. |
| **Record** | Authoring sub-mode where gizmo releases create keys. |
| **Focus** | Authoring view restricted to one part. |
| **Component** | A reusable overlay design with parameters. |
| **Instance** | One use of a component, with values, anchor and timing. |

---

## 5. Data model

Location: `src/state/animation/animationDoc.state.ts` (types) — the doc is
JSON-serializable. Units: seconds, meters, degrees in the UI, quaternions in
storage. All ids are short random strings.

```ts
// -----------------------------------------------------------------------------
// primitives
// -----------------------------------------------------------------------------

type V3 = [number, number, number];
type Quat = [number, number, number, number]; // x y z w

type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'step';

/** Reuses src/state/viewer/viewpoints.state.ts */
type ViewpointCamera = import('../viewer/viewpoints.state').ViewpointCamera;

// -----------------------------------------------------------------------------
// actors
// -----------------------------------------------------------------------------

interface Actor {
  id: string;
  name: string;
  /** lower-cased fullnames (D11); duplicates share state like .tdsnap */
  fullnames: string[];
  /** rest-space pivot; 'center' = bounds center captured at mode entry */
  pivot: V3 | 'center';
}

type ActorRef = { actor: string } | { role: string };

// -----------------------------------------------------------------------------
// tracks and keys
// -----------------------------------------------------------------------------

interface TransformKey {
  t: number;              // local seconds
  pos: V3;                // delta translation (m)
  rot: Quat;              // delta rotation about the pivot
  ease: Easing;           // easing of the segment ENDING at this key
  /** multi-turn rotation for the incoming segment; slerp can't exceed 180° */
  spin?: { axis: V3; degrees: number };
}

interface StepKey<T> { t: number; value: T }

type Track =
  | { kind: 'transform'; id: string; target: ActorRef; keys: TransformKey[] }
  | { kind: 'visibility'; id: string; target: ActorRef; keys: StepKey<boolean>[] }
  | { kind: 'opacity'; id: string; target: ActorRef; keys: StepKey<number>[] }   // 0..1, stepped (D5)
  | { kind: 'overlay'; id: string; instance: string; show: TimeRef; hide: TimeRef;
      enter: OverlayFx; exit: OverlayFx }
  | { kind: 'camera'; id: string; keys: { t: number; camera: ViewpointCamera; ease: Easing }[] };

interface Sequence {
  id: string;
  name: string;
  duration: number;
  /** authoring hint — instancing suggests reverse=true for 'disassembly' */
  authoredAs: 'forward' | 'disassembly';
  roles: string[];
  tracks: Track[];
}

// -----------------------------------------------------------------------------
// placement
// -----------------------------------------------------------------------------

/** Placement of a clip or group. Targets are SIBLINGS (same parent) — Q9. */
type ClipStart =
  | { at: number }                         // parent-local seconds
  | { after: string; gap: number }         // starts where the target ENDS
  | { with: string; offset: number }       // starts with the target's start
  | { endsWith: string; offset: number };  // its end lines up with the target's end

/** A time tied to something else (used by overlays). */
type TimeRef =
  | { at: number }
  | { edge: 'start' | 'end'; of: string; offset: number }; // clip or group id

// -----------------------------------------------------------------------------
// timeline
// -----------------------------------------------------------------------------

interface ClipInstance {
  id: string;
  sequence: string;
  group: string | null;       // owning group; null = timeline root
  start: ClipStart;
  speed: number;              // timeline length = duration / speed
  reverse: boolean;
  holdBefore: boolean;        // before start: sit at the first played pose
  holdAfter: boolean;         // after end: keep the last played pose
  bind: Record<string, string>; // role → actor id
  muted: boolean;
  label?: string;
}

interface ClipGroup {
  id: string;
  name: string;
  description: string;        // rich text (**bold**, newlines)
  parent: string | null;
  order: number;              // list order among siblings
  start: ClipStart;
  speed: number;
  reverse: boolean;
  muted: boolean;
  part: boolean;              // listed in Player / Parts / SDK
  entryCamera: ViewpointCamera | null;
  pauseAtEnd: boolean;
  partOverlay: string | null; // overlay instance shown for the whole part
  thumbnail: string | null;   // data: URI at the part's end state
  color: string;              // lane/card tint (theme token or hex)
  collapsed: boolean;         // UI only
}

interface Marker { id: string; t: number; name: string; pause: boolean }

interface Timeline {
  id: string;
  name: string;
  groups: ClipGroup[];
  clips: ClipInstance[];
  markers: Marker[];
  /** "Use this component as step card for every part" (Flow 6) */
  defaultPartOverlay: { component: string; theme: string | null } | null;
  cameraTrackEnabled: boolean;
}

// -----------------------------------------------------------------------------
// document
// -----------------------------------------------------------------------------

interface AnimationDoc {
  format: 'tredespace.animation';
  version: 1;
  name: string;
  actors: Actor[];
  sequences: Sequence[];
  timelines: Timeline[];
  overlayInstances: OverlayInstance[];     // §11.1
  overlayComponents: OverlayComponent[];   // embedded copies (D14)
  overlayThemes: OverlayTheme[];
}
```

---

## 6. Evaluation rules

All rules are implemented in pure functions (§12.3) and covered by tests.

### 6.1 Pose of an actor

```
D(t)      = T(pos) · T(pivot) · R(rot) · T(-pivot)     // pivot in rest space
itemWorld = D(t) · base                                // base = committed slot
```

- Identity key means "in place".
- A committed edit made outside animation mode changes `base`; the
  animation follows.
- Rotation segments use shortest-path slerp, unless the incoming key has
  `spin`, in which case the rotation is `axis × degrees × eased(u)` applied
  on top of the slerp from the previous key (normally identity delta).

### 6.2 Resolving time (links)

1. For each parent (root, then every group), resolve its **clips and child
   groups** as siblings: topological order over `after`/`with`/`endsWith`.
   A cycle marks the involved items as errors (they fall back to `at: 0`).
2. Group span = earliest child start → latest child end (bottom-up), then
   scaled by the group's `speed`.
3. Place the group among its siblings (same rules), recursively.
4. Result: absolute `[start, end]` for every clip and group, plus the part
   order (depth-first by `order`).

Dragging a linked item edits its `gap`/`offset`, never an absolute time.
*Unlink* converts to `{ at }`. Moving an item ripples through everything
linked to it.

### 6.3 Local time, reverse, speed, holds

For a clip with absolute span `[s, e]` and sequence duration `d`:

```
u      = (T − s) · speed · Πgroup(speed)   (group reverse applied first)
local  = reverse ? d − u : u
before : T < s → holdBefore ? pose(local at u = 0) : no contribution
after  : T > e → holdAfter  ? pose(local at u = d) : no contribution
```

- Reversing mirrors the easing automatically (the curve is sampled
  backwards). *Bake reverse* is a separate command that rewrites keys.
- A reversed clip with `holdBefore` waits at its **last authored** pose
  (the "pulled-out" pose) until its start — exactly what assembly needs.
- Group `reverse` mirrors the group's span: `T' = gs + (ge − T)` for
  everything inside.

### 6.4 Composition (Q3)

Per actor, the deltas of all contributing clips are composed in **resolved
start order**: `D = D_n · … · D_1`. Layering "slide in" then "turn valve"
therefore works, and every movement continues from where the item already
is.

Visibility and opacity: the **latest key at or before T** across all
contributing clips wins (ties → later clip start). No key → visible,
opacity 1.

### 6.5 Scopes

```ts
type PlayScope =
  | { kind: 'all' }
  | { kind: 'range'; from: number; to: number }
  | { kind: 'group'; group: string; context: 'timeline' | 'isolated'; loop: boolean };
```

- `timeline`: play the group's span on the full timeline; overlapping
  clips outside the group also play.
- `isolated`: only clips inside the group evaluate at T; every other clip
  is evaluated at the group's start time (frozen) — Q10.

### 6.6 Seeking is stateless

`evaluate(doc, resolved, T, scope)` depends only on its arguments. Jumping
into any part gives the correct positions, visibility, opacity, overlays
and camera without playing anything before it. The player and the editor
never accumulate state between frames.

### 6.7 Continuity check

After any structural edit, flag:

- **Jump**: a clip without `holdBefore` whose first played pose differs
  from the actor's pose just before the clip starts (> 1 mm or > 0.1°).
- **Hidden move**: a transform clip active while the actor is hidden.
- **Unresolved actor**: fullnames not found in the loaded models.
- **Cycle**: link cycle (from §6.2).
- **Missing component**: overlay instance whose component isn't embedded
  or in the library.

---

## 7. Engine and runtime

### 7.1 What already exists

- Global transform pool of mat4 slots, `item_states[item].tidx` (full
  `u32`, `scene.ts:38`) → slot, slot 0 = identity
  (`src/lib/modeldb/transformPool.ts`).
- Vertex, pick and snap shaders apply the slot matrix; cull moves the
  bounding sphere by it.
- `renderer.writeTransforms(pool)` uploads the used pool region
  (`renderer.ts:1771`); `setSelectionTransform(matrix)` is the live
  gizmo-drag preview for selected items (`renderer.ts:1758`).
- Camera: `goToPose()` animated restore (`camera.ts`), used by viewpoint
  activation; `captureCamera()` in `viewpoints.actions.ts`.
- Per-item hide and opacity overrides in the modeldb worker
  (`apiVisibility.ts`, `apiColor.ts`).

### 7.2 Slot budget

A slot is **not** a movement. Keys and clips are data; they evaluate into
the same slot every frame. A slot is used by each distinct
**(actor, base slot)** pair while animation mode is on:

- Actor whose items share one committed transform (or none) → 1 slot.
- Actor whose items came from different committed edits → one per
  distinct base (usually 1–3).
- Non-animated items → nothing.

Today the pool is 4096 slots, shared with committed edits. Raising it is
cheap — only the constant in `transformPool.ts`, the buffer size
(`renderer.ts:940`, `4096 * 64`) and the clamp in `writeTransforms`
(`renderer.ts:1773`) limit it. 16384 slots = 1 MB GPU memory. Proposal
(Q4): pool 16384, top 4096 reserved for animation. Per-frame upload is only
the animated slots, so pool size doesn't affect playback cost.

### 7.3 Animation mode (slot ownership)

**Enter** (one worker call, `animEnter`):

1. Resolve actor fullnames → items (report unresolved).
2. Capture every model's `tidx` runs (same RLE as `captureTransformRuns`).
3. For each (actor, base) pair allocate a slot from the **reserved band**,
   point those items at it, return `base` matrices and rest bounds.

**Per frame** (main thread): `evaluate` → for each slot write `D · base` →
`renderer.writeTransformSlots(first, data)`.

**Exit** (`animExit`): restore captured runs, clear the band. No undo
entries were created (D12).

**Hazards to handle** (found in current code):

| Hazard | Where | Fix |
|---|---|---|
| Allocator wraps to slot 1 and could reuse a live animation slot. | `allocTransformSlot`, `transformPool.ts:13` | Committed allocator never enters the reserved band. |
| Worker transform ops upload the **whole** pool and overwrite animated slots. | `writeTransforms` callers | Player re-applies its band after every full upload (or the upload skips the band). |
| Residency uses worker-side bounds; a moving part could be evicted. | `itemWorldBounds` | On enter, compute each actor's **swept bounds** over the resolved timeline and hand them to residency. |
| Committed gizmo edits on animated items while in mode. | Transform ribbon | Disabled for animated items; the gizmo edits keys instead (§9, Flow 3). |

### 7.4 Visibility and opacity (D5)

Both stepped. The player diffs the evaluated state against the last sent
state and calls `animSetVisibility` / `animSetOpacity` only for changed
actors — a handful of calls per timeline. Opacity 0–1 maps onto the
existing 7-bit override; 1 clears the override.

### 7.5 Camera track

Interpolates `ViewpointCamera`: target lerp, azimuth/elevation shortest
angle, distance log-lerp, projection/sketch step at key. Applied only when
the player's camera is in `follow` (§8) and the timeline's
`cameraTrackEnabled` is on.

### 7.6 Render loop

Playback keeps the renderer in "moving" mode like a gizmo drag (TAA/AO
restart every frame). Paused → idle → the image converges to full quality.
Video export (Q16, later): step time deterministically, N accumulation
frames per output frame.

---

## 8. Player and viewer control

The main viewer story (D8): **watch a part, pause, look around, continue.**

### 8.1 Player state

Runtime only — `src/state/animation/player.state.ts`.

```ts
interface PlayerState {
  status: 'off' | 'stopped' | 'playing' | 'paused' | 'waiting'; // waiting = stopped at a part end
  timeline: string | null;
  time: number;
  scope: PlayScope;
  part: string | null;                 // part under the playhead
  camera: 'follow' | 'free';
  pausedCamera: ViewpointCamera | null;
  onContinue: 'return' | 'keep' | 'pauseView';
  afterPart: 'stop' | 'playThrough' | 'thisPartOnly';
  speed: number;
  loop: boolean;
  hideOverlaysWhilePaused: boolean;
  kioskLock: boolean;                   // ignore camera input while playing
}
```

### 8.2 Pausing

- The scene freezes at the exact time; items stay at their animated poses.
- The renderer idles, so the paused image converges.
- Actor-anchored overlays keep re-projecting as the camera moves.
- *Hide overlays while paused* keeps screen cards out of the way.

### 8.3 Taking the camera

- **Any camera input** (orbit, pan, wheel, WASD, view cube, fly-to) while
  `camera = follow` switches to `free` — while paused **and while
  playing**. Needs one generic `onUserInput` hook on `Camera`.
- It never switches back on its own (D10). A viewport chip shows
  *"Free camera · Return to animation view"*.
- With no camera track and no entry camera there is nothing to follow; the
  chip isn't shown.
- `kioskLock` (off by default) ignores camera input during playback.

### 8.4 Continuing

Resumes from the exact paused time. Camera per `onContinue`:

| Choice | Behaviour |
|---|---|
| **Return** | Blend to the animation view over ~0.6 s. Static target → `camera.goToPose`. Moving camera track → blend between the frozen user pose and the **live** track pose with a smoothstep weight, so it lands on a moving target without a jump. |
| **Keep my view** | Stay `free`, continue the motion. |
| **Back to my pause view** | Fly to `pausedCamera`. |

If the next part has an `entryCamera` and the camera is `free`, Continue
asks once, inline: *"Go to Step 3's view?"* (remembered for the session).

### 8.5 Space tap = play/pause (D9)

Fires on **Space key-up**, only after a clean tap:

- Mouse press while Space is held → fly-to; the tap is **consumed**.
- Another key (e.g. WASD) or a wheel event during the hold → consumed.
- Auto-repeat ignored; editable focus ignored (same `inEditable` guard as
  `camera.ts`).
- Hold longer than `tapMaxMs` (Q14, 1000 ms) → not fired.
- Only while animation mode is on (`context` guard); otherwise Space
  behaves as today.
- When it fires, `preventDefault` on the key-up too, so a focused panel
  button isn't also activated.

Built as a generic hotkey option `trigger: 'tap'` (§12.8), mirroring the
engine's existing "pure modifier hold fires on release, pointer press
consumes it" rule. `animation.playPause` defaults: `Space` (tap), `K`.

### 8.6 After each part

| `afterPart` | Behaviour |
|---|---|
| `stop` | Enter `waiting` at every part end with `pauseAtEnd`; step card shows *"Step 2 of 12 done — Continue ▶"*. |
| `playThrough` | Ignore `pauseAtEnd`. |
| `thisPartOnly` | Stop at the end of the part that was started. |

### 8.7 What a paused viewer can do

- Select, see properties (SQL Detail), measure, clip — picking and snap
  already use transformed positions.
- Scrub within the part, **Replay part**, previous/next part.
- **Save this moment** → a viewpoint with camera + `{ timeline, time }`.
- Hide or recolour items. On seek/continue the player re-applies
  visibility/opacity **only for animated actors**; other changes stay.

---

## 9. Authoring experience

### 9.1 Principles

1. **Build big animations from small parts.**
2. **The scene always shows the state where you're working** — selecting a
   part puts the scene at that part's start.
3. **Direct manipulation first** (gizmo, drag, edit text on the overlay),
   numbers second (inspector).
4. **Good defaults, zero setup**: 2 s clips, ease-in-out, holds on, links
   automatic, step card per part.
5. **Everything undoable, nothing destructive** (D12, doc undo, autosave).

### 9.2 Flow 1 — first animation

Animation panel empty state: *"Build an animation from parts"* →
**Build assembly sequence…** or **Start empty** (creates a timeline and
"Part 1", focused, ready to record).

### 9.3 Flow 2 — assembly wizard

1. **Items in build order**: from the Hierarchy selection (one part per
   node, tree or click order), or one part per child of a node. Later: order
   by a SQL column.
2. **Motion**: slide in (above / side / view direction, distance), drop in,
   appear, swing in about pivot.
3. **Presentation**: step card on/off, camera (frame each part / keep),
   pause after each part.
4. **Generate**: one part per item set, reversed template clip, chained
   `after` with a small gap, thumbnails captured. The user fixes only the
   exceptions.

### 9.4 Flow 3 — record a movement

1. Select items.
2. **Animate selection** (`A`) → actor (named after the hierarchy node) +
   clip in the focused part at the playhead → **record**. Red viewport
   frame + banner *"Recording Pump base · key 2 · 1.0 s — Enter done ·
   Esc cancel"*.
3. Gizmo drag → preview via `setSelectionTransform`; on release the drag
   `G` is folded into the key at the playhead (`D' = G · D`, decomposed back
   to `pos`/`rot` about the rest pivot). Playhead then steps forward by the
   default duration (Q11).
4. **Enter** finishes. If the clip starts in place and ends away from it:
   inline *"Play this reversed (move into place)?"* — default yes.
5. The clip plays once as feedback (toggle).

**Pull-out mode**: same, but the clip is created reversed from the start
and a ghost outline stays at the installed position.

### 9.5 Flow 4 — continue where another part ends

- **New part after** (`Ctrl+Shift+N`): part linked `after` (gap 0),
  focused, playhead at its start, scene at the previous part's end state.
- **Insert before / between**: spliced into the chain, neighbours re-linked.
- **Delete part**: the chain **heals** (option: keep the gap).
- **Reorder** (Storyboard / Parts list drag): links rewritten.
- **Magnetic linking** (Timeline): near an end → `after`; near a start →
  `with`; end on end → `endsWith`. `Alt` = drop without linking. Link chips
  are clickable.
- **Continuity warnings** (§6.7) on the part card with *Go to*.

### 9.6 Flow 5 — focus a part

Double-click a part → timeline zooms to it, outside dimmed and locked,
playhead clamped, scene at the part's start. **Play** plays the part with
optional **pre-roll** (last 2 s of the previous part). Breadcrumb
*Assembly › Step 3 › Motor*; `Esc` goes up.

### 9.7 Flow 6 — overlays without fiddling

- **Step card for every part**: one setting on the timeline; each part gets
  an instance tied to its start/end (`TimeRef`) showing
  `{{part.name}}`/`{{part.description}}`.
- **Add callout** on an animated item: anchored to the actor, shown for its
  clip. Double-click the overlay in the viewport to **edit text in place**;
  drag to move.
- **Edit style…** opens the component in the Overlay Editor (applies
  everywhere); **Detach** for a one-off.
- The editor always opens from a preset.

### 9.8 Feedback and safety

- **Doc undo/redo** (snapshot-based, size-capped). `Ctrl+Z` routes to it
  while an animation panel or record mode has focus.
- **Autosaved draft** to OPFS every few seconds; *"Recover unsaved
  animation?"* on start.
- **Problems list** (§6.7) + slot budget meter.
- **Motion paths** for the focused part; **ghost** at rest while recording.
- `InfoButton` help per section, tooltip + shortcut on every control
  (house rule), empty states that say what to do next.

---

## 10. User interface specification

All UI uses `@treDeSpaceUI` widgets and theme variables; no hard-coded
colours. Every control has a tooltip and a hotkey id (house rule). Panel
components stay under ~120 lines; state in `*.state.ts`, mutations in
`*.actions.ts`.

### 10.1 Layout and entry points

| Panel id | Title | Home | Opened from |
|---|---|---|---|
| `ribbonAnimation` | Animation | top (ribbon) | always present |
| `animation` | Animation | right | ribbon *Panel*, empty state |
| `animationTimeline` | Timeline | bottom | ribbon, Animation panel |
| `animationStoryboard` | Storyboard | bottom (tab next to Timeline) | ribbon, Animation panel |
| `animationPlayer` | Player | right | ribbon *Play*, SDK, viewpoint |
| `overlayEditor` | Overlay Editor | right (often floated) | *Edit style…*, ribbon |

**Workspace presets** (Q15), added to the Layout ribbon:

```
Animate                                    Present
┌──────────── ribbon ─────────────┐        ┌──────────── ribbon ─────────────┐
│ Hier- │                │ Anim-  │        │                       │ Player  │
│ archy │    viewport    │ ation  │        │       viewport        │         │
│       │                │ panel  │        │  (mini-player when    │         │
├───────┴────────────────┴────────┤        │   panel is hidden)    │         │
│ Timeline | Storyboard           │        └───────────────────────┴─────────┘
└─────────────────────────────────┘
```

### 10.2 Ribbon tab "Animation"

| Group | Control | Action id | Default key | Tooltip (short) |
|---|---|---|---|---|
| Mode | Animate on/off | `animation.toggleMode` | — | Enter/exit animation authoring; the scene is restored on exit |
| Mode | Timeline ▾ | — | — | Active timeline |
| Transport | Previous part | `animation.prevPart` | `Shift+J` | Jump to the previous part's start |
| Transport | Play/Pause | `animation.playPause` | `Space` (tap), `K` | Play or pause |
| Transport | Stop | `animation.stop` | — | Stop and go to the start |
| Transport | Next part | `animation.nextPart` | `Shift+L` | Jump to the next part's start |
| Transport | Loop | `animation.toggleLoop` | — | Loop the current scope |
| Transport | Speed | — | — | Playback speed |
| Create | Animate selection | `animation.animateSelection` | `A` | New clip for the selection, start recording |
| Create | Pull out | `animation.pullOut` | `Shift+A` | Record a pull-out; plays reversed as move-into-place |
| Create | New part after | `animation.newPartAfter` | `Ctrl+Shift+N` | New part starting where the current one ends |
| Create | Assembly wizard | `animation.wizard` | — | Generate a part per item in build order |
| Create | Templates ▾ | — | — | Slide out, lift & swing, rotate, spin, appear, stagger |
| Create | Add callout | `animation.addCallout` | — | Callout anchored to the selected animated item |
| Keys | Add key | `animation.addKey` | `I` | Key at the playhead for the selected actor |
| Keys | Delete key | `animation.deleteKey` | `Delete` (in timeline) | Delete selected keys |
| Keys | Previous/next key | `animation.prevKey` / `nextKey` | `J` / `L` | Move the playhead between keys |
| Keys | Auto-key | `animation.toggleAutoKey` | — | Gizmo drags write keys |
| Keys | Pivot | — | — | Reuses the Transform ribbon pivot tools |
| Clip | Reverse | `animation.reverseClip` | — | Play the selected clip backwards |
| Clip | Bake reverse | `animation.bakeReverse` | — | Rewrite keys reversed |
| Clip | Link ▾ | `animation.link*` | — | After / with / ends with / unlink |
| Clip | Group | `animation.group` | `Ctrl+G` | Group selected clips into a part |
| View | Motion paths | `animation.togglePaths` | — | Show paths of the focused part |
| View | Camera track | `animation.toggleCameraTrack` | — | Use the timeline's camera track |
| View | Overlays | `animation.toggleOverlays` | — | Show 2D overlays |
| Panels | Timeline / Storyboard / Player / Overlay Editor | `panels.*` | — | Open panels |

Keys marked for check against `src/hotkeys/bindings.ts` before merging.

### 10.3 Animation panel (`animation`)

```
┌ Animation ─────────────────────────────────────────┐
│ [New ▾] [Open…] [Save] [Undo] [Redo]   ⚠ 2  ▣ 38/4096 │
├────────────────────────────────────────────────────┤
│ ▾ Parts                                            │
│   ✓ 1 Base frame        4.0s   ▶ ⟳ ◎               │
│   ● 2 Pump skid         6.5s   ▶ ⟳ ◎   ⚠           │
│     ▸ 2.1 Motor         3.0s   ▶ ⟳ ◎               │
│     3 Piping            8.0s   ▶ ⟳ ◎               │
│   [+ New part after]                               │
│ ▸ Actors (12)                                      │
│ ▸ Sequences (9)                                    │
│ ▸ Overlays (4)                                     │
│ ▸ Problems (2)                                     │
├────────────────────────────────────────────────────┤
│ Inspector — Clip "Slide in"                        │
│  Sequence   [Slide in ▾]  [Edit]                   │
│  Start      [After ▾] [Base frame ▾] gap [0.0 s]   │
│  Speed      [1.00]   Reverse [✓]                   │
│  Hold       [✓ before] [✓ after]                   │
│  Roles      part → [Pump skid ▾]                   │
└────────────────────────────────────────────────────┘
```

Row buttons: ▶ play part, ⟳ loop part, ◎ play isolated. ⚠ = problems
badge (`Badge` tone warning). ▣ = slot budget meter.

Inspector contents by selection (discriminated union, §10.9):

| Selection | Fields |
|---|---|
| Part | name, description (`TextArea`), start link, speed, reverse, pause at end, entry camera (*Capture current*), part overlay, colour, *Save as sequence*, *Refresh thumbnail* |
| Clip | sequence, start link, speed, reverse, holds, role bindings, muted |
| Key | time (`TimeInput`), position (`Vec3Input`), rotation (`RotationInput`), easing (`EasingSelect`), spin (axis + degrees) |
| Actor | name, fullnames (one per line), pivot (center / point / *Pick*), *Select in scene*, *Replace with selection*, usage count |
| Overlay instance | component (`Select`) + *Edit style…* / *Detach*, generated value form, anchor, scale, show/hide refs, enter/exit effect |
| Nothing | timeline settings: name, default part overlay, camera track, default clip duration, default easing |

### 10.4 Timeline panel (`animationTimeline`)

```
┌ ⏮ ▶ ⏭  00:12.40 / 01:30.00   Assembly › Step 2      snap ✓  − zoom + ┐
│              │0s      5s      10s   ▼  15s      20s      25s          │
│ ▾ Step 1     │▕▔▔▔▔▔▔▔▔▔▔▔▔▔▏                                         │
│   Base frame │[■■ Slide in ⟲ ■■]                                      │
│ ▾ Step 2     │              ▕▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▏                  │
│   Pump skid  │              ⇢[■■■ Drop in ⟲ ■■■]                      │
│     ↳ xform  │               ◇·······◇·····◇                          │
│   Valve V-12 │                        ⇢[■ Rotate ■]⇢[■ Spin ■]        │
│   Step card  │              (━━━━━━━━━━━━━━━━━━━━━━━━)                │
│ ◆ markers    │        ◆                     ◆                         │
└───────────────────────────────────────────────────────────────────────┘
```

Legend: `▕▔▔▏` group span bar (tinted), `[■ ■]` clip, `⟲` reversed, `⇢`
link, `◇` key, `(━━)` overlay span, `▼` playhead, `◆` marker.

| Interaction | Result |
|---|---|
| Click ruler / drag playhead | Seek (scene updates) |
| Drag clip / group bar | Move (edits link gap/offset, ripples) |
| Drag clip edge | Right edge: speed; `Shift`: change sequence duration |
| Drop near another's end/start | Magnetic link (`Alt` = no link) |
| Drag key diamonds, box select | Retime keys (snap to keys/markers/grid) |
| Double-click clip | Open its sequence (local time, same widget) |
| Double-click group | Focus part |
| Right-click | Context `Menu` (play part, loop, isolated, reverse, duplicate reversed, group/ungroup, save as sequence, unlink, delete) |
| `Ctrl+wheel` / `−`/`+` | Zoom; `Shift+wheel` pan |
| `Ctrl+G`, `Delete`, `Ctrl+D` | Group, delete, duplicate |
| Ruler in/out handles | Ad-hoc `range` scope |

### 10.5 Storyboard panel (`animationStoryboard`)

```
┌ Storyboard ───────────────────────────────────────────────────────────┐
│ ┌────────┐        ┌────────┐           ┌────────┐        ┌────────┐   │
│ │ thumb  │─then──▶│ thumb  │─then +1s─▶│ thumb ⚠│─then──▶│ thumb  │ + │
│ │1 Base  │   +    │2 Pump  │     +     │3 Motor │   +    │4 Piping│   │
│ │ 4.0s   │        │ 6.5s   │           │ 3.0s   │        │ 8.0s   │   │
│ └────────┘        └───┬────┘           └────────┘        └────────┘   │
│                       └─together─▶┌────────┐                          │
│                                   │2b Valve│                          │
│                                   └────────┘                          │
└───────────────────────────────────────────────────────────────────────┘
```

- Card: thumbnail, number, name, duration, warning badge, ▶ on hover.
- Chips between cards: *then* / *together* / *ends with* / *+gap*;
  click → small popover to change or unlink.
- `+` between cards inserts a part; drag to reorder; drop on a card's lower
  edge → *together*.
- Click = select + seek to the part's start; double-click = Focus.
- Wraps to rows on narrow panels.

### 10.6 Player panel and mini-player

```
┌ Player ─ [Assembly ▾] ──────────────────────────────┐
│ ✓ 1  Base frame           4.0s                      │
│ ▶ 2  Pump skid            6.5s  ████████░░░  paused │
│      Lift the skid onto the base and align bolts.   │
│   3  Motor                3.0s                      │
│   4  Piping               8.0s                      │
├─────────────────────────────────────────────────────┤
│  ⏮   [ ▶ Continue | ▾ ]   ⏭    ↻ Replay   1× ▾     │
│  ●━━━━━━━━━━━○──────────  00:07.2 / 00:10.5 (part)  │
│  Camera: free   [Return to animation view]          │
│  After each part [Stop ▾]   ☐ Hide overlays paused  │
│  [☆ Save this moment]                               │
└─────────────────────────────────────────────────────┘

Mini-player (floating over the viewport, bottom centre):
┌───────────────────────────────────────────────────┐
│ 2/4 Pump skid  ⏮ ▶ ⏭  ●━━━━○───  📷 free · Return │
└───────────────────────────────────────────────────┘
```

- Main button label follows `status`: *Play* / *Pause* / *Continue*.
  Dropdown: Return / Keep my view / Back to my pause view.
- Scrubber is scoped to the current part (toggle to whole timeline).
- Mini-player shows when the Player panel is hidden or in fullscreen;
  48 px touch targets on touch devices.

### 10.7 Overlay Editor panel (`overlayEditor`)

```
┌ Library ──────┬ Preview ─────────────────────────┬ Inspector ──────┐
│ ▾ Components  │ [1080p ▾] [bg: scene ▾] [▶ fx]   │ Block: text     │
│   Callout     │                                  │  Text [{{title}}]│
│   Step card ● │   ┌───────────────────────┐      │  Size  [24 ]    │
│   Caption     │   │ ▣  STEP 3 / 12        │      │  Weight[600 ▾]  │
│ ▾ Themes      │   │    Mount pump base    │      │  Color [$accent]│
│   Default     │   │ ───────────────────── │      │  Align [◧◫◨]    │
│ [+ New ▾]     │   │ Torque bolts to 80 Nm │      │ ─────────────── │
│ ─ Outline ─── │   └───────────────────────┘      │ Params          │
│ ▾ box         │                                  │  title   text   │
│   icon        │ Sample values                    │  body    rich   │
│   ▾ box       │  title [Mount pump base   ]      │  image   image  │
│     text      │  body  [Torque bolts to…  ]      │  [+ param]      │
│   divider     │                                  │                 │
│   text        │ Used by 14 instances             │                 │
│ [+ block ▾]   │ [Undo] [Redo]        [Save]      │                 │
└───────────────┴──────────────────────────────────┴─────────────────┘
```

Narrow panel: the three areas become tabs (`VerticalTabs`).

### 10.8 Viewport while animation mode is on

| Element | When | Notes |
|---|---|---|
| Red frame + record banner | `record` | Banner: actor, key count, time, `Enter`/`Esc` hints |
| Ghost outline at rest pose | `record` (pull-out) | Outline pass, depth-tested |
| Motion paths | focused part, toggle | Polyline of pivot + key dots (like `markerLines.ts`) |
| Camera chip | `camera = free` and something to follow | *Return to animation view* |
| Step card / overlays | playback | `AnimOverlay` layer |
| Overlay handles | authoring, overlay selected | Drag to move, pin grid, double-click to edit text |
| Mini-player | Player panel hidden | §10.6 |
| Continuity toast | after a structural edit that creates warnings | `toast` with *Show* |

### 10.9 UI state machine

`src/state/animation/animationUi.state.ts`

```ts
type AnimationUiMode =
  | { kind: 'off' }
  | { kind: 'playback' }                                     // Player only
  | { kind: 'author'; focus: string | null }                 // focus = part id
  | { kind: 'record'; clip: string; actor: string; pullOut: boolean; keyCount: number }
  | { kind: 'placeOverlay'; instance: string }
  | { kind: 'editOverlayText'; instance: string; param: string }
  | { kind: 'wizard'; step: 1 | 2 | 3 };

type InspectorTarget =
  | { kind: 'none' }
  | { kind: 'part'; id: string }
  | { kind: 'clip'; id: string }
  | { kind: 'keys'; track: string; ids: number[] }            // key indices
  | { kind: 'actor'; id: string }
  | { kind: 'overlay'; id: string };
```

Transitions:

```
off ──toggleMode──▶ author ──animateSelection──▶ record ──Enter/Esc──▶ author
 │                    │ ▲                                              
 │                    │ └──Esc── placeOverlay / editOverlayText ◀──┐   
 │                    └──addCallout / dbl-click overlay────────────┘   
 └──Player play──▶ playback ──Stop / close Player──▶ off
author ──toggleMode──▶ off   (exit restores the scene)
```

Record is only reachable from `author`; `playback` never enables editing.

### 10.10 Hotkeys

Category **Animation** in the Shortcuts settings. All rebindable.
`context` guard: animation mode on (except `toggleMode`).

| Id | Default | Notes |
|---|---|---|
| `animation.playPause` | `Space` (tap), `K` | §8.5 |
| `animation.stop` | — | |
| `animation.prevPart` / `nextPart` | `Shift+J` / `Shift+L` | |
| `animation.prevKey` / `nextKey` | `J` / `L` | |
| `animation.animateSelection` | `A` | author only |
| `animation.pullOut` | `Shift+A` | author only |
| `animation.finishRecord` / `cancelRecord` | `Enter` / `Esc` | record only |
| `animation.addKey` | `I` | author only |
| `animation.newPartAfter` | `Ctrl+Shift+N` | author only |
| `animation.group` | `Ctrl+G` | timeline focus |
| `animation.returnCamera` | `R`? | check conflicts |
| `animation.undo` / `redo` | `Ctrl+Z` / `Ctrl+Y` | animation panels or record focus |

### 10.11 Visual language

| Meaning | Style |
|---|---|
| Recording | `danger` tone (frame, banner, record button) |
| Warning / continuity | `warning` tone badge |
| Reversed clip | `⟲` icon + diagonal hatch on the clip |
| Linked | `⇢` connector; chip in Storyboard |
| Part tint | group `color`, used on span bar and card border |
| Current part | `info` tone left border in lists |
| Done part | muted text + ✓ |
| Dimmed (outside focus) | 40 % opacity, not interactive |

Icons from `@tabler/icons-react` (already a dependency).

### 10.12 Accessibility, keyboard and touch

- Timeline: arrow keys move the playhead (`Shift` = 1 s), `Tab` cycles
  lanes, `Enter` opens the selected item; items have `aria-label`s with
  name, start and duration.
- Lists (Parts, Player): full keyboard navigation, `Enter` plays.
- Touch (pad layouts): Player and mini-player are touch-first; authoring is
  desktop-first in v1.
- All colour meaning is paired with an icon or text.

---

## 11. 2D overlay components

### 11.1 Model

Location: `src/state/overlayComponents/overlayComponents.state.ts`.

```ts
interface OverlayComponent {
  id: string;
  name: string;
  version: number;              // bumped on every save
  params: OverlayParam[];
  root: OverlayBlock;
  size: { width: number | 'auto'; height: number | 'auto' };
  /** px scale with viewport height relative to this (1080 = 1:1) */
  designHeight: number;
}

type OverlayParam =
  | { key: string; label: string; type: 'text' | 'richText'; default: string }
  | { key: string; label: string; type: 'image'; default: string | null }   // data: URI
  | { key: string; label: string; type: 'color'; default: string }
  | { key: string; label: string; type: 'number'; default: number }
  | { key: string; label: string; type: 'toggle'; default: boolean };

type OverlayBlock =
  | { kind: 'box'; id: string; style: BoxStyle; layout: FlexLayout; children: OverlayBlock[]; showIf?: string }
  | { kind: 'text'; id: string; style: TextStyle; text: string; rich: boolean; showIf?: string }
  | { kind: 'image'; id: string; style: BoxStyle; src: string; fit: 'contain' | 'cover'; showIf?: string }
  | { kind: 'icon'; id: string; style: TextStyle; icon: string; showIf?: string }
  | { kind: 'divider'; id: string; style: BoxStyle; showIf?: string }
  | { kind: 'progress'; id: string; style: BoxStyle; value: string; showIf?: string };

interface BoxStyle {
  bg?: string; opacity?: number;
  padding?: [number, number, number, number];
  margin?: [number, number, number, number];
  border?: { width: number; color: string; style: 'solid' | 'dashed' };
  radius?: number;
  shadow?: 'none' | 'sm' | 'md' | 'lg';
  width?: number | 'auto' | 'fill';
  height?: number | 'auto' | 'fill';
}

interface TextStyle {
  color?: string; size?: number; weight?: 400 | 500 | 600 | 700;
  align?: 'left' | 'center' | 'right'; font?: 'ui' | 'mono' | 'serif';
  lineHeight?: number; maxLines?: number;
}

interface FlexLayout {
  dir: 'row' | 'col'; gap: number;
  align: 'start' | 'center' | 'end' | 'stretch';
  justify: 'start' | 'center' | 'end' | 'between';
}

/** Colours referenced as "$accent", "$bg", … */
interface OverlayTheme { id: string; name: string; tokens: Record<string, string> }

interface OverlayInstance {
  id: string;
  component: string;
  componentVersion: number;
  values: Record<string, string | number | boolean | null>;
  theme: string | null;
  anchor:
    | { kind: 'screen'; pos: [number, number]; pin: Pin }          // 0..1
    | { kind: 'actor'; actor: string; offset: [number, number]; leader: boolean }
    | { kind: 'world'; pos: V3; offset: [number, number]; leader: boolean };
  scale: number;
}

type Pin = 'tl' | 't' | 'tr' | 'l' | 'c' | 'r' | 'bl' | 'b' | 'br';

type OverlayFx =
  | { kind: 'none' }
  | { kind: 'fade'; duration: number }
  | { kind: 'pop'; duration: number }       // scale 0.8→1 + fade
  | { kind: 'slide'; from: 'left' | 'right' | 'top' | 'bottom'; duration: number };
```

### 11.2 Text templates and bindings

| Placeholder | Value |
|---|---|
| `{{<param>}}` | Instance value, else the param default |
| `{{part.name}}`, `{{part.description}}`, `{{part.index}}`, `{{part.count}}` | Current part |
| `{{step.name}}` | Latest marker |
| `{{actor.name}}` | Anchored actor |
| `{{time}}`, `{{duration}}` | Formatted playhead / timeline length |
| `{{prop.TAG}}` *(later)* | Item property from the model DB for the anchored actor |

Unknown placeholders render empty and are flagged in the editor.
`showIf: "<param>"` hides a block when that toggle is false or that text is
empty.

### 11.3 Rendering and safety (D13)

- `renderOverlay()` (lit-html, already a dependency) builds the DOM from
  the block tree. lit-html only touches changed parts, so `{{time}}` per
  frame is cheap.
- Text → `escapeHtml` / `richTextHtml` (`src/lib/richText.ts`). Styles →
  whitelisted fields mapped to CSS in code. Colours validated (hex, rgb,
  theme token). Images: `data:image/(png|jpeg|webp|svg+xml)` only, size cap
  (Q6); SVG is rendered through `<img>`, never inlined. Icons from a fixed
  list.
- The same function renders the editor preview and the viewport layer.

### 11.4 Storage (D14)

- Library: `overlay_components.json` in OPFS; add it to
  `VIEWER_OPFS_ENTRIES` (`src/lib/opfs/opfs.ts`) so *Clear all local data*
  covers it.
- Saving an animation embeds every used component and theme.
- On load, same id with a different version → choose: use file's / use
  library's / import as new.
- Shipped presets: Callout, Caption bar, Title card, Step card (with
  progress), Info card with image, Warning banner.

---

## 12. Code interfaces

These are the contracts. Names may be adjusted during implementation;
update this section in the same change.

### 12.1 File map

```
src/lib/animation/                 pure + runtime, no React
  types.ts                         re-exports doc types used by lib code
  interp.ts                        easing, slerp, spin, pose → mat4, decompose
  resolve.ts                       links → absolute spans, cycles, part order
  evaluate.ts                      FrameState at T for a scope
  continuity.ts                    problems list (§6.7)
  swept.ts                         swept bounds per actor
  io.ts                            parse/validate/migrate/serialize
  templates.ts                     slide/lift/rotate/spin/appear/stagger generators
  wizard.ts                        assembly wizard generator
  slots.ts                         slot table + band writes (main thread)
  player.ts                        clock, scope, marker/part pauses, diffs
  cameraBlend.ts                   follow / return blend
src/lib/overlay/
  overlayTemplate.ts               renderOverlay(), bindings, style mapping
  AnimOverlay.ts                   viewport layer
src/lib/modeldb/
  apiAnimation.ts                  NEW worker API (§12.5)
  transformPool.ts                 reserved band support
src/state/animation/
  animationDoc.state.ts / .actions.ts     doc + undo + autosave
  player.state.ts / .actions.ts           §8.1
  animationUi.state.ts / .actions.ts      §10.9
  record.actions.ts                       record flow
src/state/overlayComponents/
  overlayComponents.state.ts / .actions.ts
src/components/panels/
  ribbon-animation/                RibbonAnimation.tsx + group files
  animation/                       Animation.tsx, PartsSection.tsx, Inspector*.tsx, ProblemsSection.tsx
  animation-timeline/              AnimationTimeline.tsx, useTimelineModel.ts
  animation-storyboard/            Storyboard.tsx, PartCard.tsx
  animation-player/                Player.tsx, MiniPlayer.tsx
  overlay-editor/                  OverlayEditor.tsx, Outline.tsx, BlockInspector.tsx, ParamsEditor.tsx
src/treDeSpaceUI/widgets/          new widgets (§12.10)
src/hotkeys/bindings.ts            Animation category
api/tredespace-client.ts           SDK commands (§14)
```

### 12.2 Stores and actions

```ts
// animationDoc.actions.ts
interface AnimationDocActions {
  newDoc(name?: string): void;
  loadFromText(text: string): Promise<LoadReport>;
  saveToFile(): void;
  recoverDraft(): Promise<boolean>;
  undo(): void;
  redo(): void;

  addActorFromSelection(): Promise<string>;          // actor id
  updateActor(id: string, patch: Partial<Actor>): void;

  createPart(opts: { after?: string; parent?: string | null; name?: string }): string;
  insertPartBefore(id: string): string;
  deletePart(id: string, opts: { keepGap: boolean }): void;
  movePart(id: string, to: { parent: string | null; index: number }): void;
  updatePart(id: string, patch: Partial<ClipGroup>): void;
  groupClips(ids: string[]): string;
  ungroup(id: string): void;
  saveGroupAsSequence(id: string): string;

  addClip(opts: { sequence: string; group: string | null; start: ClipStart }): string;
  updateClip(id: string, patch: Partial<ClipInstance>): void;
  link(id: string, start: ClipStart): void;          // clip or group
  unlink(id: string): void;
  bakeReverse(sequenceId: string): void;

  setKey(trackId: string, key: TransformKey | StepKey<unknown>): void;
  moveKeys(trackId: string, indices: number[], dt: number): void;
  deleteKeys(trackId: string, indices: number[]): void;

  applyTemplate(kind: TemplateKind, opts: TemplateOptions): string; // clip id
  runWizard(opts: WizardOptions): Promise<string[]>;                // part ids

  addOverlayInstance(opts: { component: string; anchor: OverlayInstance['anchor'];
    show: TimeRef; hide: TimeRef }): string;
  updateOverlayInstance(id: string, patch: Partial<OverlayInstance>): void;
}

interface LoadReport {
  ok: boolean;
  errors: string[];
  unresolvedActors: { actor: string; missing: number }[];
  componentConflicts: { id: string; fileVersion: number; libraryVersion: number }[];
}

// record.actions.ts
interface RecordActions {
  start(opts: { pullOut: boolean }): Promise<void>;   // from selection
  commitGizmo(dragMatrix: Float32Array): void;       // on gizmo release
  finish(): void;                                    // Enter
  cancel(): void;                                    // Esc
}

// player.actions.ts
interface PlayerActions {
  enter(timeline: string, mode: 'playback' | 'author'): Promise<void>;
  exit(): Promise<void>;
  play(scope?: PlayScope): void;
  pause(): void;
  togglePlay(): void;
  continue(camera?: PlayerState['onContinue']): void;
  stop(): void;
  seek(time: number): void;
  playPart(id: string, opts?: { isolated?: boolean; loop?: boolean }): void;
  gotoPart(id: string): void;                        // paused at its start
  nextPart(): void;
  prevPart(): void;
  replayPart(): void;
  returnCamera(): void;
  userTookCamera(): void;                            // from Camera.onUserInput
  saveMoment(): Promise<string>;                     // viewpoint id
  set(patch: Partial<Pick<PlayerState,
    'afterPart' | 'onContinue' | 'speed' | 'loop' | 'hideOverlaysWhilePaused' | 'kioskLock'>>): void;
}
```

### 12.3 Pure core

```ts
// resolve.ts
interface ResolvedTimeline {
  duration: number;
  clips: ReadonlyMap<string, Span>;
  groups: ReadonlyMap<string, Span>;
  parts: readonly string[];            // depth-first playable order
  errors: readonly ResolveError[];
}
interface Span { start: number; end: number; depth: number; reverseParity: boolean; speed: number }
type ResolveError = { kind: 'cycle'; ids: string[] } | { kind: 'missingTarget'; id: string; target: string };

function resolveTimeline(doc: AnimationDoc, timelineId: string): ResolvedTimeline;

// evaluate.ts
interface FrameState {
  poses: ReadonlyMap<string, Float32Array>;     // actor → delta mat4 (column-major)
  visible: ReadonlyMap<string, boolean>;
  opacity: ReadonlyMap<string, number>;
  overlays: readonly OverlayFrame[];
  camera: ViewpointCamera | null;
  part: string | null;
}
interface OverlayFrame { instance: string; progress: number; phase: 'enter' | 'shown' | 'exit' }

function evaluate(doc: AnimationDoc, r: ResolvedTimeline, t: number, scope: PlayScope): FrameState;

// interp.ts
function ease(kind: Easing, u: number): number;
function poseMatrix(key: Pick<TransformKey, 'pos' | 'rot'>, pivot: V3, out: Float32Array): Float32Array;
function decomposeRigid(m: Float32Array, pivot: V3): { pos: V3; rot: Quat };
function sampleTransformTrack(keys: readonly TransformKey[], local: number, out: Float32Array, pivot: V3): Float32Array;

// continuity.ts
type Problem =
  | { kind: 'jump'; clip: string; actor: string; distance: number; angle: number }
  | { kind: 'hiddenMove'; clip: string; actor: string }
  | { kind: 'unresolvedActor'; actor: string; missing: number }
  | { kind: 'cycle'; ids: string[] }
  | { kind: 'missingComponent'; instance: string };
function checkContinuity(doc: AnimationDoc, r: ResolvedTimeline, rest: RestInfo): Problem[];

// swept.ts
function sweptBounds(doc: AnimationDoc, r: ResolvedTimeline, actor: string,
  restBounds: Float32Array /* 6 */, samplesPerSecond: number): Float32Array /* 6 */;
```

### 12.4 Runtime

```ts
// slots.ts — main thread
interface SlotBinding { actor: string; slot: number; base: Float32Array }
class AnimationSlots {
  constructor(bindings: readonly SlotBinding[], firstSlot: number, count: number);
  /** write D·base for every binding into the band buffer */
  write(poses: ReadonlyMap<string, Float32Array>): void;
  /** upload the band (after write, and after any full-pool upload) */
  upload(renderer: Renderer): void;
}

// player.ts — main thread, driven from the viewport tick
class AnimationPlayer {
  constructor(deps: { renderer: Renderer; slots: AnimationSlots; overlay: AnimOverlay });
  tick(nowMs: number): void;               // advances clock, evaluates, writes, diffs vis/opacity
  applyAt(t: number): void;                // seek (stateless)
  onFullPoolUpload(): void;                // re-apply band (hazard §7.3)
  dispose(): void;
}
```

Hook-up: `viewport.ts` tick (next to `labelOverlay?.update()`) calls
`player?.tick(now)` then `animOverlay?.update()`.

### 12.5 Worker API — `apiAnimation.ts`

Spread into the worker API like the other domain modules
(`modeldbWorker.ts`).

```ts
interface AnimEnterResult {
  bindings: { actor: string; slot: number; base: Float32Array }[];
  unresolved: { actor: string; fullnames: string[] }[];
  restBounds: Record<string, Float32Array>;  // actor → [minx,miny,minz,maxx,maxy,maxz]
  restCenter: Record<string, V3>;
  updates: StateUpdate[];
}

interface AnimationWorkerApi {
  animEnter(actors: { id: string; fullnames: string[] }[]): AnimEnterResult;
  animExit(): StateUpdate[];
  animSetVisibility(changes: { actor: string; visible: boolean }[]): StateUpdate[];
  animSetOpacity(changes: { actor: string; value: number }[]): StateUpdate[];
  animSetSweptBounds(bounds: Record<string, Float32Array>): void;
  animActorFromSelection(): { name: string; fullnames: string[]; center: V3 } | null;
  animSelectActor(fullnames: string[]): StateUpdate[];
}
```

`transformPool.ts` additions:

```ts
export const TRANSFORM_POOL: number;          // 16384 (Q4)
export const ANIM_BAND_FIRST: number;         // TRANSFORM_POOL - ANIM_BAND_SIZE
export const ANIM_BAND_SIZE: number;          // 4096
// allocTransformSlot() wraps before ANIM_BAND_FIRST
export function allocAnimSlot(): number | null;
export function resetAnimBand(): void;
```

### 12.6 Renderer additions

```ts
class Renderer {
  /** Partial upload: `data.length / 16` slots starting at `firstSlot`. */
  writeTransformSlots(firstSlot: number, data: Float32Array): void;
  /** Called after writeTransforms() so the player can re-apply its band. */
  onTransformsUploaded?: () => void;
}
```

Buffer size and the `writeTransforms` clamp use `TRANSFORM_POOL`, not a
literal.

### 12.7 Camera additions

```ts
type CameraInputKind = 'orbit' | 'pan' | 'dolly' | 'fly' | 'viewCube' | 'flyTo' | 'touch';

class Camera {
  /** Fired on any user-driven camera change (not on programmatic goToPose). */
  onUserInput?: (kind: CameraInputKind) => void;
  /** Ignore user input (kiosk lock). */
  inputLocked: boolean;
}
```

### 12.8 Hotkey engine addition (`@treDeSpaceUI/hotkeys`)

```ts
interface HotkeyDef {
  // …existing fields
  /** 'press' (default) fires on keydown. 'tap' fires on key-up of a single
   *  key, only if no other key, pointer press or wheel happened while it was
   *  held and it was held no longer than tapMaxMs. */
  trigger?: 'press' | 'tap';
  tapMaxMs?: number;   // default 1000
}
```

Library change → update the widget gallery and `src/treDeSpaceUI/README.md`
(hotkey section).

### 12.9 Overlay renderer

```ts
interface BindingContext {
  part: { name: string; description: string; index: number; count: number } | null;
  step: { name: string } | null;
  actorName: string | null;
  time: number;
  duration: number;
}

function renderOverlay(component: OverlayComponent, values: OverlayInstance['values'],
  theme: OverlayTheme | null, ctx: BindingContext): TemplateResult;
function listPlaceholders(component: OverlayComponent): { key: string; known: boolean }[];

class AnimOverlay {
  constructor(host: HTMLElement, renderer: Renderer);
  update(frames: readonly OverlayFrame[], ctx: BindingContext): void;
  setInteractive(on: boolean): void;                          // authoring handles
  onMove?: (instance: string, anchor: OverlayInstance['anchor']) => void;
  onEditText?: (instance: string, param: string, value: string) => void;
  dispose(): void;
}
```

### 12.10 New `@treDeSpaceUI` widgets

All generic (no animation types), JSDoc on props, gallery tab + README
section each.

```ts
// Timeline — widgets/timeline/
interface TimelineRow { id: string; kind: 'group' | 'lane'; depth: number; label: ReactNode;
  collapsed?: boolean; tint?: string; locked?: boolean }
interface TimelineItem { id: string; row: string; start: number; end: number; label: string;
  tint?: string; selected?: boolean; hatched?: boolean; icon?: ReactNode;
  linkFrom?: { id: string; kind: string } }
interface TimelinePoint { id: string; row: string; t: number; shape: 'diamond' | 'marker';
  selected?: boolean }
interface TimelineProps {
  rows: readonly TimelineRow[];
  items: readonly TimelineItem[];
  points: readonly TimelinePoint[];
  playhead: number;
  view: { pxPerSec: number; offset: number };
  range?: { from: number; to: number } | null;
  dimOutside?: { from: number; to: number } | null;
  snap?: { enabled: boolean; step: number; targets: readonly number[] };
  onViewChange(view: { pxPerSec: number; offset: number }): void;
  onSeek(t: number): void;
  onItemsMove(ids: readonly string[], dt: number, dropHint: DropHint | null): void;
  onItemResize(id: string, edge: 'start' | 'end', t: number, shift: boolean): void;
  onPointsMove(ids: readonly string[], dt: number): void;
  onSelect(sel: { items: string[]; points: string[] }, additive: boolean): void;
  onToggleRow(id: string): void;
  onOpen(target: { kind: 'item' | 'row'; id: string }): void;
  onContextMenu(target: { kind: 'item' | 'row' | 'point' | 'empty'; id?: string; t: number },
    at: { x: number; y: number }): void;
  onRangeChange?(range: { from: number; to: number } | null): void;
}
type DropHint = { kind: 'after' | 'with' | 'endsWith'; target: string } ;

interface TimeRulerProps {
  view: { pxPerSec: number; offset: number };
  duration: number;
  playhead: number;
  format?: (t: number) => string;
  range?: { from: number; to: number } | null;
  onSeek(t: number): void;
  onViewChange(view: { pxPerSec: number; offset: number }): void;
  onRangeChange?(range: { from: number; to: number } | null): void;
}

interface CardFlowProps<T> {
  cards: readonly T[];
  getId(card: T): string;
  renderCard(card: T, state: { selected: boolean; dragging: boolean }): ReactNode;
  connectors: readonly { from: string; to: string; label: string; branch?: boolean }[];
  selected: string | null;
  onSelect(id: string): void;
  onOpen(id: string): void;
  onReorder(id: string, toIndex: number): void;
  onInsert(index: number): void;
  onDropOnto?(id: string, target: string, zone: 'bottom'): void;
  onConnectorClick?(from: string, to: string, at: { x: number; y: number }): void;
}

interface ChapterListRow { id: string; depth: number; title: string; subtitle?: string;
  duration?: string; status: 'done' | 'current' | 'upcoming'; progress?: number; warning?: boolean }
interface ChapterListProps {
  rows: readonly ChapterListRow[];
  expanded?: string | null;
  renderActions?(row: ChapterListRow): ReactNode;
  renderDetail?(row: ChapterListRow): ReactNode;
  onActivate(id: string): void;
  onReorder?(id: string, to: { parentId: string | null; index: number }): void;
}

interface TransportControlsProps {
  status: 'stopped' | 'playing' | 'paused' | 'waiting';
  onPlayPause(): void; onStop?(): void; onPrev?(): void; onNext?(): void;
  shortcuts?: { playPause?: string; stop?: string; prev?: string; next?: string };
  playMenu?: ReactNode;   // SplitButton dropdown
}

interface TimeInputProps { value: number; onChange(v: number): void; min?: number; max?: number;
  format?: 'seconds' | 'mmss' | 'frames'; fps?: number }
interface EasingSelectProps<E extends string> { value: E; options: readonly { value: E; label: string;
  curve(u: number): number }[]; onChange(v: E): void }
interface RotationInputProps { value: [number, number, number, number]; onChange(q: [number, number, number, number]): void;
  mode?: 'euler' | 'axisAngle' }
interface SplitButtonProps { label: ReactNode; onClick(): void; menu: readonly MenuEntry[];
  tooltip?: string; shortcut?: string }
interface BreadcrumbsProps { items: readonly { id: string; label: string }[]; onSelect(id: string): void }

// overlay editor widgets
interface BoxSidesInputProps { value: [number, number, number, number]; onChange(v: [number, number, number, number]): void }
interface BorderInputProps { value: { width: number; color: string; style: 'solid' | 'dashed' } | null;
  onChange(v: BorderInputProps['value']): void }
interface ImagePickerProps { value: string | null; onChange(v: string | null): void;
  maxBytes: number; accept?: string }
interface IconSelectProps { value: string; icons: readonly { name: string; node: ReactNode }[];
  onChange(v: string): void }
interface TemplateTextInputProps { value: string; onChange(v: string): void;
  placeholders: readonly { key: string; label: string }[]; multiline?: boolean }
interface ParamListEditorProps<P> { value: readonly P[]; onChange(v: P[]): void;
  types: readonly { value: string; label: string }[] }
```

Check before adding: `TreeView` reorder support, `Button` + `Menu` for
`SplitButton`, `SqlCodeEditor` highlighting approach for
`TemplateTextInput`.

---

## 13. Persistence and file format

| What | Where | Notes |
|---|---|---|
| Animation doc | `*.tdanim.json` via Save/Load | `format` + `version` checked; migrations in `io.ts` |
| Draft | OPFS `animation_draft.json` | Autosave every ~5 s while dirty; offered on start; add to `VIEWER_OPFS_ENTRIES` |
| Overlay library | OPFS `overlay_components.json` | Per user (D14) |
| Player preferences | `localStorage` (actions module) | `afterPart`, `onContinue`, `hideOverlaysWhilePaused` |
| Viewpoint link | viewpoint JSON: optional `animation: { timeline, time? , part? }` | Optional field; old viewpoints unaffected |

Not persisted automatically: the doc itself (model-tied, like viewpoints).

Load rules:

- Unknown `format` or newer `version` → error dialog, nothing changes.
- Unresolved fullnames → actor kept, reported in Problems.
- Component version conflicts → choice dialog (§11.4).

---

## 14. postMessage SDK

Each command needs JSDoc in `api/tredespace-client.ts` and a section with a
fenced `js` example in `EVENTS.md` (the build enforces this).

| Command | Payload | Response |
|---|---|---|
| `animation.load` | `{ doc }` | `LoadReport` |
| `animation.get` | — | `{ doc }` |
| `animation.setMode` | `{ mode: 'off' \| 'playback' \| 'author', timeline? }` | `{ ok }` |
| `animation.play` | `{ scope? }` | `{ ok }` |
| `animation.pause` | — | `{ ok }` |
| `animation.continue` | `{ camera?: 'return' \| 'keep' \| 'pauseView' }` | `{ ok }` |
| `animation.seek` | `{ time }` | `{ ok }` |
| `animation.listParts` | `{ timeline? }` | `{ parts: { id, name, description, start, end, depth }[] }` |
| `animation.playPart` | `{ id, isolated?, loop? }` | `{ ok }` |
| `animation.gotoMarker` | `{ id }` | `{ ok }` |
| `animation.returnCamera` | — | `{ ok }` |
| `animation.getState` | — | `PlayerState` subset |

| Event | Payload |
|---|---|
| `animation.stateChanged` | `{ status, time, part, camera }` (throttled) |
| `animation.partStarted` / `animation.partEnded` | `{ id, name, index }` |
| `animation.marker` | `{ id, name, time }` |
| `animation.ended` | `{ timeline }` |

Later (Q8): `overlays.setComponent`, `animation.setOverlayValues`.

---

## 15. Testing and verification

**Unit (vitest, `tests/`)**

- `animationResolve.test.ts`: after/with/endsWith, nested groups, ripple,
  cycles, group speed/reverse, part order.
- `animationEvaluate.test.ts`: identity keys, easing, slerp, spin > 180°,
  reverse + holds, composition order, stepped vis/opacity, isolated scope,
  seek-into-part equals play-through at the same T.
- `animationInterp.test.ts`: `poseMatrix` ↔ `decomposeRigid` round trip,
  gizmo fold `G · D`.
- `animationIo.test.ts`: round trip, version errors, migration.
- `overlayTemplate.test.ts`: placeholders, escaping, style whitelist,
  rejected image URIs.
- `hotkeyTap.test.ts`: tap fires; pointer/other key/wheel/long hold/repeat/
  editable focus consume it.

**In-app checks (manual, listed in the PR)**

- Pool wrap: fill committed slots past the band boundary with animation
  running → no animated item jumps.
- Full-pool upload during playback (nudge another item) → no flicker.
- Residency: animate a part far outside its rest box → not evicted.
- Pause → orbit → Continue with each camera choice, with and without a
  camera track; kiosk lock.
- Space: tap, Space+click fly-to, Space+W, long hold, focus in a text
  field, focused panel button.
- Exit mode restores every `tidx`; transform undo stack unchanged.
- TAA/AO reconverge when paused.
- `npm run check:size`, `npm run typecheck`, `npm test`, `npm run build`
  (docs enforcement).

---

## 16. Phases and tasks

Each phase is shippable. Tick tasks as they land.

### Phase 1 — Engine prerequisites
- [ ] Cull upgrade behind a toggle (ANIMATION.md)
- [ ] `TRANSFORM_POOL` constant used by renderer buffer + clamp; raise to 16384 (Q4)
- [ ] Reserved animation band; `allocTransformSlot` never enters it
- [ ] `apiAnimation.animEnter` / `animExit` (capture/restore runs)
- [ ] `renderer.writeTransformSlots`, `onTransformsUploaded`
- [ ] Debug hook "spin the selection" through the band
- **Done when:** a debug spin runs at full frame rate, exit restores the scene, pool-wrap check passes.

### Phase 2 — Pure core
- [ ] Doc types + `io.ts` (validate, version)
- [ ] `interp.ts`, `resolve.ts`, `evaluate.ts`, `continuity.ts`, `swept.ts`
- [ ] Unit tests from §15
- **Done when:** all core tests pass; a hand-written doc evaluates correctly at arbitrary T.

### Phase 3 — Player (viewer story)
- [ ] `player.state` / `player.actions`, `AnimationPlayer`, `AnimationSlots`
- [ ] Stepped visibility/opacity diffs → worker
- [ ] `Camera.onUserInput`, `inputLocked`; free/follow; return via `goToPose`; pause view
- [ ] Hotkey `trigger: 'tap'` (+ gallery/README); `animation.playPause` = Space tap / K
- [ ] Widgets: `ChapterList`, `TransportControls`, `SplitButton`
- [ ] Player panel + mini-player; after-part modes; replay; save moment
- [ ] Load doc from file (Player only)
- **Done when:** a viewer can load a hand-written doc, play part 2, pause, orbit, continue with each camera choice.

### Phase 4 — Authoring core loop
- [ ] `animationDoc.actions` (edits, undo/redo, autosaved draft)
- [ ] `animationUi.state` modes; Animation ribbon (Mode, Transport, Create, Keys, Clip)
- [ ] Animation panel: Parts, Actors, Sequences, Inspector (list-based timeline)
- [ ] Record flow (Flow 3): gizmo fold, step playhead, reverse prompt, pull-out, ghost
- [ ] New part after / insert / delete-heal (Flow 4, list-based)
- [ ] Templates; Problems list; slot meter
- [ ] Widgets: `TimeInput`, `EasingSelect`, `RotationInput`
- [ ] Clickable mock test with a user (Q12) before Phase 5
- **Done when:** a user builds a 3-part assembly from scratch without the timeline widget.

### Phase 5 — Timeline
- [ ] Widgets: `TimeRuler`, `Timeline` (lanes, groups, items, points, snapping, link hints, range) + gallery + README
- [ ] Timeline panel: magnetic linking, key editing, context menu, focus + breadcrumbs (`Breadcrumbs`)
- **Done when:** all §10.4 interactions work; keyboard navigation works.

### Phase 6 — Storyboard, wizard, polish
- [ ] `CardFlow` widget + Storyboard panel; thumbnails (verify WebGPU canvas read-back)
- [ ] Assembly wizard (Flow 2)
- [ ] Continuity warnings UI; motion paths
- [ ] Workspace presets Animate / Present (Q15)
- **Done when:** a 20-part assembly is generated, reordered and fixed from the Storyboard.

### Phase 7 — Camera track
- [ ] Camera track keys (capture current view), timeline toggle
- [ ] Live-track return blend (`cameraBlend.ts`)
- **Done when:** Continue → Return lands smoothly on a moving camera.

### Phase 8 — Overlays
- [ ] `overlayTemplate.ts` + `AnimOverlay`; presets; bindings; safety rules
- [ ] Step card per part; Add callout; in-place text edit; drag anchor
- [ ] Overlay Editor panel + widgets (`BoxSidesInput`, `BorderInput`, `ImagePicker`, `IconSelect`, `TemplateTextInput`, `ParamListEditor`)
- [ ] OPFS library, embed on save, conflict dialog
- **Done when:** a user restyles the step card once and every part updates.

### Phase 9 — Reuse and integration
- [ ] Roles / re-targeting; Save group as sequence
- [ ] SDK commands + events + EVENTS.md
- [ ] Viewpoint animation link
- [ ] Later: video export (Q16), `{{prop.TAG}}`, SQL-ordered wizard, SDK components (Q8)

---

## 17. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `Timeline` widget complexity | Schedule | Phase 4 works without it; mock-test first (Q12); split into small files |
| Full-pool uploads overwrite the band | Flicker | `onTransformsUploaded` re-apply; test in §15 |
| Worker round trip for vis/opacity steps | One-frame lag at steps | Diff only changes; acceptable for stepped values |
| Gizmo fold drift over many edits | Keys slowly skew | Re-orthonormalize in `decomposeRigid`; store quats normalized |
| WebGPU canvas read-back for thumbnails | No thumbnails | Capture right after a frame; fall back to icon |
| Space conflicts (buttons, text fields, fly-to) | Surprising toggles | Tap rules §8.5 + tests |
| Hash/fullname duplicates | Extra items move together | Same semantics as `.tdsnap`; show item count per actor |
| Transparent pass with stepped opacity | Sorting artefacts | Same path as existing opacity overrides |
| Large docs (hundreds of parts) | UI slowness | Virtualized rows; memoized resolve; evaluate is O(active clips) |
| User-supplied overlay content via SDK | Injection | D13 rules + tests |

---

## 18. Plan history

| Date | Version | Change |
|---|---|---|
| 2026-08-04 | — | `ANIMATION.md` engine design capture (parked). |
| 2026-09-16 | 1.0 | Consolidated plan: sequences/clips, parts and linking, player with pause/free camera/continue, Space tap, authoring flows, UI specification, overlay components + editor, code interfaces, phases. |