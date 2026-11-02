---
"@typesugar/macros": patch
"@typesugar/core": patch
---

A derived `Clone` of a class returns an instance of that class: the copy is
created with the original's prototype (`Object.create(Object.getPrototypeOf(a))`)
and its own fields copied onto it, so methods, getters, `instanceof` and a
subclass's overrides work on the clone. It used to be a plain object typed as
the class. A class whose instances can't be copied field by field, one with a
`#private` member (or an `accessor` field) or one that extends a built-in such
as `Map`, is now a TS9106 error that says why, instead of a broken clone.

Generated code no longer prints a comment from the user's file inside an empty
argument list (a derived `Map` clone printed `v.slice(/** @derive(Clone) */)`):
`stripPositions` and the derivation parser reset node lists' positions too.
