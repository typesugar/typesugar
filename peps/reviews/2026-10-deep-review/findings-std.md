# Findings: std / collections / strings / erased

(Transcribed from reviewer report. Repros: review/std/run2.mjs, t1.ts–t12.ts, run through TransformationPipeline from packages/transformer/dist in strict mode.)
Package status: std flagship; collections frozen but published (graph dep); strings & erased frozen + excluded from release.

1. CRITICAL confirmed — std/src/macros/match.ts:1004-1049 (buildDiscriminantCaseBody), 1083-1090: discriminant switch puts each arm's const bindings directly in case clause; two arms binding same name -> "Identifier 'r' has already been declared". Fix: wrap each clause body (incl default) in f.createBlock(stmts,true).
2. HIGH confirmed — match.ts:1041-1046,1113-1124,1146-1179: guarded arm emits `if (g) return r; break;` -> failing guard leaves switch, IIFE returns undefined (later arms/else/MatchError skipped); trailing catch-all drops .else(); with needsNullGuard fallbackStmts (incl break) copied into plain if -> SyntaxError, and node array reused in two places. Fix: skip switch fast path when any arm or catch-all has a guard; use generateIIFE.
3. HIGH confirmed — match.ts:934-998,1012-1035: switch path accepts arms with one top-level literal prop but only binds (never tests) other props (nested literals, array length, type constructors, extractors, `in`); duplicate discriminant values -> `case "a"` twice. Fix: only use switch when all extra props are variables/wildcards and discriminant values distinct.
4. HIGH confirmed — match.ts:893-903,1189-1199,2383-2393: fluent match always a non-async IIFE; await/yield in arms/guards/else/scrutinee -> SyntaxError. Fix: `await (async () => {...})()` when moved expr contains await; for yield, generator IIFE or diagnostic.
5. HIGH confirmed — match.ts:1210-1240 tryDirectEmit (scrutinee type single literal): `match(next()).case("a").then(1)` -> `1` (next() never called); `.case(m).then(m.length)` -> unbound m; `.case(String(s))` -> else value. Fix: direct-emit only when scrutinee side-effect free, chosen arm is plain literal/wildcard w/o .as(), and all earlier arms literal.
6. HIGH confirmed — match.ts:2436-2591, match-runtime.ts:76-106, data/match-error.ts: object-handler match(value,{...}) macro vs runtime diverge: literal kind chosen from key text (/^\d+$/) so `{true,false}` -> `_m === "true"`, "1"|"2" union -> `_m === 1`; no `_` handler emits MatchError.throw(\_m) which doesn't exist (TypeError); method-shorthand handlers dropped; any-typed value -> `_m.kind ===`; "a|b" keys split by macro not runtime. Fix: literal kind from type; add static throw(v): never; handle MethodDeclaration or error; defer any to runtime; add a|b split in runtime.
7. HIGH confirmed — let-yield.ts:503-514; docs/guides/do-notation.md:98-119: `let:` guards put undefined into Array results (docs promise filtering [2,4]). Fix: per-instance empty value ([] for Array), bind with cond?[inner]:[] or .filter; reject guards for brands without empty.
8. HIGH confirmed — let-yield.ts:238-261,466-470: `let:` without `yield:` nests result F<F<A>> (bind before last uses map though tail is monadic); guards/map steps after last bind dropped. Guide's Some(20) example actually gives Some(Some(20)). Fix: bind method for that step; error or keep steps after last bind.
9. MEDIUM confirmed — let-yield.ts:468,516-601: nested par: inside let: wrong shape for non-Promise (isLastBind ignores parallel groups; join always map; fallback .ap() not on Array; std Array ParCombine builder unused). Fix: count groups as binds; bind after join with following steps; route Array/Iterable via getStdParCombineBuilder.
10. MEDIUM confirmed — typeclasses/flatmap-instances.ts (no @do-methods); let-yield.ts:207: let: over AsyncIterable/plain Iterable emits nonexistent .flatMap/.map. Fix: static calls to instance or @do-methods style=static.
11. MEDIUM confirmed — comprehension-utils.ts:603-611 + par-combine.ts builders: par: with two `_` bindings emits `([_, _]) =>` SyntaxError. Fix: createOmittedExpression for \_, error on other dup names.
12. MEDIUM confirmed — comprehension-utils.ts:364-376 collectReferencedIdentifiers counts property names/object keys/nested fn params as deps (`req.user` flagged as referencing `user`). Fix: skip those or resolve via checker.
13. MEDIUM confirmed(3) — match.ts:516-605,629-732 exhaustiveness: .or() alternatives not counted for discriminated unions (false error); nullable unions classed non-enumerable -> always error; String(s) over literal union false error; `{kind:"a",extra:1}` counted as covering all of "a" (missed error).
14. MEDIUM confirmed(3) — match.ts:1734-1771,1776-1835,1977-1981: sum-variant extractors `_o._tag` no null guard (Option|null with null throws); regex arms `_sn.match` no string check; Array([x,y]) no length check; product extractors `"x" in v` throw on primitives.
15. MEDIUM confirmed — match.ts:1902-1946: .or() arms drop .as() bindings and sub-pattern bindings -> ReferenceError. Fix: emit .as() bindings; error on var binding inside alternative.
16. LOW confirmed — match.ts:354-366: .case(NaN)/.case(Infinity) become catch-all bindings `const NaN = _v`. Fix: literals; Number.isNaN.
17. LOW confirmed — match-runtime.ts:36,103 handler lookup through prototype chain (match("toString",{\_:...})). Fix: hasOwnProperty.
18. MEDIUM confirmed — collections/src/hash-set.ts:58-83, hash-map.ts:76-115: iterators walk live bucket while delete splices (skips entries); NaN add twice -> size 2, has false. std/src/typeclasses/index.ts:47-50,183-185 hashNumber = a|0 (all of (-1,1), NaN, ±Inf -> 0); eqNumber NaN irreflexive; macros/primitives.ts has different hashNumber/hashString same names. Fix: snapshot bucket; primitives.ts-style hash; NaN eq; one set of primitive instances.
19. HIGH (frozen/excluded) confirmed — strings/src/macros.ts:37,49-51 regex uses cooked text: `regex\`^\d+\.\w$\`` -> new RegExp("^d+.w$"). Fix: template.rawText ?? text.
20. HIGH (frozen/excluded) confirmed — strings/src/macros.ts:79-86 html emits \_\_typesugar_escapeHtml without import. Fix: ctx.ensureImport.
21. MEDIUM (frozen/excluded) confirmed — erased/src/macros.ts:199-208,260-266,294-297: erased<[...]>() emits unbound eraseWith/instance names; literal-typed values fail (Eq<42>). Fix: ensureImport; getBaseTypeOfLiteralType.
22. MEDIUM confirmed — std/src/data/range.ts: size(range(0,10,3))=3 (should be 4); size(inclusive(0,0))=0; reversed(range(0,10)) loses 0; reversed(range(0,10,3)) -> [7,4,1].
23. MEDIUM confirmed — extensions/array.ts groupBy/keyBy/countBy/associate (and object.ts invert/fromPairs/mapKeys) use {} -> keys like constructor/toString break. Fix: Object.create(null).
24. MEDIUM confirmed — extensions/object.ts deepEqual: all Dates/Maps/Sets equal; [1] equals {0:1}; NaN != NaN. Fix: compare prototypes; special-case Date/RegExp/Map/Set/typed arrays.
25. MEDIUM confirmed — extensions/array.ts takeRight(arr,0) returns whole array. Fix: n<=0 ? [] : slice(-n).
26. MEDIUM confirmed — extensions/string.ts toBase64/fromBase64 throw on non-Latin-1 and not UTF-8 (global btoa wins over Buffer branch). Fix: TextEncoder + base64 of bytes.
27. MEDIUM confirmed — extensions/date.ts formatDateTime mixes UTC date with local time; dayOfYear off by one across DST. Fix: consistent getters; Date.UTC diffs.
28. MEDIUM confirmed — extensions/promise.ts fallbackTo leaves fallback rejection unhandled; timeout never clears its timer. Fix: fallback.catch(()=>{}) up front; clearTimeout in finally.
29. LOW confirmed — extensions/string.ts unescapeHtml double-decodes (decode &amp; last); stripMargin uses marginChar raw in regex (escapeRegex).
30. LOW — extensions/function.ts memoize JSON key throws on BigInt, conflates undefined/null/NaN; unbounded.
31. LOW — extensions/number.ts: isPrime(4.5) true; 32-bit ops in isPowerOfTwo/toHex/toBin/toOct (toHex(2\*\*32)="0"); digits(n,0|1) and rangeTo(5,1,0) infinite loop; toWords(-0.5) "negative one"; toOrdinal(-1) "-1th"; toFileSize(0.5) "512 undefined".
32. LOW — match.ts:648-654,796-802,1070-1080,1217-1223,1254-1260,2264-2290,2460; comprehension-utils.ts:252-257: checker failures swallowed silently (exhaustiveness skipped with no warning); expandObjectHandlerMatch calls checker w/o isSyntheticNode/try (CLAUDE.md rule 3). Fix: isSyntheticNode check + one reportWarning per catch.

## 1.0 gaps

- Match tests never execute generated code (PEP-019 tests only check output contains "switch"). Add execution tests for every fast path (ternary, switch, discriminant switch, direct emit).
- do-notation guide documents results the macro doesn't produce (guard filtering, implicit yield, Iterable/AsyncIterable rows, nested par: for non-Promise).
- TS9222 help suggests invalid syntax `const result = let: {...} yield: {...}`.
- Two independent primitive Eq/Ord/Hash instance sets (std typeclasses/index.ts vs macros primitives.ts) with differing semantics.
- Bounded<bigint> claims ±MAX_SAFE_INTEGER; boundedString returns "￿".repeat(256).
- ordNumber vs eqNumber disagree on NaN.
- HashSet/HashMap iterate in bucket order not insertion order (contradicts "drop-in").
- fmt inconsistent with/without interpolations re %d/%s; undocumented.
- strings package.json description lists nonexistent "json" macro.
- erased equals/compare apply left's vtable to right (asymmetric on heterogeneous lists).
- Stale comment in std/src/index.ts lists removed when/otherwise/isType/P.
- Runtime single-arg match(value) throws by design; consider @macro-only marker so editors show transformer needed.
