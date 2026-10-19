// -----------------------------------------------------------------------------
// the brief for Claude (DESIGN.md › Animation › Files and host API)
// -----------------------------------------------------------------------------
// Two files for Claude Code (or a person) writing an animation file the
// user opens in the app: the brief — what to ask the user for, how a scene
// and every row of the Timeline plays (objects, steps, camera, clipping,
// colour rules, labels, measurements, overlays), several scenes in one file,
// every field with its default, patterns, the user's cards and themes,
// custom designs, what the app flags, and a JSON Schema to check against —
// and an item list (CSV: name, fullname, tree place, centre and size, plus
// the columns of the user's SQL result when it has a fullname column). Pure:
// the caller gathers the inputs.

import { OVERLAY_ICONS } from '../overlay/overlayIcons';
import { PRESET_STEP_CARD } from '../overlay/overlayPresets';
import type { OverlayBlock, OverlayComponent, OverlayTheme } from '../overlay/overlayTypes';
import { animationFileSchema } from './animSchema';
import { SLIDE_DIRECTIONS } from './keyRows';
import { ANIMATION_FORMAT, ANIMATION_VERSION } from './types';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export interface BriefItem {
  name: string;
  fullname: string;
  /** world box [minx,miny,minz,maxx,maxy,maxz] (metres) */
  bounds: readonly number[];
  /** parent fullname ('' at a root) */
  parent?: string;
  depth?: number;
  /** leaf items under it */
  items?: number;
  model?: string;
}

export interface BriefCard {
  id: string;
  name: string;
  params: readonly { key: string; label: string; type: string; default: unknown }[];
}

export interface BriefInput {
  /** the user's card designs */
  cards: readonly BriefCard[];
  /** the user's colour themes */
  themes?: readonly { id: string; name: string }[];
}

/** The user's SQL result joined onto an item list (rows keyed by fullname). */
export interface ItemAttributes {
  columns: readonly string[];
  rows: readonly (readonly unknown[])[];
  /** index of the fullname column */
  key: number;
}

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const FILE_EXT = '.tdanim.json';
const PINS = 'tl, t, tr, l, c, r, bl, b, br (top-left … bottom-right; c = centre)';

/** Short recipes, each a whole scene; every one opens as it stands (a test
 *  checks). */
export const BRIEF_PATTERNS: readonly { title: string; scene: string }[] = [
  {
    title: 'Slide in: hidden until 2 s, then it comes 1.5 m from above into place by 4 s',
    scene: `{ "name": "Pump",
  "objects": [{ "id": "pump", "name": "Pump", "items": ["/skid/pump-01"], "keys": [
    { "t": 0, "move": [0, 0, 1.5], "visible": false, "interp": "hold" },
    { "t": 2, "move": [0, 0, 1.5], "visible": true, "interp": "hold" },
    { "t": 4, "move": [0, 0, 0] } ] }],
  "steps": [{ "name": "Pump", "text": "Lower the pump onto the skid.", "start": 2, "end": 4, "pauseAtEnd": true }] }`,
  },
  {
    title:
      'Build from nothing: the whole model hidden at the start, the foundation kept in view, items shown as they arrive',
    scene: `{ "name": "Build",
  "colorRules": [{ "t": 0, "mode": "hide", "rules": [
    { "filters": [{ "mode": "starts", "value": "/site/foundation" }], "color": null, "opacity": 1 } ] }],
  "objects": [
    { "name": "Frame", "items": ["/skid/frame-01"], "keys": [
      { "t": 0, "move": [0, 0, 2], "visible": false, "interp": "hold" },
      { "t": 0.5, "move": [0, 0, 2], "visible": true, "interp": "hold" },
      { "t": 2.5, "move": [0, 0, 0] } ] },
    { "name": "Tank", "items": ["/skid/tank-01"], "keys": [
      { "t": 0, "move": [2, 0, 0], "visible": false, "interp": "hold" },
      { "t": 3, "move": [2, 0, 0], "visible": true, "interp": "hold" },
      { "t": 5, "move": [0, 0, 0] } ] } ],
  "steps": [
    { "name": "Frame", "start": 0.5, "end": 2.5 },
    { "name": "Tank", "start": 3, "end": 5 } ] }`,
  },
  {
    title: 'A module lifted into place in one piece — all but its foundation, which is there from the start',
    scene: `{ "name": "Module",
  "objects": [{ "name": "Module 1", "items": ["/site/module-1"], "exclude": ["/site/module-1/foundation"], "keys": [
    { "t": 0, "move": [0, 0, 6] },
    { "t": 4, "move": [0, 0, 0] } ] }],
  "steps": [{ "name": "Lift module 1", "start": 0, "end": 4 }] }`,
  },
  {
    title: 'A valve wheel turning two full turns, then the cover taken off and away',
    scene: `{ "name": "Service",
  "objects": [
    { "name": "Hand wheel", "items": ["/valve-07/wheel"], "keys": [
      { "t": 0 },
      { "t": 3, "spin": { "axis": [0, 1, 0], "degrees": 720 }, "interp": "linear" } ] },
    { "name": "Cover", "items": ["/pump-01/cover"], "keys": [
      { "t": 3 },
      { "t": 5, "move": [0, -1.2, 0.4], "rotate": { "axis": [1, 0, 0], "degrees": 30 } },
      { "t": 5.5, "move": [0, -1.2, 0.4], "rotate": { "axis": [1, 0, 0], "degrees": 30 }, "visible": false, "interp": "hold" } ] } ],
  "steps": [
    { "name": "Close the valve", "start": 0, "end": 3, "pauseAtEnd": true },
    { "name": "Remove the cover", "start": 3, "end": 5.5 } ] }`,
  },
  {
    title: 'Colour a system for a step, back to normal after it; a label on its pump',
    scene: `{ "name": "Cooling water",
  "colorRules": [
    { "t": 2, "mode": "append", "rules": [
      { "filters": [{ "mode": "contains", "value": "cw-" }], "color": "#38bdf8", "opacity": 1 } ] },
    { "t": 6, "mode": "reset", "rules": [] } ],
  "objects": [{ "id": "cwpump", "name": "CW pump", "items": ["/plant/cw-pump-01"], "keys": [{ "t": 0 }] }],
  "callouts": [{ "instance": "lbl-cwpump", "start": 2, "end": 6 }],
  "steps": [{ "name": "Cooling water", "text": "The **cooling water** loop.", "start": 2, "end": 6 }] }`,
  },
  {
    title: 'A title before anything moves (a step with its own card, centred)',
    scene: `{ "name": "Intro",
  "steps": [{ "name": "Pump skid assembly", "start": 0, "end": 3, "pauseAtEnd": true,
    "card": { "component": "preset.titleCard", "values": { "title": "Pump skid assembly", "subtitle": "Build sequence" }, "place": "c" } }] }`,
  },
  {
    title:
      'The camera: from an overview into the pump (a glide), a pause there, then a cut back (anchor points from the item list)',
    scene: `{ "name": "Close-up",
  "camera": [
    { "t": 0, "view": { "target": [10, 5, 2], "azimuth": 1.571, "elevation": -0.5, "orbitDistance": 40 } },
    { "t": 3, "view": { "target": [12, 4, 1], "azimuth": 2.356, "elevation": -0.35, "orbitDistance": 6 } },
    { "t": 6, "view": { "target": [10, 5, 2], "azimuth": 1.571, "elevation": -0.5, "orbitDistance": 40 }, "interp": "hold" } ],
  "steps": [{ "name": "The pump", "text": "A closer look at the pump.", "start": 0, "end": 6, "pauseAtEnd": true }] }`,
  },
  {
    title: 'Cut the tank open from the top, deeper and deeper, then clipping off again',
    scene: `{ "name": "Inside the tank",
  "section": [
    { "t": 0, "value": { "planes": { "z": { "enabled": true, "el": -90, "position": 0, "anchor": [12, 4, 3.5] } } }, "interp": "hold" },
    { "t": 3, "value": { "planes": { "z": { "enabled": true, "el": -90, "position": 1.5, "anchor": [12, 4, 3.5] } } } },
    { "t": 6, "value": {}, "interp": "hold" } ],
  "steps": [{ "name": "Inside the tank", "text": "The top is cut away to show the baffles.", "start": 0, "end": 6, "pauseAtEnd": true }] }`,
  },
  {
    title: 'A label and a measured clearance for one step (fixed points: they do not follow anything that moves)',
    scene: `{ "name": "Clearances",
  "labels": [
    { "t": 1, "labels": [{ "text": "Pump P-101", "anchor": [12, 4, 1], "offset": [60, -50] }] },
    { "t": 5, "labels": [] } ],
  "measurements": [
    { "t": 1, "measurements": [{ "kind": "line", "label": "Service clearance", "points": [{ "pos": [12, 4, 0] }, { "pos": [12, 5.2, 0] }] }] },
    { "t": 5, "measurements": [] } ],
  "steps": [{ "name": "Clearances", "text": "Keep **1.2 m** free in front of the pump.", "start": 1, "end": 5, "pauseAtEnd": true }] }`,
  },
];

/** Two scenes in one file — an assembly and a maintenance job, each from the
 *  model as loaded — sharing a title overlay, each with its own objects (ids
 *  unique across the file) and the label in its own scene (a test opens it). */
export const BRIEF_MULTI_SCENE = `{ "format": "${ANIMATION_FORMAT}", "version": ${ANIMATION_VERSION}, "name": "Pump skid",
  "scenes": [
    { "id": "assembly", "name": "Assembly",
      "colorRules": [{ "t": 0, "mode": "hide", "rules": [] }],
      "objects": [{ "id": "asm-pump", "name": "Pump", "items": ["/skid/pump-01"], "keys": [
        { "t": 0, "move": [0, 0, 1.5], "visible": false, "interp": "hold" },
        { "t": 1, "move": [0, 0, 1.5], "visible": true, "interp": "hold" },
        { "t": 3, "move": [0, 0, 0] } ] }],
      "callouts": [{ "instance": "title", "start": 0, "end": 1 }],
      "steps": [{ "name": "Pump", "text": "Lower the pump onto the skid.", "start": 1, "end": 3, "pauseAtEnd": true }] },
    { "id": "seal", "name": "Replace the seal",
      "objects": [{ "id": "seal-cover", "name": "Cover", "items": ["/skid/pump-01/cover"], "keys": [
        { "t": 1 },
        { "t": 3, "move": [0, -0.8, 0] } ] }],
      "callouts": [
        { "instance": "title", "start": 0, "end": 1 },
        { "instance": "seal-cover-label", "start": 1, "end": 3 } ],
      "steps": [{ "name": "Open the pump", "text": "Take the cover off.", "start": 1, "end": 3, "pauseAtEnd": true }] } ],
  "overlayInstances": [
    { "id": "title", "component": "preset.titleCard", "values": { "title": "Pump skid" },
      "anchor": { "kind": "screen", "pos": [0.5, 0.15], "pin": "t" } },
    { "id": "seal-cover-label", "component": "preset.callout", "values": { "title": "Cover" },
      "anchor": { "kind": "object", "object": "seal-cover", "offset": [80, -70] } } ] }`;

/** The overlays the patterns' callouts show (the label pattern). */
export const BRIEF_PATTERN_OVERLAYS = `[{ "id": "lbl-cwpump", "component": "preset.callout", "values": { "title": "CW pump" },
  "anchor": { "kind": "object", "object": "cwpump", "offset": [80, -70] } }]`;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const round = (v: number) => Math.round(v * 1000) / 1000;

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The item list for Claude: one row per item — name, fullname, parent
 *  fullname, depth, leaf items under it, model, centre and size (metres) —
 *  and, when the user's SQL result is given, its other columns joined on the
 *  lower-cased fullname. */
export function itemsCsv(items: readonly BriefItem[], attributes?: ItemAttributes): string {
  const extra = attributes ? attributes.columns.filter((_, k) => k !== attributes.key) : [];
  const byName = new Map<string, readonly unknown[]>();
  for (const r of attributes?.rows ?? []) {
    byName.set(String(r[attributes?.key ?? 0] ?? '').toLowerCase(), r);
  }
  const rows = items.map((it) => {
    const [x0, y0, z0, x1, y1, z1] = it.bounds;
    const c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2].map(round);
    const sz = [x1 - x0, y1 - y0, z1 - z0].map(round);
    const attr = byName.get(it.fullname);
    const more = attributes
      ? attributes.columns.flatMap((_, k) => (k === attributes.key ? [] : [attr?.[k] ?? '']))
      : [];
    return [it.name, it.fullname, it.parent ?? '', it.depth ?? '', it.items ?? '', it.model ?? '', ...c, ...sz, ...more]
      .map(csvCell)
      .join(',');
  });
  const head = ['name', 'fullname', 'parent', 'depth', 'items', 'model', 'cx', 'cy', 'cz', 'sx', 'sy', 'sz', ...extra];
  return [head.map(csvCell).join(','), ...rows].join('\n');
}

/** The custom-design example: the built-in step card as a design of your
 *  own whose title size is a value, a theme, and a scene whose steps use
 *  both — built from the preset, so it follows the app (a test opens it). */
export function customDesignExample(): string {
  const bindTitle = (b: OverlayBlock): OverlayBlock => {
    if (b.kind === 'box') {
      return { ...b, children: b.children.map(bindTitle) };
    }
    return b.kind === 'text' && b.id === 'title' ? { ...b, style: { ...b.style, size: '{{titleSize}}' } } : b;
  };
  const card: OverlayComponent = {
    ...PRESET_STEP_CARD,
    id: 'custom.stepCard',
    name: 'Step card (brand)',
    params: [...PRESET_STEP_CARD.params, { key: 'titleSize', label: 'Title size', type: 'number', default: 22 }],
    root: bindTitle(PRESET_STEP_CARD.root),
  };
  const theme: OverlayTheme = {
    id: 'custom.brand',
    name: 'Brand',
    tokens: {
      bg: '#102a43',
      surface: '#243b53',
      text: '#f0f4f8',
      muted: '#9fb3c8',
      accent: '#f0b429',
      warning: '#f59e0b',
      danger: '#ef4444',
      success: '#22c55e',
    },
  };
  const scene = {
    name: 'Assembly',
    stepCard: { component: card.id, theme: theme.id },
    steps: [
      { name: 'Base frame', text: 'The skid frame goes down first.', start: 0, end: 3 },
      {
        name: 'Pump',
        start: 3,
        end: 6,
        card: { component: card.id, theme: theme.id, values: { titleSize: 28 }, place: 'tr' },
      },
    ],
  };
  return JSON.stringify(
    {
      format: ANIMATION_FORMAT,
      version: ANIMATION_VERSION,
      name: 'Branded',
      scenes: [scene],
      overlayComponents: [card],
      overlayThemes: [theme],
    },
    null,
    2,
  );
}

function cardsList(cards: readonly BriefCard[]): string {
  return cards
    .map((c) => {
      const params = c.params.map(
        (p) =>
          `\`${p.key}\` (${p.type}${p.default !== undefined && p.default !== '' ? `, default ${JSON.stringify(p.default)}` : ''})`,
      );
      return `- \`${c.id}\` — ${c.name}${params.length ? `; values: ${params.join(', ')}` : '; no values'}`;
    })
    .join('\n');
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** The brief as Markdown. */
export function animationBrief(o: BriefInput): string {
  const directions = SLIDE_DIRECTIONS.map((d) => `${d.label.toLowerCase()} = [${d.dir.join(', ')}]`).join(', ');
  return `# Brief: building animations for TreDeSpace

You help the user build an **animation file** (\`*${FILE_EXT}\`, version ${ANIMATION_VERSION}) for the TreDeSpace
viewer — often a big one: hundreds of items in tens of steps. The user opens it with **Animation ribbon → Open**, plays it and fine-tunes it in the **Timeline**. Check every file you write against the **JSON Schema** at the
end of this brief before you hand it over; in a copy of the app's source, \`npm run anim:check <file>\` checks it the
way Open does (exit code 0 = it opens, 1 = it does not or the file is missing, 2 = no file given; a relative path
is taken from the source's root folder). Fields the format does not know are ignored without a word — a misspelt
field (\`exlude\`) simply does nothing — so check every name against the schema.

## First, ask the user

Do not guess; ask for what you do not have yet:

1. **What the animation shows** — an assembly being built, a disassembly or maintenance job (parts come off, are
   replaced, go back), or a finished system presented part by part (colours, labels, little motion) — and who watches.
2. **What is visible at the start** — usually the user wants each item **hidden until it arrives**, and often the
   **whole model hidden first**, so the viewer sees it being built. If the user has not said, **ask** — do not
   assume. The three choices, and how to write each, are under *What is visible at the start* below.
3. **The item list** — a CSV the user makes in the app: select the items in the Hierarchy or 3D view, then press
   an **Item list for AI** shortcut — **ALT 1550** (the selected nodes), **ALT 1551** (their children) or **ALT 1552**
   (every leaf under them), unless the user has rebound them. Without it you do not know the fullnames — never
   invent them. Ask for the level that matches the objects they want. Its
   columns: \`name\`, \`fullname\`, \`parent\`, \`depth\`, \`items\` (how many items are under the node — a count,
   not the object field), \`model\`, the box centre \`cx cy cz\` and size \`sx sy sz\` where the items stand now,
   then the SQL result's columns; at most 20 000 rows.
4. **How to group and order** — by level, system, area or module; bottom-up or in a given order. To group by
   attributes the names do not show (system, discipline, vendor), ask the user to run a query in the SQL editor whose
   result has a \`fullname\` column and those attributes, *then* make the item list: its columns are joined on.
5. **One scene or several** — one scene for one sequence; several when the viewer should pick between sequences that
   stand on their own (an assembly, each maintenance job, a walk-through). See *Several scenes*.
6. **The presentation** — steps (named spans with a card, pausing at their end or not), labels on which items,
   colours, the camera, the pace (seconds per item / step) and the total length. And **the look of cards and
   labels**: the user's cards (*Cards* below) and the built-in Callout unless they ask for their own — then write
   designs of your own (*Custom designs* below).
7. **An existing animation** to change — the user saves it (**Animation ribbon → Save**) and gives you the file. Keep every
   \`id\` when you edit it.

## How an animation plays

- A file holds **scenes** (usually one — see *Several scenes*). The Timeline shows one scene at a time: a **Scene**
  row (its settings: name, loop, ping-pong, a pinned end, the step card), a **Steps** row, a **Camera** row, a
  **Clipping** row (the file's \`section\`), a **Colour rules** row, **Labels** and **Measurements** rows, an
  **Overlays** row (the file's \`callouts\`), and an **Objects** row with **one row per object** under it.
- **Every scene starts from the model as it was loaded**: items the user moved, hid or coloured go back, their
  clipping is off, and their own labels and measurements are put aside (only the animation's Labels / Measurements
  keys show) — so a scene sets up everything it shows itself, and it plays the same for everyone.
- An **object** is a set of items (fullnames) that move, show, hide and colour together, keyed on its own row. Make
  one object per thing that moves on its own; items that only get coloured need no object (use colour rules).
- Name an object's items as **high in the tree as you can**: the node that holds the whole thing, not its hundred
  children. When a few items under it must not move with it, leave them out with \`exclude\` — "the module minus
  its foundation" is \`"items": ["/m1"], "exclude": ["/m1/foundation"]\`. Adds and leave-outs nest: the deeper one wins.
- **An item belongs to one object only.** When two objects name the same item, the first object in \`objects\` gets
  it and the other one's copy never moves. To move a part on its own inside a bigger thing that moves too (a hatch
  on a module), leave the part out of the big object (\`exclude\`), make it an object of its own, and give it keys
  that repeat the big object's motion plus its own.
- An object **key** at time \`t\` says where the object is: \`move\` (metres) and \`rotate\` are its **offset from where
  it stands in the model** — \`[0, 0, 0]\` is its own place. Keys are absolute, never a change from the key before.
- **Before an object's first key it is as at that key — where it stands, hidden or coloured; after its last key it
  stays.** Give it a key at the start of its movement and one at the end; more keys make a path.
- Keys on every row are kept in time order (write them in any order); two keys at the same time on one row — the
  later one in the list wins.
- \`interp\` says how the object arrives at a key: \`smooth\` (eased, the default), \`linear\` or \`hold\` (it stays where
  it was and jumps at the key). An object's \`path: "smooth"\` curves its position through its keys.
- \`visible\`, \`opacity\` and \`color\` on a key are **instant**: they hold from that key on, until a later key sets
  them again; a key without them changes nothing. Hiding is \`visible: false\`, not opacity 0.
- \`spin\` adds whole turns on the way to a key (a wheel, a fan): \`rotate\` is still where it ends up.
- \`pivot\` on a key says what its \`move\` and \`rotate\` are about, and the object turns about it on the way to the
  key: a side of the object's box (\`"bottom"\`, \`"top"\`, \`"front"\` = −Y, \`"back"\`, \`"left"\` = −X, \`"right"\`,
  \`"center"\`) or a point \`[x, y, z]\` (a hinge), as \`{ "at": …, "offset": [x, y, z] }\` or just the side / point. A
  door swinging open on its hinge: \`{ "t": 2, "rotate": { "axis": [0, 0, 1], "degrees": 90 }, "pivot": [hx, hy, hz] }\`
  — no move needed. Without it a key is about the object's \`pivot\` (its centre by default). Exactly: with a pivot
  point q (on the object where it stands in the model), the key turns the object by \`rotate\` about q and takes q to
  q + \`move\`; on the way into the key q travels straight (or along the smooth path) while the turn happens about it.
- **Steps** are named spans on the Steps row (\`start\`, \`end\`; they may not overlap). While a step runs its **card**
  shows (the scene's step card unless the step has its own; \`card: null\` = none), \`{{step.name}}\` and
  \`{{step.text}}\` fill in, and playback stops at its end when \`pauseAtEnd\` is on (the viewer presses Continue).
  Steps do not move anything — line the objects' keys up with them.
- **Colour rules** keys hold Set Color rules from their time on (instant). \`hide\` mode hides everything first and the
  rules show what they match; \`append\` goes on top of the rules before; \`reset\` starts clean. An object's own keys
  win over the rules (a \`visible: true\` key shows it in a hidden model). An object key's \`color: null\` means "no
  colour of its own from here on" — a colour rule's colour can still show on it.
- **Callouts** (the Overlays row) show an overlay (in \`overlayInstances\`) from \`start\` to \`end\` — a label hanging
  from an object by its id, or a title card, caption or info card on screen.
- **Camera** keys: none = the viewer's view stays free; one = the view is set there; more = it glides between them
  (\`hold\` = a cut). Ask whether the user wants the camera to move at all; write views as in *Camera keys* below — a
  view the user made in the app (Key on the Camera row) is exact.
- **Clipping** keys (\`section\`) each hold the **whole clipping** — a box, three planes, shapes — from their time on;
  it holds before the first key and after the last, \`hold\` switches at the key and \`smooth\` / \`linear\` glide the
  box and the planes. See *Clipping* below.
- **Labels** and **Measurements** keys each hold the **whole set** shown from their time on (\`[]\` = none; before the
  first key: none). They sit at **fixed points in the model** — they do not follow a moving object: a label on
  something that moves is a callout hanging from the object. See *Labels and measurements* below.
- The scene ends at its last key, step or callout end (or at \`end\`). \`loop\` starts it again at the end;
  \`pingPong\` plays it back to the start once — with \`loop\` too it keeps going there and back.

## What is visible at the start

Settle this with the user before you write the keys — it is the first thing a viewer sees.

- **Each item waits until it arrives** (the usual assembly). Give every arriving object a first key at \`t: 0\` with
  \`visible: false\` (where it will appear from, \`interp: "hold"\`), then a key with \`visible: true\` when it appears.
  Everything that is not an object stays visible.
- **The whole model hidden first** — the animation builds it from nothing. Add a colour-rules key at \`t: 0\` with
  \`"mode": "hide"\` (\`"rules": []\` hides everything; add rules for context to keep in view — a foundation, the
  building — with \`"color": null\` to keep its own colour). Each object still needs its \`visible: true\` key when it
  arrives (and a \`visible: false\` first key if it should not show before). A later \`reset\` rules key brings the whole
  model back; use \`append\` to colour on top of the hidden model.
- **Everything visible from the start** (a disassembly, a walk-through): no \`visible: false\` keys; hide what is
  taken away with a \`visible: false\` key when it has gone.

## Several scenes

- Use **one scene per sequence that stands on its own** — an assembly, each maintenance job, a walk-through — and
  **steps** for the stages inside one. The viewer picks a scene in the Timeline's **Scene ▾** or, presenting, on the
  play bar — by its \`name\`, so give each a short, clear one; a host page can switch scenes; a video shows every scene
  one after another (each whole, empty ones left out) or one. \`scenes\` is in that order, and the first one opens.
- **Each scene starts from the model as it was loaded.** Nothing carries over from the scene before — hidden items,
  colours, moved items, clipping, the camera — so each sets up its own start (its own \`colorRules\` key at \`t: 0\`,
  its own first keys) and has its own steps, rows and settings.
- **Objects belong to their scene.** The same items may be objects in several scenes (each keys them its own way),
  but object ids are unique across the whole file — prefix them (\`asm-pump\`, \`seal-cover\`).
- **Overlays are shared**: \`overlayInstances\` belong to the file, and any scene's callouts may show them (a title
  card, a caption). One that hangs from an object must name an object of the scene that shows it — otherwise it stays
  hidden and the app lists it under Problems — so a label on "the same" item gets one instance per scene.

Two scenes, the second starting from the whole model again:

\`\`\`json
${BRIEF_MULTI_SCENE}
\`\`\`

## Units and directions

Metres; **Z is up**. Directions for "comes from": ${directions}. The item list's \`cx cy cz\` are box centres and
\`sx sy sz\` box sizes: a travel of 1–2 × the item's largest size reads well (at least 0.2 m). Times in seconds;
1.5–3 s per movement is a calm pace, 0.3–0.8 s per small item in a ripple.

## Format

\`\`\`json
{
  "format": "${ANIMATION_FORMAT}",
  "version": ${ANIMATION_VERSION},
  "name": "Pump skid",
  "scenes": [{
    "name": "Assembly",
    "objects": [{
      "id": "pump", "name": "Pump", "items": ["/skid/pump-01"], "pivot": "center",
      "keys": [
        { "t": 0, "move": [0, 0, 2], "visible": false, "interp": "hold" },
        { "t": 1, "move": [0, 0, 2], "visible": true, "interp": "hold" },
        { "t": 3, "move": [0, 0, 0] }
      ]
    }],
    "colorRules": [{ "t": 0, "mode": "hide", "rules": [] }],
    "steps": [{ "name": "Pump", "text": "Lower the pump onto the skid", "start": 1, "end": 3, "pauseAtEnd": true }]
  }],
  "overlayInstances": [], "overlayComponents": [], "overlayThemes": []
}
\`\`\`

Every field but the ones marked required in the schema may be left out; the defaults are below. Ids of scenes,
objects, steps and callouts are made up when left out — give objects an id when a callout hangs from them. **Ids
must be unique** or the file does not open: object ids across all scenes, step and callout ids within their scene
(steps and callouts share one set), and scene, overlay instance, design and theme ids. Ids are letters, digits and
\`_ : . -\` — also where one is referred to (a callout's \`instance\`, a card's \`component\` / \`theme\`, an
anchor's \`object\`).

### Object

| field | values | default |
|---|---|---|
| \`items\` | **required** — fullnames from the item list | — |
| \`exclude\` | fullnames left out of \`items\` (a group minus a few) | [] |
| \`id\` / \`name\` | id (letters, digits, \`_ : . -\`) / its row's name | made up / "" |
| \`pivot\` | a side of its box (\`center\`, \`bottom\`, \`top\`, \`front\`, \`back\`, \`left\`, \`right\`) or \`[x, y, z]\` | \`center\` |
| \`path\` | \`straight\` / \`smooth\` | \`straight\` |
| \`keys\` | keys (below), any order | [] |
| \`muted\` | true = not animated (its items stand where they are in the model) | false |

### Object key

| field | values | default |
|---|---|---|
| \`t\` | **required** — seconds | — |
| \`move\` | \`[x, y, z]\` metres from its place in the model | \`[0, 0, 0]\` |
| \`rotate\` | \`{ "axis": [x, y, z], "degrees": n }\` or a quaternion \`[x, y, z, w]\` | no rotation |
| \`interp\` | \`smooth\` / \`linear\` / \`hold\` | \`smooth\` |
| \`spin\` | \`{ "axis": [x, y, z], "degrees": n }\` extra turns on the way here | — |
| \`pivot\` | a side, a point \`[x, y, z]\` (a hinge) or \`{ "at", "offset" }\` — what move / rotate are about | the object's pivot |
| \`visible\` / \`opacity\` / \`color\` | true / false; 0–1; \`#rrggbb\` or null (own colour) — instant | as before |

### Scene

| field | values | default |
|---|---|---|
| \`objects\`, \`steps\`, \`callouts\` | lists | [] |
| \`camera\` | \`{ t, view, interp }\` keys — *Camera keys* below | [] (free view) |
| \`section\` | clipping: \`{ t, value, interp }\` keys — *Clipping* below | [] |
| \`colorRules\` | \`{ t, mode, rules }\` keys — *Colour rules* below | [] |
| \`labels\` / \`measurements\` | \`{ t, labels }\` / \`{ t, measurements }\` keys — the whole set shown from \`t\` on; *Labels and measurements* below | [] |
| \`stepCard\` | \`{ component, theme }\` the card every step shows; null = none | the built-in step card |
| \`loop\` / \`pingPong\` / \`end\` | repeat / play back to the start / pinned end (s) | false / false / its content |
| \`id\` / \`name\` | the scene's id / its name (the Timeline's Scene ▾, the play bar) | made up / "Scene" |
| \`keepOverlaysOnScreen\` | labels hanging from objects flip / clamp to stay inside the view | true |

### Step

| field | values | default |
|---|---|---|
| \`start\` / \`end\` | **required** — seconds; no overlaps | — |
| \`name\` / \`text\` | shown on its card (\`**bold**\`, line breaks in \`text\`) | "" |
| \`pauseAtEnd\` | playback waits at its end | false |
| \`card\` | \`{ component, values, place?, textScale?, theme? }\`; null = no card | the scene's step card |
| \`notes\` | presenter notes (not in the picture) | — |

### Callout

| field | values | default |
|---|---|---|
| \`instance\` | **required** — the id of an overlay in \`overlayInstances\` | — |
| \`start\` / \`end\` | **required** — seconds | — |
| \`enter\` / \`exit\` | \`{ "kind": "fade" / "pop" / "slide" / "none", "duration": s }\` (a slide also has \`from\`: \`left\`, \`right\`, \`top\`, \`bottom\`; \`duration\` 0.3 when left out) | none |
| \`keys\` | \`{ t (s after start), at, interp }\` — its place over time | — |

An overlay instance: \`{ "id", "component", "values", "theme", "anchor", "scale", "textScale" }\` — \`anchor\` is
\`{ "kind": "object", "object": "<object id>", "offset": [80, -70] }\` for a label on an object (\`offset\` in px from
it; \`"leader": true\` draws a line to it, \`leaderColor\` its colour), \`{ "kind": "world", "pos": [x, y, z], … }\` the
same from a fixed point in the model, or \`{ "kind": "screen", "pos": [0.5, 0.1], "pin": "t" }\` (0..1 of the view;
\`pin\` one of ${PINS}) for a caption or title. \`values\` are text, numbers, true / false or null; \`scale\` sizes the
whole overlay, \`textScale\` its text (0.25–4).

### Camera keys

A camera key holds an orbit view: \`{ "target": [x, y, z], "azimuth", "elevation", "orbitDistance", "orthographic",
"sketch" }\`. It looks along (cos el · cos az, cos el · sin az, sin el) and the eye sits \`orbitDistance\` back from
\`target\`: \`azimuth\` (radians) 0 looks along +X (from the left), π/2 along +Y (from the front), π along −X, −π/2
along −Y (from the back); **a negative \`elevation\` looks down** (−0.5 ≈ 30° down; keep it within ±1.55). To frame
an item: \`target\` its box centre (\`cx cy cz\`), \`orbitDistance\` 1.5–2.5 × its largest size (more for a group),
\`elevation\` −0.3 to −0.6. Between keys the view glides — target and elevation straight, azimuth **the short way
round**, distance in proportion — so a turn needs keys at most 180° apart: one orbit is 9 keys 45° (π/4) apart over
about 8 s, \`"interp": "linear"\`. \`hold\` cuts; \`orthographic\` (parallel projection) and \`sketch\` switch at the key.

### Clipping

A \`section\` key holds the **whole clipping** at its time — \`{ "box": …, "planes": { "x": …, "y": …, "z": … },
"shapes": [ … ] }\`; a part left out is off, so \`{}\` is no clipping. Between two keys \`hold\` switches at the later
key; \`smooth\` / \`linear\` glide the box (centre, size, rotation) and the planes (position, angles) while both keys
have them on — switching a part on or off, flipping it and the shapes change when the glide arrives.

- **Box** \`{ "enabled", "center", "size", "rotation", "boxOn", "inverted" }\`: \`enabled\` turns clipping on (the box
  and the shapes); it keeps what is inside the box (\`inverted\`: cuts it; \`boxOn: false\` leaves only the shapes).
- **Planes** \`x\`, \`y\`, \`z\` — three slots, each \`{ "enabled", "position", "el", "az", "flipped", "anchor" }\` and
  each on its own: its normal points at elevation \`el\` / azimuth \`az\` (degrees; el 90 = up, −90 = down; az 0 = +X,
  90 = +Y), it passes through \`anchor\` (a point; null = the loaded models' centre) moved \`position\` metres along
  the normal, and it **keeps the side its normal points to** (\`flipped\`: the other side).
- **Shapes** (up to 7): \`sphere\` (\`center\`, \`radius\`), \`cylinder\` (\`center\` = its base, \`axis\`, \`radius\`,
  \`height\`), \`box\` (\`center\`, \`halfExtents\`, \`rotation\`); what is inside any of them, or the box, is kept, and
  \`inverted\` makes one a hole.

To cut something open from the top: the \`z\` plane with \`"el": -90\` (it keeps what is below it), its \`anchor\` at
the height to start, and a glide of \`position\` to go deeper; a last key \`{ "value": {}, "interp": "hold" }\` turns it
all off.

### Labels and measurements

The Labels and Measurements rows: each key is **the whole set shown from its time on** (\`[]\` = none); before the
first key there are none. Both sit at fixed points in the model — for a label on something that moves, use a callout
hanging from the object.

- A label: \`{ "text", "anchor": [x, y, z], "offset": [px, px], "bg", "textColor", "opacity", "leaderColor",
  "sphere", "fullname" }\` — \`anchor\` the point it points at (an item's box centre from the item list), \`offset\`
  where the label sits from it on screen; colours \`#rrggbb\`.
- A measurement: \`{ "kind", "points": [{ "pos": [x, y, z] }, …], "label", "visible", "showLabel" }\` — \`point\` (1
  point: its coordinates), \`line\` (2: the distance), \`path\` (2 or more: each leg and the total), \`area\` (3 or
  more corners), \`diameter\` (3 on a rim), \`angle\` (3: the angle at the second), \`face\` (2: the gap straight out
  from the first point's face — give that point a \`normal\`).

### Patterns

Each is a whole scene (put it in \`scenes\`):

${BRIEF_PATTERNS.map((p) => `${p.title}:\n\n\`\`\`json\n${p.scene}\n\`\`\``).join('\n\n')}

The label in the colour pattern is this overlay (in \`overlayInstances\`):

\`\`\`json
${BRIEF_PATTERN_OVERLAYS}
\`\`\`

### Cards

\`place\` is one of ${PINS}. \`textScale\` (0.25–4) sizes the card's text. Text values may use \`{{step.name}}\`,
\`{{step.text}}\`, \`{{step.index}}\` and \`{{step.count}}\`. Cards available (\`component\` ids):

${cardsList(o.cards)}

Themes available (\`theme\` ids): ${(o.themes ?? []).map((t) => `\`${t.id}\` (${t.name})`).join(', ') || 'Auto only'}. Leave \`theme\` out (or null) for **Auto**: the card follows the viewer's light / dark theme — what you want unless the user asks for one look.

### Colour rules

- Rules apply in order. A rule's \`filters\` match item **fullnames**, case-insensitive; a hit takes its whole
  subtree. \`mode\`: \`contains\`, \`starts\`, \`ends\`, \`single\` (the whole name; a \`*\` at its start or end widens it),
  \`multi\` (one whole name per line), \`wildcard\` (the whole name, \`*\` anywhere). \`op\`: \`append\` adds, \`remove\`
  subtracts from the rows above, \`keep\` keeps only what the rows above found too. \`level\` makes a row test only the
  names at that depth of the tree (each hit still takes its subtree; 0 = any depth). In \`multi\` a line may end in a
  colour of its own after a space, TAB or comma (\`/site/pump-01 #ff0000\`, with \`:opacity\` 0–100 if wanted —
  \`#ff0000:40\`). A rule may be switched off (\`enabled: false\`) and has a \`comment\` (its name). Leave \`store\`
  empty.
- \`color\`: \`#rrggbb\` or null (own colour); \`opacity\` 0–1 (0 hides).

## Custom designs: cards, labels and themes

Use the user's cards and the built-in Callout unless the user asks for a look of their own. Then put designs and
themes of your own at the top of the animation file: \`"overlayComponents": [...]\` and \`"overlayThemes": [...]\`.
They travel with the file; the Overlay Editor can change them and add them to the user's library. Give each an id of
your own (\`custom.stepCard\`, \`custom.brand\`) — never \`preset.…\`, \`theme.default\` or \`theme.light\`. To change a
design the user already has, they export it from the Overlay Editor (**Export ▾**) and give you the file — keep its id
**and raise its \`version\`**: the viewer draws its own library copy of an id, and Open offers yours only when the
version differs. A changed theme needs a new id. Images must be \`data:\` URLs (https is refused), colours real
colours, a parameter's \`default\` of its own type.

How a design is built (the schema's \`$defs\` has every field):

- \`root\` is a tree of blocks: \`box\` (a flex container — \`layout\`: \`dir\` row / col, \`gap\`, \`align\`,
  \`justify\` — and \`children\`), \`text\` (\`text\`, \`rich\` for \`**bold**\` and line breaks), \`image\` (\`src\`,
  \`fit\`), \`icon\` (\`icon\`), \`divider\` and \`progress\` (\`value\`, e.g. \`{{step.index}}/{{step.count}}\`). Each
  block has an \`id\` unique in the design and a \`style\`, and may have \`showIf\`.
- Box styles (box, image, divider, progress): \`bg\`, \`opacity\`, \`padding\` / \`margin\` \`[top, right, bottom,
  left]\`, \`border\` \`{ width, color, style }\`, \`radius\`, \`shadow\` (none / sm / md / lg), \`width\` / \`height\`
  (px, \`auto\`, \`fill\`). Text styles (text, icon): \`color\`, \`size\`, \`weight\` (400–700), \`align\`, \`font\`
  (ui / mono / serif — system fonts), \`lineHeight\`, \`maxLines\`.
- **Sizes** are px on a view \`designHeight\` (1080) tall and scale with the view. **Font size**: a text block's
  \`size\` (default 16); the whole design × its \`textScale\`; a placed card × \`card.textScale\`. The design's \`size\`:
  \`{ "width": "auto", "minWidth": …, "maxWidth": … }\` (as wide as its text, wrapping at maxWidth — default 640) or a
  fixed px \`width\`; \`height\` usually \`auto\`.
- **Values** (\`params\`) are what each card sets: \`text\`, \`richText\`, \`image\`, \`color\`, \`number\`, \`toggle\`, each
  with a \`key\`, \`label\` and \`default\`. Text uses them as \`{{key}}\`; a colour field may be \`"{{key}}"\` of a colour
  value and a text \`size\` \`"{{key}}"\` of a number value — so every card sets its own colours and font sizes;
  \`showIf: "key"\` hides a block when that toggle is off or that text is empty. Text may also use \`{{step.name}}\`,
  \`{{step.text}}\`, \`{{step.index}}\`, \`{{step.count}}\`, \`{{object.name}}\` (a label's object), \`{{time}}\` and
  \`{{duration}}\`.
- **Colours**: \`#rrggbb\`, \`rgb(…)\`, \`transparent\`, a theme colour — \`$bg\`, \`$surface\`, \`$text\`, \`$muted\`,
  \`$accent\`, \`$warning\`, \`$danger\`, \`$success\`, set by the card's theme — or \`{{key}}\`. A theme gives those
  eight: \`{ "id", "name", "tokens": { "bg": "#…", … } }\`.
- **Icons**: ${OVERLAY_ICONS.map((i) => `\`${i.name}\``).join(', ')}.
- **Safe by design**: no HTML or CSS; images only as \`data:image/…\` URIs (≤ 1 MB) or an image value the user fills
  in the app — never a web address. For a logo, add an image value and let the user pick the file in the app.

Example — the built-in step card as a design of your own whose title size is a value, a brand theme, and a scene
whose steps use both:

\`\`\`json
${customDesignExample()}
\`\`\`

## Before you hand it over

The app lists these under **Problems** in the Key panel — avoid them:

- an object whose items are not in the loaded models (a fullname not from the item list);
- one item in two objects of a scene — only the first object moves it;
- an object moving while it is hidden — keep a hidden object still, move it once it shows;
- a callout whose overlay or design is missing, or one hanging from an object its scene does not have.

And the file does not open with overlapping steps, something ending before it starts, an id used twice, a colour that
is not \`#rrggbb\`, a negative time or more than 7 clip shapes in a key — \`npm run anim:check\` names the place.

## JSON Schema

\`\`\`json
${JSON.stringify(animationFileSchema(), null, 2)}
\`\`\`
`;
}
