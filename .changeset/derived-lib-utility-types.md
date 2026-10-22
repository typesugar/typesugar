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
built-in itself instead of being "derived" from `__@unscopables`. A utility type over a built-in
(`Readonly<Map<string, number>>`, `Readonly<Set<T>>`, `Partial<Date>`, or an alias of one) is a
built-in too, TS9106, instead of being derived from the built-in's internals
(`a["__@toStringTag@24"]`). Decided by the type the utility maps, by symbol: a user interface that
extends a lib type (`interface AppError extends Error { code: number }`) is not a built-in, and
`Readonly<AppError>` derives like `AppError` does, though some of its properties are declared in
lib's `Error`.
