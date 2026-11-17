// Check an animation file (*.tdanim.json) the way the app's Open does — the
// first error with its JSON path, and warnings for overlay design fields the
// loader would drop. For Claude Code or a person writing an animation:
//   npm run anim:check path/to/file.tdanim.json
// Exit code 0 = it opens (warnings may follow), 1 = it does not.
// Item fullnames are not checked here (only the app knows the loaded models).

import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run anim:check <file.tdanim.json>');
  process.exit(2);
}

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { parseAnimationDoc } = await server.ssrLoadModule('/src/lib/animation/io.ts');
  const { overlayUnknownKeys } = await server.ssrLoadModule('/src/lib/overlay/overlaySchema.ts');
  const text = await readFile(file, 'utf8');
  const r = parseAnimationDoc(text);
  if (r.error) {
    console.error(`✗ ${file} does not open:\n${r.error}`);
    process.exitCode = 1;
  } else {
    const scenes = r.doc.scenes;
    const objects = scenes.reduce((n, s) => n + s.objects.length, 0);
    const keys = scenes.reduce((n, s) => n + s.objects.reduce((k, o) => k + o.keys.length, 0), 0);
    const steps = scenes.reduce((n, s) => n + s.steps.length, 0);
    console.log(`✓ ${file}: ${scenes.length} scene(s), ${objects} object(s), ${keys} key(s), ${steps} step(s)`);
    const raw = JSON.parse(text);
    const designs = { components: raw.overlayComponents ?? [], themes: raw.overlayThemes ?? [] };
    for (const w of overlayUnknownKeys(designs)) {
      console.log(`  ! ${w.replace(/^components/, 'overlayComponents').replace(/^themes/, 'overlayThemes')}`);
    }
    const instances = new Set(r.doc.overlayInstances.map((i) => i.id));
    for (const s of scenes) {
      for (const c of s.callouts) {
        if (!instances.has(c.instance)) {
          console.log(`  ! scene "${s.name}": callout ${c.id} shows "${c.instance}", which is not in overlayInstances`);
        }
      }
    }
  }
} finally {
  await server.close();
}
