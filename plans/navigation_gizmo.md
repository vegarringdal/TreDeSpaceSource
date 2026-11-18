# Navigation gizmo — axis balls, 45° snaps and true north (IN PROGRESS)

> **Status, 2026-11-18: phases 1 and 2 are built, for trying out** (branch
> `gizmo`, see DESIGN.md › Navigation gizmo styles).
>
> - **Two styles, axis balls by default.** The cube and the axis balls are
>   switched with a **right-click or long-press on the gizmo**.
> - **The cube** has a **true-north marker, off by default** (on per project), and
>   Shift+click.
> - **The balls** show **no north**. They use the first letters of the face
>   names, and their 45° snap dots appear **only on hover, and only on the
>   side facing you**.
> - **No compass ring** (it felt in the way).
> - **Not built:** the TOP-face arrow, the north needle, and north read from
>   IFC files (phase 3).
>
> The questions still open are listed at the end. File and function names
> were accurate when this was written.

## Goal

1. Two gizmo styles the user can switch between: today's **cube**, and
   **axis balls** that keep the cube's quick 45° and isometric views. The
   switch is a right-click or long-press on the gizmo itself.
2. On the cube, anyone glancing at it can tell where **true north** is, in
   every view, top view included, even when the model's +Y (its BACK side)
   is not true north. The marker that shows it is off by default and turned
   on per project (a boat has no use for north).
3. The balls show only the model's axes, with no north on them.

## Today

- **One gizmo, the view cube.** The GPU draws it (`ViewCubePass` in
  `src/lib/render/viewCubePass.ts`; geometry and label atlas in
  `viewCubeGpu.ts`; shader in `shaders/viewCube.ts`), so screenshots include
  it. `src/lib/overlay/ViewGizmo.ts` is an invisible DOM layer. It handles the
  hit zones (6 faces, 12 edges, 8 corners: 26 views), hover and the drag
  handle. `viewport.ts` connects the two, and its `onPick` turns the camera
  with `camera.snapView`, the only caller.
- **Axes.** Z is up. +X is RIGHT, +Y is BACK, +Z is TOP
  (`gizmoFaceDirections`). Nothing in the app knows about north.
- **Face names** can be edited in Settings → Gizmo (at most 5 characters,
  `src/state/viewer/gizmoLabels.state.ts`). The ribbons' letter buttons use
  their first letters through `faceLetters()`. Colours live in viewer state,
  and sketch mode has its own set. Hosts change all of this with
  `settings.gizmo.set`.
- **The camera is a turntable with no roll.** +Z always points into the upper
  half of the gizmo.
- **No importer reads a north direction.** Nothing under `rust_src/crates`
  mentions IFC `TrueNorth`.

Why north is hard to see today:

1. The cube says FRONT / BACK / LEFT / RIGHT. Nothing says which way is
   north.
2. **A top view keeps the current heading.** `onPick` keeps the azimuth for
   TOP and BOTTOM, so north can point any way on screen, and the cube shows
   "TOP", which says nothing about heading.

## Plant convention

Plant-design tools commonly use axis gizmos rather than a cube:

- **Six labelled axis points.** Their letters are often N, S, E, W, U, D,
  because plant world axes are X / Y / Z = East / North / Up.
- **Small in-between points** for the isometric views.
- **Shift + click** gives the opposite view.

North there is simply +Y (plant north). RVM files come from that world, and
the viewer keeps their axes: `rvm-core/glb_writer.rs` turns Z-up into Y-up,
and the cooker turns it back. **So RVM north is +Y, the cube's BACK face.**
The only case this convention does not cover is a model whose +Y is not true
north.

## Styles

### Cube (today), plus small additions

- Keeps its 26 snaps: faces, 45° edges and iso corners. This is why it is
  so quick for 45° views.
- New: **Shift + click** a face, edge or corner gives the opposite view.
- New: the **TN marker** for true north (see True north). It is off by
  default; a setting or the host turns it on.
- New: an optional **north arrow on the TOP face** (and BOTTOM), turned by
  the north angle.
- Face names stay FRONT / BACK… by default.

### Axis balls with 45° snaps (new)

- Six balls on the axes: + axes solid with an arm, − axes hollow. Their
  colours are X red, Y green, Z blue.
- **Letters:** the first letter of each face name, through `faceLetters()`,
  so the balls, the cube and the ribbons' letter buttons always agree. There
  is no separate letter setting. Naming the faces NORTH / SOUTH / EAST / WEST
  / UP / DOWN gives the plant look (N S E W U D). The default names give
  F B L R T Bo.
- **Snap dots** between the balls, giving the cube's in-between views in
  ball form:
  - 12 by default: the 4 horizontal 45° views and the 8 iso corners.
  - Optionally all 20: the 4 horizontal 45° views, the 8 tilted 45° views
    and the 8 iso corners, which is the cube's full set.
- **Dots stay out of the way.** Without them the gizmo is just the six
  balls:
  - **On hover only.** The dots fade in while the pointer is over the gizmo
    and fade out when it leaves.
  - **Near side only.** A dot shows only on the half of the gizmo facing the
    viewer. It fades in from 0.12 to 0.45 of its direction's dot product with
    the toward-viewer axis, so roughly half the dots show at a time.
  - **Not where you are.** The dot within 8° of the current view hides.
  - **Fully faded dots cannot be clicked,** so a click there falls through to
    an orbit drag.
  - **Touch has no hover.** A tap anywhere on the gizmo shows the dots for
    3 s, and a tap on a dot in that time snaps. A tap on a ball snaps as usual
    and also shows the dots, so a 45° view next to it is one more tap away.
  - Press-and-slide (finger down shows the dots, release over one picks)
    was considered and rejected: it clashes with drag-to-orbit on the gizmo.
  - A setting "always show (near side)" covers anyone who wants them
    permanently.
- **Clicks:**
  - Click a ball: *view from* it (as the cube does, the default) or *look
    toward* it ("look north"). This is a setting.
  - Clicking the ball you already look from flips to the opposite.
  - **Shift + click** always gives the opposite.
  - **Drag** anywhere on the gizmo orbits.
- Balls and dots are screen-facing discs, depth-sorted each frame.

### Switching between them

- **Right-click** the gizmo, or **press and hold** it (mouse or finger), to
  switch style. A short pop animation and a toast ("Axis balls ·
  right-click or hold to switch back") confirm it. Hovering the gizmo's
  empty area shows the same hint.
- **Same hold as measuring.** The hold uses measure aim's timing
  (`measureAim.ts`: 450 ms, 10 px slop) and its haptic tick, so a
  long-press feels the same everywhere in the viewer. Moving past the slop
  turns it into an orbit drag, and the release after a switch does not also
  click.
- **The gizmo keeps its own events.** Its DOM layer stops them reaching the
  canvas: a right-click on it never starts the right-button pan, and a hold
  on it never starts measure aim.
- **No double switch on touch.** A long-press can also fire the browser's
  `contextmenu`; a short guard (700 ms in the demo) stops the two from
  switching twice.
- **Remembered.** The style is a viewer setting (`gizmoStyle`), kept like
  the cube colours. Settings → Gizmo also offers it, so people find it
  without knowing the gesture.

### Dropped

- **The compass ring**, around the cube or the balls. It was tried in the
  demo and felt in the way.
- **Tinting the north face** only works at 0°.
- **An axis triad** only repeats the model axes.
- **The north needle** stays possible as an add-on beside the cube, but
  nothing needs it once the north marker below exists.
- **North on the balls** was decided against: the balls show only the
  model's axes. True north is shown only on the cube.

## True north

| | Model sides / plant north | True north |
|---|---|---|
| What it is | The model's own axes. +Y is BACK; naming that face NORTH makes it N (plant north) | +Y turned clockwise by the **north angle** |
| Shown by | Cube faces, balls, ribbon letter buttons | On the cube only: the **TN marker** (off by default) and the TOP-face arrow. In either style: a "true north up" top view |
| Turns with the angle? | Never | Always |

- **North angle:** degrees clockwise from the model's +Y, seen from above,
  so `north = (sin a, cos a, 0)`. It is 0° for plant models (RVM) and
  can come from IFC.
- **TN marker:** one amber chip lying in the ground plane at true north,
  with a short pointer toward it, **on the cube only**. The balls show no
  north. A setting (`gizmoNorthMarker`, off by default) turns the marker on.
  It reads **TN** when the
  gizmo already calls +Y "N" (its BACK face is named NORTH, so its letter is
  N) and **N** otherwise. It is hidden when the angle is 0° and +Y already reads N.
  Clicking it views from (or looks toward) true north, following the ball
  setting.
- **Top / bottom heading** setting: *keep heading* (today), *model +Y up*,
  or *true north up*.
- **Settings note:** when the angle is not 0° and the gizmo uses compass
  letters or names, the settings show: "N on the gizmo is plant north… the
  TN marker shows true north".

### Where the angle comes from

In order of precedence:

1. **The user**, in Settings → Gizmo: a number field and a "Point north
   here" button that takes the current heading as north.
2. **The host**, through `settings.gizmo.set({ northAngle })`.
3. **The model**, on load (a later phase):
   - IFC: `IfcGeometricRepresentationContext.TrueNorth` is a direction in the
     model's XY plane, so `angle = atan2(x, y)`.
   - IFC4 `IfcMapConversion` gives a grid-north rotation, which is a
     different north.
   - RVM, STEP and GLB carry none; plant convention is 0°. Whether NWD
     carries one must be checked.
   - The converters would write the angle into the cooked metadata, which is
     a Rust change: rebuild the wasm and check whether the format needs a
     version bump.
   - A federated view has one site, so it has one north. When a model brings
     a different angle, the scene keeps its own and a notice offers to
     switch.
   - A model moved with the transform tools carries its north through the
     transform.

## Phases

1. **True north on the cube** (small to medium):
   - The north-angle and compass-letter settings, with their API and
     settings-file entries.
   - The **TN marker** on the cube, off by default, with a setting to turn it on.
   - The top/bottom heading setting.
   - Shift + click for the opposite view.
   - The TOP-face arrow, if still wanted next to the marker.
2. **Axis-ball style** (medium to large): the style switch (right-click,
   long-press and the setting), balls with face-name letters, click mode,
   flip and drag-to-orbit, and snap dots with the hover, near-side and
   touch rules. It has no north marker. It is built as a mode of
   `ViewCubePass` with its own DOM hit layer, so screenshots keep including
   the gizmo.
3. **North from the model**: IFC `TrueNorth`, then possibly others.

## Build notes

- **Settings:** new keys next to the cube colours in `viewer.state.ts`,
  also added to `viewerSettingsGroups.ts`, `sectionResets.ts`, Settings →
  Gizmo (`GizmoTab.tsx`), and `GizmoSettings` / `settingsGizmoSet` in
  `api/tredespace-client.ts` with JSDoc, plus the `settings.gizmo.set`
  example in `EVENTS.md`. The build fails without the last two. Suggested
  keys: `gizmoStyle` (`'cube' | 'balls'`), `gizmoSnaps` (`'iso' | 'all'`),
  `gizmoDots` (`'hover' | 'always'`), `gizmoClick`
  (`'viewFrom' | 'lookToward'`), `northAngle`, `compassLetters`,
  `topViewHeading` (`'keep' | 'model' | 'north'`), `gizmoNorthMarker`,
  `gizmoNorthArrow`. If the angle ends up as scene state, it moves out of
  this list (open question 2).
- **Top/bottom heading:** `onPick` in `viewport.ts`, through a pure helper
  with a unit test. Looking down, the heading is the "up" vector. Looking
  up, it is the reverse, which gives a true view from below, not a mirror
  image.
- **Shift + click:** `ViewGizmo`'s click handler passes `shiftKey` through
  `onPick`.
- **TOP-face arrow:** `buildLabelAtlas` draws it into the TOP and BOTTOM
  tiles, turned by `atan2(north·right, north·up)` in each face's own frame.
  The atlas is rebuilt when the angle changes.
- **Axis balls:**
  - The GPU pass gets discs as quads with an SDF circle, arms as thin quads,
    and a letter atlas, drawn back to front each frame.
  - A new DOM hit layer offers the same contract as `ViewGizmo` (`onPick`,
    `onHover`, `getRect`, drag handle), so `viewport.ts` treats both
    styles alike.
  - Drag to orbit needs a public `camera.orbitBy(dx, dy)`; today the orbit
    input fields are private.
  - Dot opacity is per-frame state, so the pass needs a per-dot alpha (an
    instance attribute or a small uniform array). The hover state comes from
    the DOM layer's `pointerenter` / `pointerleave`, and the touch reveal
    from `pointerType === 'touch'` on `pointerup`. A dot below the pick
    threshold must not have a hit zone either.
  - Fading dots in and out needs frames even while the camera rests, so the
    renderer's idle skip must count the fade as a change (as it already does
    for the cube's hover).
  - The pin in `tests/shaders.pin.test.ts` moves with the shader.
- **TN marker (cube only):** one more atlas tile and quad in the pass, and one DOM hit
  zone placed from its projected point in `update()`.
- **North from IFC:** `rust_src/crates/ifc-*` reads `TrueNorth`. Rebuild the
  wasm (`node scripts/build-wasm.mjs ifc2glb`, plus the cooker if the
  metadata format changes) and commit the binary with its `build-info.json`.
- **Docs:** the View cube entry in `DESIGN.md`, the Settings → Gizmo info
  text, README › Supported files if model north becomes something the
  viewer reads, and `CHANGELOG.md`.

## Demos

- **three.js lab** (a private claude.ai page, not in the repo):
  https://claude.ai/artifact/Vp9AF3AwZZ9ikjYkyZHJb4. It has a small plant
  on its own axes, a true-north compass on the ground and a north-angle
  slider. It has the cube and the axis balls, switched by right-click or
  press-and-hold on the gizmo. The balls have face-name letters and 45° snap
  dots (12 or 20, on hover or always, near side only). It also has an "act
  like a touch screen" switch for the tap-to-reveal rule, the compass
  letters (N E S W or N Ø S V), the click mode, Shift + click, the TN
  marker, the TOP arrow, the three top-view heading modes and a heading
  readout.
- **`plans/gizmo/prototype.html`** (open the file directly): the first 2D
  version. It assumes north = +Y and still has the ring variants. A Node
  check confirmed its maths on 2026-11-18. The lab supersedes it.

## Decisions (2026-11-18)

- **Default style:** the axis balls. The host sets the style with
  `settings.gizmo.set({ gizmoStyle })` and reads it back with `settings.get`,
  so it can tell whether a user changed the default.
- **Ball click:** a setting, *view from* by default.
- **North angle:** a viewer setting for now, like the other gizmo settings.
  The host can set it per project through `settings.gizmo.set`, the same
  way it already sets the face names.
- **Ball letters:** always the first letters of the face names. The balls
  never show north.
- **Defaults:** the axis balls for everyone, existing users included (no
  migration; right-click switches back). The cube's north marker is **off**,
  so the cube looks as it did until a project turns it on (a boat names its
  sides FWD / AFT / PORT / STBD and has no use for north).
- **No breaking settings:**
  - Old stored settings and settings files load as before; the new keys
    take their defaults.
  - An older app ignores the new keys in a newer file.
  - Existing `settings.gizmo.set` payloads still work, and the response
    only gains fields.
  - Unknown stored values fall back to their default (`enumOr`).

## Open questions (director)

1. Should the north angle later move into **scene state** (saved with a
   saved state and applied for everyone)? It describes the site.
2. True north or grid north? IFC can carry both.
3. Default for TOP / BOTTOM clicks: keep heading (today), or true north up
   (the same as model +Y up at 0°)?
4. Snap dots: 12 or all 20? And is 3 s right for the touch reveal?
5. North colour: fixed amber, or a setting next to the cube colours (plus a
   sketch-mode one)?
6. Stepping back and forward through earlier views: wanted here too (a
   separate feature)?
