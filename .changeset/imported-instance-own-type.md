---
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
---

An imported typeclass instance is an extension provider only for its own type: with a numeric
enum `Color` and `import { showColor }` (an `@impl Show<Color>`), `n.show()` on `n: number`
became `showColor.show(n)`, because `number` is assignable to `Color`. The receiver must now be
the instance's type by identity (literal receivers such as `Color.Red` are widened first); other
imported objects are unaffected. `InstanceScanner.scanValueDeclaration` reads one value
declaration as an instance, and `isTypeclassDeclared` is exported.
