# Changelog

Newest first. Each entry is dated and marked with the `package.json` version it
lands AFTER (`>0.26.1` = unreleased on top of 0.26.1); the director bumps the
version at release time. See CLAUDE.md for the rule.

Entries from before the stable pilot (0.26.1) have been removed.

- **2026.11.17** (>0.26.2):
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
