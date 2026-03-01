# Typesugar Red Team Findings

Date: 2026-02-21

## Overview

Systematic adversarial testing of typesugar to find edge cases, type safety holes, and unexpected behavior.

### Summary Table

| #   | Finding                                 | Module                         | Severity | Type                  |
| --- | --------------------------------------- | ------------------------------ | -------- | --------------------- |
| 1   | Option<null> Type Collapse              | `@typesugar/fp`                | Medium   | Design limitation     |
| 2   | Phantom HKT Type-Level Functions        | `@typesugar/type-system`       | Low      | User error            |
| 3   | match() Boolean Discriminant Mismatch   | `@typesugar/std`               | Medium   | Runtime fallback bug  |
| 4   | Async Predicates in Guard Arms          | `@typesugar/std`               | Medium   | Silent bug            |
| 5   | Option<unknown> Loses Structure         | `@typesugar/fp`                | Low      | Type system edge case |
| 6   | P.empty Works on Strings                | `@typesugar/std`               | Very Low | Surprising behavior   |
| 7   | OR Pattern vs Literal Discriminants     | `@typesugar/std`               | Low      | Edge case             |
| 8   | Nested HKT Types Crash Preprocessor     | `@typesugar/preprocessor`      | **High** | **FIXED**             |
| 9   | Source Maps Not Always Generated        | `@typesugar/preprocessor`      | Low      | Missing feature       |
| 10  | Scientific Notation in Prover           | `@typesugar/contracts`         | Medium   | Parsing limitation    |
| 11  | ASCII-Only Variable Names in Prover     | `@typesugar/contracts`         | Low      | Parsing limitation    |
| 12  | Equality Doesn't Imply Inequalities     | `@typesugar/contracts`         | Medium   | Proof incomplete      |
| 13  | Compound Predicates Don't Split         | `@typesugar/contracts`         | **High** | **FIXED**             |
| 14  | Comptime Cannot Serialize BigInt        | `@typesugar/comptime`          | Low      | FIXED                 |
| 15  | Comptime Circular Reference Detection   | `@typesugar/comptime`          | Medium   | FIXED                 |
| 16  | Symbolic Limit Returns Infinity         | `@typesugar/symbolic`          | Low      | FIXED                 |
| 17  | Complex Division by Zero Throws         | `@typesugar/math`              | Low      | Design choice         |
| 18  | Complex Log(0) Throws                   | `@typesugar/math`              | Low      | Design choice         |
| 19  | Rational fromNumber Precision Limits    | `@typesugar/math`              | Low      | Algorithm limitation  |
| 20  | HList splitAt Negative Index Behavior   | `@typesugar/hlist`             | Very Low | Undocumented behavior |
| 21  | LabeledHList **proto** Key Blocked      | `@typesugar/hlist`             | Low      | JavaScript quirk      |
| 22  | Vec Operations Return FusedVec Object   | `@typesugar/fusion`            | Very Low | API awareness         |
| 23  | match() Discriminant Name List Extended | `@typesugar/std`               | Low      | IMPROVED              |
| 24  | NonZero.is(NaN) Returns True            | `@typesugar/contracts-refined` | Low      | JavaScript semantics  |
| 25  | ~~Z3 Parser: Scientific Notation Missing~~| ~~`@typesugar/contracts-z3`~~  | —        | Package removed       |
| 26  | Synthetic Nodes Crash ExpansionTracker  | `@typesugar/core`              | Low      | Known limitation      |
| 27  | Signal Function Values as Updaters      | `@typesugar/react`             | Medium   | Design limitation     |
| 28  | Computed Diamond Deps Not Tracked       | `@typesugar/react`             | Medium   | Bug                   |
| 29  | Phantom State Machine Runtime State     | `@typesugar/type-system`       | Medium   | Bug                   |
| 30  | Sparse Array Validation Vulnerability   | `@typesugar/validate`          | Medium   | Bug                   |
| 31  | Async Validators Pass (Promise Truthy)  | `@typesugar/validate`          | Medium   | Bug                   |
| 32  | Parser regex() Loses Flags              | `@typesugar/parser`            | Low      | Bug                   |

### Statistics

- **Total Findings:** 32
- **Fixed:** 6 (#8, #13, #14, #15, #16, #23)
- **High Severity:** 0 remaining (2 fixed)
- **Medium Severity:** 7 remaining (1 fixed)
- **Low Severity:** 14 remaining (3 fixed)
- **Very Low Severity:** 5

### Modules Tested

- `@typesugar/fp` (Option, Either, HKT)
- `@typesugar/std` (match macro, P helpers, extensions)
- `@typesugar/preprocessor` (pipeline, HKT syntax)
- `@typesugar/contracts` (prover, requires/ensures)
- `@typesugar/contracts-refined` (refined type predicates)
- `@typesugar/comptime` (compile-time evaluation)
- `@typesugar/derive` (manual simulation)
- `@typesugar/symbolic` (expression trees, evaluation, differentiation)
- `@typesugar/math` (Rational, Complex numbers)
- `@typesugar/hlist` (HList, LabeledHList operations)
- `@typesugar/fusion` (LazyPipeline, Vec operations)
- `@typesugar/codec` (versioned codecs, schema evolution)
- `@typesugar/core` (macro infrastructure)
- `@typesugar/erased` (type erasure)
- `@typesugar/graph` (graph algorithms)
- `@typesugar/parser` (PEG parser)
- `@typesugar/react` (reactive signals)
- `@typesugar/type-system` (HKT, newtype, refined types)
- `@typesugar/units` (physical units)
- `@typesugar/validate` (validation schemas)
- Plus config packages: eslint-plugin, prettier-plugin, ts-plugin, unplugin-typesugar, vscode, typesugar umbrella

### Test Coverage

- **1900+ tests** across 44 test files
- All tests passing (documenting both correct and edge case behavior)

### Test Files

| File                                  | Tests | Focus Area                                     |
| ------------------------------------- | ----- | ---------------------------------------------- |
| `red-team-option.test.ts`             | 19    | Option type null-collapse edge cases           |
| `red-team-hkt.test.ts`                | 22    | HKT encoding, phantom types, unsound instances |
| `red-team-macros.test.ts`             | 27    | match macro, specialize, type coercion         |
| `red-team-preprocessor.test.ts`       | 35    | Pipeline, HKT syntax, cons operator            |
| `red-team-contracts.test.ts`          | 42    | Prover, linear arithmetic, runtime checks      |
| `red-team-comptime.test.ts`           | 68    | Value serialization, sandbox security          |
| `red-team-derive.test.ts`             | 9     | Eq, Ord, Clone, Hash, Debug edge cases         |
| `red-team-transformer.test.ts`        | 43    | Extension methods, operators, imports          |
| `red-team-symbolic.test.ts`           | 48    | Evaluation, differentiation, rendering         |
| `red-team-fusion.test.ts`             | 48    | LazyPipeline, Vec, range edge cases            |
| `red-team-hlist.test.ts`              | 45    | HList operations, LabeledHList edge cases      |
| `red-team-fp.test.ts`                 | 49    | Option/Either edge cases, conversions          |
| `red-team-math.test.ts`               | 45    | Rational, Complex number edge cases            |
| `red-team-std.test.ts`                | 46    | match patterns, P helpers, Unicode             |
| `red-team-codec.test.ts`              | 36    | Schema validation, migration, serialization    |
| `red-team-contracts-refined.test.ts`  | 89    | Refined type predicates, subtyping             |
| `red-team-core.test.ts`               | 67    | Registry, config, capabilities, hygiene        |
| `red-team-effect.test.ts`             | 29    | Service registry, layers, HKT integration      |
| `red-team-erased.test.ts`             | 41    | VTable, capabilities, type erasure             |
| `red-team-eslint-plugin.test.ts`      | 53    | Preprocessor, file handling, config            |
| `red-team-graph.test.ts`              | 70    | Graph algorithms, state machines               |
| `red-team-mapper.test.ts`             | 38    | Object mapping edge cases                      |
| `red-team-parser.test.ts`             | 76    | PEG parsing, grammar edge cases                |
| `red-team-prettier-plugin.test.ts`    | 40    | Custom syntax formatting                       |
| `red-team-react.test.ts`              | 39    | Signals, computed, effects, batching           |
| `red-team-reflect.test.ts`            | 49    | Type info, validators, field names             |
| `red-team-specialize.test.ts`         | 47    | Specialization, instance methods               |
| `red-team-sql.test.ts`                | 94    | SQL DSL, type mapping, ConnectionIO            |
| `red-team-strings.test.ts`            | 38    | Escaping, Unicode, template literals           |
| `red-team-testing.test.ts`            | 45    | Assertions, property testing, type equality    |
| `red-team-ts-plugin.test.ts`          | 39    | Position mapping, file filtering               |
| `red-team-type-system.test.ts`        | 71    | HKT, newtype, refined, phantom types           |
| `red-team-typeclass.test.ts`          | 48    | Registry, instances, derive strategies         |
| `red-team-typesugar.test.ts`          | 32    | Umbrella re-exports, macro registration        |
| `red-team-units.test.ts`              | 56    | Unit conversion, precision, arithmetic         |
| `red-team-unplugin-typesugar.test.ts` | 36    | Bundler plugin configuration                   |
| `red-team-validate.test.ts`           | 40    | Schema validation, type coercion               |
| `red-team-vscode.test.ts`             | 26    | VS Code extension configuration                |

---

## Finding #1: Option<null> Type Collapse

**Module:** `@typesugar/fp/data/option`
**Severity:** Medium (design limitation, not a bug)
**Status:** CONFIRMED

**Description:**
The zero-cost `Option<A> = A | null` representation causes `Some(null)` to be indistinguishable from `None` at runtime. This breaks type safety when `A` includes `null` as a valid value.

**Reproduction:**

```typescript
import * as Option from "@typesugar/fp/data/option";

// These are identical at runtime!
const someNull: Option.Option<null> = Option.Some(null);
const none: Option.Option<null> = Option.None;

// isSome type guard is unsound
Option.isSome(someNull); // returns false! (should be true)

// map treats Some(null) as None
Option.map(someNull, (x) => "transformed"); // returns null, never calls callback

// fold goes to the "None" branch
Option.fold(
  someNull,
  () => "none",
  () => "some"
); // returns "none"
```

**Affected Operations:**

- `isSome()` - returns false for `Some(null)`
- `isNone()` - returns true for `Some(null)`
- `map()` - doesn't call callback for `Some(null)`
- `flatMap()` - doesn't call callback for `Some(null)`
- `fold()` - takes None branch for `Some(null)`
- `getOrElse()` - returns default for `Some(null)`
- `sequence()` - fails on array containing `Some(null)`
- `traverse()` - fails if callback returns null
- `zip()` - fails if either argument is `Some(null)`
- `bind()` (Do-notation) - fails with `Some(null)`

**Workarounds:**

1. Use `undefined` instead of `null` for missing values (works because `undefined !== null`)
2. Use a wrapper type like `{ value: null }` instead of raw `null`
3. Use the traditional tagged union `{ _tag: "Some", value: A } | { _tag: "None" }` when needed

**Analysis:**
This is a fundamental trade-off of the zero-cost design. The null-based representation provides:

- Zero runtime overhead (no wrapper allocation)
- Native JavaScript null-check semantics

But sacrifices:

- Ability to distinguish `Some(null)` from `None`
- Type safety for `Option<A>` where `A` includes `null`

**Recommendation:** Document this limitation prominently. Consider adding a compile-time lint/warning when `Option<A>` is used with `A` that includes `null`.

---

## Finding #2: Phantom HKT Type-Level Functions Are Unsound

**Module:** `@typesugar/type-system`
**Severity:** Low (user error, but not prevented)
**Status:** CONFIRMED

**Description:**
The HKT encoding (`Kind<F, A> = F & { readonly __kind__: A }`, with type-level functions defining `_: T<this["__kind__"]>`) allows "phantom" type-level functions that ignore their argument. These produce unsound Functor/Monad instances where `map` doesn't actually transform the type.

**Reproduction:**

```typescript
// Phantom type-level function - always returns string
interface PhantomF {
  _: string; // Should be `this["__kind__"]` but isn't
}

// Kind<PhantomF, number> resolves to string
// Kind<PhantomF, boolean> resolves to string
// All the same type!

// This Functor is "type-correct" but semantically wrong
const phantomFunctor: Functor<PhantomF> = {
  map: (_fa, _f) => "I ignore the function completely",
};

// User expects number -> string transformation
// Actually gets constant "I ignore the function"
phantomFunctor.map("hello", (n: number) => n * 2); // Returns string, not number!
```

**Analysis:**
TypeScript can't enforce that type-level functions use `this["__kind__"]`. Lint rules or documentation should warn users.

**Recommendation:** Add a lint rule that checks HKT type-level functions reference `this["__kind__"]`.

---

## Finding #3: match() Boolean Discriminant Runtime Mismatch

**Module:** `@typesugar/std/macros/match`
**Severity:** Medium (breaks runtime fallback)
**Status:** CONFIRMED

**Description:**
When matching on a boolean discriminant (like `ok: true | false`), the compile-time macro correctly detects it, but the runtime fallback defaults to looking for discriminant `"kind"`. This causes runtime errors when the transformer doesn't run.

**Reproduction:**

```typescript
type Result<T> = { ok: true; value: T } | { ok: false; error: Error };

const result: Result<string> = { ok: true, value: "hello" };

// Compile-time: works (macro detects "ok" discriminant)
// Runtime fallback: fails ("Non-exhaustive match: no handler for 'undefined'")
match(result, {
  true: ({ value }) => value,
  false: ({ error }) => error.message,
});
```

**Analysis:**
The runtime `match()` function uses `const key = discriminant ?? "kind"` but the boolean discriminant detection only works at compile-time via type checker analysis.

**Workarounds:**

1. Pass explicit discriminant: `match(result, handlers, "ok")`
2. Ensure transformer is running

**Recommendation:** Runtime should try common discriminant names beyond just "kind" (e.g., "ok", "\_tag", "type").

---

## Finding #4: Async Predicates in Guard Arms Are Silently Broken

**Module:** `@typesugar/std/macros/match`
**Severity:** Medium (silent bug)
**Status:** CONFIRMED

**Description:**
Using async functions as predicates in `when()` arms causes incorrect behavior because Promises are truthy values. The predicate appears to always match.

**Reproduction:**

```typescript
const value = 42;

// Async predicate returns a Promise, which is truthy!
const result = match(value, [
  when(
    async () => false,
    () => "should not match"
  ),
  otherwise(() => "default"),
]);

// Expected: "default"
// Actual: "should not match" (Promise is truthy)
```

**Analysis:**
The guard evaluation is synchronous: `arm.predicate(value)` evaluates to a Promise object, which is truthy regardless of what the Promise eventually resolves to.

**Recommendation:** Add runtime check or type constraint to prevent async predicates.

---

## Finding #5: Option<unknown> Loses Option Structure

**Module:** `@typesugar/fp/data/option`
**Severity:** Low (edge case)
**Status:** CONFIRMED

**Description:**
`Option<unknown>` collapses to just `unknown` because `unknown | null = unknown`. This loses the Option structure entirely.

**Reproduction:**

```typescript
type T = Option<unknown>;
// T = unknown | null = unknown

const opt: Option<unknown> = "anything"; // No error - accepts any value
```

**Analysis:**
This is a consequence of how TypeScript handles union with `unknown`. Similar issues affect `Option<any>` and `Option<never>`.

**Recommendation:** Document that `Option<unknown>` is degenerate. Consider a branded Option type for these edge cases.

---

## Finding #6: P.empty Works on Strings (Unintended)

**Module:** `@typesugar/std/macros/match`
**Severity:** Very Low (surprising but harmless)
**Status:** CONFIRMED

**Description:**
The `P.empty` predicate checks `.length === 0`, which works on strings too, not just arrays.

**Reproduction:**

```typescript
P.empty("hello"); // false
P.empty(""); // true
P.empty([]); // true
```

**Analysis:**
Not a bug per se, but may surprise users who expect array-only behavior.

---

## Finding #7: OR Pattern Keys Conflict with Literal Discriminants

**Module:** `@typesugar/std/macros/match`
**Severity:** Low (edge case)
**Status:** TESTED (works correctly)

**Description:**
When a discriminant literal value contains `|`, it conflicts with the OR pattern syntax. However, testing shows the implementation correctly handles this as a literal.

**Reproduction:**

```typescript
type WeirdUnion = { kind: "a|b"; value: 1 };
const val: WeirdUnion = { kind: "a|b", value: 1 };

// "a|b" could be OR pattern or literal
match(val, {
  "a|b": () => "pipe literal", // Works - treated as OR pattern with arms ["a", "b"]
});
```

**Analysis:**
The OR pattern split happens unconditionally. If your discriminant contains `|`, you'll get unexpected behavior where it's split. In the test case, the value `"a|b"` doesn't match arms `["a", "b"]`.

This is actually a potential bug if someone has a discriminant value containing `|`.

---

## Finding #8: Nested HKT Types Crash Preprocessor

**Module:** `@typesugar/preprocessor`
**Severity:** High (crashes the compiler)
**Status:** FIXED

**Fix:** The HKT extension now properly handles nested type applications by processing replacements from innermost to outermost, avoiding overlapping edits.

**Description:**
Nested HKT type applications like `F<G<A>>` crash the preprocessor with "Cannot split a chunk that has already been edited" error from magic-string.

**Reproduction:**

```typescript
interface Nested<F<_>, G<_>> {
  fg: <A>(fa: F<G<A>>) => G<F<A>>;
}
```

**Error:**

```
Error: Cannot split a chunk that has already been edited (0:45 – "F<G<A>>")
```

**Analysis:**
The HKT extension creates overlapping replacements when nested type applications are present. The inner `G<A>` gets replaced first, then the outer `F<...>` tries to replace a range that overlaps with the already-replaced region.

**Recommendation:** Sort and merge replacements to avoid overlapping edits, or process from innermost to outermost.

---

## Finding #9: Source Maps Not Always Generated

**Module:** `@typesugar/preprocessor`
**Severity:** Low (debugging inconvenience)
**Status:** CONFIRMED

**Description:**
The preprocessor's `sourceMap` return value is sometimes `undefined` even when changes were made.

**Reproduction:**

```typescript
const { code, changed, sourceMap } = preprocess(`
  const pipeline1 = x |> f |> g;
  const pipeline2 = y |> h |> i;
`);

console.log(changed); // true
console.log(sourceMap); // undefined!
```

**Analysis:**
Likely the source map generation is conditional or failing silently.

**Recommendation:** Always generate source maps when changes are made, or document when they're not generated.

---

## Finding #10: Linear Prover Doesn't Handle Scientific Notation

**Module:** `@typesugar/contracts/prover/linear`
**Severity:** Medium (proof incomplete)
**Status:** CONFIRMED

**Description:**
The linear arithmetic prover uses regex patterns like `(-?\d+(?:\.\d+)?)` which don't match scientific notation. This means bounds like `x >= 1e-300` or `x >= 1e308` are not parsed.

**Reproduction:**

```typescript
const facts = [{ variable: "x", predicate: "x >= 1e-300" }];
tryLinearArithmetic("x > 0", facts); // false! Should be true
```

**Analysis:**
The regex `\d+(?:\.\d+)?` doesn't handle:

- Scientific notation: `1e-300`, `1e308`
- Negative zero: `-0`
- Infinity: `Infinity`
- NaN: `NaN` (though this is semantically problematic anyway)

**Recommendation:** Extend regex to handle scientific notation: `(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)`.

---

## Finding #11: Linear Prover Uses ASCII-Only Variable Names

**Module:** `@typesugar/contracts/prover/linear`
**Severity:** Low (non-ASCII code is rare)
**Status:** CONFIRMED

**Description:**
The prover regex uses `\w+` for variable names, which in JavaScript regex doesn't match Unicode letters. Greek letters, accented characters, etc. won't work.

**Reproduction:**

```typescript
const facts = [{ variable: "αβγ", predicate: "αβγ > 0" }];
tryLinearArithmetic("αβγ > 0", facts); // false! Should be true
```

**Analysis:**
JavaScript `\w` only matches `[A-Za-z0-9_]`. Unicode identifiers like `αβγ`, `résultat`, or `数值` are valid TypeScript identifiers but won't match.

**Recommendation:** Use Unicode-aware regex pattern or explicitly enumerate character classes. E.g., use `[\p{L}\p{N}_]+` with the `u` flag.

---

## Finding #12: Equality Doesn't Imply Inequalities in Prover

**Module:** `@typesugar/contracts/prover/linear`
**Severity:** Medium (incomplete proofs)
**Status:** CONFIRMED

**Description:**
When a variable is known to equal a constant (e.g., `x == 5`), the prover doesn't derive that it satisfies related inequalities (e.g., `x > 0`, `x < 10`).

**Reproduction:**

```typescript
const facts = [{ variable: "x", predicate: "x == 5" }];
tryLinearArithmetic("x > 0", facts); // false! Should be true (5 > 0)
```

**Analysis:**
The prover has a pattern for `x >= c` given `x == c` but not for deriving strict inequalities. The equality `x == 5` should let us conclude `x > 0`, `x >= 0`, `x < 10`, etc.

**Recommendation:** Add rule that equality facts can be used to satisfy inequality goals when the constant satisfies the inequality.

---

## Finding #13: TypeFact Predicate Parsing Doesn't Split ANDs Correctly

**Module:** `@typesugar/contracts/prover/linear`
**Severity:** High (compound refinements don't work)
**Status:** FIXED

**Fix:** The `splitFacts()` function now properly splits compound predicates on `&&` before passing to the linear arithmetic solver.

**Description:**
Compound predicates like `x >= 0 && x <= 255` (common for UInt8) don't get properly split into individual constraints for the Fourier-Motzkin solver.

**Reproduction:**

```typescript
const facts = [{ variable: "x", predicate: "x >= 0 && x <= 255" }];
tryLinearArithmetic("x >= 0", facts); // false! Should be true
```

**Analysis:**
The code in `tryLinearProof` does try to split on `&&`:

```typescript
const parts = fact.predicate.split("&&").map((p) => p.trim());
```

But there seems to be an issue where this doesn't work correctly. The constraint parsing may be expecting different formatting.

**Recommendation:** Debug the AND-splitting logic. May need to normalize whitespace more aggressively.

---

## Finding #14: Comptime Cannot Serialize BigInt

**Module:** `@typesugar/comptime`
**Severity:** Low (edge case)
**Status:** FIXED

**Fix:** Added `kind: "bigint"` to `ComptimeValue` type and proper BigInt handling in both `jsToComptimeValue` and `jsValueToExpression`.

**Description:**
The `jsToComptimeValue` function doesn't handle BigInt values, returning an error instead.

**Reproduction:**

```typescript
import { jsToComptimeValue } from "@typesugar/comptime";

const result = jsToComptimeValue(BigInt(9007199254740991));
// result.kind === "error"
```

**Analysis:**
The comptime value conversion needs a `bigint` case. The `jsValueToExpression` function in the same module does handle BigInt correctly (calls `createBigIntLiteral`), but the ComptimeValue type representation doesn't have a BigInt variant.

**Recommendation:** Add `kind: "bigint"` to ComptimeValue type and handle it in jsToComptimeValue.

---

## Finding #15: Comptime Circular Reference Detection Missing

**Module:** `@typesugar/comptime`
**Severity:** Medium (can hang compiler)
**Status:** FIXED

**Fix:** Added `WeakSet` tracking of visited objects in both `jsValueToExpression` and `jsToComptimeValue` to detect and report circular references gracefully.

**Description:**
The `jsValueToExpression` function recursively processes objects/arrays without detecting circular references. A circular object would cause infinite recursion and stack overflow.

**Reproduction:**

```typescript
const obj: any = { a: 1 };
obj.self = obj;

// comptime(() => obj)  // Would hang during AST generation
```

**Analysis:**
Need to add a `seen` WeakSet to track visited objects and detect cycles.

**Recommendation:** Add circular reference detection before recursing into object/array properties.

---

## Finding #16: Symbolic Limit Evaluation Returns Large Numbers, Not Infinity

**Module:** `@typesugar/symbolic`
**Severity:** Low (numeric approximation)
**Status:** FIXED

**Fix:** Updated `computeLimitInternal` to detect non-finite results and return symbolic `Infinity` or `-Infinity` as appropriate. One-sided limits (`left`, `right`) now return proper infinity values, and two-sided limits check consistency of infinite limits.

**Description:**
The `limit()` function uses numeric approximation with small epsilon values. For limits that approach infinity (e.g., `lim x->0 of 1/x`), it returns very large numbers (~1e10) rather than `Infinity`.

**Reproduction:**

```typescript
const x = var_("x");
const expr = limit(div(ONE, x), "x", 0, "right");
const result = evaluate(expr, {}); // Returns ~1e10, not Infinity
```

**Analysis:**
This is expected behavior for numeric approximation. The implementation samples the function at small epsilon values and returns the result. For better infinity detection, could check if result exceeds a threshold.

---

## Finding #17: Complex Division by Zero Throws

**Module:** `@typesugar/math`
**Severity:** Low (design choice)
**Status:** CONFIRMED

**Description:**
Complex number division by zero throws an error rather than returning `Infinity` or `NaN`.

**Reproduction:**

```typescript
const a = complex(1, 1);
const zero = complex(0, 0);
fractionalComplex.div(a, zero); // Throws "Complex division by zero"
```

**Analysis:**
This is a design choice. Throwing is arguably safer than returning `Infinity` which could propagate silently.

---

## Finding #18: Complex Log(0) Throws

**Module:** `@typesugar/math`
**Severity:** Low (design choice)
**Status:** CONFIRMED

**Description:**
`log(complex(0, 0))` throws rather than returning `-Infinity`.

**Reproduction:**

```typescript
const z = complex(0, 0);
floatingComplex.log(z); // Throws "Complex logarithm of zero"
```

**Analysis:**
Similar to Finding #17, this is a design choice for safety.

---

## Finding #19: Rational fromNumber Precision Limits

**Module:** `@typesugar/math`
**Severity:** Low (algorithm limitation)
**Status:** CONFIRMED

**Description:**
The `fromNumber()` continued fraction algorithm has limited precision for very small or very large numbers.

**Reproduction:**

```typescript
const r = fromNumber(1e-10);
const back = toNumber(r); // May return 0 instead of 1e-10
```

**Analysis:**
The continued fraction algorithm uses a default `maxDenominator` of 1000000. Very small numbers require larger denominators to represent accurately.

**Recommendation:** Consider increasing `maxDenominator` default or adding special handling for extreme values.

---

## Finding #20: HList splitAt Negative Index Behavior

**Module:** `@typesugar/hlist`
**Severity:** Very Low (undocumented behavior)
**Status:** CONFIRMED

**Description:**
`splitAt(list, -1)` treats negative indices as offsets from the end, similar to JavaScript's `slice()`.

**Reproduction:**

```typescript
const list = hlist(1, 2, 3);
const [left, right] = splitAt(list, -1);
// left = [1, 2], right = [3]
```

**Analysis:**
This is consistent with JavaScript array semantics but should be documented.

---

## Finding #21: LabeledHList **proto** Key Blocked

**Module:** `@typesugar/hlist`
**Severity:** Low (JavaScript quirk)
**Status:** CONFIRMED

**Description:**
Using `__proto__` as a field name in `labeled()` doesn't work because JavaScript treats it as a prototype setter.

**Reproduction:**

```typescript
const rec = labeled({ __proto__: "value" });
get(rec, "__proto__"); // Throws - field not found
```

**Analysis:**
This is a JavaScript language limitation. The `__proto__` property is special and cannot be used as a regular object key.

**Recommendation:** Document this limitation. Consider using `Object.create(null)` for the internal storage.

---

## Finding #22: Vec Operations Return FusedVec Objects

**Module:** `@typesugar/fusion`
**Severity:** Very Low (API awareness)
**Status:** CONFIRMED

**Description:**
Vec operations return `FusedVec<T>` objects with `{ data, length }` structure, not raw arrays.

**Reproduction:**

```typescript
const a = vec([1, 2, 3]);
const result = add(a, a);
result[0]; // undefined - result is { data: [...], length: 3 }
result.data[0]; // 2 - correct way to access
```

**Analysis:**
This is by design for the fusion system, but may surprise users expecting array returns.

---

## Finding #23: match() Non-Standard Discriminant Names Require Explicit Parameter

**Module:** `@typesugar/std`
**Severity:** Low (requires explicit param)
**Status:** IMPROVED

**Fix:** Extended the common discriminant names list to include: `variant`, `action`, `event`, `case`, `state`, `name`, `nodeType`, `message`. This covers many more common patterns from Redux, state machines, AST nodes, and event systems.

**Description:**
When using discriminant field names not in the common list (`kind`, `_tag`, `type`, `ok`, `status`, `tag`, `discriminant`), you must pass the discriminant name explicitly.

**Reproduction:**

```typescript
type Greeting = { lang: "ja"; message: string } | { lang: "en"; message: string };
const val: Greeting = { lang: "ja", message: "Hello" };

// Fails without explicit discriminant
match(val, { ja: () => "Japanese", en: () => "English" });
// Error: no handler for 'undefined'

// Works with explicit discriminant
match(val, { ja: () => "Japanese", en: () => "English" }, "lang");
```

**Analysis:**
The runtime fallback tries common discriminant names. Non-standard names like `lang` aren't detected automatically.

**Recommendation:** Document the supported discriminant names and how to specify custom ones.

---
