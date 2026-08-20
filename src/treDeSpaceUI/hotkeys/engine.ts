// Framework-free hotkey engine. Zero app imports. See DESIGN.md for the
// full design. Grammar over keys:
//   X        tap (press & release)
//   [X]/[A&B] hold a key/group across the rest of the sequence
//   A&B      together (same instant — regular keys too, e.g. E&R)
//   A + B    then (release, press next)
//   AA/101   runs expand to taps (A+A, 1+0+1); F-keys & named keys stay whole
//   ++       the literal + key
//
// A shortcut is a Sequence of Combos. A Combo is modifiers + a set of held
// keys, canonicalized (mods in fixed order, keys sorted) so "E&R" === "R&E".

export type Combo = string;
export type Sequence = Combo[];

export const DEFAULT_TIMEOUT = 1500; // ms between sequence steps

const MODS: Record<string, string> = {
  CTRL: 'Ctrl',
  CONTROL: 'Ctrl',
  ALT: 'Alt',
  SHIFT: 'Shift',
  META: 'Meta',
  CMD: 'Meta',
};
const NAMED: Record<string, string> = {
  ESC: 'Escape',
  ESCAPE: 'Escape',
  ENTER: 'Enter',
  SPACE: 'Space',
  TAB: 'Tab',
  UP: 'ArrowUp',
  DOWN: 'ArrowDown',
  LEFT: 'ArrowLeft',
  RIGHT: 'ArrowRight',
  PAGEUP: 'PageUp',
  PAGEDOWN: 'PageDown',
  HOME: 'Home',
  END: 'End',
  DELETE: 'Delete',
  BACKSPACE: 'Backspace',
};
const NAMED_CODE_TO_DISPLAY: Record<string, string> = {
  Escape: 'ESC',
  Enter: 'ENTER',
  Space: 'SPACE',
  Tab: 'TAB',
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  PageUp: 'PAGEUP',
  PageDown: 'PAGEDOWN',
  Home: 'HOME',
  End: 'END',
  Delete: 'DELETE',
  Backspace: 'BACKSPACE',
};
const MOD_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];

export class HotkeyParseError extends Error {}

function isBareModifier(code: string): boolean {
  return code.startsWith('Control') || code.startsWith('Alt') || code.startsWith('Shift') || code.startsWith('Meta');
}

/** The canonical modifier name for a bare-modifier code (`AltLeft` → `Alt`). */
function modifierName(code: string): string | null {
  if (code.startsWith('Control')) {
    return 'Ctrl';
  }
  if (code.startsWith('Alt')) {
    return 'Alt';
  }
  if (code.startsWith('Shift')) {
    return 'Shift';
  }
  if (code.startsWith('Meta')) {
    return 'Meta';
  }
  return null;
}

// While recording a shortcut, the live engine is suspended so the keys being
// captured don't also fire the actions they're bound to.
let suspendDepth = 0;
export function suspendHotkeys(): void {
  suspendDepth++;
}
export function resumeHotkeys(): void {
  suspendDepth = Math.max(0, suspendDepth - 1);
}

/** One display token -> { mod } or { key: code }. Throws on anything unknown. */
function classify(tok: string): { mod?: string; key?: string } {
  const up = tok.toUpperCase();
  if (MODS[up]) {
    return { mod: MODS[up] };
  }
  if (NAMED[up]) {
    return { key: NAMED[up] };
  }
  if (/^F([1-9]|1[0-2])$/.test(up)) {
    return { key: up }; // F1..F12
  }
  if (/^[0-9]$/.test(tok)) {
    return { key: `Digit${tok}` };
  }
  if (/^[A-Za-z]$/.test(tok)) {
    return { key: `Key${up}` };
  }
  if (tok === '+') {
    return { key: 'Equal' }; // the physical +/= key (written "++")
  }
  throw new HotkeyParseError(`unknown key token "${tok}"`);
}

/** mods + keys -> canonical combo (mods fixed order, keys sorted). */
export function makeCombo(mods: string[], keys: string[]): Combo {
  const m = MOD_ORDER.filter((o) => mods.includes(o));
  const k = [...new Set(keys)].sort();
  return [...m, ...k].join('&');
}

/** Build the combo for the current keydown from the held-set (mods + keys). */
export function comboFromHeld(e: KeyboardEvent, held: Set<string>): Combo | null {
  if (isBareModifier(e.code)) {
    return null;
  }
  const mods: string[] = [];
  if (e.ctrlKey) {
    mods.push('Ctrl');
  }
  if (e.altKey) {
    mods.push('Alt');
  }
  if (e.shiftKey) {
    mods.push('Shift');
  }
  if (e.metaKey) {
    mods.push('Meta');
  }
  return makeCombo(mods, [...held, e.code]);
}

/** Prettify one combo: "Alt&F1" -> "ALT&F1", "Digit1" -> "1", "KeyZ" -> "Z".
 *  Display order: modifiers, then multi-char keys (F-keys/named — usually the
 *  held leader), then single chars — so "1&F1" reads "F1&1". */
export function formatCombo(c: Combo): string {
  const disp = (p: string): string => {
    if (p.startsWith('Digit')) {
      return p.slice(5);
    }
    if (p.startsWith('Key')) {
      return p.slice(3);
    }
    if (p === 'Equal') {
      return '++'; // the + key is written doubled (round-trips)
    }
    if (NAMED_CODE_TO_DISPLAY[p]) {
      return NAMED_CODE_TO_DISPLAY[p];
    }
    return p.toUpperCase(); // ALT, CTRL, SHIFT, F1…
  };
  const parts = c.split('&').map(disp);
  const mods = parts
    .filter((p) => MOD_DISPLAY.includes(p))
    .sort((a, b) => MOD_DISPLAY.indexOf(a) - MOD_DISPLAY.indexOf(b));
  const keys = parts
    .filter((p) => !MOD_DISPLAY.includes(p))
    .sort((a, b) => (b.length > 1 ? 1 : 0) - (a.length > 1 ? 1 : 0) || a.localeCompare(b));
  return [...mods, ...keys].join('&');
}
const MOD_DISPLAY = ['CTRL', 'ALT', 'SHIFT', 'META'];

/** Whole sequence for display. Steps join " + "; a run of bare lone digits is
 *  concatenated so ["Alt&F1","Digit1","Digit0","Digit1"] -> "ALT&F1 + 101". */
export function formatSequence(seq: Sequence): string {
  const out: string[] = [];
  let digits = '';
  const flush = () => {
    if (digits) {
      out.push(digits);
      digits = '';
    }
  };
  for (const c of seq) {
    const f = formatCombo(c);
    if (/^[0-9]$/.test(f)) {
      digits += f;
    } else {
      flush();
      out.push(f);
    }
  }
  flush();
  return out.join(' + ');
}

/** Parse the display grammar into a Sequence. Whitespace is insignificant.
 *  Brackets [X]/[A&B] mark held keys that persist into every following combo. */
export function parseSequence(str: string): Sequence {
  const seq: Combo[] = [];
  const heldMods: string[] = [];
  const heldKeys: string[] = [];

  // protect the doubled "++" (literal + key) before splitting on the separator
  const SENT = '\u0001';
  const steps = str.replaceAll('++', SENT).split('+');

  for (const rawStep of steps) {
    const step = rawStep.replaceAll(SENT, '+').trim();
    if (!step) {
      continue;
    }

    // strip bracketed hold-groups: "[F1&ALT]" adds F1,ALT to the held set and
    // (on its own) emits no combo; "[F1] 1" isn't valid — holds are their own step
    const holdMatches = [...step.matchAll(/\[([^\]]+)\]/g)];
    if (holdMatches.length > 0) {
      const rest = step
        .replace(/\[[^\]]+\]/g, '')
        .replace(/&+/g, '&')
        .replace(/^&|&$/g, '')
        .trim();
      for (const m of holdMatches) {
        for (const t of m[1].split('&')) {
          const c = classify(t.trim());
          if (c.mod) {
            heldMods.push(c.mod);
          } else if (c.key) {
            heldKeys.push(c.key);
          }
        }
      }
      if (rest) {
        parseTapStep(rest, seq, heldMods, heldKeys);
      }
      continue;
    }

    parseTapStep(step, seq, heldMods, heldKeys);
  }

  if (seq.length === 0) {
    throw new HotkeyParseError(`empty sequence "${str}"`);
  }
  return seq;
}

/** Parse one non-hold step (a combo or an expandable run) into `seq`,
 *  merging in any currently-held mods/keys. */
function parseTapStep(step: string, seq: Combo[], heldMods: string[], heldKeys: string[]) {
  if (step.includes('&')) {
    const mods = [...heldMods];
    const keys = [...heldKeys];
    for (const t of step.split('&')) {
      const c = classify(t.trim());
      if (c.mod) {
        mods.push(c.mod);
      } else if (c.key) {
        keys.push(c.key);
      }
    }
    // A modifiers-only chord (e.g. "ALT&SHIFT") is a valid leader step; only a
    // truly empty step (no mods, no keys) is an error.
    if (keys.length === 0 && mods.length === 0) {
      throw new HotkeyParseError(`empty step "${step}"`);
    }
    seq.push(makeCombo(mods, keys));
    return;
  }
  const up = step.toUpperCase();
  if (MODS[up]) {
    // bare modifier step ("ALT + 101"): a modifiers-only leader combo — the
    // matcher emits these when the modifier is tapped and released alone
    seq.push(makeCombo([...heldMods, MODS[up]], heldKeys));
    return;
  }
  if (NAMED[up]) {
    seq.push(makeCombo(heldMods, [...heldKeys, NAMED[up]]));
    return;
  }
  if (/^F([1-9]|1[0-2])$/.test(up)) {
    seq.push(makeCombo(heldMods, [...heldKeys, up]));
    return;
  }
  if (step === '+') {
    seq.push(makeCombo(heldMods, [...heldKeys, 'Equal']));
    return;
  }
  if (/^[A-Za-z0-9]$/.test(step)) {
    seq.push(makeCombo(heldMods, [...heldKeys, classify(step).key as string]));
    return;
  }
  if (/^[A-Za-z0-9]{2,}$/.test(step)) {
    // run -> one tap per char (AA, FF, 101)
    for (const ch of step) {
      seq.push(makeCombo(heldMods, [...heldKeys, classify(ch).key as string]));
    }
    return;
  }
  throw new HotkeyParseError(`cannot parse step "${step}"`);
}

/** Does this string parse? (validation test + record guard.) */
export function isValidKeys(str: string): boolean {
  try {
    parseSequence(str);
    return true;
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// the matcher
// -----------------------------------------------------------------------------

export interface Registered {
  id: string;
  sequence: Sequence;
  run: () => void;
  timeout?: number;
  allowInInput?: boolean;
  context?: () => boolean;
}

function startsWith(seq: Sequence, prefix: Combo[]): boolean {
  return prefix.length <= seq.length && prefix.every((c, i) => seq[i] === c);
}

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el?.tagName) {
    return false;
  }
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export class HotkeyEngine {
  private registered: Registered[] = [];
  private held = new Set<string>(); // non-modifier codes currently down
  private modCodes = new Set<string>(); // bare-modifier codes currently down
  private modChord = new Set<string>(); // modifier NAMES seen during this hold (peak)
  private pureModHold = true; // no non-modifier pressed since the modifiers went down
  private progress: Combo[] = [];
  private pending: Registered | null = null; // exact match awaiting a possible longer one
  private timer = 0;
  private onProgress: ((p: Combo[]) => void) | null = null;
  private running = false;

  setBindings(list: Registered[]) {
    this.registered = list;
    this.reset();
  }
  setProgressListener(fn: (p: Combo[]) => void) {
    this.onProgress = fn;
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('blur', this.onBlur);
  }
  stop() {
    this.running = false;
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('blur', this.onBlur);
    this.reset();
    this.held.clear();
  }

  /** A mouse press CONSUMES a pure modifier hold (alt+click camera pivot etc.)
   *  — releasing the modifier afterwards must not emit it as a leader step. */
  private onPointerDown = () => {
    this.pureModHold = false;
  };

  /** Clear in-flight state WITHOUT firing a pending match (blur/stop/rebind). */
  private reset() {
    this.progress = [];
    this.pending = null;
    clearTimeout(this.timer);
    this.timer = 0;
    this.onProgress?.([]);
  }
  /** Timeout elapsed: a pending shorter match (a prefix of a longer binding,
   *  e.g. F when F+F also exists) now commits since no continuation arrived. */
  private fireTimeout = () => {
    const p = this.pending;
    this.reset();
    p?.run();
  };
  private arm(cand: Registered[]) {
    clearTimeout(this.timer);
    const ms = Math.min(...cand.map((r) => r.timeout ?? DEFAULT_TIMEOUT));
    this.timer = window.setTimeout(this.fireTimeout, Number.isFinite(ms) ? ms : DEFAULT_TIMEOUT);
  }

  private onBlur = () => {
    this.held.clear();
    this.modCodes.clear();
    this.modChord.clear();
    this.pureModHold = true;
    this.reset();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (suspendDepth > 0) {
      return;
    }
    if (isBareModifier(e.code)) {
      this.modCodes.delete(e.code);
      // All modifiers released after a PURE modifier hold (no other key pressed)
      // → emit the modifier chord as a sequence step (a "Alt&Shift" leader).
      if (this.modCodes.size === 0) {
        if (this.pureModHold && this.held.size === 0 && this.modChord.size > 0) {
          const combo = makeCombo([...this.modChord], []);
          // only advance when the chord is actually part of some binding, so a
          // stray Alt/Shift tap never disturbs an in-progress sequence
          if (this.modChordUsable(combo)) {
            this.feed(combo, e);
          }
        }
        this.modChord.clear();
        this.pureModHold = true;
      }
      return;
    }
    this.held.delete(e.code);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (suspendDepth > 0) {
      return; // recording a shortcut — stay out of the way
    }
    if (e.repeat) {
      return; // ignore auto-repeat
    }
    if (isBareModifier(e.code)) {
      if (this.modCodes.size === 0) {
        this.pureModHold = true;
      }
      this.modCodes.add(e.code);
      const name = modifierName(e.code);
      if (name) {
        this.modChord.add(name);
      }
      return; // modifiers alone don't advance until released (or a key joins)
    }
    // a real key joined — this hold is no longer a pure modifier chord
    this.pureModHold = false;
    const combo = comboFromHeld(e, this.held);
    if (combo === null) {
      return; // (shouldn't happen — not a bare modifier)
    }
    this.held.add(e.code);
    this.feed(combo, e);
  };

  /** True if `combo` starts, or continues, some registered binding — used to
   *  gate modifier-chord emission so stray taps are ignored. */
  private modChordUsable(combo: Combo): boolean {
    const next = [...this.progress, combo];
    return this.registered.some((r) => startsWith(r.sequence, next) || startsWith(r.sequence, [combo]));
  }

  /** Advance the sequence with one committed combo (from a keydown or a released
   *  modifier chord): match, fire, or arm the pending timeout. */
  private feed(combo: Combo, e: KeyboardEvent) {
    const inInput = isEditable(e.target);
    const usable = (r: Registered) => (!inInput || r.allowInInput) && (r.context?.() ?? true);

    let next = [...this.progress, combo];
    let cand = this.registered.filter((r) => usable(r) && startsWith(r.sequence, next));

    if (cand.length === 0) {
      // this key doesn't continue the sequence — commit any pending shorter
      // match (the in-progress sequence just ended), then try a fresh start.
      const p = this.pending;
      this.reset();
      p?.run();
      next = [combo];
      cand = this.registered.filter((r) => usable(r) && startsWith(r.sequence, next));
      if (cand.length === 0) {
        return; // nothing matches — let the key through
      }
    }

    // A matched shortcut fully owns the event: block the browser default AND
    // stop it reaching other JS handlers (equivalent to the old `return false`).
    e.preventDefault();
    e.stopPropagation();
    const exact = cand.find((r) => r.sequence.length === next.length) ?? null;
    const hasLonger = cand.some((r) => r.sequence.length > next.length);
    // exact with no possible extension → fire now (snappy single keys).
    if (exact && !hasLonger) {
      this.reset();
      exact.run();
      return;
    }
    // partial, or an exact that could still extend (F vs F+F) → wait; the
    // pending exact fires on timeout if no continuation arrives.
    this.progress = next;
    this.pending = exact;
    this.arm(cand);
    this.onProgress?.(next);
  }
}

/** Capture a sequence for the panel's Record button. Resolves on idle-pause or
 *  Enter, rejects on Escape. Commits a chord (E&R) as one step when its keys
 *  are fully released; sequential taps become separate steps. */
export function recordSequence(opts?: { idleMs?: number }): Promise<Sequence> {
  const idleMs = opts?.idleMs ?? 900;
  // Suspend the live engine so the keys being recorded don't fire their actions.
  suspendHotkeys();
  return new Promise((resolve, reject) => {
    const seq: Combo[] = [];
    const heldCodes = new Set<string>(); // every physical key down (incl. modifiers)
    const modNames = new Set<string>(); // peak modifiers seen this chord
    let pending: Combo | null = null; // max chord seen since last commit
    let idle = 0;

    // Build the current chord from the event's modifier state + all held keys.
    // Unlike the engine, a modifiers-only chord (e.g. Alt&Shift) is captured too.
    const currentCombo = (e: KeyboardEvent): Combo | null => {
      const mods: string[] = [];
      if (e.ctrlKey) {
        mods.push('Ctrl');
      }
      if (e.altKey) {
        mods.push('Alt');
      }
      if (e.shiftKey) {
        mods.push('Shift');
      }
      if (e.metaKey) {
        mods.push('Meta');
      }
      for (const m of modNames) {
        if (!mods.includes(m)) {
          mods.push(m); // event flags can lag
        }
      }
      const keys = [...heldCodes].filter((c) => !isBareModifier(c));
      if (mods.length === 0 && keys.length === 0) {
        return null;
      }
      return makeCombo(mods, keys);
    };

    const commit = () => {
      if (pending) {
        seq.push(pending);
        pending = null;
      }
    };
    const finish = () => {
      commit();
      cleanup();
      seq.length ? resolve(seq) : reject(new Error('empty'));
    };

    const onDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        cleanup();
        return reject(new Error('cancelled'));
      }
      if (e.code === 'Enter' && (seq.length || pending)) {
        return finish();
      }
      if (e.repeat) {
        return;
      }
      heldCodes.add(e.code);
      const name = modifierName(e.code);
      if (name) {
        modNames.add(name);
      }
      const c = currentCombo(e);
      if (c) {
        pending = c; // grows as more keys/modifiers join the chord
      }
      clearTimeout(idle);
    };
    const onUp = (e: KeyboardEvent) => {
      heldCodes.delete(e.code);
      // Whole chord released → commit it as a step, then wait for the next one.
      if (heldCodes.size === 0 && pending) {
        commit();
        modNames.clear();
        clearTimeout(idle);
        idle = window.setTimeout(finish, idleMs);
      }
    };
    const cleanup = () => {
      clearTimeout(idle);
      resumeHotkeys();
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
  });
}

// -----------------------------------------------------------------------------
// validation (defaults test + record guard)
// -----------------------------------------------------------------------------

export interface ValidatableDef {
  id: string;
  defaultKeys: string;
}

/** Validate a binding table: every default parses & round-trips, ids unique,
 *  and no two bindings share the exact same keys. Prefixes ARE allowed (a
 *  shorter match fires on timeout, e.g. F alongside F+F). Returns a list of
 *  problems (empty = OK). Pure — used by the boot assertion + unit test. */
export function validateBindings(defs: ValidatableDef[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const parsed: { id: string; seq: Sequence }[] = [];

  for (const d of defs) {
    if (seen.has(d.id)) {
      errors.push(`duplicate id: ${d.id}`);
    }
    seen.add(d.id);
    try {
      const seq = parseSequence(d.defaultKeys);
      const round = parseSequence(formatSequence(seq));
      if (round.join(' ') !== seq.join(' ')) {
        errors.push(`${d.id}: "${d.defaultKeys}" does not round-trip (-> "${formatSequence(seq)}")`);
      }
      parsed.push({ id: d.id, seq });
    } catch (e) {
      errors.push(`${d.id}: cannot parse "${d.defaultKeys}" — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // only EXACT duplicates are errors now (prefixes coexist via timeout-fire)
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      if (parsed[i].seq.join(' ') === parsed[j].seq.join(' ')) {
        errors.push(`${parsed[i].id} and ${parsed[j].id} share the same keys "${formatSequence(parsed[i].seq)}"`);
      }
    }
  }
  return errors;
}
