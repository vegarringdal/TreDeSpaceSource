import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import pkg from './package.json' with { type: 'json' };
import { writeApiDocs } from './scripts/gen-api-docs.mjs';
import { writeWidgetDocs } from './scripts/gen-widget-docs.mjs';
import { packUi } from './scripts/pack-ui.mjs';

// Third-party license attribution (Settings → About → "Show third-party
// notices") is generated into src/generated/third-party-notices.json by
// scripts/gen-third-party-notices.mjs — run `npm run gen:notices` after a
// dependency change.

/** Emit dist/build.version at build time — a deployed instance can be probed
 *  at <host>/build.version to see which version/build is live. */
function buildVersion(): Plugin {
  return {
    name: 'build-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build.version',
        source: `VERSION: ${pkg.version}\nBUILD_TIME: ${new Date().toISOString()}\n`,
      });
    },
  };
}

/** Ship the demo's large sample assets, kept in /samples (OUTSIDE public/ so
 *  Vite's public-dir copy never touches them — a 10 MB GLB shouldn't be copied
 *  raw into the build just to be deleted again).
 *
 *  Build: a `gzip` asset is written `<name>.gz` ONLY (the live demo fetches it
 *  and gunzips in-browser via DecompressionStream); a non-gzip asset (the
 *  license PDF, which must open in a tab) is copied as-is. Dev: a middleware
 *  serves them from /samples at their root URLs, incl. the on-the-fly `.gz`.
 *  The `.gz` is served as OPAQUE bytes (no `Content-Encoding: gzip`) so the
 *  client-side DecompressionStream sees the compressed stream, not a decoded one. */
function sampleAssets(assets: { name: string; type: string; gzip?: boolean }[]): Plugin {
  const dir = resolve(import.meta.dirname, 'samples');
  let outDir = 'dist';
  return {
    name: 'sample-assets',
    configResolved(cfg) {
      outDir = cfg.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        for (const a of assets) {
          const src = resolve(dir, a.name);
          if (url === `/${a.name}` && existsSync(src)) {
            res.setHeader('Content-Type', a.type);
            res.end(readFileSync(src));
            return;
          }
          if (a.gzip && url === `/${a.name}.gz` && existsSync(src)) {
            res.setHeader('Content-Type', 'application/gzip');
            res.end(gzipSync(readFileSync(src), { level: 9 }));
            return;
          }
        }
        next();
      });
    },
    closeBundle() {
      for (const a of assets) {
        const src = resolve(dir, a.name);
        if (!existsSync(src)) {
          this.warn(`sample-assets: samples/${a.name} not found — skipped`);
          continue;
        }
        const bytes = readFileSync(src);
        writeFileSync(
          resolve(import.meta.dirname, outDir, a.gzip ? `${a.name}.gz` : a.name),
          a.gzip ? gzipSync(bytes, { level: 9 }) : bytes,
        );
      }
    },
  };
}

const LEGAL_BANNER = `/*!
 * TreDeSpace Web Viewer v${pkg.version}
 * Copyright (c) ${new Date().getFullYear()} Vegar Ringdal. All rights reserved.
 *
 * Use of the hosted application is permitted as-is. Redistribution of this
 * code or a reconstructed form of it, publication of the model format or
 * derived tools to compete with the application, and use of this code or its
 * data for machine-learning training or text and data mining are not
 * permitted. Rights under mandatory law (incl. decompilation for
 * interoperability) are unaffected. See https://tredespace.com — LICENSE.
 */`;

/** Prepend the copyright / no-reverse-engineering notice to every emitted JS
 *  chunk. Vite drops rollupOptions.output.banner and the minifier strips
 *  ordinary comments, so this runs in generateBundle — after minification. */
function legalBanner(): Plugin {
  return {
    name: 'legal-banner',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk') {
          file.code = `${LEGAL_BANNER}\n${file.code}`;
        }
      }
    },
  };
}

/** Docs generation for /docs/: (1) derive the API command reference from
 *  api/tredespace-client.ts into docs/generated/apiData.json so the docs can't
 *  drift from the SDK — runs for dev AND build; (2) on build, copy the SDK
 *  source into the output so hosts can grab it at /docs/tredespace-client.ts;
 *  (3) derive the widget gallery's props reference from src/treDeSpaceUI into
 *  docs/generated/widgetData.json (lenient — no build failures). */
function apiDocs(): Plugin {
  const clientPath = resolve(import.meta.dirname, 'api/tredespace-client.ts');
  let isBuild = false;
  return {
    name: 'api-docs',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    buildStart() {
      writeWidgetDocs();
      const { problems } = writeApiDocs();
      // STRICT: every command must be documented (JSDoc in the SDK + an example
      // in EVENTS.md). Fail the build if not; in dev just warn so iterating on
      // unrelated code isn't blocked.
      if (problems.length) {
        const msg = `API docs out of sync — document these before shipping:\n  ${problems.join('\n  ')}`;
        if (isBuild) {
          this.error(msg);
        } else {
          this.warn(msg);
        }
      }
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'docs/tredespace-client.ts',
        source: readFileSync(clientPath, 'utf8'),
      });
    },
  };
}

/** Package @tredespace/ui (scripts/pack-ui.mjs: tsc emit → npm pack) and ship
 *  the tarball next to the widget gallery, which offers it for download so
 *  hosts can depend on it via `"@tredespace/ui": "file:…"`. Build-only — in
 *  dev the gallery's download card explains the tarball comes from a build. */
function uiPackage(): Plugin {
  return {
    name: 'ui-package',
    apply: 'build',
    generateBundle() {
      const { tgzPath, fileName } = packUi();
      this.emitFile({ type: 'asset', fileName: `docs/${fileName}`, source: readFileSync(tgzPath) });
    },
  };
}

export default defineConfig({
  base: './',
  define: {
    // package.json version, baked in at build/dev time (Console banner)
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // keep in sync with "paths" in tsconfig.json
  resolve: { alias: { '@treDeSpaceUI': resolve(import.meta.dirname, 'src/treDeSpaceUI') } },
  // basicSsl serves the dev server over HTTPS (self-signed) so the deployed
  // HTTPS viewer can embed this dev instance as an External-app dialog without
  // mixed-content blocking. Dev-only (apply: 'serve'); never in the build.
  plugins: [
    react(),
    tailwindcss(),
    buildVersion(),
    legalBanner(),
    basicSsl(),
    apiDocs(),
    uiPackage(),
    // demo samples live in /samples (not public/); GLB shipped gzipped, PDF raw.
    sampleAssets([
      { name: 'HuldraDemo.glb', type: 'model/gltf-binary', gzip: true },
      { name: 'EquinorDemoLicense.pdf', type: 'application/pdf' },
    ]),
  ],
  // Workers bundle through a separate pipeline that does not inherit `plugins`,
  // so the legal banner has to be registered here too (cooker, modeldb, the
  // *2glb importers).
  worker: { plugins: () => [legalBanner()] },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        // the app + the API demo host page (dist/demo/ — shipped so hosts can
        // try the postMessage API against a deployed viewer)
        main: resolve(import.meta.dirname, 'index.html'),
        demo: resolve(import.meta.dirname, 'demo/index.html'),
        // combined product page + API docs + live demo (dist/docs/). The docs
        // page renders apiData.json (generated by apiDocs()); the demo embeds
        // the viewer at ../ and drives it with the copy-paste SDK.
        docs: resolve(import.meta.dirname, 'docs/index.html'),
        docsEvents: resolve(import.meta.dirname, 'docs/events.html'),
        docsDemo: resolve(import.meta.dirname, 'docs/demo.html'),
        // live gallery of the @treDeSpaceUI component library (internal ref)
        docsWidgets: resolve(import.meta.dirname, 'docs/widgets.html'),
      },
    },
  },
  server: {
    fs: {
      // allow /@fs/ access to the sample folders (dev auto-load mode)
      allow: ['.'],
    },
    watch: {
      // the Rust reference tree is huge (target/ especially) and never affects
      // the web build — watching it exhausts inotify watchers
      ignored: ['**/rust_src/target/**'],
    },
  },
});
