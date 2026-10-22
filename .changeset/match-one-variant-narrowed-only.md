---
"@typesugar/std": patch
---

`match` treated any object type with a literal-typed field as a one-variant
discriminated union, so `interface Cfg { version: 1; name: string }` got
"missing variants: 1 (discriminant: "version")" for arms on `name`, and a
`match: switch` over it reported its `default:` as unreachable. The
one-variant rule now applies only to what it was for: a variable or property
declared as a discriminated union and narrowed to one variant
(`const c: Shape = { kind: "circle", ... }`). A plain object type keeps the
object diagnostics (it needs `.else()`).
