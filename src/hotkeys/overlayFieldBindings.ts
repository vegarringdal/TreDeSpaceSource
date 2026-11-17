// Hotkeys for the fields of the Overlay Editor, the Overlay Preview and an
// overlay's place in the Key panel (DESIGN.md › Animation › Overlays): each
// presses the control that shows it — a stepper's − / +, a segment, a check
// box — so it does exactly what that control does, only while it is on
// screen. Codes are ASSIGNED (ALT 1605-1661); never renumber.

import type { HotkeyDef } from '@treDeSpaceUI/hotkeys';
import type { AnimationPanelId } from '../components/panels/animation/animationPanels';
import { hasControl, pressControl } from '../components/panels/shared/pressControl';

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const CATEGORY = 'Animation';

function control(panel: AnimationPanelId, id: string, code: number, label: string, description: string): HotkeyDef {
  return {
    id,
    category: CATEGORY,
    label,
    defaultKeys: `ALT ${code}`,
    description,
    run: () => pressControl(panel, id),
    context: () => hasControl(panel, id),
  };
}

/** A stepper's − and + (`${id}.dec`, `${id}.inc`). */
function stepper(panel: AnimationPanelId, id: string, codes: [number, number], what: string): HotkeyDef[] {
  return [
    control(panel, `${id}.dec`, codes[0], `${what} −`, `A step less: ${what} (the field's −).`),
    control(panel, `${id}.inc`, codes[1], `${what} +`, `A step more: ${what} (the field's +).`),
  ];
}

/** One hotkey per segment of a choice (`${id}.${value}`). */
function choices(
  panel: AnimationPanelId,
  id: string,
  first: number,
  what: string,
  values: readonly (readonly [string, string])[],
): HotkeyDef[] {
  return values.map(([value, label], i) =>
    control(panel, `${id}.${value}`, first + i, `${what}: ${label}`, `${what}: ${label} (that segment).`),
  );
}

// -----------------------------------------------------------------------------
// table
// -----------------------------------------------------------------------------

const ED: AnimationPanelId = 'overlayEditor';
const PREVIEW: AnimationPanelId = 'overlayPreview';
const KEY: AnimationPanelId = 'animation';

const SIZE_MODES = [
  ['auto', 'Auto'],
  ['fill', 'Fill'],
  ['px', 'px'],
] as const;

/** Overlay Editor design fields, the preview's toolbar and an overlay's
 *  place (anchor, position, offset, leader line). */
export const OVERLAY_FIELD_HOTKEYS: HotkeyDef[] = [
  ...stepper(ED, 'overlay.card.width', [1605, 1606], 'Design width'),
  ...stepper(ED, 'overlay.card.minWidth', [1607, 1608], 'Design min width'),
  ...stepper(ED, 'overlay.card.maxWidth', [1609, 1610], 'Design max width'),
  ...choices(ED, 'overlay.card.widthMode', 1611, 'Design width', [
    ['auto', 'Auto'],
    ['px', 'Fixed'],
  ]),
  ...choices(ED, 'overlay.box.dir', 1613, 'Box direction', [
    ['col', 'Column'],
    ['row', 'Row'],
  ]),
  ...stepper(ED, 'overlay.box.gap', [1615, 1616], 'Box gap'),
  ...choices(ED, 'overlay.style.width', 1617, 'Block width', SIZE_MODES),
  ...stepper(ED, 'overlay.style.width', [1620, 1621], 'Block width (px)'),
  ...choices(ED, 'overlay.style.height', 1622, 'Block height', SIZE_MODES),
  ...stepper(ED, 'overlay.style.height', [1625, 1626], 'Block height (px)'),
  ...stepper(ED, 'overlay.style.opacity', [1627, 1628], 'Block opacity'),
  ...stepper(ED, 'overlay.style.radius', [1629, 1630], 'Block corner radius'),
  ...stepper(ED, 'overlay.text.size', [1631, 1632], 'Text size'),
  ...choices(ED, 'overlay.text.align', 1633, 'Text align', [
    ['left', 'Left'],
    ['center', 'Centre'],
    ['right', 'Right'],
  ]),
  ...stepper(ED, 'overlay.text.lineHeight', [1636, 1637], 'Text line height'),
  ...stepper(ED, 'overlay.text.maxLines', [1638, 1639], 'Text max lines'),
  ...choices(ED, 'overlay.media.fit', 1640, 'Image fit', [
    ['contain', 'Contain'],
    ['cover', 'Cover'],
  ]),
  ...choices(PREVIEW, 'overlay.preview.height', 1642, 'Preview size', [
    ['fit', 'Fit'],
    ['720', '720p'],
    ['1080', '1080p'],
    ['1440', '1440p'],
  ]),
  ...choices(PREVIEW, 'overlay.preview.bg', 1646, 'Preview background', [
    ['dark', 'Dark'],
    ['light', 'Light'],
    ['checker', 'Checker'],
  ]),
  control(
    ED,
    'overlay.block.richText',
    1649,
    'Text block: rich text',
    'Turn **bold**, *italic* and line breaks in the selected text block on or off.',
  ),
  ...choices(KEY, 'animation.overlay.anchor', 1650, 'Overlay anchor', [
    ['screen', 'Screen'],
    ['object', 'Object'],
    ['world', 'Point'],
  ]),
  ...stepper(KEY, 'animation.overlay.x', [1653, 1654], 'Overlay X'),
  ...stepper(KEY, 'animation.overlay.y', [1655, 1656], 'Overlay Y'),
  ...stepper(KEY, 'animation.overlay.dx', [1657, 1658], 'Overlay label offset dx'),
  ...stepper(KEY, 'animation.overlay.dy', [1659, 1660], 'Overlay label offset dy'),
  control(
    KEY,
    'animation.overlay.leader',
    1661,
    'Overlay: leader line',
    'Draw the line from the label to what it hangs from, or not.',
  ),
];
