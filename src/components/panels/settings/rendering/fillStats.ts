// Debug report: meshlet fill for every loaded model, printed to the Console
// panel. Geometry bytes are packed to content, so low fill costs (a) the fixed
// 144 B/meshlet record tax and (b) vertex-pull draw slots (372 verts per
// meshlet regardless of fill). The report shows both, against two bounds:
// "repack per item" (achievable — meshlets never span items) and "across
// items" (the hard floor if they could).
import { getRenderer } from '../../../../state/viewer/viewer.actions';
import { consoleActions } from '../../console/console.actions';

const MB = (b: number) => `${(b / (1024 * 1024)).toFixed(1)} MB`;
const N = (n: number) => n.toLocaleString('en-US');
const pct = (n: number, d: number) => `${d > 0 ? Math.round((100 * n) / d) : 0}%`;
const BUCKETS = ['1–15', '16–31', '32–47', '48–63', '64–79', '80–95', '96–111', '112–124'];

/** How many per-model lines to print — the Console rotates past ~100 lines,
 *  so large imports (hundreds of models) only list the worst offenders. */
const TOP = 20;

export async function logMeshletFill() {
  const models = (await getRenderer()?.readMeshletFill()) ?? [];
  if (models.length === 0) {
    consoleActions.log('warn', 'Meshlet fill: no models are loaded.');
    return;
  }
  const log = (text: string) => consoleActions.log('info', text);

  const t = models.reduce(
    (a, m) => ({
      meshlets: a.meshlets + m.meshlets,
      tris: a.tris + m.tris,
      items: a.items + m.items,
      idealPerItem: a.idealPerItem + m.idealPerItem,
      idealCrossItem: a.idealCrossItem + m.idealCrossItem,
      geoBytes: a.geoBytes + m.geoBytes,
      recordBytes: a.recordBytes + m.recordBytes,
      hist: a.hist.map((h, i) => h + m.hist[i]),
    }),
    {
      meshlets: 0,
      tris: 0,
      items: 0,
      idealPerItem: 0,
      idealCrossItem: 0,
      geoBytes: 0,
      recordBytes: 0,
      hist: new Array<number>(8).fill(0),
    },
  );
  // record bytes freed by each repack bound (records cost 144 B each)
  const savePerItem = (t.meshlets - t.idealPerItem) * 144;
  const saveCrossItem = (t.meshlets - t.idealCrossItem) * 144;

  log(`Meshlet fill — ${models.length} model${models.length === 1 ? '' : 's'}, ${N(t.items)} items`);
  log(
    `  ${N(t.meshlets)} meshlets · ${N(t.tris)} tris · avg ${(t.tris / t.meshlets).toFixed(1)}/124 tris ` +
      `(${pct(t.tris, t.meshlets * 124)} fill) · geometry ${MB(t.geoBytes)} · records ${MB(t.recordBytes)}`,
  );
  log(`  histogram: ${BUCKETS.map((b, i) => `${b}: ${pct(t.hist[i], t.meshlets)}`).join(' · ')}`);
  log(
    `  repacked per item: ${N(t.idealPerItem)} records (frees ${MB(savePerItem)}) · ` +
      `across items: ${N(t.idealCrossItem)} (frees ${MB(saveCrossItem)})`,
  );
  log(
    `  vertex-pull draw slots: ${((t.meshlets * 124) / Math.max(1, t.tris)).toFixed(2)}× the actual triangles ` +
      `(fixed 372-vert slots; the MDI path draws real counts and is unaffected)`,
  );

  const byWaste = [...models].sort((a, b) => (b.meshlets - b.idealPerItem) * 144 - (a.meshlets - a.idealPerItem) * 144);
  for (const m of byWaste.slice(0, TOP)) {
    log(
      `  · ${m.name} — ${N(m.meshlets)} meshlets · avg ${(m.tris / m.meshlets).toFixed(1)} tris ` +
        `(${pct(m.tris, m.meshlets * 124)}) · records ${MB(m.recordBytes)} · ` +
        `low-fill loss ${MB((m.meshlets - m.idealPerItem) * 144)} (per-item repack)`,
    );
  }
  if (byWaste.length > TOP) {
    log(`  … ${byWaste.length - TOP} more models (sorted by loss, worst first)`);
  }
}
