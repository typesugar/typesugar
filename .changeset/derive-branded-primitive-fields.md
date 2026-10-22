---
"@typesugar/macros": patch
---

Derived instances treat a branded primitive field (`number & { readonly __brand: "ProductId" }`,
a `Newtype<number, "UserId">`, `string & {}`) as the primitive it is. Derived `Eq` rejected such a
field ("Cannot derive Eq for 'Product'", TS9106, with "ProductId lacks Eq" in the trace), and
derived `Clone` copied it with an object spread (`id: { ...a.id }`), which turns a number into `{}`.
Now `Eq` compares it with `===` and `Clone` keeps the value.
