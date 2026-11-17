// Shared syntax highlighter for the gallery (no deps).
// Same token grammar and .hl-* classes as the events page, as React nodes.
import type { ReactNode } from 'react';

const HL_KEYWORDS = new Set([
  'string',
  'number',
  'boolean',
  'void',
  'null',
  'undefined',
  'unknown',
  'any',
  'never',
  'readonly',
  'true',
  'false',
  'interface',
  'type',
  'extends',
  'const',
  'let',
  'await',
  'async',
  'new',
  'return',
  'import',
  'from',
  'export',
  'function',
  'if',
  'else',
]);
const HL_TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\s])/g;

/** TS/JSX source → highlighted spans (theme-aware via the docs .hl-* colors). */
export function hl(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let k = 0;
  code.replace(HL_TOKEN, (m, cm, str, num, id, ws) => {
    if (cm) {
      out.push(
        <span key={k++} className="hl-cm">
          {cm}
        </span>,
      );
    } else if (str) {
      out.push(
        <span key={k++} className="hl-st">
          {str}
        </span>,
      );
    } else if (num) {
      out.push(
        <span key={k++} className="hl-nu">
          {num}
        </span>,
      );
    } else if (id) {
      if (HL_KEYWORDS.has(id)) {
        out.push(
          <span key={k++} className="hl-kw">
            {id}
          </span>,
        );
      } else if (/^[A-Z]/.test(id)) {
        out.push(
          <span key={k++} className="hl-ty">
            {id}
          </span>,
        );
      } else if (/^(?:use|set|on)[A-Z]/.test(id)) {
        out.push(
          <span key={k++} className="hl-fn">
            {id}
          </span>,
        );
      } else {
        out.push(<span key={k++}>{id}</span>);
      }
    } else {
      out.push(<span key={k++}>{ws ?? m}</span>);
    }
    return '';
  });
  return out;
}
