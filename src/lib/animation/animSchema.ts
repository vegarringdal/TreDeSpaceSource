// -----------------------------------------------------------------------------
// animation file JSON Schema, version 2 (DESIGN.md › Animation › Files)
// -----------------------------------------------------------------------------
// The schema the Claude brief hands an AI assistant so it can check an
// animation file before the user opens it. Mirrors the parser in io.ts;
// ranges mirror its clamps. The overlay design $defs come from
// overlaySchema.ts.

import { OVERLAY_SCHEMA_DEFS } from '../overlay/overlaySchema';
import { ANIMATION_FORMAT, ANIMATION_VERSION } from './types';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const num = (min: number, max: number | null, description: string): Json =>
  max === null
    ? { type: 'number', minimum: min, description }
    : { type: 'number', minimum: min, maximum: max, description };
/** The sides of an object's box a pivot can be on. */
const SIDES = ['center', 'bottom', 'top', 'front', 'back', 'left', 'right'];

const vec = (n: number, description: string): Json => ({
  type: 'array',
  items: { type: 'number' },
  minItems: n,
  maxItems: n,
  description,
});
const ref = (name: string): Json => ({ $ref: `#/$defs/${name}` });
const TIME = num(0, null, 'seconds on the scene clock');
const HEX = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
const ID = { type: 'string', pattern: '^[A-Za-z0-9_:.-]{1,64}$' };
const INTERP: Json = {
  enum: ['smooth', 'linear', 'hold'],
  description: 'how it arrives at this key: smooth (eased in and out, the default), linear, hold (stays, then jumps)',
};
const PINS = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'];

// -----------------------------------------------------------------------------
// definitions
// -----------------------------------------------------------------------------

const ROTATION: Json = {
  description: 'rotation about the pivot: a quaternion [x, y, z, w], or { axis: [x, y, z], degrees }',
  oneOf: [
    vec(4, 'quaternion [x, y, z, w]'),
    {
      type: 'object',
      required: ['axis', 'degrees'],
      additionalProperties: false,
      properties: { axis: vec(3, 'rotation axis (any length)'), degrees: { type: 'number' } },
    },
  ],
};

const OBJECT_KEY: Json = {
  type: 'object',
  required: ['t'],
  additionalProperties: false,
  properties: {
    t: TIME,
    move: vec(3, 'offset in metres from where the object stands in the model (default [0, 0, 0])'),
    rotate: ROTATION,
    interp: INTERP,
    spin: {
      type: 'object',
      required: ['axis', 'degrees'],
      additionalProperties: false,
      description: 'extra turns on the way to this key (360 = one full turn); rotate stays the end orientation',
      properties: { axis: vec(3, 'spin axis'), degrees: { type: 'number' } },
    },
    pivot: {
      description:
        "what move and rotate are about, and what it turns about on the way here: a side of the object's box or a point (a hinge), plus an offset; absent = the object's pivot",
      oneOf: [
        { enum: SIDES },
        vec(3, 'a point of the object where it stands in the model (metres)'),
        {
          type: 'object',
          required: ['at'],
          additionalProperties: false,
          properties: {
            at: { oneOf: [{ enum: SIDES }, vec(3, 'a point (metres)')] },
            offset: vec(3, 'moves the pivot (metres)'),
          },
        },
      ],
    },
    visible: { type: 'boolean', description: 'shown / hidden from this key on (instant); absent = as before' },
    opacity: num(0, 1, 'from this key on (instant); absent = as before'),
    color: {
      type: ['string', 'null'],
      pattern: '^#[0-9a-fA-F]{6}$',
      description: "#rrggbb from this key on; null = the item's own colour; absent = as before",
    },
  },
};

const OBJECT: Json = {
  type: 'object',
  required: ['items'],
  additionalProperties: false,
  properties: {
    id: { ...ID, description: 'unique in the file; made up when left out (callouts hang from it by id)' },
    name: { type: 'string', description: 'shown on its Timeline row' },
    items: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
      description: 'fullnames from the item list; everything under a named node moves with it',
    },
    exclude: {
      type: 'array',
      items: { type: 'string' },
      description:
        'fullnames left out (with what is under them): a group minus a few; a node listed in items deeper than a left-out one comes back',
    },
    pivot: {
      description:
        "what keys without a pivot of their own are about: a side of its items' box where they stand ('center' default, 'bottom', 'top', 'front' = -Y, 'back', 'left' = -X, 'right') or a point [x, y, z]",
      oneOf: [{ enum: SIDES }, vec(3, 'a point in the model (metres)')],
    },
    path: { enum: ['straight', 'smooth'], description: 'lines between keys (default) or a curve through them' },
    keys: { type: 'array', items: ref('objectKey'), description: 'any order; sorted on load' },
    muted: { type: 'boolean', description: 'not animated' },
  },
};

const VIEW: Json = {
  type: 'object',
  required: ['target', 'azimuth', 'elevation', 'orbitDistance'],
  additionalProperties: false,
  description:
    'an orbit view: it looks along (cos el · cos az, cos el · sin az, sin el) and the eye sits orbitDistance back from target',
  properties: {
    target: vec(3, 'the point looked at and orbited (metres)'),
    azimuth: {
      type: 'number',
      description:
        'radians around Z of the view direction: 0 looks along +X, π/2 along +Y (from the front), π along −X',
    },
    elevation: {
      type: 'number',
      description:
        'radians, the view direction up or down: NEGATIVE looks down (the eye above the target); the viewer keeps it within ±1.55',
    },
    orbitDistance: num(0, null, 'metres from the eye to the target'),
    orthographic: { type: 'boolean', description: 'parallel projection (default false); switches at the key' },
    sketch: { type: 'boolean', description: 'the sketch look; switches at the key' },
  },
};

const CLIP_BOX: Json = {
  type: 'object',
  required: ['enabled', 'center', 'size'],
  additionalProperties: false,
  description: 'the clip box: it keeps what is inside it (inverted: cuts it)',
  properties: {
    enabled: { type: 'boolean', description: 'clipping on — the box AND the shapes (the planes have their own)' },
    boxOn: { type: 'boolean', description: 'the box itself (default true); false = only the shapes clip' },
    center: vec(3, 'box centre in the model (metres)'),
    size: vec(3, 'box size along its x / y / z (metres)'),
    rotation: vec(4, 'box rotation, quaternion [x, y, z, w] (default none)'),
    inverted: { type: 'boolean', description: 'cut what is inside instead of outside (default false)' },
  },
};

const CLIP_PLANE: Json = {
  type: 'object',
  required: ['enabled', 'position'],
  additionalProperties: false,
  description:
    "a plane that keeps the side its normal points to; it passes through anchor (null = the loaded models' centre) moved position metres along the normal",
  properties: {
    enabled: { type: 'boolean' },
    position: { type: 'number', description: 'metres along the normal from the anchor' },
    el: { type: 'number', description: 'normal elevation, degrees: 90 = up, −90 = down (default 0)' },
    az: { type: 'number', description: 'normal azimuth, degrees around Z: 0 = +X, 90 = +Y (default 0)' },
    flipped: { type: 'boolean', description: 'keep the other side (default false)' },
    anchor: {
      description: "a point in the model (metres); null = the loaded models' centre (default)",
      oneOf: [{ type: 'null' }, vec(3, 'a point (metres)')],
    },
  },
};

const CLIP_SHAPE: Json = {
  type: 'object',
  required: ['kind', 'center'],
  additionalProperties: false,
  description:
    'an extra clip volume: what is inside any shape (or the box) is kept; an inverted shape is a hole that cuts its inside',
  properties: {
    kind: { enum: ['sphere', 'cylinder', 'box'] },
    label: { type: 'string' },
    center: vec(3, "sphere / box centre; a cylinder's base point (metres)"),
    axis: vec(3, 'cylinder axis (default [0, 0, 1])'),
    radius: num(0, null, 'sphere / cylinder radius, metres (default 1)'),
    height: num(0, null, 'cylinder height along its axis, metres (default 1)'),
    halfExtents: vec(3, 'box half sizes, metres (default [1, 1, 1])'),
    rotation: vec(4, 'box rotation, quaternion [x, y, z, w] (default none)'),
    enabled: { type: 'boolean', description: 'default true' },
    inverted: { type: 'boolean', description: 'a hole: cuts what is inside it (default false)' },
  },
};

const CLIP_STATE: Json = {
  type: 'object',
  additionalProperties: false,
  description:
    'the whole clipping at a key — the box, three planes and up to 7 shapes; a part left out is off ({} = no clipping)',
  properties: {
    box: ref('clipBox'),
    planes: {
      type: 'object',
      additionalProperties: false,
      description: 'three planes, each on its own (the names are slots — each points where its el / az say)',
      properties: { x: ref('clipPlane'), y: ref('clipPlane'), z: ref('clipPlane') },
    },
    shapes: { type: 'array', maxItems: 7, items: ref('clipShape') },
  },
};

const RULE: Json = {
  type: 'object',
  required: ['filters'],
  additionalProperties: false,
  properties: {
    comment: { type: 'string' },
    enabled: { type: 'boolean' },
    filters: {
      type: 'array',
      items: {
        type: 'object',
        required: ['mode', 'value'],
        additionalProperties: false,
        properties: {
          op: {
            enum: ['append', 'remove', 'keep'],
            description: 'append adds, remove subtracts from the rows above, keep intersects',
          },
          mode: {
            enum: ['contains', 'single', 'multi', 'starts', 'ends', 'wildcard'],
            description: 'how `value` is matched against item fullnames (case-insensitive)',
          },
          value: { type: 'string', description: 'the text to match (multi: one fullname per line)' },
          comment: { type: 'string' },
          level: {
            type: 'integer',
            minimum: 0,
            description: 'test only names at this depth of the tree, each hit with its subtree (0 = any depth)',
          },
        },
      },
    },
    color: { type: ['string', 'null'], pattern: '^#[0-9a-fA-F]{6}$', description: '#rrggbb, or null = own colour' },
    opacity: num(0, 1, '0 hides, 1 = no change'),
    store: { type: 'string', description: "leave empty ('' = every store)" },
  },
};

const SPHERE: Json = {
  description:
    'a sphere drawn in the model at the point: true = the default (0.1 m orange wireframe), or { size (m), color, solid, opacity }',
  oneOf: [
    { type: 'null' },
    { const: true },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        size: num(0, null, 'radius, metres'),
        color: HEX,
        solid: { type: 'boolean' },
        opacity: num(0, 1, "a solid sphere's opacity"),
      },
    },
  ],
};

const LABEL: Json = {
  type: 'object',
  required: ['anchor'],
  additionalProperties: false,
  description: 'a label at a fixed point in the model — it does not follow a moving object',
  properties: {
    id: { type: 'number', description: 'made up when left out' },
    text: { type: 'string', description: "the label's text" },
    fullname: { type: ['string', 'null'], description: 'the item it belongs to; null = a free label (default)' },
    anchor: vec(3, 'the point it points at, in the model (metres)'),
    offset: vec(2, 'where the label sits from that point on screen, px (default [0, 0])'),
    muted: { type: 'boolean', description: 'kept in the set but not shown' },
    bg: { ...HEX, description: 'background (default #ffffff)' },
    opacity: num(0, 1, "the label's opacity (default 1)"),
    textColor: { ...HEX, description: 'default #14161a' },
    leaderColor: { ...HEX, description: "leader line and border (default the Label panel's)" },
    sphere: SPHERE,
  },
};

const MEASURE_POINT: Json = {
  type: 'object',
  required: ['pos'],
  additionalProperties: false,
  properties: {
    pos: vec(3, 'the point in the model (metres)'),
    normal: vec(3, "the face's normal at the point (a face measurement's first point)"),
    clicked: vec(3, 'where a perpendicular point was clicked off its line (leave out)'),
  },
};

const MEASUREMENT: Json = {
  type: 'object',
  required: ['kind', 'points'],
  additionalProperties: false,
  description: 'a measurement between fixed points in the model — it does not follow a moving object',
  properties: {
    id: { type: 'number', description: 'made up when left out' },
    kind: {
      enum: ['point', 'line', 'path', 'area', 'diameter', 'angle', 'face'],
      description:
        "point: 1 point, its coordinates; line: 2, the distance; path: 2+, each leg and the total; area: 3+ corners; diameter: 3 on a rim; angle: 3, the angle at the second; face: 2, the gap straight out from the first point's face (give it a normal)",
    },
    points: { type: 'array', items: ref('measurePoint') },
    label: { type: 'string', description: 'its name' },
    visible: { type: 'boolean', description: 'default true' },
    showLabel: { type: 'boolean', description: 'the name as a header on the value (default true)' },
    showPerp: { type: 'boolean', description: 'the perpendicular helper of a perpendicular point (default false)' },
    axisLegs: { type: 'array', items: { type: 'boolean' }, minItems: 3, maxItems: 3, description: 'ΔX / ΔY / ΔZ legs' },
    axisLabels: {
      type: 'array',
      items: { type: 'boolean' },
      minItems: 3,
      maxItems: 3,
      description: 'lengths on those legs',
    },
    legsInLabel: { type: 'boolean', description: 'ΔX / ΔY / ΔZ in the label (default false)' },
    slopeInLabel: { type: 'boolean', description: 'line: the slope in the label (default false)' },
    flipAngle: { type: 'boolean', description: 'angle: the reflex angle (360° − it)' },
    sphere: SPHERE,
  },
};

const LABELS_KEY: Json = {
  type: 'object',
  required: ['t'],
  additionalProperties: false,
  properties: {
    t: TIME,
    labels: { type: 'array', items: ref('label'), description: 'the whole set shown from t on ([] = none)' },
  },
};

const MEASUREMENTS_KEY: Json = {
  type: 'object',
  required: ['t'],
  additionalProperties: false,
  properties: {
    t: TIME,
    measurements: {
      type: 'array',
      items: ref('measurement'),
      description: 'the whole set shown from t on ([] = none)',
    },
  },
};

const RULES_KEY: Json = {
  type: 'object',
  required: ['t'],
  additionalProperties: false,
  properties: {
    t: TIME,
    mode: {
      enum: ['reset', 'append', 'hide'],
      description:
        'reset: clean model first; append: on the rules before; hide: everything hidden, the rules show what they match',
    },
    rules: { type: 'array', items: ref('rule') },
  },
};

const STEP: Json = {
  type: 'object',
  required: ['start', 'end'],
  additionalProperties: false,
  properties: {
    id: { ...ID, description: 'made up when left out' },
    name: { type: 'string', description: 'shown to the viewer ({{step.name}})' },
    text: { type: 'string', description: 'the step card text ({{step.text}}): **bold**, line breaks' },
    start: TIME,
    end: num(0, null, 'seconds; steps may not overlap'),
    pauseAtEnd: { type: 'boolean', description: 'playback waits at its end until Continue (default false)' },
    card: {
      description: "its own card; null = no card; leave out for the scene's step card",
      oneOf: [
        { type: 'null' },
        {
          type: 'object',
          required: ['component'],
          additionalProperties: false,
          properties: {
            component: { type: 'string', description: 'a design id (Cards list, or one in overlayComponents)' },
            values: { type: 'object', description: "the design's values" },
            place: { enum: PINS, description: 'screen place (default bl)' },
            textScale: num(0.25, 4, 'text size multiplier'),
            theme: {
              type: ['string', 'null'],
              description: "a theme id (absent or null = Auto: the viewer's light / dark theme)",
            },
          },
        },
      ],
    },
    notes: { type: 'string', description: 'presenter notes (not in the picture)' },
  },
};

const CALLOUT: Json = {
  type: 'object',
  required: ['instance', 'start', 'end'],
  additionalProperties: false,
  properties: {
    id: { ...ID, description: 'made up when left out' },
    instance: { type: 'string', description: 'id of an overlay in overlayInstances' },
    start: TIME,
    end: TIME,
    enter: ref('fx'),
    exit: ref('fx'),
    keys: {
      type: 'array',
      description: 'its place over time',
      items: {
        type: 'object',
        required: ['t', 'at'],
        additionalProperties: false,
        properties: {
          t: num(0, null, 'seconds after the callout starts'),
          at: vec(2, 'screen overlay: position 0..1 of the view; attached: label offset in px'),
          interp: INTERP,
        },
      },
    },
  },
};

const FX: Json = {
  type: 'object',
  required: ['kind'],
  additionalProperties: false,
  properties: {
    kind: { enum: ['none', 'fade', 'pop', 'slide'] },
    duration: num(0, 10, 'seconds (default 0.3)'),
    from: { enum: ['left', 'right', 'top', 'bottom'], description: 'slide only' },
  },
};

const INSTANCE: Json = {
  type: 'object',
  required: ['id', 'component', 'anchor'],
  additionalProperties: false,
  properties: {
    id: ID,
    component: { type: 'string', description: 'a design id (Cards list, or one in overlayComponents)' },
    componentVersion: { type: 'integer', minimum: 1 },
    values: { type: 'object', description: "the design's values" },
    theme: {
      type: ['string', 'null'],
      description: "a theme id, or null for Auto (follows the viewer's light / dark theme)",
    },
    anchor: {
      description: 'where it sits: on the screen, hanging from an object, or at a point',
      oneOf: [
        {
          type: 'object',
          required: ['kind', 'pos'],
          additionalProperties: false,
          properties: {
            kind: { const: 'screen' },
            pos: vec(2, '0..1 of the view (x right, y down)'),
            pin: { enum: PINS },
          },
        },
        {
          type: 'object',
          required: ['kind', 'object'],
          additionalProperties: false,
          properties: {
            kind: { const: 'object' },
            object: { type: 'string', description: "an object's id" },
            offset: vec(2, 'label offset from the object, px (default [0, -60])'),
            leader: { type: 'boolean', description: 'a line to the object (default true)' },
            leaderColor: HEX,
          },
        },
        {
          type: 'object',
          required: ['kind', 'pos'],
          additionalProperties: false,
          properties: {
            kind: { const: 'world' },
            pos: vec(3, 'a point in the model'),
            offset: vec(2, 'px'),
            leader: { type: 'boolean' },
            leaderColor: HEX,
          },
        },
      ],
    },
    scale: num(0.1, 10, 'size multiplier'),
    textScale: num(0.25, 4, 'text size multiplier'),
  },
};

const SCENE: Json = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { ...ID, description: 'made up when left out' },
    name: { type: 'string', description: 'shown in the Scene ▾ and on the play bar (default "Scene")' },
    objects: { type: 'array', items: ref('object') },
    camera: {
      type: 'array',
      description:
        'no keys = the view is free; one = fixed there; more = it glides (target and elevation straight, azimuth the short way round, distance in proportion)',
      items: {
        type: 'object',
        required: ['t', 'view'],
        additionalProperties: false,
        properties: {
          t: TIME,
          view: ref('view'),
          interp: { ...INTERP, description: 'hold = a cut; smooth / linear = a glide' },
        },
      },
    },
    section: {
      type: 'array',
      description: 'Clipping row: the whole clipping at each key; it holds before the first key and after the last',
      items: {
        type: 'object',
        required: ['t', 'value'],
        additionalProperties: false,
        properties: { t: TIME, value: ref('clipState'), interp: INTERP },
      },
    },
    colorRules: { type: 'array', items: ref('rulesKey') },
    labels: {
      type: 'array',
      items: ref('labelsKey'),
      description: 'Labels row: each key is the set shown from its time on; before the first key none',
    },
    measurements: {
      type: 'array',
      items: ref('measurementsKey'),
      description: 'Measurements row: each key is the set shown from its time on; before the first key none',
    },
    steps: { type: 'array', items: ref('step') },
    callouts: { type: 'array', items: ref('callout') },
    loop: { type: 'boolean' },
    pingPong: { type: 'boolean', description: 'at the end, play back to the start' },
    end: num(0, null, 'pinned end (s); default the last key, step or callout end'),
    stepCard: {
      description:
        'the card steps show unless they have their own; null = no card; leave out for the built-in step card',
      oneOf: [
        { type: 'null' },
        {
          type: 'object',
          required: ['component'],
          additionalProperties: false,
          properties: { component: { type: 'string' }, theme: { type: ['string', 'null'] } },
        },
      ],
    },
    keepOverlaysOnScreen: {
      type: 'boolean',
      description: 'attached labels flip / clamp to stay in view (default true)',
    },
  },
};

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** The JSON Schema (2020-12) of an animation file. */
export function animationFileSchema(): Json {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'TreDeSpace animation (*.tdanim.json), version 2',
    type: 'object',
    required: ['format', 'version', 'scenes'],
    additionalProperties: false,
    properties: {
      format: { const: ANIMATION_FORMAT },
      version: { const: ANIMATION_VERSION },
      name: { type: 'string' },
      scenes: { type: 'array', minItems: 1, items: ref('scene') },
      overlayInstances: { type: 'array', items: ref('instance'), description: 'the overlays callouts show' },
      overlayComponents: { type: 'array', items: ref('component'), description: 'designs of your own (and copies)' },
      overlayThemes: { type: 'array', items: ref('theme'), description: 'colour themes of your own' },
    },
    $defs: {
      scene: SCENE,
      object: OBJECT,
      objectKey: OBJECT_KEY,
      view: VIEW,
      clipState: CLIP_STATE,
      clipBox: CLIP_BOX,
      clipPlane: CLIP_PLANE,
      clipShape: CLIP_SHAPE,
      rulesKey: RULES_KEY,
      labelsKey: LABELS_KEY,
      label: LABEL,
      measurementsKey: MEASUREMENTS_KEY,
      measurement: MEASUREMENT,
      measurePoint: MEASURE_POINT,
      rule: RULE,
      step: STEP,
      callout: CALLOUT,
      fx: FX,
      instance: INSTANCE,
      ...OVERLAY_SCHEMA_DEFS,
    },
  };
}
