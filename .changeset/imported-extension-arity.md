---
"@typesugar/core": patch
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
---

An imported function is an extension for `recv.method(args)` only when it can take the rewritten call: the receiver plus the call's arguments (any number with a spread argument). Found porting remeda: a generic first parameter accepts almost any receiver, so remeda's one-parameter `isArray<T>(data: ArrayLike<unknown> | T)` matched `Array.isArray(c)`, and for a method the receiver lacks the same mismatch could pick an import that can't take the call over one that can, or report a false ambiguity between them. The rewrite, the `ExtensionMethodCall` diagnostic rule and the unused-import check share the check, so `typesugar check` keeps the TS2339 of a call no import can take.
