# Changelog

Newest first. Each entry is dated and marked with the `package.json` version it
lands AFTER (`>0.26.1` = unreleased on top of 0.26.1); the director bumps the
version at release time. See CLAUDE.md for the rule.

Entries from before the stable pilot (0.26.1) have been removed.

- **2026.11.18** (>0.26.2):
  Screenshot (Home button and `view.screenshot`): the navigation cube is in
  the picture again, and the picture really is rendered at the higher
  resolution. When the view had already settled, the capture took the very
  next frame — still at screen size, because the switch to the capture size
  waited for the live-resize pause — while the cube was already placed for
  the larger size, so it fell outside the frame. The capture size now
  applies at once, and a frame at a stale size is never captured (this also
  covers video export frames).

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
