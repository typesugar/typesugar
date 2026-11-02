---
"@typesugar/macros": patch
---

`validator<T>()` validates a primitive or literal `T`

`validator<string | number>()` emitted an object validator: it failed any value
that was not an object ("Expected object, got string") and then checked the
apparent members `toString`, `valueOf` and `toLocaleString`, so it rejected
every value the type allows. A `T` whose members are all primitives or
literals (`string | number`, `"a" | "b"`, `boolean | undefined`, an enum) is
now checked as a whole, failing with `Expected string | number, got object`.
Object types are validated as before.
