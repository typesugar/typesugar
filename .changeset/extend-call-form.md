---
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
---

`extend(value).method(args)` falls back to the ordinary method-call rewrite when no typeclass
instance or registered extension matches: it used to emit a new `value.method(args)` node that the
visitor never rewrote, so `extend(150).clamp(0, 100)` with std's import-scoped `clamp` became
`150..clamp(0, 100)` and threw at run time. On an unconstrained type parameter it is now an error
that says to take the instance as a parameter (`S: Show<T> = implicit()`), instead of a silent
`x.show()`. `const e = extend(x)` stays an error by design (extend() compiles to a direct call, so
there is no wrapper value), and its message now names the value and method and says what to write
instead. Import-scoped extensions are also found for a call a macro rebuilt with `factory.update*`.
