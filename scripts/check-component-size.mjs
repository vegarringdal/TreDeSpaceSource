#!/usr/bin/env node
// Lists .tsx component files over the style guide's 120-line cap.
// Usage: node scripts/check-component-size.mjs [--strict]
//   --strict  exit 1 when any file is over (for CI once the backlog is clear)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT = 120;
const ROOTS = ['src', 'docs', 'demo'];
const strict = process.argv.includes('--strict');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'wasm') {
        continue;
      }
      yield* walk(p);
    } else if (name.endsWith('.tsx')) {
      yield p;
    }
  }
}

const over = [];
for (const root of ROOTS) {
  for (const f of walk(root)) {
    const lines = readFileSync(f, 'utf8').split('\n').length;
    if (lines > LIMIT) {
      over.push([lines, f]);
    }
  }
}

over.sort((a, b) => b[0] - a[0]);
for (const [lines, f] of over) {
  console.log(`${String(lines).padStart(5)}  ${f}`);
}
console.log(over.length ? `\n${over.length} component file(s) over ${LIMIT} lines` : `all component files within ${LIMIT} lines`);
if (strict && over.length) {
  process.exit(1);
}
