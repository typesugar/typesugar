# Playground Examples Review Log

Reviewed all 32 playground examples across 15 groups. Each was assessed for:

1. Showcase quality (does it show the best of the module?)
2. Transformer output quality (does generated code make sense?)
3. Playground deployment readiness (types, runtime, declarations)

---

## Critical Issues (Playground Will Break)

### P0 — Examples that will fail in the deployed playground

| Example                            | Issue                                                                                                                                                                                                                                                       | Fix Required                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **math/numeric-typeclass.ts**      | `@typesugar/math` is NOT registered in playground runtime-entry.ts (explicitly excluded). Ambient declarations missing `numericComplex`, `complexToString`, `complexMagnitude`, `complexEquals`. Operator overloading will not fire and runtime will crash. | Add math to runtime-entry OR rewrite example to not need runtime math imports |
| **collections/hashset-hashmap.ts** | `HashMap.getOrElse` not declared in playground-declarations. `hashNumber` declared as function instead of `Hash<number>` object. `Eq` constructor param expects `eqv()` but real instances use `equals()`.                                                  | Fix playground-declarations for HashMap and hashNumber                        |
| **core/cfg.ts**                    | Declaration says `cfg(condition: boolean): void` — completely wrong. Actual: `cfg<T>(condition: string, thenValue: T, elseValue?: T): T`. Will cause type errors.                                                                                           | Fix playground declaration                                                    |
| **core/specialize.ts**             | Declaration says `specialize<F>(fn: F): F` (1 arg) but example calls `specialize(fold, numberAdd)` (2 args). Type error in playground.                                                                                                                      | Fix playground declaration                                                    |
| **fp/validated.ts**                | `Validated.mapN` not declared (namespace method missing). `NonEmptyList` not declared; `e.head` will fail type check.                                                                                                                                       | Add Validated namespace + mapN to declarations                                |
| **preprocessor/pipeline.sts**      | Listed in `KNOWN_PREPROCESS_ISSUES` in test suite — transformation currently fails.                                                                                                                                                                         | Fix preprocessor pipeline handling                                            |

### P1 — Declaration mismatches (may cause subtle failures)

| Example                           | Issue                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **core/tailrec.ts**               | Example uses `@tailrec` decorator but declaration exposes `tailrec` as a function                             |
| **core/pipe-compose.ts**          | `compose` only has 2-arg overload but example uses 3 arguments                                                |
| **validate/schema-validation.ts** | Never actually uses `@typesugar/validate` — imports only from `typesugar`. Misleading categorization          |
| **fp/linked-list.ts**             | `Nil` declared as `{ _tag: "Nil" }` object but example claims `Nil` is `null` at runtime — potential mismatch |

### P2 — Missing examples (GROUP_META entries with no files)

| Group      | Status                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| **mapper** | Has GROUP_META entry (order 92), ambient declarations, and runtime registration — but no example file   |
| **sql**    | Has GROUP_META entry (order 90) — but no example file, no ambient declarations, no runtime registration |

---

## Per-Example Quality Ratings

### Getting Started

| Example       | Rating | Verdict                                                                                                                |
| ------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| welcome.ts    | 4/5    | Solid intro to 4 core macros. Missing `match` which is arguably the signature feature                                  |
| full-stack.ts | 3/5    | Too complex for getting-started. Tries 6+ features. `@opaque` is advanced; `==` vs `===` inconsistency with welcome.ts |

**Suggestions:** Add `match` to welcome.ts. Move full-stack.ts to an "advanced" group or simplify it. Bridge gap with intermediate examples.

### Core Macros

| Example          | Rating | Verdict                                                                                   |
| ---------------- | ------ | ----------------------------------------------------------------------------------------- |
| typeclass.ts     | 5/5    | Excellent. Complete lifecycle: define, impl, summon, implicit. Best in group              |
| pipe-compose.ts  | 5/5    | Excellent. Three macros clearly demonstrated with practical example                       |
| derive.ts        | 4/5    | Good. Could show nested structures and `@derive(Ord, Hash)`                               |
| operators.ts     | 4/5    | Good. Only shows `+`; second operator would strengthen it                                 |
| tailrec.ts       | 4/5    | Good. BigInt fibonacci is impressive. Missing: showing compile error on non-tail calls    |
| static-assert.ts | 4/5    | Good. Missing: showing a failing assertion                                                |
| extension.ts     | 4/5    | Good. May need Number/String augmentations in declarations                                |
| specialize.ts    | 4/5    | Good concept but declaration is wrong                                                     |
| comptime.ts      | 3/5    | Weak. Examples trivially simple — factorial, string join. Needs real-world use case       |
| reflect.ts       | 3/5    | Weak. Doesn't differentiate reflect/typeInfo/fieldNames clearly                           |
| cfg.ts           | 2/5    | Broken. Wrong declaration. All conditions resolve to "else" in playground (no cfg config) |

### FP

| Example          | Rating | Verdict                                                                                       |
| ---------------- | ------ | --------------------------------------------------------------------------------------------- |
| option-either.ts | 4/5    | Good zero-cost demo. But filename is misleading — no Either usage at all. Missing `.fold()`   |
| linked-list.ts   | 4/5    | Good pattern matching demo. Nil representation uncertain. No `List.map`/`List.fold`           |
| validated.ts     | 3/5    | Good concept but `Validated.mapN` missing from declarations. No zero-cost story (not @opaque) |

**Suggestions:** Rename option-either.ts to option.ts or add Either examples. Add `.fold()`. Fix Validated declarations.

### Std

| Example             | Rating | Verdict                                                                                                       |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| pattern-matching.ts | 4/5    | Good but omits advanced features: guards (`.if()`), type constructor patterns, regex patterns                 |
| do-notation.ts      | 3/5    | Has redundant manually-written "compiled form" that produces duplicate console output. Only shows Array monad |
| ranges.ts           | 3/5    | Verbose function-based API. "Zero-cost" claim in comments is likely inaccurate. Unrelated `staticAssert`      |

**Suggestions:** Add `.if()` guards to pattern-matching. Remove manual compiled form from do-notation, add Promise/Option monad. Remove misleading zero-cost claim from ranges.

### Graph

| Example           | Rating | Verdict                                                                          |
| ----------------- | ------ | -------------------------------------------------------------------------------- |
| state-machine.ts  | 5/5    | Excellent. DSL, verification, type-safe transitions. Dead import `deadEndStates` |
| directed-graph.ts | 4/5    | Good. Practical monorepo build-order use case. Trivial staticAssert              |

### Collections

| Example            | Rating | Verdict                                                                  |
| ------------------ | ------ | ------------------------------------------------------------------------ |
| hashset-hashmap.ts | 3/5    | Multiple declaration mismatches (getOrElse, hashNumber, Eq method names) |

### Math + Symbolic

| Example                   | Rating | Verdict                                                                                            |
| ------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| symbolic/calculus.ts      | 4/5    | Good breadth (diff, integrate, simplify, LaTeX). `const_()` wrapping is verbose. Filler `comptime` |
| math/numeric-typeclass.ts | 2/5    | Will crash in playground. Only shows Complex. Package has Rational, Matrix, Money, etc.            |

### Units + Contracts + Validate

| Example                         | Rating | Verdict                                                                                 |
| ------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| contracts/design-by-contract.ts | 4/5    | Best of the three. `MAX_BALANCE` declared but never used in any contract                |
| units/dimensional-analysis.ts   | 3/5    | `mass.value * gravity.value` manually extracts values — defeats type-safe units purpose |
| validate/schema-validation.ts   | 2/5    | Never uses `@typesugar/validate`. Uses only core macros in validation-themed wrapper    |

### Codec + Parser + Testing

| Example                 | Rating | Verdict                                                                         |
| ----------------------- | ------ | ------------------------------------------------------------------------------- |
| parser/arithmetic.ts    | 5/5    | Strongest. Grammar DSL vs manual combinator comparison is compelling            |
| testing/power-assert.ts | 4/5    | Good concept. All assertions pass so user never sees power-assert diagnostics   |
| codec/schema-codec.ts   | 3/5    | Functional but `comptime(() => 2)` and `staticAssert(2 > 1)` are trivial filler |

### Preprocessor

| Example           | Rating | Verdict                                                                      |
| ----------------- | ------ | ---------------------------------------------------------------------------- |
| pipeline.sts      | 3/5    | Fails transformation (in KNOWN_PREPROCESS_ISSUES). Good concept when working |
| cons-operator.sts | 3/5    | Only shows array `::`, not typeclass-dispatched cons. Decent intro           |

---

## Improvement Priorities

### Tier 1 — Fix broken playground deployment

1. Fix `cfg` playground declaration: `cfg<T>(condition: string, thenValue: T, elseValue?: T): T`
2. Fix `specialize` declaration: add second argument for dictionary
3. Fix `compose` declaration: add 3-arg and 4-arg overloads
4. Add `Validated` namespace with `mapN` to playground-declarations
5. Fix `HashMap` declarations: add `getOrElse`, fix `hashNumber` type
6. Add `@typesugar/math` to playground runtime OR rewrite math example
7. Fix `tailrec` declaration to support decorator usage
8. Fix `pipeline.sts` preprocessor issue

### Tier 2 — Improve weak examples

1. **cfg.ts** (2/5) — Rewrite with correct declaration and interesting cfg config
2. **validate/schema-validation.ts** (2/5) — Actually use `is<T>()` from `@typesugar/validate`
3. **math/numeric-typeclass.ts** (2/5) — Show more types (Rational, Matrix), fix runtime
4. **comptime.ts** (3/5) — Add real-world use cases (lookup tables, config validation)
5. **reflect.ts** (3/5) — Differentiate macros clearly, add practical ORM/validation use
6. **units/dimensional-analysis.ts** (3/5) — Use `mass.mul(gravity)` not manual `.value` extraction

### Tier 3 — Polish good examples

1. Add `match` to welcome.ts
2. Add Either examples to option-either.ts (or rename)
3. Add `.fold()` to Option example
4. Add guards/type-constructor patterns to pattern-matching
5. Remove duplicate compiled form from do-notation
6. Add failing assertion example to power-assert
7. Remove dead `deadEndStates` import from state-machine.ts
8. Create mapper and sql examples (or remove GROUP_META entries)

### Tier 4 — Filler `comptime`/`staticAssert` cleanup

Many examples pad with unrelated `comptime(() => ...)` or `staticAssert(trivially_true)`. These should either be removed or replaced with domain-relevant compile-time checks:

- units: `staticAssert(42195 > 0)` — trivial
- collections: `staticAssert(2 + 2 === 4)` — trivial
- graph: `staticAssert("typesugar".length > 0)` — trivial
- codec: `staticAssert(2 > 1)` — trivial
- math: `comptime(() => Math.PI)` — unrelated to complex numbers
- symbolic: `comptime(() => 0.5 * 16 + 12)` — unrelated to symbolic math
