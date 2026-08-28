# Model Assets search — how the filter expressions work

This describes the search box in the **Model Assets** panel of the TreDeSpace
viewer: the expression grammar (`&`, `|`, parentheses, `*`), what each asset
is matched against, and how a match relates to the parent folders and stores
the tree shows. Implementation: `src/lib/searchExpr.ts` (the parser/matcher)
and `src/components/panels/model-assets/useAssetsLibrary.ts` (what it is
applied to and how the tree is rebuilt).

> Scope: this grammar is the **Model Assets** panel's search. The
> **Hierarchy** panel's search box is a different, plain matcher (contains /
> equals on entry names via the worker) — `&`, `|` and parentheses have no
> special meaning there.

## 1. What is being searched

The Model Assets tree is: **store** (a project) → **folders** (nested,
`A/B/C`) → **assets** (the imported model files). Only assets are searched.
Each asset is matched independently against **three strings**:

| haystack | example        | meaning                                   |
| -------- | -------------- | ----------------------------------------- |
| `name`   | `AF000-PIPE`   | the asset's display name                  |
| `folder` | `Topside/Deck2`| its full folder path inside the store     |
| `store`  | `project-x`    | the store (project) it lives in           |

Matching is **case-insensitive** on all three.

## 2. The grammar

```
expr   := and ( '|' and )*          -- OR, lowest precedence
and    := atom ( '&' atom )*        -- AND, binds tighter than OR
atom   := '(' expr ')' | term
term   := any text up to '&' '|' '(' ')' , trimmed
```

- `a | b` — **OR**: either side satisfies it.
- `a & b` — **AND**: both sides must be satisfied.
- `(…)` — grouping. `&` binds tighter than `|`, so `a | b & c` means
  `a | (b & c)`; use parentheses when you mean `(a | b) & c`.
- Spaces inside a term are part of the term (`pipe rack` is one term that
  must appear as that substring). Spaces around operators are ignored.
- There is **no NOT** operator.
- Parsing is tolerant: an empty term (`a & `) matches everything, and a
  missing closing parenthesis is accepted.

### Two match modes (the "Equals" toggle next to the search box)

| mode                     | rule                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| **contains** (default)   | the term is a substring of the haystack                              |
| **equals** ("Equals" on) | the term must equal the *whole* haystack; `*` is a wildcard (any run) |

In equals mode `/AF*-PIPE` matches the name `/AF000-PIPE` but not
`/AF000-PIPE_VAT`. In contains mode `*` is a literal character.

## 3. How a term is evaluated against the three haystacks

This is the part that matters for "parent and child": **each term is
evaluated against all three strings, and it is satisfied if ANY of them
matches.** The boolean operators then combine those per-term results for the
asset.

So for an asset `name = AF000-PIPE`, `folder = Topside/Deck2`,
`store = project-x`:

| query                    | satisfied? | why                                                            |
| ------------------------ | ---------- | -------------------------------------------------------------- |
| `pipe`                   | yes        | term matches the name                                          |
| `deck2`                  | yes        | term matches the folder                                        |
| `project`                | yes        | term matches the store                                         |
| `pipe & deck2`           | yes        | `pipe` hits the name, `deck2` hits the folder — different      |
|                          |            | haystacks are fine, each term only needs *some* hit            |
| `pipe & valve`           | no         | `valve` hits nothing                                           |
| `pipe \| valve`          | yes        | `pipe` hits                                                    |
| `(deck1 \| deck2) & pipe`| yes        | grouping: a Deck1-or-Deck2 asset whose name contains pipe      |

Consequence of "any haystack": a term never has to say *which* field it
targets, and there is no way to force a term onto one field. `pipe & pipe` is
the same as `pipe`. If a folder is named `PIPE`, then `pipe` shows every asset
in that folder regardless of their names.

## 4. Parents and children — what the tree shows during a search

The tree is rebuilt from the **matching assets only**, then the folders and
stores are derived from them:

1. Every asset is tested with the expression (section 3).
2. For each store, the **matching** assets are grouped back into their folder
   paths. A folder appears **only if at least one matching asset lives under
   it** — folders are never matched themselves, they are *implied* by their
   matching children.
3. A store with no matching asset is **dropped** from the tree entirely.
4. Empty user-created folders (folders with no assets) are omitted while a
   search is active, since nothing can match inside them.
5. The count shown on each store/folder row is the number of matching assets
   beneath it (the same count that shows the total when not searching).
6. Nothing auto-expands: collapsed stores/folders stay collapsed; the counts
   on the collapsed rows tell you where the hits are.

So, in tree terms:

- Matching a **child** (an asset) makes its whole **ancestor chain** appear
  (folder, parent folders, store) — the parents are shown *because* a child
  matched, not because they matched.
- Matching by a **parent's** name (a folder or store name) works because the
  folder path and store name are haystacks of every asset beneath them: the
  term hits the *asset's* folder/store string, so all those assets match, and
  they bring the folder along. `deck2` therefore shows every asset under a
  folder whose path contains `deck2`, at any depth (`Topside/Deck2/Piping`
  also contains it).
- Sibling assets that do not match are simply not listed, even though their
  folder is.
- Folder paths are matched as one string with `/` separators, so
  `topside/deck2` (contains mode) targets that nesting specifically, while
  `deck2` alone matches it anywhere in the path.

## 5. Selection while searching

The selection is global (it spans stores), but the action buttons act on the
**visible** selected assets — "Select all" selects every visible asset, and
Delete / Load / Unload / Export apply to the selected assets that pass the
current filter. Assets selected earlier and now filtered out stay selected but
are not acted on until the filter shows them again.

## 6. Quick reference

```
pipe                    contains "pipe" in name, folder path or store
pipe & deck2            both terms must hit (each may hit a different field)
pipe | valve            either term
(deck1 | deck2) & pipe  grouping; & binds tighter than |
/AF*-PIPE               Equals mode: whole-string match with * wildcards
```

Not supported: NOT / exclusion, field-targeted terms (`name:pipe`), regular
expressions, quoting.
