// Boolean search expressions for asset filtering:
//   `a | b`         a OR b
//   `a & b`         a AND b
//   `(a & b) | c`   parentheses group
// Terms are matched case-insensitively against a set of haystacks (name +
// folder). Mode 'contains' = substring; mode 'equals' = whole-string match
// where `*` is a wildcard (so `/AF*-PIPE` works).

type Node = { kind: 'or' | 'and'; a: Node; b: Node } | { kind: 'term'; text: string } | { kind: 'all' }; // empty term — matches everything (tolerant parsing)

function parse(input: string): Node {
  let pos = 0;
  const skipWs = () => {
    while (input[pos] === ' ') {
      pos++;
    }
  };
  const peek = () => {
    skipWs();
    return input[pos];
  };
  const eat = () => input[pos++];

  // term = everything up to an operator/paren, trimmed
  const term = (): Node => {
    let out = '';
    while (pos < input.length && !'&|()'.includes(input[pos])) {
      out += eat();
    }
    const text = out.trim();
    return text ? { kind: 'term', text } : { kind: 'all' };
  };

  const atom = (): Node => {
    if (peek() === '(') {
      eat();
      const inner = or();
      if (peek() === ')') {
        eat(); // tolerate a missing close paren
      }
      return inner;
    }
    return term();
  };

  const and = (): Node => {
    let left = atom();
    while (peek() === '&') {
      eat();
      left = { kind: 'and', a: left, b: atom() };
    }
    return left;
  };

  const or = (): Node => {
    let left = and();
    while (peek() === '|') {
      eat();
      left = { kind: 'or', a: left, b: and() };
    }
    return left;
  };

  const root = or();
  return root;
}

function termMatcher(text: string, mode: 'contains' | 'equals'): (hay: string) => boolean {
  const t = text.toLowerCase();
  if (mode === 'contains') {
    return (hay) => hay.includes(t);
  }
  // equals: whole-string match with `*` wildcards
  const rx = new RegExp(`^${t.split('*').map(escapeRx).join('.*')}$`);
  return (hay) => rx.test(hay);
}

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Compile a search expression into a predicate over haystack strings
 *  (a row matches when ANY haystack satisfies the expression's terms). */
export function compileSearch(input: string, mode: 'contains' | 'equals'): (haystacks: string[]) => boolean {
  const trimmed = input.trim();
  if (!trimmed) {
    return () => true;
  }
  const root = parse(trimmed);
  const evalNode = (n: Node, hays: string[]): boolean => {
    switch (n.kind) {
      case 'all':
        return true;
      case 'term': {
        const m = termMatcher(n.text, mode);
        return hays.some(m);
      }
      case 'and':
        return evalNode(n.a, hays) && evalNode(n.b, hays);
      case 'or':
        return evalNode(n.a, hays) || evalNode(n.b, hays);
    }
  };
  return (haystacks) => {
    const hays = haystacks.map((h) => h.toLowerCase());
    return evalNode(root, hays);
  };
}
