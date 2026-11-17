import { describe, expect, it } from 'vitest';
import { animationFileSchema } from '../src/lib/animation/animSchema';
import {
  animationBrief,
  BRIEF_MULTI_SCENE,
  BRIEF_PATTERN_OVERLAYS,
  BRIEF_PATTERNS,
  customDesignExample,
  itemsCsv,
  preparedObjectsJson,
} from '../src/lib/animation/brief';
import { validateAnimationDoc } from '../src/lib/animation/io';

describe('Claude brief', () => {
  it('has patterns that open as they stand', () => {
    for (const p of BRIEF_PATTERNS) {
      const r = validateAnimationDoc({
        format: 'tredespace.animation',
        version: 2,
        scenes: [JSON.parse(p.scene)],
        overlayInstances: JSON.parse(BRIEF_PATTERN_OVERLAYS),
      });
      expect(r.error, p.title).toBeUndefined();
    }
  });

  it('hands over the objects the user prepared, as objects that open', () => {
    const objects = [
      { id: 'tskid', name: 'Skid', items: ['/skid'], exclude: ['/skid/base'], pivot: 'bottom' as const, move: [2, 0, 0], rotate: [0, 0, 0, 1] },
      { id: 'tvalve', name: 'Valve', items: ['/skid/valve'], parent: 'tskid', pivot: [1, 2, 3], move: [0, 0, 0], rotate: [0, 0, 0, 1] },
    ];
    const brief = animationBrief({ cards: [], objects });
    expect(brief).toContain('## Objects the user has prepared');
    expect(brief).toContain('"parent":"tskid"');
    expect(animationBrief({ cards: [] })).not.toContain('Objects the user has prepared');
    const r = validateAnimationDoc({
      format: 'tredespace.animation',
      version: 2,
      scenes: [{ objects: JSON.parse(preparedObjectsJson(objects)) }],
    });
    expect(r.error).toBeUndefined();
    const [skid, valve] = r.doc?.scenes[0].objects ?? [];
    expect([skid.keys[0].move, skid.exclude, skid.pivot]).toEqual([[2, 0, 0], ['/skid/base'], 'bottom']);
    expect([valve.parent, valve.keys[0].move, valve.pivot]).toEqual(['tskid', [0, 0, 0], [1, 2, 3]]);
    expect(brief).toContain('| `parent` |');
    expect(JSON.stringify(animationFileSchema())).toContain('rides on');
  });

  it('has a custom design example that opens, with its own design and theme', () => {
    const r = validateAnimationDoc(JSON.parse(customDesignExample()));
    expect(r.error).toBeUndefined();
    expect(r.doc?.overlayComponents[0]?.id).toBe('custom.stepCard');
    expect(r.doc?.overlayThemes[0]?.id).toBe('custom.brand');
  });

  it('has a two-scene example that opens: objects per scene, a shared overlay, a label in its own scene', () => {
    const r = validateAnimationDoc(JSON.parse(BRIEF_MULTI_SCENE));
    expect(r.error).toBeUndefined();
    expect(r.doc?.scenes.map((s) => s.name)).toEqual(['Assembly', 'Replace the seal']);
    expect(r.doc?.scenes[1]?.colorRules).toEqual([]);
    const label = r.doc?.overlayInstances.find((i) => i.anchor.kind === 'object');
    expect(label?.anchor.kind === 'object' && r.doc?.scenes[1]?.objects.some((o) => o.id === label.anchor.object)).toBe(
      true,
    );
  });

  it('explains every row and several scenes, and the camera the right way up', () => {
    const text = animationBrief({ cards: [] });
    for (const heading of [
      '## Several scenes',
      '### Camera keys',
      '### Clipping',
      '### Labels and measurements',
      '## Before you hand it over',
    ]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain('a negative `elevation` looks down');
    const defs = JSON.stringify(animationFileSchema());
    for (const def of ['"clipBox"', '"clipPlane"', '"clipShape"', '"label"', '"measurement"']) {
      expect(defs).toContain(def);
    }
    expect(defs).toContain('NEGATIVE looks down');
    expect(defs).not.toContain('above the horizon');
  });

  it('describes the format, the user’s cards and carries the schema', () => {
    const text = animationBrief({
      cards: [{ id: 'preset.stepCard', name: 'Step card', params: [{ key: 'showProgress', label: 'Show', type: 'toggle', default: true }] }],
      themes: [{ id: 'theme.default', name: 'Default' }],
    });
    expect(text).toContain('"version": 2');
    expect(text).toContain('What is visible at the start');
    expect(text).toContain('`preset.stepCard` — Step card');
    expect(text).toContain('"$schema"');
    const schema = animationFileSchema();
    expect(typeof schema === 'object' && schema !== null && !Array.isArray(schema) && '$defs' in schema).toBe(true);
  });

  it('lists items with centres and sizes and joins SQL columns', () => {
    const csv = itemsCsv(
      [{ name: 'Pump', fullname: '/a/pump', bounds: [0, 0, 0, 2, 2, 1], parent: '/a', depth: 1 }],
      { columns: ['fullname', 'system'], rows: [['/A/PUMP', 'CW']], key: 0 },
    );
    expect(csv.split('\n')).toEqual([
      'name,fullname,parent,depth,items,model,cx,cy,cz,sx,sy,sz,system',
      'Pump,/a/pump,/a,1,,,1,1,0.5,2,2,1,CW',
    ]);
  });
});
