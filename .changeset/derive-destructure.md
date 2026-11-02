---
"@typesugar/std": minor
"@typesugar/transformer-core": patch
---

`@derive(Destructure)` gives your own types extractor patterns. On a product
interface (or object type alias) it generates a constructor function named
after the type, `Point(x, y)`, and a `Destructure` instance binding the fields
in declaration order (`@destructure always -> x, y`). On a discriminated union
it generates one per variant, named after the variant's interface or, for an
inline variant, its tag in PascalCase (`{ kind: "circle"; r }` → `Circle(r)`),
testing the discriminant. So `case Point(x, y)`, `.case(Circle(r))` and
`Point(1, 2)` all work, in the same file and from other files, and a library's
`.d.ts` declares the functions and instances for its consumers.

Patterns compile to field reads and discriminant checks and never reference the
generated function or instance, so a bundler drops them when only patterns use
them. Ambiguous cases are compile errors: several candidate discriminants, a tag
that makes no name or a duplicate one, `extends` clauses, a name some value
(or global) already has, a class.

`@derive` now emits derive-generated function declarations before the rest of
a declaration's derive output, so `@derive(Eq, Destructure)` can merge the
function `Point` with the companion namespace `Point` (TypeScript requires the
function first).
