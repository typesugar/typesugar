---
"@typesugar/std": patch
"@typesugar/core": patch
---

`import "@typesugar/std/syntax/do"` is removed from the compiled output once the file's comprehensions are expanded, as `syntax/match` already was. It only activates the `let:`/`par:` labels; left in, it made `@typesugar/std` a runtime dependency of every do-notation user and loaded std's instances for nothing. A comprehension that calls one of those instances (static-style `Iterable`/`AsyncIterable`) still imports it by name.
