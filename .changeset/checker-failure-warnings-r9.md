---
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
---

The rest of the places that caught a type-checker failure and quietly degraded now say so with one
warning: `@reflect`'s metadata (a field's type was silently "unknown", or every field was left out),
matching an instance against a type's default type arguments (the instance was silently not found),
following an imported instance's alias before inlining it, and specialization's symbol comparisons,
primitive-instance test, body lookup and return-type-driven specialization (the call was silently not
specialized). A repeat of the same failure is not warned again. A specialized call whose callee has no
symbol is no longer cached under the callee's name, which two different functions of that name could
share.
