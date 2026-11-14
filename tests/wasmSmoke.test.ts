// Smoke test of the COMMITTED wasm binaries (src/lib/*/wasm/*.wasm) — the
// files the viewer actually ships. Nothing else in `npm test` loads them, and
// CI never rebuilds them, so this is what catches a broken or mismatched
// rebuild.
//
// Every converter embeds its own copy of cooker-core, and so does the cooker
// module. The checks below mirror the Rust `direct_cook` tests across BINARIES:
// a converter's direct .tdp (the import path the app uses) must equal the
// standalone cooker cooking that converter's merged GLB. A difference means
// the modules were built from different sources. Each output must also parse
// with the app's own reader, and the cooked bytes are pinned — a deliberate
// cooker change updates them with `npx vitest run -u`.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as cookerWasm from '../src/lib/cooker/wasm/cooker_wasm.js';
import * as ifcWasm from '../src/lib/ifc2glb/wasm/ifc_wasm.js';
import { parseModel } from '../src/lib/model/format';
import * as nwdWasm from '../src/lib/nwd2tdp/wasm/nwd_wasm.js';
import * as rvmWasm from '../src/lib/rvm2glb/wasm/rvm_wasm.js';
import * as scanWasm from '../src/lib/scan2tdpp/wasm/scan_wasm.js';
import * as stepWasm from '../src/lib/step2glb/wasm/step_wasm.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type MemIo = Readonly<{
  /** The JS side of the workers' sync-access-handle `Io`, held in RAM. */
  io: Record<string, (...args: never[]) => unknown>;
  files: Map<string, Uint8Array>;
}>;

type Cooked = Readonly<{ full: Uint8Array; coarse: Uint8Array | undefined }>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const ROOT = resolve(import.meta.dirname, '..');
const RVM_SAMPLE = 'convertSamples/rvm/HA-PIPE.RVM';
const STEP_SAMPLE = 'rust_src/crates/step-core/tests/fixtures/colored.step';
const IFC_SAMPLE = 'tests/fixtures/box.ifc';
const NWD_SAMPLE = 'convertSamples/nwd/aps-params-test-desks/params_test_desks.nwd';

// the app's import defaults (assets.state.ts) and worker flags
const COMPUTE_NORMALS = false;
const COARSEN = true;
const STEP_DEFLECTION_MM = 1.0;
const STEP_MAX_ANGLE_DEG = 25.0;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

const read = (path: string): Uint8Array => new Uint8Array(readFileSync(resolve(ROOT, path)));

const md5 = (bytes: Uint8Array): string => createHash('md5').update(bytes).digest('hex');

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

/** An in-memory `Io` for the streaming converters: input reads, a growable
 *  spill area, and outputs collected by name. Handles start at 1 like the
 *  workers' (0 means "not opened"). Writes land immediately — the coarse
 *  sibling is written without a close. */
function createMemIo(input: Uint8Array): MemIo {
  const files = new Map<string, Uint8Array>();
  const names: string[] = [];
  let spill = new Uint8Array(0);
  const append = (name: string, bytes: Uint8Array) => {
    const prev = files.get(name) ?? new Uint8Array(0);
    const next = new Uint8Array(prev.length + bytes.length);
    next.set(prev);
    next.set(bytes, prev.length);
    files.set(name, next);
  };
  const io = {
    size: () => input.length,
    read: (offset: number, len: number) => input.slice(offset, offset + len),
    open: (name: string) => {
      names.push(name);
      files.set(name, new Uint8Array(0));
      return names.length;
    },
    write: (handle: number, bytes: Uint8Array) => append(names[handle - 1], bytes),
    close: () => {},
    progress: () => {},
    writeTemp: (offset: number, bytes: Uint8Array) => {
      if (offset + bytes.length > spill.length) {
        const grown = new Uint8Array(Math.max(offset + bytes.length, spill.length * 2));
        grown.set(spill);
        spill = grown;
      }
      spill.set(bytes, offset);
    },
    readTemp: (offset: number, len: number) => spill.slice(offset, offset + len),
    tempLen: () => spill.length,
    readSlot: () => {
      throw new Error('no sub-workers in the smoke test');
    },
  };
  return { io, files };
}

function cookGlb(glb: Uint8Array): Cooked {
  const res = cookerWasm.cook(glb, COMPUTE_NORMALS, COARSEN);
  const cooked = { full: res.bytes, coarse: res.coarse };
  res.free();
  return cooked;
}

function rvmOptions(): rvmWasm.Options {
  const o = new rvmWasm.Options();
  o.mode = 0; // merged — the only shape the cooker accepts
  o.remove_empty = true;
  o.level = 0;
  o.tolerance = 0.01;
  o.include_line = false;
  o.line_width = 0.005;
  o.align_segments = false;
  return o;
}

function ifcOptions(): ifcWasm.Options {
  const o = new ifcWasm.Options();
  o.mode = 'merged';
  o.split = 'none';
  o.quality = 'medium';
  o.spaces = 'skip';
  o.openings = 'skip';
  o.recenter = true;
  o.source_name = 'box.ifc';
  return o;
}

/** Every `.glb` / `.tdp` a converter result holds, by name. */
function collect(res: { len: number; name(i: number): string | undefined; bytes(i: number): Uint8Array | undefined }) {
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < res.len; i++) {
    const name = res.name(i);
    const bytes = res.bytes(i);
    if (name && bytes && /\.(glb|tdp)$/i.test(name)) {
      out.set(name, bytes);
    }
  }
  return out;
}

async function expectParses(name: string, bytes: Uint8Array | undefined): Promise<void> {
  expect(bytes, `${name} missing`).toBeDefined();
  const model = await parseModel(name, toArrayBuffer(bytes ?? new Uint8Array(0)));
  expect(model.itemCount, `${name} has no items`).toBeGreaterThan(0);
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

beforeAll(() => {
  cookerWasm.initSync({ module: read('src/lib/cooker/wasm/cooker_wasm_bg.wasm') });
  rvmWasm.initSync({ module: read('src/lib/rvm2glb/wasm/rvm_wasm_bg.wasm') });
  stepWasm.initSync({ module: read('src/lib/step2glb/wasm/step_wasm_bg.wasm') });
  ifcWasm.initSync({ module: read('src/lib/ifc2glb/wasm/ifc_wasm_bg.wasm') });
  nwdWasm.initSync({ module: read('src/lib/nwd2tdp/wasm/nwd_wasm_bg.wasm') });
  scanWasm.initSync({ module: read('src/lib/scan2tdpp/wasm/scan_wasm_bg.wasm') });
});

describe('committed wasm: RVM', () => {
  it('cooks the import path to the same bytes as the cooker cooking its GLB', async () => {
    const rvm = read(RVM_SAMPLE);
    const { io, files } = createMemIo(rvm);
    rvmWasm.convert_streaming_tdp(io, rvmOptions(), 'HA-PIPE.RVM', COMPUTE_NORMALS, COARSEN);
    const glbs = collect(rvmWasm.convert_in_ram(rvm, rvmOptions(), 'HA-PIPE.RVM', { report: () => {} }));
    expect(glbs.size).toBeGreaterThan(0);

    for (const [glbName, glb] of glbs) {
      const stem = glbName.replace(/\.glb$/i, '');
      const direct = files.get(`${stem}.tdp`);
      const directCoarse = files.get(`${stem}.coarse.tdp`);
      const viaGlb = cookGlb(glb);
      expect(direct && md5(direct), `${stem}.tdp`).toBe(md5(viaGlb.full));
      expect(directCoarse && md5(directCoarse), `${stem}.coarse.tdp`).toBe(viaGlb.coarse && md5(viaGlb.coarse));
      await expectParses(`${stem}.tdp`, direct);
      await expectParses(`${stem}.coarse.tdp`, directCoarse);
      expect({ [stem]: md5(viaGlb.full), [`${stem}.coarse`]: viaGlb.coarse && md5(viaGlb.coarse) }).toMatchSnapshot();
    }
  });
});

describe('committed wasm: Navisworks', () => {
  it('cooks the import path to the same bytes as the cooker cooking its GLB', async () => {
    const nwd = read(NWD_SAMPLE);
    const direct = createMemIo(nwd);
    const viaGlb = createMemIo(nwd);
    const o = new nwdWasm.Options();
    nwdWasm.convert_streaming_tdp(direct.io, o, 'params_test_desks.nwd', COMPUTE_NORMALS, COARSEN);
    nwdWasm.convert_streaming(viaGlb.io, o, 'params_test_desks.nwd');
    o.free();
    const glbs = [...viaGlb.files].filter(([name]) => /\.glb$/i.test(name));
    expect(glbs.length).toBeGreaterThan(0);

    for (const [glbName, glb] of glbs) {
      const stem = glbName.replace(/\.glb$/i, '');
      const full = direct.files.get(`${stem}.tdp`);
      const coarse = direct.files.get(`${stem}.coarse.tdp`);
      const cooked = cookGlb(glb);
      expect(full && md5(full), `${stem}.tdp`).toBe(md5(cooked.full));
      expect(coarse && md5(coarse), `${stem}.coarse.tdp`).toBe(cooked.coarse && md5(cooked.coarse));
      await expectParses(`${stem}.tdp`, full);
      await expectParses(`${stem}.coarse.tdp`, coarse);
      expect({ [stem]: md5(cooked.full), [`${stem}.coarse`]: cooked.coarse && md5(cooked.coarse) }).toMatchSnapshot();
    }
  });
});

describe('committed wasm: Navisworks options', () => {
  it('cooks per-vertex normals when asked, and lines add geometry', async () => {
    const nwd = read(NWD_SAMPLE);
    const cookWith = (set: (o: nwdWasm.Options) => void, normals: boolean) => {
      const mem = createMemIo(nwd);
      const o = new nwdWasm.Options();
      set(o);
      nwdWasm.convert_streaming_tdp(mem.io, o, 'params_test_desks.nwd', normals, COARSEN);
      o.free();
      return [...mem.files].filter(([name]) => /(?<!\.coarse)\.tdp$/i.test(name));
    };
    const plain = cookWith(() => {}, false);
    const smooth = cookWith((o) => {
      o.include_normals = true;
    }, true);
    expect(plain.length).toBeGreaterThan(0);
    expect(smooth.length).toBe(plain.length);
    for (const [i, [name, bytes]] of smooth.entries()) {
      await expectParses(name, bytes);
      expect(bytes.length, `${name} with normals`).toBeGreaterThan(plain[i][1].length);
    }
  });
});

describe('committed wasm: laser scans', () => {
  it('loads, and rejects a file that is neither LGSX nor E57 with an error (no trap)', () => {
    expect(scanWasm.version()).toMatch(/^scan-wasm .*meshoptimizer 1\.3/);
    const junk = new Uint8Array(4096).fill(7);
    const io = {
      size: () => junk.length,
      read: (offset: number, len: number) => junk.slice(offset, offset + len),
      write: () => undefined,
      progress: () => undefined,
    };
    expect(() => scanWasm.cook(io, '{}')).toThrow();
  });
});

describe('committed wasm: STEP', () => {
  it('cooks the session path (the import path) to the same bytes as the in-RAM path and the cooker', async () => {
    const step = read(STEP_SAMPLE);
    const { io, files } = createMemIo(step);
    const session = new stepWasm.StepSession(io, STEP_DEFLECTION_MM, STEP_MAX_ANGLE_DEG, true, false, true);
    session.finish(
      new Uint32Array(),
      new Uint32Array(),
      new Float64Array(),
      new Uint32Array(),
      '',
      'colored.tdp',
      COARSEN,
      COMPUTE_NORMALS,
    );
    session.free();
    const ram = stepWasm.convert_step_to_tdp(
      step,
      STEP_DEFLECTION_MM,
      STEP_MAX_ANGLE_DEG,
      true,
      false,
      true,
      COMPUTE_NORMALS,
      COARSEN,
      { report: () => {} },
    );
    const viaRam = { full: ram.tdp, coarse: ram.coarse };
    ram.free();
    // across binaries: the GLB entry point has its own tessellation defaults,
    // which is why the fixture is planar — deflection and angle don't apply
    const glb = stepWasm.convert_step_to_glb(step);
    const viaGlb = cookGlb(glb.glb);
    glb.free();

    const direct = files.get('colored.tdp');
    expect(direct && md5(direct)).toBe(md5(viaRam.full));
    expect(md5(viaGlb.full)).toBe(md5(viaRam.full));
    await expectParses('colored.tdp', direct);
    await expectParses('colored.coarse.tdp', files.get('colored.coarse.tdp'));
    expect({ colored: md5(viaRam.full) }).toMatchSnapshot();
  });
});

describe('committed wasm: IFC', () => {
  it('cooks the import path to the same bytes as the cooker cooking its GLB', async () => {
    const ifc = read(IFC_SAMPLE);
    const direct = collect(ifcWasm.convert_ifc_tdp(ifc, ifcOptions(), null, COMPUTE_NORMALS, COARSEN));
    const glbs = collect(ifcWasm.convert_ifc(ifc, ifcOptions(), null));
    expect(glbs.size).toBeGreaterThan(0);

    for (const [glbName, glb] of glbs) {
      const stem = glbName.replace(/\.glb$/i, '');
      const viaGlb = cookGlb(glb);
      const tdp = direct.get(`${stem}.tdp`);
      expect(tdp && md5(tdp), `${stem}.tdp`).toBe(md5(viaGlb.full));
      await expectParses(`${stem}.tdp`, tdp);
      await expectParses(`${stem}.coarse.tdp`, direct.get(`${stem}.coarse.tdp`));
      expect({ [stem]: md5(viaGlb.full) }).toMatchSnapshot();
    }
  });
});

describe('committed wasm: cooker', () => {
  it('rebuilds a parseable coarse variant from a cooked .tdp (the .tdp import path)', async () => {
    const { io, files } = createMemIo(read(RVM_SAMPLE));
    rvmWasm.convert_streaming_tdp(io, rvmOptions(), 'HA-PIPE.RVM', COMPUTE_NORMALS, false);
    const tdp = [...files].find(([name]) => /\.tdp$/i.test(name))?.[1];
    expect(tdp).toBeDefined();

    const coarse = cookerWasm.coarsenTdp(tdp ?? new Uint8Array(0));
    await expectParses('coarsened.tdp', coarse);
    expect({ coarsened: md5(coarse) }).toMatchSnapshot();
  });
});
