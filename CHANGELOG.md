# Changelog

Newest first. Each entry is dated and marked with the `package.json` version it
lands AFTER (`>0.26.1` = unreleased on top of 0.26.1); the director bumps the
version at release time. See CLAUDE.md for the rule.

Entries from before the stable pilot (0.26.1) have been removed.

- **2026.11.18** (>0.26.3):
  New `plans/future_events.md`: a backlog of host API commands and events
  to add later, each with sample code (SDK method, handler, EVENTS.md
  entry, host use). It starts with the temporary isolate command and event,
  plain hide / isolate commands, a `settings.changed` event (to see when a
  user switches the gizmo style) and the model's true north on
  `model.loaded`.

  Hierarchy toolbar: a **temporary isolate** button after Model order, also
  on hotkey `ALT 805`. Switched on, it hides everything that is not
  selected, like Isolate. Switched off, it shows again exactly what it hid,
  and selected parts that were hidden before go back to hidden. Colours you
  set and parts you hide while isolated stay as they are. Each switch is
  one undo step.

  Navigation gizmo: a second style, **axis balls**, is now the default
  beside the cube. A right-click or a press-and-hold on the gizmo switches
  between them, and Settings → Gizmo → Navigation gizmo offers the choice
  too.
  - **Balls.** The balls show the first letters of the face names, as the
    ribbons' letter buttons do. Small 45° snap dots between them give the
    cube's angled and iso views. They appear only while the pointer is over
    the gizmo, and only on the side facing you; on touch, a tap shows them
    for 3 s. Clicking a ball views from that side (a setting can make it
    look toward it instead). Clicking it again, or Shift+click anywhere on
    either style, gives the opposite view. Dragging the balls orbits.
  - **True north.** A north angle (degrees clockwise from the model's +Y,
    the back side) can be set, and the cube can mark true north with an
    amber N and a small triangle pointing at it. The marker is off by
    default, so the cube looks as before until a project or user turns it
    on. The balls never show north.
  - **Moving the gizmo.** Its drag handle sits clear of the balls (and of
    the north marker), shows the app's own tooltip, and Shift+click on the
    handle puts the gizmo back in its corner.
  - **Top and bottom views** can keep the heading (as before), turn +Y up,
    or turn true north up.
  - **Host API.** `settings.gizmo.set` sets all of this (`gizmoStyle`,
    `gizmoBallClick`, `gizmoSnapDots`, `topViewHeading`, `northAngle`,
    `gizmoNorthMarker`), and an empty payload or `settings.get` reads back
    whether a user switched style. RVM models keep their axes, so their
    plant north is +Y, the cube's back side.

  New `plans/navigation_gizmo.md`: the gizmo design behind this. It covers
  the cube with a true-north marker beside axis balls with hover-only 45°
  snap dots, as plant-design tools often use. It also covers models whose
  +Y is not north, and records that a compass ring was tried and dropped.
  A throw-away browser prototype is in `plans/gizmo/prototype.html`.

- **2026.11.18** (>0.26.2):
  Screenshot (Home button and `view.screenshot`): the navigation cube is in
  the picture again, and the picture really is rendered at the higher
  resolution. When the view had already settled, the capture took the very
  next frame — still at screen size, because the switch to the capture size
  waited for the live-resize pause — while the cube was already placed for
  the larger size, so it fell outside the frame. The capture size now
  applies at once, and a frame at a stale size is never captured (this also
  covers video export frames).

  Hierarchy search: Ctrl+click (⌘ on a Mac) on a match adds it to the
  selection, or takes it out again, the same as Ctrl+click on a tree row;
  the tree still opens at the match. A new **One row per name** toggle
  right of `* / =` lists a name found several times only once, with a
  `×N` count. Clicking it selects every item with that name, across all
  loaded models, and opens the tree at the first (shallowest) one;
  Ctrl+click adds them all. Duplicates are merged before the ten-row
  limit, so they no longer push other matches off the list. The user
  guide describes both.

- **2026.11.17** (>0.26.2):
  Version gate (CI, no app change): moved from `ci.yml` into its own
  `version-gate.yml` on `pull_request_target`, so main's copy always runs
  and a PR cannot loosen the gate it is checked by; it never runs PR code.
  Tightened: only this repository's own `dev` may target `main` (a fork's
  `dev` is refused), it re-runs when the PR title is edited, a `MAJOR` bump
  must reset `RELEASE` to 1 (`0.26.3` → `1.26.1`, so a mistyped `MAJOR`
  fails), a file moved out of `src/` counts as an app change, and the
  version must be a word of its own in the title (`v0.26.30` no longer
  passes for `v0.26.3`). CONTRIBUTING.md and `plans/action.md` describe the
  new rules, the fork workflow (fork `main` / `dev` only synced, work
  branches PR into this repository's `dev`) and the branch-protection
  setup order.

  New `plans/action.md`: suggested CI improvements (run on every branch,
  boot test, CHANGELOG check, Rust format/clippy cleanup), postponed until
  after the pilot. No CI change yet.

  Pages workflow (manual, for trying a branch on a test fork): it now
  builds the branch picked under "Run workflow" and force-pushes the site
  to the root of `gh-pages` as a single commit, so that branch holds only
  the latest deploy instead of growing a history. The build's version reads
  `<branch>#<short sha>`, so About and `/build.version` show which branch
  and commit are live. Pages must be set to deploy from the `gh-pages`
  branch.

  More ribbon buttons get a shortcut, so a keyboard user or a host driving
  the viewer through `hotkeys.run` can reach them too:
  Clipping Box face resize (ALT 3300–3305 grow, ALT 3310–3315 shrink) and
  move (ALT 344–349), Clipping Plane Center (ALT 3001–3003 for X/Y/Z, only
  while that plane is on), and the Transform pivot Lock / Cancel (ALT 127 /
  ALT 128, only while placing a pivot). The Selection Color ribbon's Panel
  button is now linked to the Color Panel's existing show/hide shortcut
  (ALT 671), and a click toggles the panel the same way instead of only
  opening it. The user guide lists the new keys.
- **2026.11.17** (>0.26.1):
  Selection Color › Opacity Override: the Set Sel button now shows its
  shortcut (T) in the tooltip — the binding existed but the button was not
  linked to it.
