// The animation runtime (DESIGN.md › Animation › Engine) — the main-thread
// bridge between the doc, the player state, the modeldb worker and the
// renderer. It owns the non-serializable handles (renderer, band slots,
// overlay layer) and the precise playhead; player.actions.ts drives it.
//
// Session = animation mode entered: the worker points the active scene's
// objects' items at band slots (nothing in the scene is modified) and every
// frame writes D·base for each binding. The viewport calls tick() before
// each frame and postFrame() after it (overlays project with the new view).

import { type EvalContext, evaluate, type FrameState, movingObjects } from '../../lib/animation/evaluate';
import { type M4, m4Identity, m4Multiply, poseMatrix } from '../../lib/animation/interp';
import { poseAt } from '../../lib/animation/keyRows';
import { objectPivotPoint, type PivotOf, pivotResolver } from '../../lib/animation/pivots';
import { advancePlayhead, type PlayheadStop } from '../../lib/animation/playhead';
import type { SharedItems } from '../../lib/animation/problems';
import type { RulesFrame } from '../../lib/animation/rules';
import { type SceneView, sceneView, stepNumber } from '../../lib/animation/scene';
import { AnimationSlots } from '../../lib/animation/slots';
import { sweptBoundsAll } from '../../lib/animation/swept';
import type { AnimCamera, AnimObject, ObjectPivot, RuleSet, Scene, V3 } from '../../lib/animation/types';
import { AnimOverlay, objectAnchorPoint } from '../../lib/overlay/AnimOverlay';
import type { OverlayAnchor } from '../../lib/overlay/overlayTypes';
import type { CameraInputKind } from '../../lib/render/camera';
import type { Renderer } from '../../lib/render/renderer';
import { db } from '../viewer/db';
import { selectionState } from '../viewer/selection.state';
import { applyStateUpdates, refreshSelection, refreshSelectionBounds } from '../viewer/viewer.actions';
import { animationDocState } from './animationDoc.state';
import { emitAnimationEvent, stateEventPayload } from './animationEvents';
import { contentRevision } from './docContent';
import { activeScene } from './docEdit';
import { playerState } from './player.state';
import { blendedCamera, cancelReturnBlend, isReturnBlending, restoreCameraModes, setCameraPose } from './runtimeCamera';
import { clipEnter, clipExit, syncClip } from './runtimeClip';
import { makeOverlayScene } from './runtimeOverlay';
import { resetVisibilitySync, syncVisibility } from './runtimeVisibility';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

interface Session {
  slots: AnimationSlots;
  restCenter: Map<string, V3>;
  restBounds: Map<string, Float32Array>;
  /** object → items that resolved to nothing */
  unresolved: Map<string, number>;
  itemCounts: Record<string, number>;
  bandFull: boolean;
  shared: readonly SharedItems[];
  /** the object list the worker capture was built from */
  specsKey: string;
  /** the objects array last compared with specsKey (edits that leave the
   *  objects alone keep the same array) */
  specsSeen: readonly unknown[] | null;
}

/** Hooks the authoring UI installs on the overlay layer. */
export interface OverlayHandlers {
  onMove: (instance: string, anchor: OverlayAnchor) => void;
  onEditText: (instance: string, param: string, value: string) => void;
  onSelect: (instance: string) => void;
}

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** UI rate for the stored playhead while playing (the runtime keeps the
 *  precise one). */
const UI_PUSH_MS = 66;
/** Re-capture after the object list or the scene changed. */
const REENTER_DEBOUNCE_MS = 150;
const SWEPT_DEBOUNCE_MS = 600;
/** Longest frame step the clock accepts (a hidden tab must not jump). */
const MAX_STEP_S = 0.1;
/** How often the worker gets the moving pose while playing (selection
 *  bounds / gizmo follow the animation at this rate). */
const PLAYING_BAND_SYNC_MS = 100;
/** How far past the end the time slider may go while authoring (s). */
const AUTHORING_MAX_S = 24 * 3600;

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

let renderer: Renderer | null = null;
let layer: AnimOverlay | null = null;
let host: HTMLElement | null = null;
let session: Session | null = null;
let pendingEnter: Promise<unknown> | null = null;
let enterSeq = 0;
let liveTime = 0;
let lastNow = 0;
let needsApply = true;
let lastFrame: FrameState | null = null;
let lastUiPush = 0;
/** set while a video export captures frames */
let capture: { overlays: boolean } | null = null;
/** a pose sync (worker band + selection bounds) is wanted after the next apply */
let bandSyncWanted = false;
/** A band sync asked for once the next apply has drawn the new pose. */
let bandSyncAfterApply = false;
/** A video hold frame's step (see holdStep). */
let heldStep: string | null = null;
let bandSyncBusy = false;
let lastBandSyncMs = 0;
let pivotCache: { revision: number; session: Session | null; ctx: EvalContext } | null = null;
let reenterTimer = 0;
/** Posing: a world-space matrix per object drawn on top of the animation
 *  until it is keyed — or dropped when the time slider moves. */
const pendingPoses = new Map<string, M4>();
/** Set Color rules shown before they are keyed (dropped with the poses). */
let pendingRules: RulesFrame | null = null;
let onPendingDropped: (() => void) | null = null;
/** canFollow must be worked out again (the doc changed). */
let followStale = false;
/** content revision the swept bounds and the band sync were last scheduled for */
let sweptContent = -1;
let sweptTimer = 0;
let unsubs: (() => void)[] = [];
let lastModelsVersion = -1;
let lastScene = '';
let userInputHandler: ((kind: CameraInputKind) => void) | null = null;
let handlers: OverlayHandlers | null = null;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** The active scene's objects as the worker captures them (movers first). */
function objectSpecs(scene: Scene | null): { id: string; fullnames: string[]; exclude?: string[]; moves: boolean }[] {
  if (!scene) {
    return [];
  }
  const moving = movingObjects({ ...animationDocState.get().doc, scenes: [scene] });
  return scene.objects.map((o) => ({
    id: o.id,
    fullnames: o.items,
    ...(o.exclude?.length ? { exclude: o.exclude } : {}),
    moves: moving.has(o.id),
  }));
}

/** Pivot per object (a point, or a side of its items' rest box) and the
 *  rest boxes keys' side pivots are on. */
export function evalContext(): EvalContext {
  const s = animationDocState.get();
  if (pivotCache && pivotCache.revision === s.revision && pivotCache.session === session) {
    return pivotCache.ctx;
  }
  const pivots = new Map<string, V3>();
  for (const o of activeScene(s.doc)?.objects ?? []) {
    const c = session?.restCenter.get(o.id) ?? [0, 0, 0];
    pivots.set(o.id, objectPivotPoint(o.pivot, session?.restBounds.get(o.id), c));
  }
  pivotCache = { revision: s.revision, session, ctx: { pivots, boxes: session?.restBounds ?? new Map() } };
  return pivotCache.ctx;
}

/** Object `id`'s pivot `p` (a side or a point) as a rest point. */
export function objectPivotPointOf(id: string, p: ObjectPivot): V3 {
  return objectPivotPoint(p, session?.restBounds.get(id), session?.restCenter.get(id) ?? [0, 0, 0]);
}

/** Where object `o` is drawn now, as a matrix in double precision: its keys
 *  at the time slider with a pose not keyed yet on top. */
export function objectPoseNow(o: AnimObject): Float64Array {
  const s = poseAt(o, liveTime, pivotOfObject(o.id));
  const animated = poseMatrix(s, s.pivot, new Float64Array(16));
  const g = pendingPoses.get(o.id);
  return g ? m4Multiply(g, animated, new Float64Array(16)) : animated;
}

/** How object `id`'s keys resolve their pivots (rest points). */
export function pivotOfObject(id: string): PivotOf {
  const ctx = evalContext();
  return pivotResolver(ctx.boxes?.get(id) ?? null, ctx.pivots.get(id) ?? [0, 0, 0]);
}

/** Re-upload the band after any full-pool upload (DESIGN.md › Animation › Engine). */
function reassertBand(): void {
  if (session && renderer) {
    session.slots.upload(renderer, true);
  }
}

function scheduleReenter(): void {
  clearTimeout(reenterTimer);
  reenterTimer = window.setTimeout(() => {
    if (session) {
      void enterSession();
    }
  }, REENTER_DEBOUNCE_MS);
}

function scheduleSwept(): void {
  clearTimeout(sweptTimer);
  sweptTimer = window.setTimeout(() => void pushSweptBounds(), SWEPT_DEBOUNCE_MS);
}

async function pushSweptBounds(): Promise<void> {
  const s = session;
  const v = currentView();
  if (!s || !v) {
    return;
  }
  const swept = sweptBoundsAll(v.scene, v.duration, s.restBounds, evalContext().pivots);
  const bySlot: Record<number, Float32Array | null> = {};
  for (const [object, box] of swept) {
    for (const slot of s.slots.slotsOf(object)) {
      bySlot[slot] = box;
    }
  }
  await db.animSetSweptBounds(bySlot);
}

function onDocChange(): void {
  needsApply = true;
  const s = session;
  if (!s) {
    return;
  }
  const scene = activeScene();
  if (scene?.id !== lastScene) {
    lastScene = scene?.id ?? '';
    scheduleReenter();
  } else if (scene?.objects !== s.specsSeen) {
    s.specsSeen = scene?.objects ?? null;
    if (JSON.stringify(objectSpecs(scene)) !== s.specsKey) {
      scheduleReenter();
    }
  }
  const content = contentRevision();
  if (content !== sweptContent) {
    sweptContent = content;
    scheduleSwept();
    // an edit can move what is drawn at the time slider (undo / redo of a
    // key, a key dragged): the worker gets the new pose after the next
    // apply, so the gizmo, selection bounds, fit and picking follow
    bandSyncWanted = true;
    // …and camera keys may have come or gone (Play / Return follow them)
    followStale = true;
  }
}

function onSceneChange(): void {
  const v = selectionState.get().modelsVersion;
  if (v !== lastModelsVersion) {
    lastModelsVersion = v;
    if (session) {
      scheduleReenter(); // models loaded / unloaded: re-resolve the objects
    }
  }
}

function stepInfo(v: SceneView, id: string): { id: string; name: string; index: number } {
  return { id, name: v.steps.find((s) => s.id === id)?.name ?? id, index: stepNumber(v, id) - 1 };
}

/** Evaluate at the live time and push everything the frame drives. */
function apply(nowMs: number): void {
  const s = session;
  const v = currentView();
  if (!s || !v || !renderer) {
    return;
  }
  const p = playerState.get();
  // waiting at a step's end: that step stays up (its card, its name) — at a
  // shared edge the next step would otherwise win; a video's hold frames
  // name it themselves
  const held = heldStep ?? (p.status === 'waiting' ? p.step : null);
  const frame = evaluate(v, liveTime, evalContext(), held);
  s.slots.write(withPendingPoses(frame.poses));
  s.slots.upload(renderer);
  syncVisibility(
    pendingRules ? { ...frame, look: pendingRules } : frame,
    v.scene.objects.map((o) => o.id),
  );
  syncClip(frame.clip);
  onAnnotations?.(frame);
  if (p.camera === 'follow' && frame.camera) {
    setCameraPose(renderer, blendedCamera(frame.camera, nowMs));
  }
  if (followStale) {
    followStale = false;
    playerState.set({ canFollow: v.scene.camera.length > 0 });
  }
  if (frame.step !== p.step) {
    const prev = p.step;
    playerState.set({ step: frame.step });
    if (prev) {
      emitAnimationEvent('animation.stepEnded', stepInfo(v, prev));
    }
    if (frame.step) {
      emitAnimationEvent('animation.stepStarted', stepInfo(v, frame.step));
    }
  }
  lastFrame = frame;
  needsApply = false;
  if (bandSyncAfterApply) {
    bandSyncAfterApply = false;
    bandSyncWanted = true;
  }
}

/** Store the playhead for the UI (throttled while playing). */
function pushTime(nowMs: number, force = false): void {
  if (!force && nowMs - lastUiPush < UI_PUSH_MS) {
    return;
  }
  lastUiPush = nowMs;
  playerState.set({ time: liveTime });
  emitAnimationEvent('animation.stateChanged', stateEventPayload(liveTime));
}

function onPlaybackStop(stop: PlayheadStop): void {
  const cam = renderer ? captureForPause() : null;
  if (stop.kind === 'stepEnd') {
    playerState.set({ status: 'waiting', pausedCamera: cam, step: stop.step });
  } else if (stop.kind === 'end') {
    const whole = playerState.get().scope.kind === 'all';
    playerState.set({ status: 'stopped', pausedCamera: cam, direction: 1 });
    // a step or a range played to its end is not the end of the scene
    if (whole) {
      emitAnimationEvent('animation.ended', { scene: currentView()?.scene.id ?? '' });
    }
  }
  bandSyncWanted = true;
  pushTime(performance.now(), true);
}

function captureForPause(): AnimCamera | null {
  if (!renderer) {
    return null;
  }
  const c = renderer.camera;
  return {
    target: [c.target[0], c.target[1], c.target[2]],
    azimuth: c.azimuth,
    elevation: c.elevation,
    orbitDistance: c.orbitDistance,
    orthographic: c.ortho,
  };
}

/** Push the drawn pose to the worker and re-read the selection bounds; one
 *  run at a time, a request during a run is served right after it. */
async function runBandSync(): Promise<void> {
  bandSyncBusy = true;
  try {
    while (bandSyncWanted) {
      bandSyncWanted = false;
      await syncBandToWorker();
      await refreshSelectionBounds();
    }
  } finally {
    bandSyncBusy = false;
  }
}

/** The frame's poses with the pending ones on top (a copy; the frame stays). */
function withPendingPoses(poses: ReadonlyMap<string, Float32Array>): ReadonlyMap<string, Float32Array> {
  if (pendingPoses.size === 0) {
    return poses;
  }
  const posed = new Map(poses);
  for (const [object, g] of pendingPoses) {
    posed.set(object, m4Multiply(g, poses.get(object) ?? m4Identity()));
  }
  return posed;
}

function dropPending(): void {
  if (pendingPoses.size > 0 || pendingRules) {
    clearPending();
    onPendingDropped?.();
  }
}

// -----------------------------------------------------------------------------
// public api — viewport wiring
// -----------------------------------------------------------------------------

/** Called by the viewport once its renderer is up (also after GPU recovery,
 *  with the fresh renderer). Returns the disposer. */
export function attachAnimationViewport(hostEl: HTMLElement, r: Renderer): () => void {
  renderer = r;
  host = hostEl;
  layer = new AnimOverlay(
    hostEl,
    makeOverlayScene({
      doc: () => animationDocState.get().doc,
      view: currentView,
      time: () => liveTime,
      viewProj: () => r.viewProjMatrix,
      objectPoint,
    }),
  );
  applyOverlayHandlers();
  r.camera.onUserInput = (kind) => userInputHandler?.(kind);
  if (session) {
    r.onTransformsUploaded = reassertBand;
    session.slots.upload(r, true);
    needsApply = true;
  }
  return () => {
    layer?.dispose();
    layer = null;
    if (renderer === r) {
      r.onTransformsUploaded = null;
      r.camera.onUserInput = null;
      renderer = null;
      host = null;
    }
  };
}

/** Viewport tick, BEFORE renderer.frame: advance, evaluate, write slots. */
export function tickAnimation(nowMs: number): void {
  const dt = lastNow ? Math.min(MAX_STEP_S, (nowMs - lastNow) / 1000) : 0;
  lastNow = nowMs;
  const p = playerState.get();
  if (!session || !renderer || p.status === 'off') {
    return;
  }
  const v = currentView();
  if (!v) {
    return;
  }
  if (p.status === 'playing') {
    dropPending();
    const step = advancePlayhead({
      time: liveTime,
      dt: dt * p.speed,
      direction: p.direction,
      view: v,
      scope: p.scope,
      loop: v.scene.loop,
      pingPong: v.scene.pingPong,
    });
    liveTime = step.time;
    needsApply = true;
    if (step.direction !== p.direction) {
      playerState.set({ direction: step.direction });
    }
    if (step.stop.kind !== 'none') {
      onPlaybackStop(step.stop);
    }
    pushTime(nowMs);
  }
  // a paused follow view needs frames only while the Return blend moves it
  if (needsApply || (p.camera === 'follow' && lastFrame?.camera && isReturnBlending())) {
    apply(nowMs);
  }
  // AFTER apply: the worker must get the pose that is now drawn — selection
  // bounds, the gizmo, fit and picking all read it (throttled while playing)
  if (p.status === 'playing' && nowMs - lastBandSyncMs >= PLAYING_BAND_SYNC_MS) {
    bandSyncWanted = true;
  }
  if (bandSyncWanted && !bandSyncBusy) {
    lastBandSyncMs = nowMs;
    void runBandSync();
  }
}

/** Sync the pose to the worker once the next frame has been evaluated
 *  (pause, stop, seek, step jumps — the slots change in that apply). */
export function requestBandSync(): void {
  // after the next apply — a sync running now would push the pose before it
  bandSyncAfterApply = true;
  needsApply = true;
}

/** Viewport tick, AFTER renderer.frame: overlays (they project with the new
 *  view matrix). */
export function postFrameAnimation(): void {
  if (!layer) {
    return;
  }
  const p = playerState.get();
  const shown = capture ? capture.overlays : p.showOverlays;
  const visible = !!session && p.status !== 'off' && shown;
  layer.update(visible ? (lastFrame?.overlays ?? []) : [], visible);
}

// -----------------------------------------------------------------------------
// public api — session
// -----------------------------------------------------------------------------

/** Enter (or re-enter) animation mode for the active scene's objects. */
export async function enterSession(): Promise<{
  error?: string;
  bandFull?: boolean;
  unresolved?: number;
  /** a later enter or an exit came first: this one did nothing */
  superseded?: boolean;
}> {
  const seq = ++enterSeq;
  const scene = activeScene();
  const specs = objectSpecs(scene);
  const run = db.animEnter(specs);
  pendingEnter = run;
  let res: Awaited<typeof run>;
  try {
    res = await run;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (pendingEnter === run) {
      pendingEnter = null;
    }
  }
  if (seq !== enterSeq) {
    return { superseded: true };
  }
  applyStateUpdates(res.updates);
  resetVisibilitySync();
  clipEnter();
  session = {
    slots: new AnimationSlots(res.bindings),
    restCenter: new Map(Object.entries(res.restCenter)),
    restBounds: new Map(Object.entries(res.restBounds)),
    unresolved: new Map(res.unresolved.map((u) => [u.actor, u.fullnames.length])),
    itemCounts: res.itemCounts,
    bandFull: res.bandFull,
    shared: res.shared.map((x) => ({ object: x.actor, owner: x.owner, items: x.items })),
    specsKey: JSON.stringify(specs),
    specsSeen: scene?.objects ?? null,
  };
  lastScene = scene?.id ?? '';
  if (renderer) {
    renderer.onTransformsUploaded = reassertBand;
    session.slots.upload(renderer, true);
  }
  if (unsubs.length === 0) {
    lastModelsVersion = selectionState.get().modelsVersion;
    unsubs = [animationDocState.subscribe(onDocChange), selectionState.subscribe(onSceneChange)];
  }
  needsApply = true;
  bandSyncWanted = true;
  followStale = true;
  lastFrame = null;
  playerState.set({ slotsUsed: res.bindings.length });
  scheduleSwept();
  // the doc changed while the worker captured (a load, an edit): catch up
  const now = activeScene();
  if (now?.id !== scene?.id || JSON.stringify(objectSpecs(now)) !== session.specsKey) {
    scheduleReenter();
  }
  return { bandFull: res.bandFull, unresolved: res.unresolved.reduce((n, u) => n + u.fullnames.length, 0) };
}

/** Leave animation mode: the worker restores every slot and object bit. */
export async function exitSession(): Promise<void> {
  enterSeq++;
  clearTimeout(reenterTimer);
  clearTimeout(sweptTimer);
  if (pendingEnter) {
    await pendingEnter.catch(() => {});
  }
  for (const off of unsubs) {
    off();
  }
  unsubs = [];
  if (renderer) {
    renderer.onTransformsUploaded = null;
    renderer.camera.inputLocked = false;
  }
  session = null;
  lastFrame = null;
  pendingPoses.clear();
  pendingRules = null;
  cancelReturnBlend();
  restoreCameraModes();
  resetVisibilitySync();
  clipExit();
  layer?.update([], false);
  applyStateUpdates(await db.animExit());
  bandSyncWanted = false;
  // items back at rest (the gizmo follows) and the colour undo depth is the
  // viewer's own again
  await refreshSelection();
  playerState.set({ slotsUsed: 0 });
}

export function sessionActive(): boolean {
  return session !== null;
}

/** Is a first enter still waiting for the worker? (An exit then still has
 *  something to undo.) */
export function enterPending(): boolean {
  return pendingEnter !== null;
}

/** Catch the session up with the doc's objects now instead of after the
 *  debounce — a key folded the moment its object is made needs the
 *  object's rest box (its side pivots) and band slots. `force` captures
 *  again whatever changed (a video moving on to another scene: no re-capture
 *  may land between its frames). */
export async function syncSessionNow(opts: { force?: boolean } = {}): Promise<void> {
  if (!session) {
    return;
  }
  const scene = activeScene();
  if (!opts.force && scene?.id === lastScene && JSON.stringify(objectSpecs(scene)) === session.specsKey) {
    return;
  }
  clearTimeout(reenterTimer);
  await enterSession();
}

/** The step a video's hold frame waits at the end of (its card stays up);
 *  null = as the player says. */
export function holdStep(id: string | null): void {
  heldStep = id;
  needsApply = true;
}

/** Video export: overlays as the export says, and no authoring helpers in
 *  the frame; null = normal. */
export function setCaptureMode(mode: { overlays: boolean } | null): void {
  capture = mode;
}

export function captureActive(): boolean {
  return capture !== null;
}

/** Problems-list inputs the session knows: items that resolved to nothing
 *  and items shared per object. */
export function sessionInfo(): {
  unresolved: ReadonlyMap<string, number>;
  itemCounts: Readonly<Record<string, number>>;
  bandFull: boolean;
  shared: readonly SharedItems[];
} | null {
  return session
    ? {
        unresolved: session.unresolved,
        itemCounts: session.itemCounts,
        bandFull: session.bandFull,
        shared: session.shared,
      }
    : null;
}

// -----------------------------------------------------------------------------
// public api — playhead
// -----------------------------------------------------------------------------

/** The active scene's view (memoized per scene object). */
export function currentView(): SceneView | null {
  const scene = activeScene();
  return scene ? sceneView(scene) : null;
}

export function liveTimeNow(): number {
  return liveTime;
}

/** Move the time slider (a stateless seek). Moving it drops a pose or rules
 *  not keyed yet, unless `keepPose` (the Key panel's Time carries them). */
export function setLiveTime(t: number, keepPose = false): void {
  // authoring may go past the end — the next key goes there and lengthens
  // the scene; playback stops at the end
  const end = playerState.get().mode === 'author' ? AUTHORING_MAX_S : (currentView()?.duration ?? t);
  const next = Math.max(0, Math.min(t, end));
  if (!keepPose && Math.abs(next - liveTime) > 1e-6) {
    dropPending();
  }
  liveTime = next;
  needsApply = true;
  pushTime(performance.now(), true);
}

/** Draw `object` posed by the world-space matrix `g` on top of the
 *  animation (null = no pose); the worker gets it after the next apply, so
 *  the gizmo sits on the posed items. Kept as given (a Float64Array keeps a
 *  pose far from the origin exact until it is keyed). */
export function setPendingPose(object: string, g: M4 | null): void {
  if (g) {
    pendingPoses.set(object, g);
  } else {
    pendingPoses.delete(object);
  }
  needsApply = true;
  bandSyncWanted = true;
}

export function pendingPose(object: string): M4 | null {
  return pendingPoses.get(object) ?? null;
}

/** Show Set Color rules before they are keyed (null = the keyed ones). */
export function setPendingRules(rules: RuleSet | null): void {
  pendingRules = rules ? { key: `preview:${JSON.stringify(rules)}`, value: rules } : null;
  needsApply = true;
}

export function hasPendingRules(): boolean {
  return pendingRules !== null;
}

/** The rules shown before they are keyed (null: none). */
export function pendingRulesSet(): RuleSet | null {
  return pendingRules?.value ?? null;
}

/** Forget pending poses — every one, or those of `objects` — without
 *  telling anyone (they were keyed or discarded). A rules preview stays. */
export function clearPendingPoses(objects?: readonly string[]): void {
  const before = pendingPoses.size;
  if (objects) {
    for (const o of objects) {
      pendingPoses.delete(o);
    }
  } else {
    pendingPoses.clear();
  }
  if (pendingPoses.size !== before) {
    needsApply = true;
    bandSyncWanted = true;
  }
}

/** Forget the rules preview (it was keyed or dropped); poses stay. */
export function clearPendingRules(): void {
  if (pendingRules) {
    pendingRules = null;
    needsApply = true;
  }
}

/** Forget every pending pose and the rules preview (the time slider moved,
 *  the mode ended). */
export function clearPending(): void {
  clearPendingPoses();
  clearPendingRules();
}

/** Who hears that unkeyed poses were dropped (the time slider moved). */
export function setPendingDroppedHandler(fn: (() => void) | null): void {
  onPendingDropped = fn;
}

/** Who shows each frame's labels and measurements (annotations.actions). */
let onAnnotations: ((frame: FrameState) => void) | null = null;

export function setAnnotationsHandler(fn: ((frame: FrameState) => void) | null): void {
  onAnnotations = fn;
}

/** Evaluate and upload NOW (after a key: the band must hold the new pose
 *  before the gizmo's live preview is dropped, or one frame flashes). */
export function applyNow(): void {
  apply(performance.now());
}

/** Force a re-evaluation next tick (camera mode changed). */
export function requestApply(): void {
  needsApply = true;
}

/** The last evaluated frame (Key panel read-outs). */
export function currentFrame(): FrameState | null {
  return lastFrame;
}

/** An object's rest world box. */
export function sessionRestBounds(object: string): Float32Array | null {
  return session?.restBounds.get(object) ?? null;
}

/** World point an object-anchored overlay hangs from. */
export function objectPoint(object: string): V3 | null {
  const pivot = evalContext().pivots.get(object);
  if (!pivot) {
    return null;
  }
  const pose = lastFrame?.poses.get(object) ?? null;
  const g = pendingPoses.get(object);
  return objectAnchorPoint(pivot, g ? m4Multiply(g, pose ?? m4Identity()) : pose);
}

/** Keep the worker's band matrices in step with what is drawn (paused /
 *  posing: selection bounds and the gizmo then follow the pose). */
export async function syncBandToWorker(): Promise<void> {
  const s = session;
  if (!s || s.slots.count === 0) {
    return;
  }
  await db.animSyncBand(s.slots.first, s.slots.data.slice());
}

// -----------------------------------------------------------------------------
// public api — hooks
// -----------------------------------------------------------------------------

/** Who hears camera user input (player.actions: follow → free). */
export function setUserInputHandler(fn: ((kind: CameraInputKind) => void) | null): void {
  userInputHandler = fn;
}

/** Authoring gestures on the overlay layer (null = view only). */
export function setOverlayHandlers(h: OverlayHandlers | null): void {
  handlers = h;
  applyOverlayHandlers();
}

function applyOverlayHandlers(): void {
  if (!layer) {
    return;
  }
  layer.setInteractive(handlers !== null);
  layer.onMove = handlers?.onMove ?? null;
  layer.onEditText = handlers?.onEditText ?? null;
  layer.onSelect = handlers?.onSelect ?? null;
}

export function setSelectedOverlay(id: string | null): void {
  layer?.setSelected(id);
}

/** The renderer the runtime draws into (keys, thumbnails). */
export function runtimeRenderer(): Renderer | null {
  return renderer;
}

/** The viewport host element (the floating play bar mount). */
export function runtimeHost(): HTMLElement | null {
  return host;
}
