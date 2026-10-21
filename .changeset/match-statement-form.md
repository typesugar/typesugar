---
"@typesugar/std": minor
"@typesugar/core": minor
"@typesugar/transformer-core": minor
"@typesugar/macros": minor
---

`match: switch` — the statement form of pattern matching. A `match:` label on
a `switch` (activated by `import "@typesugar/std/syntax/match"`) keeps the
switch, with arm bodies in place and plain `break`/`return`/`continue`/
`throw`/fallthrough, and adds the exhaustiveness check (TS9226, as for the
fluent form):

- literal cases (literals, consts, enum members) compile to the same switch,
  label removed: the JavaScript is the hand-written switch;
- destructuring cases (`case { type: "Point", coordinates: [x, y] }:`)
  compile to a switch on the shared discriminant with the bindings
  destructured in a block per case; built-in extractors (`case Some(v):`)
  work too, and cases with no shared discriminant compile to `switch (true)`;
- `default:` covers the rest, except one that only throws (a runtime safety
  net), which keeps the check; an unreachable `default:` is a warning.

Supporting changes: `LabeledBlockMacro.statement` (`"block"` | `"switch"`)
selects the statement a label attaches to; `erasableSyntaxModule` removes a
marker-only activation import from the output; a `MatchSwitch` diagnostic
suppression rule hides TS2304/TS18004 for names a case binds and TS7028 on the
`match` label in files that activate it.
