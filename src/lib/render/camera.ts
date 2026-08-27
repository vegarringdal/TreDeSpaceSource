// Camera controller ported from the native renderer
// (crates/desk3d-state/src/camera_controller.rs + camera.rs):
// hybrid orbit/fly around a target with exponential smoothing, smoothstep
// goto animations, and perspective/orthographic projections (both reversed-Z,
// Z-up, ortho half-height = focus distance * tan(fovY/2) so toggling
// preserves framing).
//
// Input map (native): LMB drag = orbit, RMB drag = pan (distance-scaled),
// wheel = exponential dolly, WASD/QE = fly (Shift = sprint; W/S dolly the
// focus distance under ortho), arrows = pan, Alt+LMB = re-pivot at picked
// point, Space = fly to picked point.
export type Mat4 = Float32Array;

const DEG = Math.PI / 180;

// native CameraConfig::default
const SENSITIVITY = 0.003;
const PAN_SENSITIVITY = 0.002;
const DOLLY_SENSITIVITY = 1.0;
const SPRINT_MULT = 5.0; // ortho W/S dolly acceleration while Shift is held
const MIN_PAN_SPEED = 0.5;
const MAX_PAN_SPEED = 50.0;
const EL_CLAMP = 89 * DEG;
/** Near plane as a fraction of the orbit distance (see the `near` getter). */
const NEAR_RATIO = 1 / 12500;
const NEAR_MIN = 0.001;
const EL_CLAMP_ANIM = 89.99 * DEG;

export class CameraController {
  target = new Float32Array([0, 0, 0]);
  azimuth = 0.6;
  elevation = 0.5;
  orbitDistance = 10;
  fovY = 55 * DEG;

  ortho = false;
  orthoNear = -1; // view-depth slab, set per frame from the scene AABB
  orthoFar = 1000;

  // navigation: 'fly' moves along the full view direction (W dives when you
  // look down); 'walk' keeps Z constant (W/A/S/D move in the ground plane,
  // like turning your head while walking). Speeds are units/second, with a
  // separate speed while Shift is held. Synced from the nav settings store.
  navMode: 'orbit' | 'fly' | 'walk' = 'fly';
  /** Arrow-key pan sensitivity multiplier (1 = native feel). */
  keyPanSens = 1;
  /** performance.now() of the last frame with active user input — the
   *  residency manager's idle gate (swaps only while the camera is at rest). */
  lastInputT = 0;
  /** A pointer/touch drag is in progress on the canvas (also an idle-gate input). */
  pointerActive = false;
  /** Fired on a WASD/QE keydown — the app uses it to leave orbit mode. */
  onMoveKey: (() => void) | null = null;
  /** Fired on orbit-style input (alt+click, wheel dolly, space+click) — the
   *  app uses it to hop back into orbit mode. */
  onOrbitIntent: (() => void) | null = null;
  /** Analog inputs from the on-screen touch pads, −1..1.
   *  padMove = [strafe(+right), forward(+fwd)]; padLook = look-around. */
  padMove: [number, number] = [0, 0];
  padLook: [number, number] = [0, 0];
  flySpeed = 6;
  flyShift = 18;
  walkSpeed = 4;
  walkShift = 10;
  /** Mouse sensitivity multipliers (settings): LMB orbit / look-around, RMB pan. */
  orbitSens = 1;
  panSens = 1;

  // smoothed targets (exponential settle like native)
  private tAz = 0.6;
  private tEl = 0.5;
  private tDist = 10;

  // input accumulators, consumed once per update()
  private orbitDX = 0;
  private orbitDY = 0;
  private panDX = 0;
  private panDY = 0;
  private wheel = 0;
  private keys = new Set<string>();

  // smoothstep goto animation
  private anim: {
    start: number;
    smoothTime: number;
    sTarget: Float32Array;
    sDist: number;
    sAz: number;
    sEl: number;
    eTarget: Float32Array;
    eDist: number;
    eAz: number;
    eEl: number;
  } | null = null;

  // filled by viewProj(); consumed by cull/AO/edge passes
  readonly lastView = new Float32Array(16);
  lastP00 = 1;
  lastP11 = 1;
  orthoHalfH = 1;

  /** Near plane, DERIVED from how far the camera is rather than from the scene
   *  size. Reverse-Z on depth32float has near-uniform relative precision, so
   *  the near plane can hug the camera however large the scene is — pinning it
   *  to the scene radius meant one far-away model clipped everything within a
   *  metre, and the value went stale when that model was unloaded. The ratio
   *  reproduces what the old scene-radius rule gave right after a fit
   *  (radius / 5000, with orbitDistance ≈ 2.5 × radius at the default 55° fov),
   *  so framing is unchanged while flying in close now actually gets close. */
  get near(): number {
    return Math.max(this.orbitDistance * NEAR_RATIO, NEAR_MIN);
  }

  get focusDist(): number {
    return Math.max(this.orbitDistance, this.near);
  }

  forward(): [number, number, number] {
    const ce = Math.cos(this.elevation),
      se = Math.sin(this.elevation);
    return [ce * Math.cos(this.azimuth), ce * Math.sin(this.azimuth), se];
  }

  eye(): [number, number, number] {
    const f = this.forward();
    return [
      this.target[0] - f[0] * this.orbitDistance,
      this.target[1] - f[1] * this.orbitDistance,
      this.target[2] - f[2] * this.orbitDistance,
    ];
  }

  // right points screen-LEFT (native convention); up = fwd x right (screen-up)
  private axes() {
    const f = this.forward();
    const rl = Math.hypot(f[0], f[1]) || 1;
    const right: [number, number, number] = [-f[1] / rl, f[0] / rl, 0];
    const up: [number, number, number] = [
      f[1] * right[2] - f[2] * right[1],
      f[2] * right[0] - f[0] * right[2],
      f[0] * right[1] - f[1] * right[0],
    ];
    return { f, right, up };
  }

  /** Set the orbit angles directly (no animation) — used for the default
   *  load view. az/el in radians; negative elevation looks down. */
  setView(azimuth: number, elevation: number) {
    this.azimuth = this.tAz = azimuth;
    this.elevation = this.tEl = elevation;
  }

  fit(min: number[], max: number[]) {
    for (let i = 0; i < 3; i++) {
      this.target[i] = (min[i] + max[i]) / 2;
    }
    const radius = Math.max(0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]), 0.01);
    this.orbitDistance = this.tDist = (radius * 1.3) / Math.tan(this.fovY / 2);
    this.anim = null;
  }

  // Animate to a new pivot/distance keeping azimuth/elevation (native dolly()).
  dolly(point: [number, number, number], distance: number, smoothTime: number) {
    this.anim = {
      start: performance.now(),
      smoothTime: Math.max(smoothTime, 0.01),
      sTarget: this.target.slice(),
      sDist: this.orbitDistance,
      sAz: this.azimuth,
      sEl: this.elevation,
      eTarget: new Float32Array(point),
      eDist: Math.max(distance, 0.05),
      eAz: this.azimuth,
      eEl: Math.min(EL_CLAMP_ANIM, Math.max(-EL_CLAMP_ANIM, this.elevation)),
    };
  }

  // View-cube snap: animate to the given azimuth/elevation around the current
  // pivot at the current distance (native ViewCube SnapView).
  snapView(azimuth: number, elevation: number, smoothTime: number) {
    this.dolly([this.target[0], this.target[1], this.target[2]], this.orbitDistance, smoothTime);
    if (this.anim) {
      // rotate the SHORT way round: wrap the azimuth delta to (-π, π]
      const delta = Math.atan2(Math.sin(azimuth - this.azimuth), Math.cos(azimuth - this.azimuth));
      this.anim.eAz = this.azimuth + delta;
      this.anim.eEl = Math.min(EL_CLAMP_ANIM, Math.max(-EL_CLAMP_ANIM, elevation));
    }
  }

  rePivot(point: [number, number, number]) {
    this.onOrbitIntent?.();
    // Alt+LMB (any nav mode): keep the EYE where it is — move only the orbit
    // pivot to the clicked point, rotating slightly to face it. The camera
    // never dollies toward the target, so WASD/QE flying continues from the
    // same spot with the new pivot.
    const eye = this.eye();
    const d = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
    const dist = Math.hypot(d[0], d[1], d[2]);
    if (dist < 1e-4) {
      return;
    }
    this.dolly(point, dist, 0.25);
    if (this.anim) {
      const az = Math.atan2(d[1], d[0]);
      const delta = Math.atan2(Math.sin(az - this.azimuth), Math.cos(az - this.azimuth));
      this.anim.eAz = this.azimuth + delta;
      this.anim.eEl = Math.min(EL_CLAMP_ANIM, Math.max(-EL_CLAMP_ANIM, Math.asin(d[2] / dist)));
    }
  }

  flyTo(point: [number, number, number]) {
    this.onOrbitIntent?.();
    // Space: fly ~15% of the current distance toward the point (native 0.6 s)
    this.dolly(point, Math.max(this.orbitDistance * 0.15, 0.5), 0.6);
  }

  /** Animated restore of a full saved pose (viewpoints): dolly to the saved
   *  target/distance while rotating the SHORT way to the saved azimuth/
   *  elevation — the same dolly+override pattern as snapView/rePivot. */
  goToPose(target: [number, number, number], azimuth: number, elevation: number, distance: number, smoothTime = 0.5) {
    this.dolly(target, Math.max(distance, 0.05), smoothTime);
    if (this.anim) {
      const delta = Math.atan2(Math.sin(azimuth - this.azimuth), Math.cos(azimuth - this.azimuth));
      this.anim.eAz = this.azimuth + delta;
      this.anim.eEl = Math.min(EL_CLAMP_ANIM, Math.max(-EL_CLAMP_ANIM, elevation));
    }
  }

  update(dtIn: number) {
    const dt = Math.min(dtIn, 0.033); // native clamp
    const sprint = this.keys.has('shift') ? SPRINT_MULT : 1;
    const { f, right, up } = this.axes();

    const interacting =
      this.orbitDX !== 0 ||
      this.orbitDY !== 0 ||
      this.panDX !== 0 ||
      this.panDY !== 0 ||
      this.wheel !== 0 ||
      this.padMove[0] !== 0 ||
      this.padMove[1] !== 0 ||
      this.padLook[0] !== 0 ||
      this.padLook[1] !== 0 ||
      ['w', 'a', 's', 'd', 'q', 'e'].some((k) => this.keys.has(k));
    if (interacting) {
      this.anim = null;
      this.lastInputT = performance.now();
    }

    // wheel: exponential dolly (native update_camera:335-347)
    if (this.wheel !== 0) {
      const pct = Math.min(0.9, Math.max(-0.9, this.wheel * DOLLY_SENSITIVITY * 0.1));
      this.tDist = Math.max(this.tDist * (1 - pct), 0.1);
      this.wheel = 0;
    }

    // right touch pad: look around (same path as LMB orbit, dt-scaled)
    if (this.padLook[0] !== 0 || this.padLook[1] !== 0) {
      const LOOK_SPEED = 2.2; // rad/s at full deflection
      this.tAz -= this.padLook[0] * LOOK_SPEED * dt * this.orbitSens;
      this.tEl = Math.min(EL_CLAMP, Math.max(-EL_CLAMP, this.tEl - this.padLook[1] * LOOK_SPEED * dt * this.orbitSens));
    }

    // LMB orbit
    if (this.orbitDX !== 0 || this.orbitDY !== 0) {
      this.tAz -= this.orbitDX * SENSITIVITY * this.orbitSens;
      this.tEl = Math.min(EL_CLAMP, Math.max(-EL_CLAMP, this.tEl - this.orbitDY * SENSITIVITY * this.orbitSens));
      this.orbitDX = this.orbitDY = 0;
    }

    // RMB pan: distance-proportional speed (native 351-363, invert_pan=true)
    if (this.panDX !== 0 || this.panDY !== 0) {
      const t = Math.min(1, Math.max(0, this.orbitDistance / 1000));
      const speed = MIN_PAN_SPEED + t * (MAX_PAN_SPEED - MIN_PAN_SPEED);
      const dx = this.panDX * PAN_SENSITIVITY * this.panSens * speed;
      const dy = this.panDY * PAN_SENSITIVITY * this.panSens * speed;
      for (let i = 0; i < 3; i++) {
        this.target[i] += right[i] * dx + up[i] * dy;
      }
      this.panDX = this.panDY = 0;
    }

    // arrow keys: screen-plane pan, distance-scaled (native 378-397)
    let adx = 0,
      ady = 0;
    if (this.keys.has('arrowright')) {
      adx += 1;
    }
    if (this.keys.has('arrowleft')) {
      adx -= 1;
    }
    if (this.keys.has('arrowup')) {
      ady += 1;
    }
    if (this.keys.has('arrowdown')) {
      ady -= 1;
    }
    if (adx !== 0 || ady !== 0) {
      const step = Math.max(this.orbitDistance, 0.1) * 0.8 * dt * this.keyPanSens;
      for (let i = 0; i < 3; i++) {
        // +right for ArrowRight — matches RMB pan and the vertical arrows (was
        // negated, which panned the wrong way horizontally)
        this.target[i] += (right[i] * adx + up[i] * ady) * step;
      }
    }

    // WASD/QE movement (native move_camera:598-660). A = +right (screen-left).
    // fly: W/S go along the full view direction (dive when looking down).
    // walk: W/S move in the ground plane (Z held) — like walking while your
    // head (mouse look) turns; E/Q still change height deliberately.
    // 'orbit' mode: pure orbit navigation — movement keys and the move pad
    // are ignored so a stray touch can't walk the camera away.
    const orbit = this.navMode === 'orbit';
    const walk = this.navMode === 'walk';
    const base = walk ? this.walkSpeed : this.flySpeed;
    const shiftSpeed = walk ? this.walkShift : this.flyShift;
    const speed = this.keys.has('shift') ? shiftSpeed : base;
    const mv: [number, number, number] = [0, 0, 0];
    const add = (v: readonly number[], s: number) => {
      mv[0] += v[0] * s;
      mv[1] += v[1] * s;
      mv[2] += v[2] * s;
    };
    if (this.ortho) {
      // ortho can't show forward motion: W/S dolly the focus distance instead
      const factor = Math.max(1 - DOLLY_SENSITIVITY * dt * Math.min(sprint, 5), 0.1);
      if (!orbit && (this.keys.has('w') || this.padMove[1] > 0.3)) {
        this.tDist = Math.max(this.tDist * factor, 0.1);
      }
      if (!orbit && (this.keys.has('s') || this.padMove[1] < -0.3)) {
        this.tDist = Math.min(this.tDist / factor, 1e7);
      }
    } else if (!orbit) {
      // walk uses the horizontal projection of forward (constant Z)
      const rl = Math.hypot(f[0], f[1]) || 1;
      const fwd = walk ? ([f[0] / rl, f[1] / rl, 0] as const) : f;
      if (this.keys.has('w')) {
        add(fwd, 1);
      }
      if (this.keys.has('s')) {
        add(fwd, -1);
      }
      if (this.padMove[1] !== 0) {
        add(fwd, this.padMove[1]); // left pad: forward/back
      }
    }
    if (!orbit) {
      if (this.keys.has('a')) {
        add(right, 1);
      }
      if (this.keys.has('d')) {
        add(right, -1);
      }
      if (this.padMove[0] !== 0) {
        add(right, -this.padMove[0]); // left pad: strafe
      }
      if (this.keys.has('e')) {
        mv[2] += 1;
      }
      if (this.keys.has('q')) {
        mv[2] -= 1;
      }
    }
    const ml = Math.hypot(mv[0], mv[1], mv[2]);
    if (ml > 1e-6) {
      // divide by max(len,1), not len: keys (len≥1) normalize to full speed as
      // before, but a partly-pushed analog joystick (len<1) keeps its magnitude
      // → speed scales with how far the stick is pushed, up to the settings max.
      const s = (speed * dt) / Math.max(ml, 1);
      if (this.ortho) {
        for (let i = 0; i < 3; i++) {
          this.target[i] += mv[i] * s;
        }
      } else {
        // fly/walk: move the EYE and pin the orbit pivot an epsilon in front of
        // it, so orbiting after moving is essentially look-around at the camera
        // (not a swing around a far point).
        const NUDGE = 0.001;
        const eye = this.eye(); // uses the current (pre-collapse) distance
        this.orbitDistance = this.tDist = NUDGE;
        for (let i = 0; i < 3; i++) {
          this.target[i] = eye[i] + mv[i] * s + f[i] * NUDGE;
        }
      }
    }

    // goto animation: smoothstep over target/distance/azimuth/elevation
    if (this.anim) {
      const a = this.anim;
      const t = Math.min(1, (performance.now() - a.start) / 1000 / a.smoothTime);
      const alpha = t * t * (3 - 2 * t);
      for (let i = 0; i < 3; i++) {
        this.target[i] = a.sTarget[i] + (a.eTarget[i] - a.sTarget[i]) * alpha;
      }
      // shortest-path azimuth
      let dAz = a.eAz - a.sAz;
      dAz -= Math.round(dAz / (2 * Math.PI)) * 2 * Math.PI;
      this.azimuth = this.tAz = a.sAz + dAz * alpha;
      this.elevation = this.tEl = a.sEl + (a.eEl - a.sEl) * alpha;
      this.orbitDistance = this.tDist = a.sDist + (a.eDist - a.sDist) * alpha;
      if (t >= 1) {
        this.anim = null;
      }
      return;
    }

    // exponential settle toward targets (native smooth = 1 - exp(-10 dt))
    const s = 1 - Math.exp(-10 * dt);
    const settle = (cur: number, tgt: number) => (Math.abs(tgt - cur) < 1e-5 ? tgt : cur + (tgt - cur) * s);
    this.azimuth = settle(this.azimuth, this.tAz);
    this.elevation = settle(this.elevation, this.tEl);
    this.orbitDistance = settle(this.orbitDistance, this.tDist);
  }

  get animating(): boolean {
    return this.anim !== null;
  }

  /** Resolves once the current move (dolly / goToPose / snapView) has landed.
   *  The render loop drives the animation, so this polls per frame; the cap
   *  keeps a command from hanging if that loop is stalled (hidden tab) or
   *  something else cancels the move. */
  settled(maxMs = 3000): Promise<void> {
    if (!this.anim) {
      return Promise.resolve();
    }
    const t0 = performance.now();
    return new Promise((resolve) => {
      const tick = () => {
        if (!this.anim || performance.now() - t0 > maxMs) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  // View + projection (both reversed-Z). Perspective: infinite far.
  // Orthographic: half-height from the focus distance (matches perspective
  // framing at the focal plane); depth slab [orthoNear, orthoFar].
  viewProj(aspect: number): Mat4 {
    return this.buildViewProj(aspect, 0, 0, 0, true);
  }

  /** The same matrix with the world REBASED on `origin`: clip = vp * (world -
   *  origin). Built from the f64 camera state, so the translation terms stay
   *  small and survive the f32 upload — at 10 km an absolute f32 coordinate
   *  resolves to only ~1 mm, which is what makes distant geometry speckle.
   *  Does NOT touch `lastView` (the cull pass works in absolute world space). */
  viewProjRelative(aspect: number, origin: readonly [number, number, number]): Mat4 {
    return this.buildViewProj(aspect, origin[0], origin[1], origin[2], false);
  }

  private buildViewProj(aspect: number, ox: number, oy: number, oz: number, record: boolean): Mat4 {
    const [eyeX, eyeY, eyeZ] = this.eye();
    // rebase in f64 BEFORE the matrix math: the subtraction is exact here and
    // the products below then stay small
    const ex = eyeX - ox;
    const ey = eyeY - oy;
    const ez = eyeZ - oz;
    const f = this.forward();
    // right-handed look_at basis (camera x = screen-right = cross(fwd, up))
    let rx = f[1],
      ry = -f[0];
    const rl = Math.hypot(rx, ry) || 1;
    rx /= rl;
    ry /= rl;
    const ux = ry * f[2],
      uy = -rx * f[2],
      uz = rx * f[1] - ry * f[0];

    const v = [
      rx,
      ux,
      -f[0],
      0,
      ry,
      uy,
      -f[1],
      0,
      0,
      uz,
      -f[2],
      0,
      -(rx * ex + ry * ey),
      -(ux * ex + uy * ey + uz * ez),
      f[0] * ex + f[1] * ey + f[2] * ez,
      1,
    ];
    if (record) {
      this.lastView.set(v);
    }

    const p = new Array(16).fill(0);
    if (this.ortho) {
      const halfH = this.focusDist * Math.tan(this.fovY / 2);
      const halfW = halfH * aspect;
      this.orthoHalfH = halfH;
      const n = this.orthoNear;
      const fr = Math.max(this.orthoFar, n + 0.01);
      // reversed-Z: depth = (far + z_view) / (far - near), w = 1
      p[0] = 1 / halfW;
      p[5] = 1 / halfH;
      p[10] = 1 / (fr - n);
      p[14] = fr / (fr - n);
      p[15] = 1;
      this.lastP00 = p[0];
      this.lastP11 = p[5];
    } else {
      const pf = 1 / Math.tan(this.fovY / 2);
      // reversed-Z infinite far (depth 1 at near, 0 at infinity)
      p[0] = pf / aspect;
      p[5] = pf;
      p[11] = -1;
      p[14] = this.near;
      this.lastP00 = p[0];
      this.lastP11 = pf;
      this.orthoHalfH = 0;
    }

    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += p[k * 4 + r] * v[c * 4 + k];
        }
        out[c * 4 + r] = sum;
      }
    }
    return out;
  }

  /** true while the spacebar is held (Space+LMB = fly to point, native style) */
  get spaceHeld(): boolean {
    return this.keys.has(' ');
  }

  // pick(x, y, goto): goto=false re-pivots (alt+LMB), goto=true flies there (Space+LMB)
  attach(canvas: HTMLCanvasElement, pick: (x: number, y: number, goto: boolean) => void) {
    let button = -1;
    // touch gestures: one finger = look/orbit, two fingers = pan (their
    // centroid) + pinch = dolly. Mouse keeps the button-based mapping below.
    const touches = new Map<number, { x: number; y: number }>();
    const centroidDist = () => {
      const pts = [...touches.values()];
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      return { cx, cy, d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) };
    };
    canvas.style.touchAction = 'none'; // we own all touch gestures on the canvas

    canvas.addEventListener('pointerdown', (e) => {
      this.pointerActive = true;
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button === 0 && this.keys.has(' ')) {
        e.preventDefault();
        pick(e.offsetX, e.offsetY, true); // Space+LMB: fly to the clicked point
        return;
      }
      if (e.altKey && e.button === 0) {
        e.preventDefault();
        pick(e.offsetX, e.offsetY, false);
        return;
      }
      button = e.button;
      canvas.setPointerCapture(e.pointerId);
    });
    const endTouch = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (e.pointerType !== 'touch') {
        button = -1;
      }
      this.pointerActive = touches.size > 0 || button !== -1;
    };
    canvas.addEventListener('pointerup', endTouch);
    canvas.addEventListener('pointercancel', endTouch);
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        const prev = touches.get(e.pointerId);
        if (!prev) {
          return;
        }
        if (touches.size === 1) {
          this.orbitDX += e.clientX - prev.x;
          this.orbitDY += e.clientY - prev.y;
          touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        } else if (touches.size === 2) {
          const before = centroidDist();
          touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const after = centroidDist();
          this.panDX += after.cx - before.cx;
          this.panDY += after.cy - before.cy;
          this.wheel += (after.d - before.d) / 60; // pinch = dolly
        } else {
          touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }
        return;
      }
      if (button === 0) {
        this.orbitDX += e.movementX;
        this.orbitDY += e.movementY;
      } else if (button === 2 || button === 1) {
        this.panDX += e.movementX;
        this.panDY += e.movementY;
      }
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.onOrbitIntent?.(); // wheel dolly is an orbit-style move
        // normalize pixel-mode wheels to "lines"; wheel up = zoom in
        this.wheel += e.deltaMode === 0 ? -e.deltaY / 100 : -e.deltaY;
      },
      { passive: false },
    );
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // never steal WASD/QE/arrows/space from text editing
    const inEditable = (e: KeyboardEvent): boolean => {
      const t = e.target as HTMLElement | null;
      return (
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      );
    };
    window.addEventListener('keydown', (e) => {
      if (inEditable(e)) {
        return;
      }
      if (e.key === ' ') {
        e.preventDefault(); // held modifier for Space+LMB; stop page scroll
        this.keys.add(' ');
        return;
      }
      const k = e.key.toLowerCase();
      if ('wasdqe'.includes(k) || k === 'shift' || k.startsWith('arrow')) {
        this.keys.add(k);
        if ('wasdqe'.includes(k)) {
          this.onMoveKey?.(); // lets the app leave orbit mode
        }
        if (k.startsWith('arrow')) {
          e.preventDefault();
        }
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
    });
    window.addEventListener('blur', () => this.keys.clear());
  }
}
