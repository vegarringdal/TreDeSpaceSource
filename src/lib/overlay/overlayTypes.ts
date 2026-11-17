// -----------------------------------------------------------------------------
// 2D overlay component model (DESIGN.md › Animation › Overlays)
// -----------------------------------------------------------------------------
// Pure, JSON-serializable data: a component is a small block tree with typed
// parameters; an instance is one use of it (values + anchor + scale). Nothing
// here is user HTML/CSS (D13) — overlayTemplate.ts maps these fields to markup.

export type V2 = [number, number];
export type V3 = [number, number, number];

export type OverlayParam =
  | { key: string; label: string; type: 'text' | 'richText'; default: string }
  | { key: string; label: string; type: 'image'; default: string | null }
  | { key: string; label: string; type: 'color'; default: string }
  | { key: string; label: string; type: 'number'; default: number }
  | { key: string; label: string; type: 'toggle'; default: boolean };

export type OverlayParamType = OverlayParam['type'];

export type Shadow = 'none' | 'sm' | 'md' | 'lg';

/** Colours in styles: '#rrggbb' (or #rgb / #rrggbbaa), rgb() / rgba(), a
 *  theme token ('$accent'), 'transparent', or '{{key}}' — the design's colour
 *  value `key`, so every card using the design sets its own. */
export interface BoxStyle {
  bg?: string;
  opacity?: number;
  padding?: [number, number, number, number];
  margin?: [number, number, number, number];
  border?: { width: number; color: string; style: 'solid' | 'dashed' };
  radius?: number;
  shadow?: Shadow;
  width?: number | 'auto' | 'fill';
  height?: number | 'auto' | 'fill';
}

export type FontFamily = 'ui' | 'mono' | 'serif';

export interface TextStyle {
  color?: string;
  /** font size in px at the design height, or '{{key}}' — the design's
   *  number value `key`, so every card using the design sets its own */
  size?: number | string;
  weight?: 400 | 500 | 600 | 700;
  align?: 'left' | 'center' | 'right';
  font?: FontFamily;
  lineHeight?: number;
  maxLines?: number;
}

export interface FlexLayout {
  dir: 'row' | 'col';
  gap: number;
  align: 'start' | 'center' | 'end' | 'stretch';
  justify: 'start' | 'center' | 'end' | 'between';
}

export type OverlayBlock =
  | {
      kind: 'box';
      id: string;
      style: BoxStyle;
      layout: FlexLayout;
      children: OverlayBlock[];
      showIf?: string;
    }
  | { kind: 'text'; id: string; style: TextStyle; text: string; rich: boolean; showIf?: string }
  | { kind: 'image'; id: string; style: BoxStyle; src: string; fit: 'contain' | 'cover'; showIf?: string }
  | { kind: 'icon'; id: string; style: TextStyle; icon: string; showIf?: string }
  | { kind: 'divider'; id: string; style: BoxStyle; showIf?: string }
  | { kind: 'progress'; id: string; style: BoxStyle; value: string; showIf?: string };

export type OverlayBlockKind = OverlayBlock['kind'];

export interface OverlayComponent {
  id: string;
  name: string;
  /** bumped on every save */
  version: number;
  params: OverlayParam[];
  root: OverlayBlock;
  /** the card's frame; an auto width hugs the content between `minWidth`
   *  and `maxWidth` (default 640) */
  size: { width: number | 'auto'; height: number | 'auto'; minWidth?: number; maxWidth?: number };
  /** px scale with viewport height relative to this (1080 = 1:1) */
  designHeight: number;
  /** multiplies every text size of the design (absent = 1); a placed card's
   *  own text size multiplies on top */
  textScale?: number;
}

/** Colours referenced as "$accent", "$bg", … */
export interface OverlayTheme {
  id: string;
  name: string;
  tokens: Record<string, string>;
}

export type Pin = 'tl' | 't' | 'tr' | 'l' | 'c' | 'r' | 'bl' | 'b' | 'br';

/** Leader line colour when an anchor sets none. */
export const DEFAULT_LEADER_COLOR = '#e2e8f0';

/** Where an overlay sits. `leaderColor` (#rrggbb) colours an item / point
 *  label's leader line and dot (absent = DEFAULT_LEADER_COLOR). */
export type OverlayAnchor =
  | { kind: 'screen'; pos: V2; pin: Pin }
  | { kind: 'object'; object: string; offset: V2; leader: boolean; leaderColor?: string }
  | { kind: 'world'; pos: V3; offset: V2; leader: boolean; leaderColor?: string };

export type OverlayValue = string | number | boolean | null;

export interface OverlayInstance {
  id: string;
  component: string;
  componentVersion: number;
  values: Record<string, OverlayValue>;
  /** a library theme; null = Auto (the app's light / dark theme) */
  theme: string | null;
  anchor: OverlayAnchor;
  scale: number;
  /** multiplies every text size in the card; padding and boxes stay as
   *  designed (absent = 1) */
  textScale?: number;
}

export type OverlayFx =
  | { kind: 'none' }
  | { kind: 'fade'; duration: number }
  /** scale 0.8 → 1 + fade */
  | { kind: 'pop'; duration: number }
  | { kind: 'slide'; from: 'left' | 'right' | 'top' | 'bottom'; duration: number };

/** One overlay to draw this frame (evaluate.ts). `progress` is 0..1 inside
 *  the enter/exit effect and 1 while shown — enter/exit visuals are computed
 *  from it, never from wall-clock CSS transitions, so seeking and frame
 *  capture are exact. */
export interface OverlayFrame {
  instance: string;
  progress: number;
  phase: 'enter' | 'shown' | 'exit';
  fx: OverlayFx;
  /** the step a step card belongs to ({{step.*}} bindings), else null */
  step: string | null;
  /** keyed placement now (pos for screen anchors, offset for attached), else
   *  the anchor's own (D32) */
  place?: V2;
}

/** What text templates can bind to (DESIGN.md › Animation › Overlays). */
export interface BindingContext {
  /** the step shown ({{step.*}}; the older {{part.*}} names read it too) */
  step: { name: string; text: string; index: number; count: number } | null;
  /** the object an attached overlay hangs from ({{object.name}}) */
  objectName: string | null;
  time: number;
  duration: number;
}
