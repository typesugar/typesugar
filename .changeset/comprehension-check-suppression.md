---
"@typesugar/macros": patch
---

`typesugar check` and `typesugar build` no longer fail on do-notation. They type-check the
code as written, where a `let:`/`par:` comprehension is not valid TypeScript, and reported
TS1214 on the `let`/`yield` labels, TS2304 on every bound name and TS2363 on every `a << e`
(TS2869 on `a << e ?? fallback`), in every position; `build` exited 1 although its output was
right. A new ComprehensionBlock rule hides exactly what the syntax causes, in files that
activate the labels: the labels, a bind's `<<`, a bound name where the expansion declares it
(and, when it also names an outer declaration such as the DOM's `name`, the errors from that
declaration's type), and the expression-position preprocessor's `__letyield_N` tag, which
`typesugar watch` reported. An unknown name, a wrong argument, or a bound name used where it
isn't bound is still reported. A use of a bound name (`user.nme`) is type-checked only by the
editor and `typesugar check --strict`, which check the expansion.
