// In-page probe for the animation end-to-end suite (scripts/anim-e2e.mjs):
// loaded by the headless app through Vite, it sets a clean authoring state
// and reads back what the scenarios check — objects and their keys, the
// drawn poses, the selection bounds the gizmo sits on, the camera, the
// player and the scene rows. The scenarios drive the app through the same
// actions the buttons and hotkeys call.

import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny';
import { dialogs } from '../../src/components/dialogs/dialogs.actions';
import { m4Identity, m4Multiply } from '../../src/lib/animation/interp';
import { emptyDoc } from '../../src/lib/animation/io';
import { animationDocActions } from '../../src/state/animation/animationDoc.actions';
import { animationDocState } from '../../src/state/animation/animationDoc.state';
import { animationUiActions } from '../../src/state/animation/animationUi.actions';
import { animationUiState } from '../../src/state/animation/animationUi.state';
import { activeScene } from '../../src/state/animation/docEdit';
import { playerActions } from '../../src/state/animation/player.actions';
import { playerState } from '../../src/state/animation/player.state';
import {
  currentFrame,
  currentView,
  liveTimeNow,
  pendingPose,
  pendingRulesSet,
  runtimeRenderer,
  sessionInfo,
} from '../../src/state/animation/runtime';
import { clearDir, videoTempDir } from '../../src/lib/opfs/opfs';
import { openMp4Writer } from '../../src/lib/video/mp4Writer';
import { db } from '../../src/state/viewer/db';
import { selectionState } from '../../src/state/viewer/selection.state';
import { viewerActions } from '../../src/state/viewer/viewer.actions';

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const SETTLE_FRAMES = 4;
const SYNC_MS = 250;

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** The active scene's object holding `fullname`. */
function objectOf(fullname: string) {
  const name = fullname.toLowerCase();
  return activeScene()?.objects.find((o) => o.items.includes(name)) ?? null;
}

// -----------------------------------------------------------------------------
// setup
// -----------------------------------------------------------------------------

/** A clean slate: dialogs say yes, a new empty animation in authoring mode,
 *  nothing selected or picked, the defaults the scenarios assume. */
export async function reset(): Promise<void> {
  dialogs.confirm = async () => true;
  // as File ▾ → New does: leave the mode around the swap
  if (animationUiState.get().mode.kind !== 'off') {
    await animationUiActions.exitMode();
  }
  await animationDocActions.adopt(emptyDoc('E2E'), null, false);
  await animationUiActions.enterAuthoring();
  animationUiActions.set({ autoKey: false, nextInterp: null, current: null, keyColor: '#ef4444' });
  animationUiActions.pick({ kind: 'none' });
  await viewerActions.clearSelection();
  playerActions.stop();
  playerActions.seek(0);
  playerActions.followCamera();
  await settle();
}

/** The top-level MP4 boxes of a file, in order (headers only). */
async function topBoxes(file: File): Promise<string[]> {
  const out: string[] = [];
  let at = 0;
  while (at + 8 <= file.size && out.length < 32) {
    const v = new DataView(await file.slice(at, at + 16).arrayBuffer());
    const size32 = v.getUint32(0);
    out.push(String.fromCharCode(v.getUint8(4), v.getUint8(5), v.getUint8(6), v.getUint8(7)));
    const size = size32 === 1 ? Number(v.getBigUint64(8)) : size32 === 0 ? file.size - at : size32;
    if (size < 8) {
      break;
    }
    at += size;
  }
  return out;
}

/** The video file path without the GPU: frames drawn on a 2D canvas go
 *  through the MP4 writer into an OPFS file, which is read back. */
export async function videoFile(
  frames: number,
  fps: number,
): Promise<{ error: string } | { codec: string; packets: number; duration: number; boxes: string[]; size: number }> {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  const g = canvas.getContext('2d');
  if (!g) {
    return { error: 'no 2D canvas' };
  }
  const dir = await videoTempDir();
  await clearDir(dir);
  const handle = await dir.getFileHandle('probe.mp4', { create: true });
  const opened = await openMp4Writer(await handle.createWritable(), frames, canvas.width, canvas.height, fps);
  if (opened.error || !opened.data) {
    return { error: opened.error?.msg ?? 'no writer' };
  }
  const writer = opened.data;
  for (let i = 0; i < frames; i++) {
    g.fillStyle = `hsl(${(i * 8) % 360}, 70%, 50%)`;
    g.fillRect(0, 0, canvas.width, canvas.height);
    const added = await writer.add(canvas, i);
    if (added.error) {
      return { error: added.error.msg };
    }
  }
  const done = await writer.finish();
  if (done.error) {
    return { error: done.error.msg };
  }
  const file = await handle.getFile();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  let packets = 0;
  if (track) {
    for await (const _ of new EncodedPacketSink(track).packets()) {
      packets++;
    }
  }
  const result = {
    codec: writer.codec,
    packets,
    duration: await input.computeDuration(),
    boxes: await topBoxes(file),
    size: file.size,
  };
  input.dispose();
  await clearDir(dir);
  return result;
}

/** Let the runtime apply a frame and the worker sync settle. */
export async function settle(ms = SYNC_MS): Promise<void> {
  for (let i = 0; i < SETTLE_FRAMES; i++) {
    await frame();
  }
  await sleep(ms);
}

export async function select(fullnames: string[]): Promise<void> {
  await viewerActions.selectByFullnames(fullnames);
  await settle();
}

/** A finished move-gizmo drag by (dx, dy, dz) metres, as the viewport ends one. */
export async function drag(dx: number, dy = 0, dz = 0): Promise<void> {
  await viewerActions.bakeSelectionTransform(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, dx, dy, dz, 1]));
  await settle();
}

export async function seek(t: number): Promise<void> {
  playerActions.seek(t);
  await settle();
}

// -----------------------------------------------------------------------------
// read-backs
// -----------------------------------------------------------------------------

export function time(): number {
  return round(liveTimeNow());
}

/** The drawn translation of the object holding `fullname` — its animated
 *  pose with a pose not keyed yet on top; null when no object holds it. */
export function pose(fullname: string): [number, number, number] | null {
  const o = objectOf(fullname);
  if (!o) {
    return null;
  }
  const animated = currentFrame()?.poses.get(o.id);
  const posed = pendingPose(o.id);
  const m = posed ? m4Multiply(posed, animated ?? m4Identity()) : animated;
  return m ? [round(m[12]), round(m[13]), round(m[14])] : [0, 0, 0];
}

/** Centre of the selection bounds — where the gizmo sits. */
export function gizmo(): [number, number, number] | null {
  const b = selectionState.get().bounds;
  const mid = (i: 0 | 1 | 2) => (b ? round((b.min[i] + b.max[i]) / 2) : 0);
  return b ? [mid(0), mid(1), mid(2)] : null;
}

/** The active scene's objects and their keys. */
export function objects(): {
  id: string;
  name: string;
  items: string[];
  exclude: string[];
  muted: boolean;
  keys: { t: number; move: number[]; interp: string; visible?: boolean; color?: string | null }[];
}[] {
  return (activeScene()?.objects ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    items: o.items,
    exclude: o.exclude ?? [],
    muted: o.muted === true,
    keys: o.keys.map((k) => ({
      t: round(k.t),
      move: k.move.map(round),
      interp: k.interp,
      ...(k.visible !== undefined ? { visible: k.visible } : {}),
      ...(k.color !== undefined ? { color: k.color } : {}),
    })),
  }));
}

/** The rules previewed before Key (mode and how many; null: none). */
export function previewLook(): { mode: string; rules: number } | null {
  const r = pendingRulesSet();
  return r ? { mode: r.mode, rules: r.rules.length } : null;
}

/** How many items the session moves for an object (null: not entered). */
export function itemCount(id: string): number | null {
  return sessionInfo()?.itemCounts[id] ?? null;
}

/** Lower x of the drawn box of `fullname`'s items (null: none) — where they
 *  stand now, animated or not. */
export async function minX(fullname: string): Promise<number | null> {
  const b = await db.boundsForNames([fullname]);
  return b ? round(b.min[0]) : null;
}

/** How many items are selected. */
export function selectionCount(): number {
  return selectionState.get().count;
}

/** Centre of the drawn box of `fullname`'s items (null: none). */
export async function center(fullname: string): Promise<[number, number, number] | null> {
  const b = await db.boundsForNames([fullname]);
  return b
    ? [round((b.min[0] + b.max[0]) / 2), round((b.min[1] + b.max[1]) / 2), round((b.min[2] + b.max[2]) / 2)]
    : null;
}

/** The fullnames under a node, in tree order. */
export async function childrenOf(fullname: string): Promise<string[]> {
  const [h] = await db.findEntriesByNames([fullname]);
  return h ? (await db.children(h.model, h.entry)).map((c) => c.name) : [];
}

/** The active scene's rows besides the objects. */
export function scene(): {
  id: string;
  scenes: number;
  camera: number[];
  section: number[];
  rules: { t: number; mode: string; rules: number }[];
  steps: { id: string; start: number; end: number; pause: boolean }[];
  callouts: { id: string; start: number; end: number; keys: number }[];
  loop: boolean;
  pingPong: boolean;
  duration: number;
} {
  const s = activeScene();
  return {
    id: s?.id ?? '',
    scenes: animationDocState.get().doc.scenes.length,
    camera: (s?.camera ?? []).map((k) => round(k.t)),
    section: (s?.section ?? []).map((k) => round(k.t)),
    rules: (s?.colorRules ?? []).map((k) => ({ t: round(k.t), mode: k.mode, rules: k.rules.length })),
    steps: (s?.steps ?? []).map((x) => ({ id: x.id, start: round(x.start), end: round(x.end), pause: x.pauseAtEnd })),
    callouts: (s?.callouts ?? []).map((c) => ({ id: c.id, start: round(c.start), end: round(c.end), keys: c.keys?.length ?? 0 })),
    loop: s?.loop ?? false,
    pingPong: s?.pingPong ?? false,
    duration: round(currentView()?.duration ?? 0),
  };
}

export function camera(): { view: number | null; frame: number | null; follow: string } {
  const r = runtimeRenderer();
  const cam = currentFrame()?.camera;
  return {
    view: r ? round(r.camera.azimuth) : null,
    frame: cam ? round(cam.azimuth) : null,
    follow: playerState.get().camera,
  };
}

export function player(): { status: string; time: number; step: string | null; mode: string; duration: number; direction: number } {
  const p = playerState.get();
  return {
    status: p.status,
    time: time(),
    step: p.step,
    mode: animationUiState.get().mode.kind,
    duration: round(currentView()?.duration ?? 0),
    direction: p.direction,
  };
}

/** What the frame shows besides poses: the rules, overlays, the step. */
export function frameInfo(): { look: string | null; rules: number; overlays: string[]; step: string | null; clip: boolean } {
  const f = currentFrame();
  return {
    look: f?.look ? f.look.value.mode : null,
    rules: f?.look?.value.rules.length ?? 0,
    overlays: (f?.overlays ?? []).map((o) => o.instance),
    step: f?.step ?? null,
    clip: f?.clip !== null && f?.clip !== undefined,
  };
}

/** The visibility of the object holding `fullname` (null = no key sets it). */
export function visibleOf(fullname: string): boolean | null {
  const o = objectOf(fullname);
  const v = o ? currentFrame()?.visible.get(o.id) : undefined;
  return v === undefined ? null : v;
}

/** The colour key in force on the object holding `fullname` (undefined =
 *  none, null = its own colour). */
export function colorOf(fullname: string): string | null | 'none' {
  const o = objectOf(fullname);
  const c = o ? currentFrame()?.colors.get(o.id) : undefined;
  return c === undefined ? 'none' : c;
}

/** The authoring UI: the current row, the pick, the pose waiting for Key. */
export function ui(): {
  current: string | null;
  picked: string;
  indices: number[];
  posing: string[] | null;
  previewRules: boolean;
  previewLabels: boolean;
  objectSelection: string[];
} {
  const u = animationUiState.get();
  return {
    current: u.current,
    picked: u.picked.kind,
    indices: u.picked.kind === 'keys' ? u.picked.indices : [],
    posing: u.posing?.objects ?? null,
    previewRules: u.previewRules,
    previewLabels: u.previewLabels,
    objectSelection: [...u.objectSelection].sort(),
  };
}

/** Text shown in a dock panel (Timeline rows, Key panel headings). */
export function panelText(panel: string): string {
  return document.querySelector(`.dock-panel[data-panel="${panel}"]`)?.textContent ?? '';
}
