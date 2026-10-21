---
"@typesugar/macros": patch
"@typesugar/core": patch
---

`derived<Eq<Readonly<Point>>>()`, `Partial<Point>`, `Record<"a" | "b", number>`,
`Pick<Point, "x">` and the lib's other utility types were refused as
"built-in" (TS9106), because the check read the type's alias, which the lib
declares. It now reads the resolved type's own symbol: only an interface or
class declared in TypeScript's lib (Array, ReadonlyArray, Map, Set, Date,
Promise, ...) is a built-in, so the utility types derive from their fields,
and an alias of a built-in (`type Nums = number[]`) is refused like the
built-in itself instead of being "derived" from `__@unscopables`.
