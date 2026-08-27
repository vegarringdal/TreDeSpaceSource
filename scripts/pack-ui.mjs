// pack-ui.mjs — build the @tredespace/ui npm package (a .tgz for file:
// dependencies) out of src/treDeSpaceUI. No package.json lives in the source
// tree; everything here is generated into .pack/tredespace-ui/ and packed:
//
//   1. tsc -p tsconfig.lib.json      → ESM .js + .d.ts (staging dir)
//   2. copy styles.css + dockable.css (tsc doesn't move assets)
//   3. generate package.json          (version from the root package.json,
//      runtime deps pinned to the versions this repo builds against)
//   4. write LICENSE (MIT) + README
//   5. npm pack                       → .pack/tredespace-ui-<version>.tgz
//
// Consumers install it with:
//   "@tredespace/ui": "file:./libs/tredespace-ui-<version>.tgz"
// and must (a) have react/react-dom 19 (peer deps), (b) import
// '@tredespace/ui/styles.css', and (c) let Tailwind v4 scan the package:
//   @source "../node_modules/@tredespace/ui";
//
// Run standalone (`npm run pack:ui`) or via the Vite uiPackage() plugin,
// which emits the tarball into dist/docs/ for the widget-gallery download.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const SRC = resolve(root, 'src/treDeSpaceUI');
const STAGE = resolve(root, '.pack/tredespace-ui');
const OUT_DIR = resolve(root, '.pack');

/** Runtime packages the library imports — pinned to the repo's versions. */
const RUNTIME_DEPS = ['lit-html', '@tabler/icons-react', 'clsx', 'tailwind-merge'];

const MIT = (year, holder) => `MIT License

Copyright (c) ${year} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const README = (version) => `# @tredespace/ui

The TreDeSpace component library: the widgets, dialogs, tooltips, hotkeys
registry, and dockable panel shell the TreDeSpace viewer's UI is built from.
Live gallery with usage snippets and props docs: \`/docs/widgets.html\` on any
TreDeSpace deployment.

Compiled ESM + TypeScript declarations. A bundler (Vite, webpack, …) is
required — internal imports are extensionless and CSS is imported from JS.

## Install (from the downloaded tarball)

\`\`\`json
"dependencies": {
  "@tredespace/ui": "file:./libs/tredespace-ui-${version}.tgz"
}
\`\`\`

### What you need alongside it

- **React 19** — \`react\` and \`react-dom\` >= 19 are peer dependencies
  (npm 7+ installs them automatically if absent; an older React in your
  project is a conflict).
- **Tailwind CSS v4 in your build** — the widgets style themselves with
  Tailwind utilities, and a build tool can't come bundled inside a package:
  \`npm i -D tailwindcss @tailwindcss/vite\` (or \`@tailwindcss/postcss\`
  for non-Vite setups), then see the styling section below.

Everything else (\`lit-html\`, \`@tabler/icons-react\`, \`clsx\`,
\`tailwind-merge\`) is a regular dependency and installs automatically with
the package — no action needed.

## Styling (Tailwind v4)

The widgets style themselves with Tailwind utility classes, so your Tailwind
build must scan this package (node_modules is not scanned by default), and the
library's theme/scrollbar stylesheet must be imported:

\`\`\`css
@import "tailwindcss";
@import "@tredespace/ui/styles.css";
@source "../node_modules/@tredespace/ui";
\`\`\`

Theming: the library reads Tailwind's \`--color-*\` variables and ships a light
remap keyed by \`data-theme="light"\` on \`<html>\` (dark is the default). The
dock chrome (\`dockable\`) carries its own plain CSS with fallback colors and
works even without Tailwind.

## Entry points

\`\`\`ts
import { Button, Select, initTooltips } from '@tredespace/ui/widgets';
import { DockView, definePanel, split, tabs, useDockManager } from '@tredespace/ui/dockable';
import { hotkeysActions } from '@tredespace/ui/hotkeys';
\`\`\`

Call \`initTooltips()\` once at startup to enable the \`data-tooltip\`
attribute tooltips (and hotkey-combo footers via \`data-shortcut\`).
`;

export function packUi() {
  const rootPkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const version = rootPkg.version;

  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });

  // 1. compile
  execFileSync('node', [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(root, 'tsconfig.lib.json')], {
    cwd: root,
    stdio: 'inherit',
  });

  // 2. assets tsc leaves behind
  cpSync(resolve(SRC, 'styles.css'), resolve(STAGE, 'styles.css'));
  cpSync(resolve(SRC, 'dockable/dockable.css'), resolve(STAGE, 'dockable/dockable.css'));

  // 2b. strip side-effect CSS imports from the .d.ts files (verbatimModuleSyntax
  // keeps them, but consumers' tsc can't resolve '.css' modules; the runtime
  // import stays in the .js, where bundlers handle it).
  for (const f of readdirSync(STAGE, { recursive: true })) {
    const file = String(f);
    if (!file.endsWith('.d.ts')) continue;
    const p = resolve(STAGE, file);
    const src = readFileSync(p, 'utf8');
    const stripped = src.replace(/^import ['"][^'"]+\.css['"];\n/gm, '');
    if (stripped !== src) writeFileSync(p, stripped);
  }

  // 3. manifest
  const deps = Object.fromEntries(RUNTIME_DEPS.map((d) => [d, rootPkg.dependencies[d]]));
  for (const [d, v] of Object.entries(deps)) {
    if (!v) throw new Error(`pack-ui: runtime dep ${d} not found in root package.json dependencies`);
  }
  const entry = (p) => ({ types: `./${p}/index.d.ts`, default: `./${p}/index.js` });
  writeFileSync(
    resolve(STAGE, 'package.json'),
    `${JSON.stringify(
      {
        name: '@tredespace/ui',
        version,
        description: 'TreDeSpace component library — widgets, dialogs, tooltips, hotkeys, and the dockable panel shell.',
        license: 'MIT',
        type: 'module',
        sideEffects: ['**/*.css', './dockable/index.js'],
        exports: {
          './widgets': entry('widgets'),
          './dockable': entry('dockable'),
          './hotkeys': entry('hotkeys'),
          // createStore + cn — the state pattern the README teaches, and the
          // class helper; consumers were unable to reach either before
          './lib': entry('lib'),
          './styles.css': './styles.css',
          './package.json': './package.json',
        },
        peerDependencies: { react: '>=19', 'react-dom': '>=19' },
        dependencies: deps,
      },
      null,
      2,
    )}\n`,
  );

  // 4. license + readme
  writeFileSync(resolve(STAGE, 'LICENSE'), MIT(new Date().getFullYear(), 'Vegar Ringdal'));
  writeFileSync(resolve(STAGE, 'README.md'), README(version));

  // 5. pack
  execFileSync('npm', ['pack', STAGE, '--pack-destination', OUT_DIR], { cwd: root, stdio: 'inherit' });
  const fileName = `tredespace-ui-${version}.tgz`;
  return { tgzPath: resolve(OUT_DIR, fileName), fileName, version };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const { tgzPath } = packUi();
  console.log(`\npacked → ${tgzPath}`);
}
