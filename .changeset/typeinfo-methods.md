---
"@typesugar/macros": patch
"@typesugar/reflect": patch
---

`typeInfo<T>()` reports methods. `TypeInfo` declares `methods`, but the emitted literal had none,
so `typeInfo<Calculator>().methods` was `undefined` and the methods were listed as fields. A
class's methods and an interface's method signatures now go to `methods`, with each parameter's
name, type and optionality and the return type as the type checker gives them (as the `@reflect`
class metadata already does); a function-valued property stays a field.
