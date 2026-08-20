// gen-widget-docs.mjs — derive the /docs/ widget-gallery props reference from
// the @treDeSpaceUI sources themselves, so the gallery's docs cannot drift.
// Extracts every interface (and type alias) from the widgets folder plus the
// dockable types, with per-member JSDoc. Non-exported base interfaces
// (LabelledProps, BaseProps, BaseNode…) are inlined into their children so the
// docs show the full prop surface a caller actually sees.
//
// Output: docs/generated/widgetData.json — imported and rendered by
// docs/widgets.tsx. Lenient by design (an undocumented prop just renders
// without a description): this is an internal reference, unlike the strict
// postMessage API docs (gen-api-docs.mjs).
//
// Run standalone (`node scripts/gen-widget-docs.mjs`) or via the Vite plugin.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const WIDGETS_DIR = resolve(root, 'src/treDeSpaceUI/widgets');
const EXTRA_FILES = [
  resolve(root, 'src/treDeSpaceUI/dockable/types.ts'),
  resolve(root, 'src/treDeSpaceUI/hotkeys/engine.ts'),
  resolve(root, 'src/treDeSpaceUI/hotkeys/hotkeys.state.ts'),
];
const OUT = resolve(root, 'docs/generated/widgetData.json');

/** Flatten a JSDoc comment (string | NodeArray) to plain text. */
function jsdocText(node) {
  const docs = ts.getJSDocCommentsAndTags?.(node) ?? [];
  for (const d of docs) {
    if (ts.isJSDoc(d) && d.comment) {
      return typeof d.comment === 'string'
        ? d.comment.trim()
        : d.comment.map((c) => c.text ?? '').join('').trim();
    }
  }
  return '';
}

const isExported = (node) => node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;

export function generateWidgetDocs() {
  // Widgets live either flat or one-folder-per-multi-file-widget — walk both.
  const files = [
    ...readdirSync(WIDGETS_DIR, { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.tsx?$/.test(f) && f !== 'index.ts')
      .map((f) => resolve(WIDGETS_DIR, f)),
    ...EXTRA_FILES,
  ];

  /** name → { doc, exported, extends, fields: [{ text, doc }] } */
  const interfaces = new Map();
  /** name → { doc, def } */
  const aliases = new Map();

  for (const file of files) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (ts.isInterfaceDeclaration(node)) {
        interfaces.set(node.name.getText(sf), {
          doc: jsdocText(node),
          exported: isExported(node),
          extends: node.heritageClauses?.flatMap((h) => h.types.map((t) => t.getText(sf))).join(', ') || null,
          fields: node.members.map((mem) => ({
            text: mem.getText(sf).replace(/\s+/g, ' ').trim(),
            doc: jsdocText(mem),
          })),
        });
      }
      if (ts.isTypeAliasDeclaration(node)) {
        aliases.set(node.name.getText(sf), {
          doc: jsdocText(node),
          def: node.type.getText(sf).replace(/\s+/g, ' ').trim(),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  // Inline non-exported bases (one level is all the tree has): the reader sees
  // the props a caller can actually pass, and the meaningless private name
  // disappears from the heritage line.
  for (const t of interfaces.values()) {
    const baseName = t.extends?.match(/^([A-Za-z_$][\w$]*)$/)?.[1];
    const base = baseName ? interfaces.get(baseName) : undefined;
    if (base && !base.exported) {
      t.fields = [...t.fields, ...base.fields];
      t.extends = null;
    }
  }

  return {
    generatedFrom: 'src/treDeSpaceUI',
    types: Object.fromEntries([...interfaces].map(([name, { exported, ...t }]) => [name, t])),
    aliases: Object.fromEntries(aliases),
    typeCount: interfaces.size,
  };
}

export function writeWidgetDocs() {
  const data = generateWidgetDocs();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const d = writeWidgetDocs();
  console.log(`wrote ${OUT} — ${d.typeCount} types, ${Object.keys(d.aliases).length} aliases`);
}
