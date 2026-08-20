// gen-api-docs.mjs — derive the docs command reference from the SDK itself, so
// the docs cannot drift from `api/tredespace-client.ts`. Extracts, per public
// method: its JSDoc description, its TypeScript signature, and the protocol
// command it sends (the string in `this.send('…')`). Also pulls the exported
// interfaces (payload/response shapes) with their field docs.
//
// Output: docs/generated/apiData.json — imported and rendered by docs/events.ts.
// Run standalone (`node scripts/gen-api-docs.mjs`) or via the Vite plugin.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const CLIENT = resolve(root, 'api/tredespace-client.ts');
const EVENTS = resolve(root, 'EVENTS.md');
const OUT = resolve(root, 'docs/generated/apiData.json');

/** Harvest the payload/response example under each `### command` heading in
 *  EVENTS.md, keyed by command name. Keeps examples single-sourced there
 *  instead of hand-copied into the docs. Shared headings ('a.set / a.add')
 *  attach the same block to every command they list. */
function parseExamples() {
  const md = readFileSync(EVENTS, 'utf8');
  const byCommand = new Map();
  // split into '### …' sections
  const sections = md.split(/^### /m).slice(1);
  for (const sec of sections) {
    const heading = sec.slice(0, sec.indexOf('\n'));
    const commands = heading.match(/[a-z][\w]*(?:\.[\w]+)+/g) ?? [];
    if (!commands.length) continue;
    const fence = sec.match(/```(?:js|ts|json)?\n([\s\S]*?)```/);
    if (!fence) continue;
    const example = fence[1].replace(/\s+$/, '');
    for (const cmd of commands) if (!byCommand.has(cmd)) byCommand.set(cmd, example);
  }
  return byCommand;
}

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

/** First `this.send('command', …)` string inside a method body, if any. */
function commandOf(methodText) {
  const m = methodText.match(/\.send(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

/** Strip block comments and collapse whitespace (signature source often has
 *  inline /** …*​/ JSDoc from the interface fields). */
function cleanText(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim();
}

/** Split on `sep` only at bracket depth 0. Tracks ()[]{} but NOT <> (so `=>`
 *  and generics don't confuse a `;` split). */
function splitTopLevel(str, sep) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of str) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Pretty-print the first (outermost) inline object literal in `str` across
 *  indented lines, recursing into nested objects. `indent` is the column the
 *  closing brace lands on. Strings without a `{` come back unchanged. */
function expandObject(str, indent) {
  const s = str.indexOf('{');
  if (s === -1) return str;
  let depth = 0;
  let e = -1;
  for (let i = s; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}') {
      depth--;
      if (depth === 0) {
        e = i;
        break;
      }
    }
  }
  if (e === -1) return str;
  const head = str.slice(0, s);
  const tail = str.slice(e + 1);
  const pad = ' '.repeat(indent);
  const padIn = ' '.repeat(indent + 2);
  const members = splitTopLevel(str.slice(s + 1, e), ';')
    .map((m) => m.trim())
    .filter(Boolean);
  const inner = members.map((m) => `${padIn}${expandObject(m, indent + 2)};`).join('\n');
  return `${head}{\n${inner}\n${pad}}${tail}`;
}

/** One line when short; otherwise break params AND the return type, expanding
 *  any inline object literals for readability. */
function formatSignature(name, params, ret) {
  const oneLine = `${name}(${params.join(', ')}): ${ret}`;
  if (oneLine.length <= 76) return oneLine;
  const lines = params.map((p, i) => `  ${expandObject(p, 2)}${i < params.length - 1 ? ',' : ''}`);
  return `${name}(\n${lines.join('\n')}\n): ${expandObject(ret, 0)}`;
}

/** Split an EVENTS.md example into its payload / response object text.
 *  Line comments (` // …`) are stripped from the payload so brace matching and
 *  key parsing aren't confused by notes like `// or {} to just query`. */
function splitExample(ex) {
  const r = ex.match(/(^|\n)\s*response\s*:\s*([\s\S]*)$/);
  let payloadText = r ? ex.slice(0, r.index) : ex;
  const responseText = r ? r[2].trim() : '';
  payloadText = payloadText
    .replace(/^\s*payload\s*:\s*/, '')
    .replace(/\s+\/\/[^\n]*/g, '') // drop trailing line comments (keeps http:// etc.)
    .trim();
  return { payloadText, responseText };
}

/** Split on `sep` at depth 0, skipping string contents. */
function splitAware(str, sep) {
  const out = [];
  let depth = 0;
  let cur = '';
  let q = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (q) {
      cur += ch;
      if (ch === q && str[i - 1] !== '\\') q = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Top-level key → raw-value-text pairs of an object literal (comments stripped). */
function objectPairs(objText) {
  const s = objText.indexOf('{');
  const e = objText.lastIndexOf('}');
  if (s === -1 || e < s) return [];
  // whitespace-guarded line-comment strip so `https://…` in a value survives
  const inner = objText.slice(s + 1, e).replace(/\s+\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const pairs = [];
  for (const raw of splitAware(inner, ',')) {
    const m = raw.trim();
    if (!m) continue;
    const ci = m.indexOf(':');
    if (ci === -1) continue;
    pairs.push([m.slice(0, ci).trim().replace(/^['"]|['"]$/g, ''), m.slice(ci + 1).trim()]);
  }
  return pairs;
}

function paramInfo(p) {
  const ci = p.indexOf(':');
  const namePart = (ci === -1 ? p : p.slice(0, ci)).trim();
  const type = ci === -1 ? '' : p.slice(ci + 1).trim();
  return { name: namePart.replace(/\?$/, '').trim(), optional: namePart.endsWith('?'), isObject: type.startsWith('{'), type };
}

/** Build an accurate `client.method(args)` from the method's params and the
 *  wire payload — first named params, remaining keys → the trailing opts
 *  object. A lone object param takes the whole payload (bytes injected). */
function buildCall(name, params, payloadText) {
  const pinfos = params.map(paramInfo);
  if (!pinfos.length) return `client.${name}()`;
  if (pinfos.length === 1 && pinfos[0].isObject) {
    let obj = payloadText.trim() || '{}';
    if (/\bbytes\b/.test(pinfos[0].type) && !/\bbytes\b/.test(obj)) obj = obj.replace(/^\{\s*/, '{ bytes, ');
    return `client.${name}(${obj})`;
  }
  const pairs = objectPairs(payloadText);
  const map = new Map(pairs.map(([k, v]) => [k, v]));
  const consumed = new Set();
  const args = [];
  for (const pi of pinfos) {
    if (pi.isObject) {
      const rest = pairs.filter(([k]) => !consumed.has(k));
      rest.forEach(([k]) => consumed.add(k));
      if (rest.length) args.push(`{ ${rest.map(([k, v]) => `${k}: ${v}`).join(', ')} }`);
      else if (!pi.optional) args.push('{}');
    } else if (map.has(pi.name)) {
      args.push(map.get(pi.name));
      consumed.add(pi.name);
    } else if (!pi.optional) {
      args.push('…');
    }
  }
  return `client.${name}(${args.join(', ')})`;
}

/** Turn an EVENTS.md payload/response example into a runnable call sample. */
function toSample(name, params, exampleText) {
  try {
    const { payloadText, responseText } = splitExample(exampleText);
    if (!responseText) return null;
    // Some sections show the raw postMessage envelope (e.g. sql.import, to
    // illustrate transferables) rather than a plain payload — leave those as-is.
    if (/postMessage|tredespace\s*:/.test(payloadText) || !/^[[{]/.test(payloadText)) return null;
    const call = buildCall(name, params, payloadText);
    return `const res = await ${call};\n// res.data →\n${responseText}`;
  } catch {
    return null;
  }
}

export function generateApiDocs() {
  const src = readFileSync(CLIENT, 'utf8');
  const sf = ts.createSourceFile('tredespace-client.ts', src, ts.ScriptTarget.Latest, true);
  const examples = parseExamples();

  const methods = [];
  const types = [];
  let protocol = null;

  const visit = (node) => {
    // protocol constant
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (decl.name.getText(sf) === 'TREDESPACE_PROTOCOL' && decl.initializer) {
          protocol = decl.initializer.getText(sf);
        }
      }
    }

    // exported interfaces → payload/response shapes
    if (ts.isInterfaceDeclaration(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      types.push({
        name: node.name.getText(sf),
        kind: 'interface',
        doc: jsdocText(node),
        fields: node.members.map((mem) => ({
          text: mem.getText(sf).replace(/\s+/g, ' ').trim(),
          doc: jsdocText(mem),
        })),
      });
    }

    // exported type aliases (e.g. ImportFormat unions) → linkable named types
    if (ts.isTypeAliasDeclaration(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      types.push({
        name: node.name.getText(sf),
        kind: 'alias',
        doc: jsdocText(node),
        def: cleanText(node.type.getText(sf)),
      });
    }

    // TredespaceClient public methods
    if (ts.isClassDeclaration(node) && node.name?.getText(sf) === 'TredespaceClient') {
      for (const mem of node.members) {
        if (!ts.isMethodDeclaration(mem)) continue;
        const mods = mem.modifiers ?? [];
        const isPrivate = mods.some(
          (m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword,
        );
        const name = mem.name.getText(sf);
        if (isPrivate || name === 'send') continue;

        const params = mem.parameters.map((p) => cleanText(p.getText(sf)));
        const ret = mem.type ? cleanText(mem.type.getText(sf)) : 'void';
        const command = commandOf(mem.getText(sf));
        const example = command ? (examples.get(command) ?? null) : null;
        methods.push({
          name,
          command,
          signature: formatSignature(name, params, ret),
          doc: jsdocText(mem),
          example,
          sample: example ? toSample(name, params, example) : null,
        });
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  // group methods by command namespace (prefix before the first dot); methods
  // with no command (ready, dispose, on*, helpers) go under 'client'.
  const groupsMap = new Map();
  for (const m of methods) {
    const ns = m.command ? m.command.split('.')[0] : 'client';
    if (!groupsMap.has(ns)) groupsMap.set(ns, []);
    groupsMap.get(ns).push(m);
  }
  const groups = [...groupsMap.entries()].map(([ns, ms]) => ({ ns, methods: ms }));

  // STRICT: a command-bearing method must carry JSDoc (feeds the docs) AND have
  // a payload/response example in EVENTS.md. This is what enforces "changing the
  // SDK requires updating EVENTS.md + docs" — the build fails otherwise.
  const problems = [];
  for (const m of methods) {
    if (!m.command) continue;
    if (!m.doc.trim()) problems.push(`${m.command} (${m.name}): no JSDoc in api/tredespace-client.ts`);
    if (!m.example) problems.push(`${m.command}: no payload/response example in EVENTS.md`);
  }

  return {
    protocol,
    generatedFrom: 'api/tredespace-client.ts',
    groups,
    types,
    methodCount: methods.length,
    problems,
  };
}

export function writeApiDocs() {
  const data = generateApiDocs();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const d = writeApiDocs();
  console.log(`wrote ${OUT} — ${d.methodCount} methods, ${d.groups.length} namespaces, ${d.types.length} types`);
  if (d.problems.length) {
    console.error(`\n✗ ${d.problems.length} undocumented command(s):`);
    for (const p of d.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
}
