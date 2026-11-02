# Correctness audit of the compile-time engine — 2026-11

**Branch:** `fable-correctness-audit` · **Baseline:** `main` at `218278b1` · **Author:** Claude Fable 5.1, for Dean's review

This is a diagnosis-only audit of typesugar's compile-time engine (PEP-052
import-scoped activation, instance resolution, PEP-053 always-on specialization,
PEP-056 pipeline). The audit itself fixed nothing; see "Status" under the
summary for what has been fixed since. Every confirmed finding has a failing
test under `packages/transformer/tests/audit/`, written as `it.fails` so the suite
stays green while the bug exists and flips red (prompting `it.fails` → `it`) once
it is fixed. Controls in the same files are plain `it` and prove the harness.

```
pnpm --filter @typesugar/transformer vitest run tests/audit     # all findings fixed; no it.fails left
```

To see the raw failures, temporarily swap `it.fails(` → `it(` in a file and rerun.

## Summary

| Area                                   | Confirmed        | Suspected | Top severity |
| -------------------------------------- | ---------------- | --------- | ------------ |
| Instance-method inlining (`===` sugar) | F1–F9, F24 (10)  | —         | Critical     |
| Auto-specialization (hoisted copies)   | F10–F13 (4)      | —         | Critical     |
| Instance resolution / activation       | F14–F19, F25 (7) | S1, S2    | High         |
| AST mutation / watch mode              | F20 (1)          | —         | High         |
| `@derive` over non-primitive fields    | F21–F23 (3)      | S3        | High         |
| Pipeline parity (PEP-056)              | 0                | S4        | —            |
| **Total**                              | **25 confirmed** | **6**     |              |

**Status (2026-11-01).** The audit was written against `main` (`218278b1`),
but the open PR stack #80 → #81 → #82 → #83 rewrites the same files. Rebased onto
the #83 tip, 30 of the 34 `it.fails` tests already passed; PR #84 (stacked on #83)
fixes F15's structural half, F17's second half, F19 and three F20 residuals, and inlines
F5/F6/F8 exactly instead of through an IIFE; PR #85 fixes F23.
Each finding below carries its status line.

**Top three.**

1. **Auto-specialization miscompiles ordinary code (F10, F11).** `tryAutoSpecialize`
   deletes the "dictionary" parameter from a hoisted copy of the callee but only
   rewrites `dict.method(...)` calls inside the body. Every other use of the
   parameter (`M.empty`, `xs.reduce(M.combine, …)`, forwarding `F` to a helper,
   recursion) is left as a dangling identifier → `ReferenceError` at runtime. And
   the trigger is any argument whose declaration has a PascalCase generic
   annotation with ≥1 type argument, so `run(cfg)` with `const cfg: Partial<Handlers>`
   or `pick(handlers)` with `Record<string, () => number>` is "specialized" too.
   This is not a typeclass edge case; it is a correctness hazard for plain TS.
2. **The inliner is a textual substitution (F1–F9, F24).** `substituteParams`
   replaces every identifier spelled like a parameter with the call-site argument
   node. Side-effecting arguments run twice (`mk().x === q.x && mk().y === q.y`),
   evaluation order flips, unused arguments vanish, `this` escapes to module
   scope, `async` bodies lose their Promise, default/rest/destructured parameters
   dangle, template-internal lambdas capture call-site variables, and property
   names / shorthand properties get rewritten. This is the code path behind the
   headline `p1 === p2` feature.
3. **The transform mutates the program's own SourceFile (F20).** `stripPositions`
   and `stripCommentsDeep` set `pos/end = -1` on nodes owned by the real
   `ts.SourceFile`. A watch host reuses that object for an unchanged file, and the
   next build's checker throws `Error: start < 0` from `createTextSpan`. `cli.ts`
   already catches this message at three sites and blames "synthetic nodes"; the
   source is the mutation of real nodes.

Runners-up: **F14** (one `ts.Program` leaks instance bodies across files by bare
name — `b.ts` inlines `a.ts`'s `eqPoint`), **F15** (`a === b` with `b: Point | null`
is rewritten to `a.x === b.x` even under `strictNullChecks`, and a structurally
identical type's instance silently wins), **F21** (`@derive(Eq)` fails on any
class with a user-typed field, with a misleading "Unknown derive: 'Eq'").

Severity: **Critical** = silent miscompile of plausible user code; **High** =
crash or wrong output in a realistic scenario; **Medium** = wrong but narrow, or
loud; **Low** = inconsistency / papercut.

---

## A. Instance-method inlining — `inlineMethod` / `substituteParams`

All of A shares one root cause.
`packages/macros/src/specialize.ts:828-854` (`substituteParams`) walks the method
body and replaces **any `Identifier` whose text equals a parameter name** with the
**same** call-site argument node (`stripped.get(n.text)`, line 844). There are no
once-only temporaries, no scope analysis, no check of the method node's shape.
`inlineFromNode` (`specialize.ts:707-817`) builds the substitution map
positionally and only for `i < callArgs.length` (line 739), ignoring `async`,
`*`, default initializers, rest and binding-pattern parameters. Reached via
`tryInlineDerivedInstanceCall` (`transformer-core/src/specialization.ts:790-825`)
for both direct `inst.method(args)` calls and the PEP-052 operator rewrite
(`rewriting.ts:1169-1191` feeds the rewritten call straight back into it).

**Suggested fix direction (for all of A):** inline only when every argument is
a side-effect-free, single-use simple expression (identifier/literal) **or** bind
each argument once to a hygienic `const` inside an IIFE / hoisted helper, in
argument order, before the body; refuse (fall back to the call) when the method
node is `async`/generator, uses `this`/`arguments`, has rest/default/destructured
params, or when the substitution would land in a non-expression position
(property name, shorthand property, binding name). Substitute by **symbol**, not
by identifier text, so inner binders can't capture call-site identifiers.

Tests: `packages/transformer/tests/audit/inliner-semantics.audit.test.ts`.

### F1 — Side-effecting argument evaluated twice · Critical

**Status:** fixed on the PR #80–#83 stack (verified 2026-11-01 at `631a902d`, the #83 tip); test flipped to `it`.

```ts
const r = eqPoint.equals(mk(), q); // also:  mk() === q
// emits: mk().x === q.x && mk().y === q.y
```

### F2 — Evaluation order changed; unused arguments elided · Critical

**Status:** fixed on the PR #80–#83 stack (verified 2026-11-01 at `631a902d`, the #83 tip); test flipped to `it`.

```ts
combineNum.combine(f(), g()); // body (a, b) => b - a   → g() - f()   (g runs first)
combineNum.first(f(), g()); // body (a, _b) => a      → f()          (g never runs)
```

### F3 — `this` escapes to the call site · High

**Status:** fixed on the PR #80–#83 stack (verified 2026-11-01 at `631a902d`, the #83 tip); test flipped to `it`.

```ts
notEquals(a, b) { return !this.equals(a, b); }  →  export const r = !this.equals(p, q);
```

Module-scope `this` is `undefined` in ESM → `TypeError`.

### F4 — `async` body inlined synchronously · High

**Status:** fixed on the PR #80–#83 stack (verified 2026-11-01 at `631a902d`, the #83 tip); test flipped to `it`.

```ts
run: async (a) => a + 1        →  export const r = 41 + 1;   // and (41 + 1).then(...) → TypeError
```

### F5 — Defaulted parameter with no argument dangles · High

**Status:** made correct by the #80–#83 stack (an IIFE of the method, `((a, b, sep = ",") => …)("x", "y")`); inlined exactly (`"x" + "," + "y"`) in PR #84 (`normalizeParameterShapes`, specialize.ts), so the assertion passes unchanged.

```ts
join: (a, b, sep = ",") => a + sep + b;   joinStr.join("x","y")  →  "x" + sep + "y"   // ReferenceError
```

### F6 — Destructured parameter bindings dangle · High

**Status:** as F5: IIFE on the stack; `({ x, y })` over a stable argument now reads `p.x`/`p.y` in PR #84.

```ts
show: ({ x, y }) => `(${x}, ${y})`;   showPoint.show(p)  →  `(${x}, ${y})`   // x, y unbound
```

`extractMethodsFromObjectLiteral` (`specialize.ts:364-370`) substitutes a
placeholder name for a binding pattern that never occurs in the body.

### F7 — Template-internal binder captures a call-site identifier · Critical

**Status:** fixed on the PR #80–#83 stack (verified 2026-11-01 at `631a902d`, the #83 tip); test flipped to `it`.

```ts
map: (xs, f) => xs.map((a) => f(a));
const a = 10;  arrMapper.map(list, (v) => v + a)  →  list.map(a => ((v) => v + a)(a))   // wrong values
```

### F8 — Rest parameter bound to the first argument · High

**Status:** as F5: IIFE on the stack; a rest parameter now gets `[1, 2, 3]` in PR #84.

```ts
sum: (...xs) => xs.length;   sumNum.sum(1, 2, 3)  →  1..length
```

### F9 — Shorthand property rewritten to an invalid literal · High

**Status:** fixed on the PR #80–#83 stack (verified 2026-11-01 at `631a902d`, the #83 tip); test flipped to `it`.

```ts
wrap: (x) => ({ x });   wrapNum.wrap(f())  →  ({ f() })   // syntax error / wrong key
```

### F24 — Parameter named like a property rewrites the property · Critical

**Status:** fixed on the PR #80–#83 stack (verified 2026-11-01 at `631a902d`, the #83 tip); test flipped to `it`.

```ts
scale: (x, p) => ({ x: p.x * x, y: p.y * x });   scalePoint.scale(k, pt)  →  ({ k: pt.k * k, y: pt.y * k })
```

Property-name identifiers (`PropertyAssignment.name`, `PropertyAccessExpression.name`)
are visited and replaced like any other identifier.

---

## B. Auto-specialization — `tryAutoSpecialize` / `inlineAutoSpecializeForHoisting`

Tests: `packages/transformer/tests/audit/auto-specialize.audit.test.ts`.

### F10 — Removed dictionary parameter still referenced · Critical

**Status:** fixed on the PR #80–#83 stack (verified 2026-11-01 at `631a902d`, the #83 tip); test flipped to `it`.

```ts
function fold<A>(M: Monoid<A>, xs: A[]) {
  return xs.reduce((acc, x) => M.combine(acc, x), M.empty);
}
fold(sumMonoid, [1, 2, 3]);
// hoisted: const __typesugar___fold_number_0__ = xs => { return xs.reduce((acc, x) => acc + x, M.empty); };
```

Same for `xs.reduce(M.combine, M.empty)` (callback position), `helper(F, …)`
(forwarding) and `times(F, …)` (recursion). **Root cause:**
`transformer-core/src/specialization.ts:186-274` (`inlineAutoSpecializeForHoisting`)
drops the parameter at line 228 unconditionally, while
`rewriteDictCallsForAutoSpec` (`:148-180`) rewrites only
`dict.method(...)` _calls_. **Fix direction:** after rewriting, scan the body for
any remaining reference to the removed parameter's symbol; if one exists, either
keep the parameter (and pass the instance through at the call site) or skip
specialization. A `Monoid.empty`-style value member should be inlined as the
instance's property initializer when it is a literal, else keep the dictionary.

### F11 — Fires on arbitrary generic-annotated object literals · Critical

**Status:** fixed on the PR #80–#83 stack (verified 2026-11-01 at `631a902d`, the #83 tip); test flipped to `it`.

```ts
const cfg: Partial<Handlers> = { onA: () => 1 };
function run(h: Partial<Handlers>) { return h.onA() + (h.extra ?? 0); }
run(cfg)   →   const __typesugar___run_Handlers_0__ = () => { return 1 + (h.extra ?? 0); };
```

Also `Record<string, () => number>`. **Root cause:**
`packages/macros/src/instance-extraction.ts:119-125` (`hasTypeclassTypeAnnotation`)
accepts any `PascalCase<…>` type reference with ≥1 type argument as "typeclass
shaped" (PEP-053 Wave 2 gap 5's "looser rule"). **Fix direction:** require the
annotation's type to resolve to an interface carrying `@typeclass` (the op-index
already knows these: `isTypeclassDeclared(program, name)`), or an `@impl`/
`@instance` tag; never PascalCase-by-shape. Also exclude lib types outright.

### F12 — Specialization cache keyed by type brand, not instance · Critical

**Status:** fixed on the PR #80–#83 stack (verified 2026-11-01 at `631a902d`, the #83 tip); test flipped to `it`.

```ts
const upper: Show<string> = { show: (s) => s.toUpperCase() };
const quoted: Show<string> = { show: (s) => JSON.stringify(s) };
render(upper, "a");
render(quoted, "a"); // both → __typesugar___render_string_0__ (upper's body)
```

**Root cause:** `specialization.ts:423-424` — `cacheKey = computeKey(fnSymbolId, dictBrands)`
where the brand is the first type argument text (`"string"`), so two distinct
instances of the same type collide. PEP-052 explicitly allows multiple
instances per type ("coherence is local; scope decides"). **Fix direction:** key by
the instance's declaration symbol (or `argName` + declaring file) in addition to
the function symbol.

### F13 — DCE deletes an `export`ed instance · High

**Status:** fixed on the PR #80–#83 stack (verified 2026-11-01 at `631a902d`, the #83 tip); test flipped to `it`.

```ts
export const combineNum: Combine<number> = { combine: (a, b) => a + b };
export const r = combineNum.combine(1, 2); // output has NO `export const combineNum` → importers break at link time
```

**Root cause:** `specialization.ts:887-953` (`eliminateDeadDerivedInstances`)
removes any `VariableStatement` whose name was inlined and has no remaining
same-file reference, without checking for an `export` modifier (or re-exports /
`export { combineNum }` elsewhere). **Fix direction:** never remove exported or
`declare`d statements; restrict DCE to the transformer's own synthesized
`_TypeTC` consts.

---

## C. Instance resolution and import-scoped activation

Tests: `packages/transformer/tests/audit/instance-resolution.audit.test.ts`.

### F14 — Cross-file leak of instance bodies within one `ts.Program` · Critical

**Status:** fixed on the PR #80–#83 stack (verified 2026-11-01 at `631a902d`, the #83 tip); test flipped to `it`.

```
a.ts:  /** @impl Eq<PointA> */ const eqPoint: Eq<PointA> = { equals: (a, b) => a.x === b.x };   eqPoint.equals(p, q)
c.ts:  export const eqPoint: Eq<PointB> = { equals: (a, b) => a.name === b.name };
b.ts:  import { eqPoint } from "./c";  eqPoint.equals(p, q)
```

Built in one program after `a.ts`, `b.ts` emits `p.x === q.x` (a.ts's body, wrong
fields for `PointB`); alone it emits `p.name === q.name`. Same when `b.ts` uses a
local `eqPoint` _before_ its declaration (function hoisting). **Root cause:**
`instanceMethodRegistry` is keyed by **bare local name** per program
(`packages/macros/src/specialize.ts:301-322`; written by
`instance-extraction.ts:657` and the `@impl` macro), and
`resolveInstanceOrIntrinsicMethodsSafely` (`transformer-core/src/specialization.ts:762-778`)
consults it **before** symbol-based extraction (line 767). This is exactly the
order-dependent, cross-file state PEP-052 set out to eliminate, and the CLI
`build`/`watch`/LS all share one program. (PEP-052 Wave 7/8 already filed the
"bare identifier text, no scope/symbol check" hazard for same-file shadowing;
the cross-file consequence is new.) **Fix direction:** key the registry by the
instance's declaration `ts.Symbol` (or `fileName + name`), and resolve the
call-site identifier to its symbol first; drop the name-keyed lookup.

### F15 — Structural matching and left-operand-only typing · High

**Status:** the nullable-operand half was fixed on the #80–#83 stack (both sides are matched and a nullable one is guarded: `(b === a || (b != null && eqPoint.equals(b, a)))`; the "asymmetry" control now pins that). The structural half is fixed in PR #84: an instance declared for the operand's own type (by symbol) is looked for in every stage before any structural match (`resolveInstance`, instance-resolver.ts). A same-shape instance is still used for a type that has none of its own, as `docs/guides/typeclasses.md` documents.

```ts
import { Point, eqPoint } from "./eq-lib";          // Eq<Point>
export const eqVec: Eq<Vec> = { equals: (a, b) => a.x === b.x, … };   // Vec ≡ Point structurally
p1 === p2   →   p1.x === p2.x        // eqVec's body, local-scope stage wins, no ambiguity reported
```

```ts
declare const a: Point; declare const b: Point | null;   // strictNullChecks: true
a === b   →   a.x === b.x            // TypeError when b is null; native === returned false
b === a   →   b === a                // left-operand union is NOT matched (asymmetric)
```

**Root cause:** `packages/macros/src/instance-resolver.ts:143-155` (`isTypeMatch`)
uses bidirectional assignability, so structurally identical nominal types match;
`transformer-core/src/rewriting.ts:445-452` only rejects a right operand whose
type _is_ `null`/`undefined` (a union carries `TypeFlags.Union`), and line 457
resolves the instance from `leftType` alone. **Fix direction:** match instances
on the declared type's symbol/alias identity (or require the operand type to be
the instance's declared type, not merely mutually assignable); require both
operand types to match the instance (or both be the same non-nullable type)
before rewriting; otherwise stay native.

### F16 — Same-named instances from two modules silently deduplicated · High

**Status:** fixed on the PR #80–#83 stack (verified 2026-11-01 at `631a902d`, the #83 tip); test flipped to `it`.

```ts
import { one } from "./lib1";  // exports eqPoint: Eq<Point> (compares x)
import { two } from "./lib2";  // exports eqPoint: Eq<Point> (compares y)
p === q   →   eqPoint.equals(p, q) + `import { eqPoint } from "./lib1"`   // no ambiguity, import order decides
```

**Root cause:** `instance-resolver.ts:532-555` (`pickResult`) dedupes candidates
by `exportName` only (line 543). **Fix direction:** dedupe by
`(sourceModule, exportName)`; report ambiguity otherwise.

### F17 — Type-only imports produce runtime references · High

**Status:** the first test (an instance named in `import type`) was fixed on the #80–#83 stack by injecting a value import. The second is fixed in PR #84, but not by ignoring type-only imports (an eslint `consistent-type-imports` autofix would then silently turn `===` back into reference equality): the inliner now resolves a generated receiver through the pending import (`resolveDictForIdentifier`, specialization.ts), and only imports the output still references are injected (`getPendingImports(isReferenced)`). An inlined call therefore adds no import; one that can't be inlined still imports the instance (regression test added). The first test's accepted outputs were widened by one: "inlined, so nothing references `eqPoint`".

```ts
import type { Point, eqPoint } from "./eq-lib";
p1 === p2   →   eqPoint.equals(p1, p2)       // the only binding is type-only → erased → ReferenceError
```

```ts
import type { Point } from "./eq-lib";
p1 === p2   →   + `import { eqPoint } from "./eq-lib";`   // a type-only dependency became a runtime one
```

**Root cause:** `instance-resolver.ts:75-124` (`getImportMap`) never checks
`importClause.isTypeOnly` / `ImportSpecifier.isTypeOnly`, so type-only imports
feed both the explicit-import and module-scan stages; `ctx.ensureImport` then
sees an existing (type-only) binding and injects nothing. **Fix direction:** skip
type-only imports in `getImportMap` (and in `scanImportsForScope`, see S1). If a
type-only module should still count for module-scan, `ensureImport` must emit a
value import even when a same-named type-only binding exists.

### F18 — Method sugar skips literal-typed receivers · Low

**Status:** fixed on the PR #80–#83 stack (verified 2026-11-01 at `631a902d`, the #83 tip); test flipped to `it`.

```ts
n.show()   → showNum.show(n)         (5).show()  →  (5).show()   // runtime TypeError
```

**Root cause:** `transformer-core/src/method-sugar.ts:135,172` resolves on the
raw receiver type; the extension path (`rewriting.ts:289-291`) normalizes via
`getBaseTypeOfLiteralType` but this sibling does not. **Fix:** same normalization.

### F19 — The documented bare `/** @instance */` form errors · Medium

**Status:** fixed in PR #84: a bare `@impl`/`@instance` takes `TC<T>` from the const's annotation (`implArgsFromAnnotation`, typeclass.ts), like the scanner.

```ts
/** @instance */
export const eqPoint: Eq<Point> = { … };
// error: @impl requires arguments: @impl("Type"), @impl("Typeclass<Type>"), or @impl(Typeclass, Type)   (×2)
```

PEP-052's design example and the existing operator-activation test fixtures use
this form; it works only because those fixtures are never _transformed_. The
scanner accepts it (annotation fallback) but the `@impl`/`@instance` attribute
macro rejects it (`packages/macros/src/typeclass.ts:1803-1809`). **Fix
direction:** let the macro take `TC<T>` from the type annotation when the tag has
no argument, mirroring the scanner.

### F25 — Operator sugar is skipped inside `@impl`-tagged declaration bodies · Medium

**Status:** fixed on the PR #80–#83 stack (verified 2026-11-01 at `631a902d`, the #83 tip); test flipped to `it`.

```ts
/** @impl Same<Inner> */ const taggedSame: Same<Inner> = { same: (a, b) => a === b }; // stays native
const untaggedSame: Same<Inner> = { same: (a, b) => a === b }; // → Inner.Eq.equals(a, b), inlined
```

`===` on `Inner` means reference equality in one declaration and structural
equality three lines below, in the same file with the same activation.
**Root cause:** `transformer-core/src/transformer.ts:1032-1037` returns the result
of `tryExpandJSDocMacros` without passing it (or the original children) back
through `visit`, so operator/method-sugar/auto-spec dispatch never runs inside a
JSDoc-macro target. (Expression macros such as `comptime` _do_ still expand
inside those bodies — the mechanism was not traced; see S5.) **Fix direction:**
visit the macro result's children (as the decorator path does at `:1572-1579`).

---

## D. AST mutation and watch mode

Test: `packages/transformer/tests/audit/ast-mutation-watch.audit.test.ts`.

### F20 — Program-owned nodes are mutated to `pos/end = -1` · High

**Status:** the reported path was fixed on the #80–#83 stack. PR #84 fixes three residuals found while checking it: (1) `cloneWithoutPositions`/`cloneWithoutComments` (and `cloneNodeDeep`, for NodeArrays) shared token children and unchanged NodeArrays with the original, so `(n + 1).show()` still reset `+` on the real file; (2) `inlineFromNode` stripped an `@impl`-registered method body in place; (3) `ctx.parseExpression`/`parseStatements` (and `quote`'s type parser, the HKT signature parser, the reflected intrinsics) returned temp-file parse-tree nodes, which TypeScript's emit resolver treated as real and queued a "Cannot find name" at position -1, so `getPreEmitDiagnostics` after emit still threw `start < 0`; they now return synthesized copies. With those gone, the three `"start < 0"` catches in `cli.ts` are removed and `build-emit.test.ts`'s safety-net test asserts no throw.

After one emit of a file with `eqPoint.equals(p, undefinedVar)` the **original**
`ts.SourceFile` carries 17 nodes with negative positions. With a host that
reuses SourceFile objects for unchanged files (what `ts.createWatchProgram` and
the language-service document registry do), editing `dep.ts` and rebuilding
makes `program.getSemanticDiagnostics(main)` throw:

```
Error: start < 0
    at createTextSpan … at getErrorSpanForNode … at createDiagnosticForNode … at resolveNameHelper
```

**Root cause:** `packages/core/src/ast-utils.ts:142-149` (`stripPositions`) and
`:191-201` (`stripCommentsDeep`) mutate in place (their own doc comment says so).
They are applied to nodes the program owns at `specialize.ts:839`
(`stripPositions(value)` on call-site arguments), `rewriting.ts:508-509`
(`stripCommentsDeep(left/right)` on visited operands), `method-sugar.ts:231`, and
`specialization.ts:824` (`stripCommentsDeep(result)`, whose tree embeds original
argument nodes). `cli.ts:594,625,655` catch `"start < 0"` and degrade (dropping a
whole diagnostics pass), attributing it to synthetic nodes. **Fix direction:**
`cloneNodeDeep` (already in core) before stripping anything that came from the
source tree, or build replacement nodes with `factory.create*` + `setTextRange`
instead of mutating; then the CLI catches become unnecessary.

---

## E. `@derive` over non-primitive fields; activation without import

Tests: `packages/transformer/tests/audit/derive-nested.audit.test.ts`.

### F21 — `@derive(Eq)` fails for any class with a user-typed field · High

**Status:** fixed on the PR #80–#83 stack (verified 2026-11-01 at `631a902d`, the #83 tip); test flipped to `it`. Its control (which pinned the old misleading "Unknown derive" message) now asserts that message is gone.

```ts
@derive(Eq)
class Inner {
  constructor(public v: number) {}
}
@derive(Eq)
class Outer {
  constructor(
    public inner: Inner,
    public n: number
  ) {}
}
// error: Unknown derive: 'Eq'. Not a registered derive macro, typeclass with auto-derivation, …
```

Same outcome when `Inner`'s instance is a hand-written `@impl Eq<Inner>` in the
same file or imported by name from another module. Only all-primitive products
derive. **Root cause:** the Eq GenericDerivation's
`hasFieldInstance: makePrimitiveChecker(…)` (`packages/macros/src/auto-derive.ts:685-687`)
rejects every non-primitive field type (`:339-353`), so `tryDeriveViaGeneric`
returns no expression and `expandDeriveDecorator`
(`transformer-core/src/macro-helpers.ts:617`) falls through to the generic
"Unknown derive" message. The scope-based planner that _could_ answer this
(`typeclass.ts:313-325` `hasPrimitiveOrInstance` → `hasInstanceInScopeByName`)
is not consulted by the GenericDerivation path. **Fix direction:** make
`hasFieldInstance` take `ctx` and consult `resolveInstance`/`hasInstanceInScopeByName`
(including same-pass synthesized companions); emit `Inner.Eq.equals(a.inner, b.inner)`
or the resolved instance name (with `ensureImport`) in `deriveProduct`. Fix the
diagnostic to name the field that lacks an instance.

### F22 — Array field crashes string codegen · Medium

**Status:** fixed on the PR #80–#83 stack (verified 2026-11-01 at `631a902d`, the #83 tip); test flipped to `it`.

```ts
@derive(Eq)
class Tags {
  constructor(public tags: string[]) {}
}
// error: GenericDerivation failed for Eq: Error: Failed to parse expression: ({ equals: … => string[].Eq.equals(a.tags, b.tags), … })
```

**Root cause:** `auto-derive.ts:689-700` builds the instance as a template string
(`${inst}.equals(…)` with `inst = "string[]"`) and reparses it — the string-codegen
exception CLAUDE.md/PEP-057 already flag for `auto-derive.ts`. **Fix direction:**
build the AST with `ts.factory`, and resolve array/tuple/union field types to an
instance (`Eq.array(Eq.string)`) or a precise diagnostic.

### F23 — JSDoc `@derive` activates with no import and injects a compile-time package · Medium

**Status:** fixed in PR #85 (stacked on #84). A JSDoc `@derive X` applies only when the file binds `X` itself (an import, type-only included, or a top-level declaration) or, for a derive macro with no export to import, imports the macro's package; otherwise it is ignored with a warning, so another tool's `@derive` tag is never taken for typesugar's. A new `JSDocDeriveImport` suppression rule keeps `typesugar check` and the editor from reporting such an import as unused. `@typesugar/testing` exports an `Arbitrary` token to import.

```ts
/** @derive Eq */ class P { … }           // no imports at all in the file
// output adds:  import { Eq } from "@typesugar/macros";   and the companion
```

PEP-052's acceptance criterion is "a file that imports no `@syntax-*` marker and
no named macro is byte-for-byte unchanged". `@typesugar/macros` is on the
runtime-purity ALLOWLIST as build-time only (it imports `typescript`), so the
injected import drags the compiler into the user's bundle. **Root cause:**
`typeclass.ts:3128-3155` (`tryExpandGenericDerive`) hardcodes the
`"@typesugar/macros"` specifier when the derivable isn't imported. **Fix
direction:** treat the JSDoc form like the decorator form (require the derivable
to be imported; emit a diagnostic otherwise), and never inject `@typesugar/macros`.

---

## Suspected (no failing test; evidence noted)

- **S1 — A type-only import of a marker module activates syntax.**
  `import type { EqOpsMarker } from "./eq-ops"` activated `===` rewriting
  (`scanImportsForScope`, `resolution-scope.ts:336-369`, never checks
  `isTypeOnly`). Probably harmless (the marker has no runtime content) but it
  contradicts the "side-effect import" framing; decide and document.
- **S2 — An `Eq<any>` instance in scope matches every operand type** via
  `isTypeMatch`'s bidirectional assignability (`any` is assignable both ways).
  Not probed with a test; follows directly from `instance-resolver.ts:143-155`.
- **S3 — Importing the `typesugar` umbrella at runtime loads the TypeScript
  compiler.** `packages/typesugar/src/index.ts:121` re-exports `Eq`/`Ord`/… from
  `@typesugar/macros`, whose `.` entry imports `typescript`. Verified:
  `await import("typesugar")` puts `typescript/lib/typescript.js` in the require
  cache (~150 ms). `scripts/check-runtime-purity.mjs` only inspects _direct_
  `typescript` imports per package, so the transitive leak passes CI. The
  derive docs tell users to `import { derive, Eq } from "typesugar"`.
- **S4 — Parity gap by construction:** `transformer-core`'s in-memory
  `transformCode()` (and therefore `@typesugar/playground`'s exported browser
  `transform()`) does not run `arrow-comprehension-preprocess.ts`, which lives in
  the Node package. Known since PEP-052 Wave 2; the docs playground compiles
  server-side so users don't hit it. Recorded so nobody re-derives it.
- **S5 — Why `comptime(...)` still expands inside `@impl`-tagged bodies while
  operators do not (F25)** was not traced. Worth understanding before fixing F25,
  since the fix (re-visiting JSDoc macro results) could double-expand whatever
  path currently handles the expression macro.
- **S6 — Non-exported instances found by `findScannedInScope` in imported
  modules** (`instance-resolver.ts:377-413`, the PEP-056 Wave 5 widening) return
  an `exportName` that is not importable. Today's consumers only read the
  declaration (companion-path extraction) or a boolean (derive planner), so no
  bad emit was found; a future consumer that _emits_ `exportName` would dangle.

## Hypotheses checked and ruled out

- **Main transformer vs `transformer-core` parity (PEP-056).** Identical output
  on the F1 operator-inline input, the F18 method-sugar input and the F10
  auto-spec input through `@typesugar/transformer-core`'s `transformCode`,
  `pipeline.transformCode`, `macroTransformerFactory` via `ts.transform`, and via
  `program.emit`. Expected (one engine since Wave 4) and now confirmed; the only
  remaining divergence is S4.
- **Named-trigger macros without an import** (`comptime(1 + 1)`, `staticAssert(…)`
  with no import): correctly left unexpanded (`fallbackNameLookupWithImports`
  requires a matching import for module-owning macros). The JSDoc `@derive` form
  is the exception (F23).
- **`/** @op === \*/`on the same line as the opening`{`** is not read — this is
TypeScript's JSDoc attachment rule (a same-line comment after `{`is trailing
trivia of the brace), not a typesugar bug. Two existing fixtures in`pep052-operator-activation.test.ts` ("falls back to native when two same-named
  typeclasses…") use that one-line form and therefore pass vacuously; worth
  rewriting them multi-line.
- **Cross-file registry leak when both files declare `@impl` instances of the
  same name and use them _after_ the declaration** does not reproduce: the second
  file's `@impl` macro re-registers the name before the use site. The leak needs
  a use-before-declare or an annotation-only/imported instance (F14).
- **Generator (`*method`) instance bodies** are not inlined (the block body
  fails classification). Correct by accident; worth an explicit guard with F4.
- **Operator precedence of substituted arguments** (`numNum.twice(x + y)` →
  `(x + y) * 2`): correct; the printer parenthesizes.
- **A reference-equality fast path inside an instance's own body**
  (`equals: (a, b) => a === b || …`) does not recurse into itself — only because
  of F25 (the tagged body is never visited). Fixing F25 will expose it: `===` on
  the instance's own type inside its `@impl` body would rewrite to a self-call.
  Plan for `refEq`/`a.ref` guidance or a "no operator sugar inside the declaring
  instance" rule when fixing F25.
- **Diagnostics after `emit` within one program** do not throw: TypeScript checks
  a file before the `before` transformers run, so the spans are already computed.
  The crash needs a _second_ program that reuses the SourceFile (F20).
- **Nullable LEFT operand** (`b === a` with `b: Point | null`) stays native;
  only the right operand is unchecked (F15).
- **In-file `@typeclass` interfaces activate their own operators with zero
  imports** and emit `export const Eq = {}` + a `globalThis.__typesugar_companions`
  entry. By design per PEP-052 ("you don't import what you define"); noted
  because it means the "byte-for-byte unchanged" criterion only holds for files
  with no JSDoc macro tags at all.
- **`@derive(Eq)` with an optional primitive field** (`n?: number`) derives and
  compares with `Eq.number.equals(a.n, b.n)`; `undefined === undefined` is
  `true`, so this is semantically fine.

## Method and harness

Hypotheses were generated from reading `resolution-scope.ts`,
`instance-resolver.ts`, `instance-scanner.ts`, `typeclass-index.ts`,
`rewriting.ts`, `method-sugar.ts`, `specialization.ts`, `specialize.ts`,
`instance-extraction.ts`, `transformer.ts`, `pipeline.ts` and PEP-052/053/056/
057/058, then each was confirmed or ruled out by running real inputs through the
built packages (throwaway probe scripts in `/tmp/fable-probe`, not committed).
The committed tests use `packages/transformer/tests/audit/_harness.ts`, which
drives a `TransformationPipeline` over an in-memory multi-file project so several
files can be transformed against **one** `ts.Program` (the CLI/LS shape); the
watch-mode test drives `macroTransformerFactory` through `program.emit` with a
SourceFile-reusing host. Everything is reproducible with the command at the top.
