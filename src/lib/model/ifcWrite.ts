// Minimal IFC4 (ISO-10303-21 / STEP) writer for the Export panel — a cleaned
// port of the director's earlier web3d IFC exporter. Two shapes:
//   writeIfc(sections, sink)        merged — one proxy per final color
//   writeIfcHierarchy(roots, sink)  the app's tree — nested IfcRelAggregates of
//                                   proxies, leaf items carry triangulated bodies
// STREAMING: entities are pushed to the sink as they are produced — the whole
// STEP text never exists in memory (big point lists are sliced too). The one
// entity needing global knowledge (#51, the building's containment list) is
// emitted at the END of the DATA section; STEP permits arbitrary entity order
// and forward references.
// Meshes keep their TRUE world coordinates (BIM coordination needs them; the
// STEP text reals have no f32 precision problem). IFC is natively Z-up with
// metres — geometry goes in unchanged.
// Validate with https://validate.buildingsmart.org/dashboard
import type { ExportNode, ExportPrimitive } from './glbWrite';

/** Receives verbatim STEP text fragments in order (not necessarily lines). */
export type IfcSink = (text: string) => void;

// IFC GlobalId alphabet (base64 variant with _ and $)
const GUID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** IFC GlobalId: 128 random bits as 22 chars — the FIRST char encodes only
 *  2 bits (so it is always 0-3), the remaining 21 chars 6 bits each. */
function ifcGuid(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let out = GUID_ALPHABET[b[0] >> 6];
  let bits = b[0] & 0x3f;
  let len = 6;
  for (let i = 1; i < 16; i++) {
    bits = (bits << 8) | b[i];
    len += 8;
    while (len >= 6) {
      len -= 6;
      out += GUID_ALPHABET[(bits >> len) & 0x3f];
    }
  }
  return out; // 6 + 15*8 = 126 bits = exactly 21 more chars
}

/** STEP string payload: quotes doubled, non-ASCII replaced. */
const esc = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/[^\x20-\x7e]/g, '?');

/** STEP REAL — compact but always carrying a decimal point. */
function real(v: number, dp = 3): string {
  const r = Math.round(v * 10 ** dp) / 10 ** dp;
  const s = String(r);
  if (s.includes('e') || s.includes('E')) {
    return r.toFixed(dp);
  }
  return s.includes('.') ? s : `${s}.`;
}

export interface IfcSection {
  name: string;
  prim: ExportPrimitive;
}

/** The default building's IfcLocalPlacement — every top-level product chains
 *  off it; aggregated children chain off their parent (OJP001). */
const BUILDING_PLACEMENT = 107;

/** Big aggregate lists (points, faces) are flushed to the sink in slices of
 *  this many members, so no single entity is materialised as one huge string. */
const SLICE = 4096;

/** Entity emitter: the fixed scaffold owns #1-#107, products count up from #108.
 *  The header + scaffold go to the sink on construction, products as they are
 *  added, and finish() closes the DATA section (emitting #51 last). */
class IfcFile {
  private topProxies: string[] = [];
  private id = 108;
  private w: IfcSink;

  constructor(sink: IfcSink) {
    this.w = sink;
    const line = (s: string) => sink(`${s}\n`);
    line('ISO-10303-21;');
    line('HEADER;');
    line("FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1]'),'2;1');");
    line(
      `FILE_NAME('export.ifc','${new Date().toISOString()}',('tredespace'),('tredespace'),'tredespace','tredespace','None');`,
    );
    line("FILE_SCHEMA (('IFC4'));");
    line('ENDSEC;');
    line('DATA;');
    // exchange context, default building, project + SI units (#51 — the
    // building's containment list — is emitted by finish(), it needs the
    // complete top-level product list)
    line("#1= IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.0001,#3,$);");
    line('#2= IFCCARTESIANPOINT((0.0,0.0,0.0));');
    line('#3= IFCAXIS2PLACEMENT3D(#2,$,$);');
    line("#4= IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Axis','Model',*,*,*,*,#1,$,.MODEL_VIEW.,$);");
    line("#5= IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#1,$,.MODEL_VIEW.,$);");
    line(`#50= IFCBUILDING('${ifcGuid()}',$,'IfcBuilding',$,$,#107,$,$,$,$,$,$);`);
    line(`#100= IFCPROJECT('${ifcGuid()}',$,'IfcProject',$,$,$,$,(#1),#101);`);
    line('#101= IFCUNITASSIGNMENT((#102,#103,#104));');
    line('#102= IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);');
    line('#103= IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);');
    line('#104= IFCSIUNIT(*,.TIMEUNIT.,$,.SECOND.);');
    line(`#105= IFCRELAGGREGATES('${ifcGuid()}',$,'Project Container','Project Container for Buildings',#100,(#50));`);
    // Georeferencing (buildingSMART GRF003: an IfcBuilding requires a CRS).
    // No real CRS is known — a named local engineering CRS is declared; the
    // geometry keeps its true world coordinates, so the conversion is zero.
    line(`#60= IFCPROJECTEDCRS('unknown','local engineering CRS (not georeferenced)',$,$,$,$,#102);`);
    line('#61= IFCMAPCONVERSION(#1,#60,0.,0.,0.,$,$,$);');
    // identity axis placement (#106) + the building's placement (#107) that
    // every product placement chains off — per-product placements are emitted
    // by addProduct so aggregated children can reference their parent (OJP001)
    line('#106= IFCAXIS2PLACEMENT3D(#2,$,$);');
    line('#107= IFCLOCALPLACEMENT($,#106);');
  }

  /** One IFCBUILDINGELEMENTPROXY with its own IfcLocalPlacement RELATIVE to
   *  `relToPlacement` (identity offset — geometry is world-space). Group
   *  nodes pass no primitives (no body); each primitive becomes a
   *  triangulated face set with its own style. */
  addProduct(
    name: string,
    prims: ExportPrimitive[],
    relToPlacement: number = BUILDING_PLACEMENT,
  ): { proxy: number; placement: number } {
    const faceSetIds: number[] = [];
    for (const prim of prims) {
      const pointListId = this.id++;
      const faceSetId = this.id++;
      const colorId = this.id++;
      const shadingId = this.id++;
      const surfaceStyleId = this.id++;
      const styledItemId = this.id++;

      this.w(`#${pointListId}= IFCCARTESIANPOINTLIST3D((`);
      const p = prim.positions;
      let parts: string[] = [];
      let first = true;
      const flush = () => {
        if (parts.length === 0) {
          return;
        }
        this.w((first ? '' : ',') + parts.join(','));
        first = false;
        parts = [];
      };
      for (let i = 0; i < p.length; i += 3) {
        parts.push(`(${real(p[i])},${real(p[i + 1])},${real(p[i + 2])})`);
        if (parts.length >= SLICE) {
          flush();
        }
      }
      flush();
      this.w('));\n');

      this.w(`#${faceSetId}= IFCTRIANGULATEDFACESET(#${pointListId},$,$,(`);
      const idx = prim.indices;
      first = true;
      for (let i = 0; i < idx.length; i += 3) {
        // IFC indices are 1-based
        parts.push(`(${idx[i] + 1},${idx[i + 1] + 1},${idx[i + 2] + 1})`);
        if (parts.length >= SLICE) {
          flush();
        }
      }
      flush();
      this.w('),$);\n');

      const [r, g, b, a] = prim.color;
      this.w(`#${colorId}= IFCCOLOURRGB($,${real(r, 6)},${real(g, 6)},${real(b, 6)});\n`);
      this.w(`#${shadingId}= IFCSURFACESTYLESHADING(#${colorId},${real(1 - a, 4)});\n`);
      this.w(`#${surfaceStyleId}= IFCSURFACESTYLE($,.BOTH.,(#${shadingId}));\n`);
      this.w(`#${styledItemId}= IFCSTYLEDITEM(#${faceSetId},(#${surfaceStyleId}),$);\n`);
      faceSetIds.push(faceSetId);
    }
    let shapeRef = '$';
    if (faceSetIds.length > 0) {
      const shapeRepId = this.id++;
      const shapeDefId = this.id++;
      this.w(
        `#${shapeRepId}= IFCSHAPEREPRESENTATION(#5,'Body','Tessellation',(${faceSetIds.map((f) => `#${f}`).join(',')}));\n`,
      );
      this.w(`#${shapeDefId}= IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));\n`);
      shapeRef = `#${shapeDefId}`;
    }
    const placementId = this.id++;
    this.w(`#${placementId}= IFCLOCALPLACEMENT(#${relToPlacement},#106);\n`);
    const proxyId = this.id++;
    this.w(
      `#${proxyId}= IFCBUILDINGELEMENTPROXY('${ifcGuid()}',$,'${esc(name)}',$,$,#${placementId},${shapeRef},$,$);\n`,
    );
    return { proxy: proxyId, placement: placementId };
  }

  /** parent ⊃ children (the tree edge; children must NOT also be top-level). */
  aggregate(parent: number, children: number[]) {
    const relId = this.id++;
    this.w(
      `#${relId}= IFCRELAGGREGATES('${ifcGuid()}',$,$,$,#${parent},(${children.map((c) => `#${c}`).join(',')}));\n`,
    );
  }

  /** Mark a proxy as top-level: contained directly in the default building. */
  topLevel(proxy: number) {
    this.topProxies.push(`#${proxy}`);
  }

  finish(): void {
    this.w(
      `#51= IFCRELCONTAINEDINSPATIALSTRUCTURE('${ifcGuid()}',$,'Building','Building Container for Elements',(${this.topProxies.join(',')}),#50);\n`,
    );
    this.w('ENDSEC;\nEND-ISO-10303-21;\n');
  }
}

/** Merged export: one proxy per section (= per final color), streamed to `sink`. */
export function writeIfc(sections: IfcSection[], sink: IfcSink): void {
  const f = new IfcFile(sink);
  for (const s of sections) {
    f.topLevel(f.addProduct(s.name, [s.prim]).proxy);
  }
  f.finish();
}

/** Hierarchy export streamed to `sink`: the app's tree as nested
 *  IfcRelAggregates — each child's placement chains off its parent's (OJP001).
 *  Node matrices must already be baked into the primitives (IFC placements
 *  cannot carry arbitrary matrices). */
export function writeIfcHierarchy(roots: ExportNode[], sink: IfcSink): void {
  const f = new IfcFile(sink);
  const walk = (n: ExportNode, relToPlacement: number): number => {
    const { proxy, placement } = f.addProduct(n.name ?? 'group', n.primitives ?? [], relToPlacement);
    const kids = (n.children ?? []).map((c) => walk(c, placement));
    if (kids.length > 0) {
      f.aggregate(proxy, kids);
    }
    return proxy;
  };
  for (const r of roots) {
    f.topLevel(walk(r, BUILDING_PLACEMENT));
  }
  f.finish();
}
