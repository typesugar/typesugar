# Error Messages

typesugar error messages are modeled after Rust's compiler — they tell you the problem, why it
happened, and a fix.

## What They Look Like

Here's what `summon` reports when it can't find or derive an `Eq` instance, because one field's
type has no `Eq`:

```typescript
import { summon } from "typesugar";
import type { Eq } from "@typesugar/std";

interface Color {
  r: number;
  g: number;
  b: number;
}
interface Point {
  x: number;
  y: number;
  color: Color;
}

const eqPoint = summon<Eq<Point>>();
```

```
src/palette.ts(15,17): error TS9001: [typesugar] [TS9001] No instance found for `Eq<Point>`
  = note: resolution trace for Eq<Point>:
  = note:   1. explicit-instance: Eq<Point> — not found — no @impl/@instance value for this type in scope
  = note:   2. auto-derive via Generic: Eq<Point> — FAILED — see child attempts
  = note:     derivation-strategy: Eq — ok
  = note:     generic-meta: GenericMeta for Point: { x: number, y: number, color: Color } — FAILED — one or more fields lack required instance
  = note:       field-check: field `x`: number — ok — number has Eq
  = note:       field-check: field `y`: number — ok — number has Eq
  = note:       field-check: field `color`: Color — FAILED — Color lacks Eq
  = help: Add @derive(Eq) to Color, or provide @instance Eq<Color>
    Add: import { Eq } from "typesugar";
```

The CLI (`typesugar build` / `check`) prints each diagnostic in the familiar `tsc` layout —
`file(line,col): error TS<code>: message` — and your editor shows the same text at the primary
location. A diagnostic carries:

- **Error code** (TS9001) — look up the full explanation in the [Error Code Reference](/errors/)
  (each page is at `/errors/TS<code>`). Diagnostics that don't have a dedicated code yet are
  reported as TS9999.
- **Primary location** — the expression or declaration that went wrong
- **Notes** — explain why this happened (such as the resolution trace above)
- **Help** — tell you what to do

## Error Categories

| Range         | Category             | Examples                                                        |
| ------------- | -------------------- | --------------------------------------------------------------- |
| TS9001-TS9099 | Typeclass Resolution | No instance, ambiguous instances, coherence conflicts           |
| TS9101-TS9199 | Derive Failures      | Missing field instance, unsupported type, circular derivation   |
| TS9201-TS9299 | Macro Syntax         | Wrong argument count, invalid target, not compile-time constant |
| TS9301-TS9399 | HKT                  | Invalid type-level function, kind mismatch                      |
| TS9401-TS9499 | Extension Methods    | Method not found, ambiguous extension                           |
| TS9501-TS9599 | Comptime             | Evaluation failed, permission denied                            |
| TS9601-TS9699 | Specialization       | Function body not inlineable, auto-specialization skipped       |
| TS9701-TS9799 | Import Resolution    | Missing import, ambiguous resolution                            |
| TS9801-TS9899 | Operators            | Invalid overload, preprocessor/typeclass overlap                |

Full reference: [Error Code Reference](/errors/)

## Examples by Category

### Missing Typeclass Instance (TS9001)

The most common error: `summon()`, an `= implicit()` parameter, or another macro needs a
typeclass instance for a type that doesn't have one (see the example at the top of the page).

**Fixes:**

- Add `@derive(...)` to the type (and to the field types it lists as lacking the instance)
- Provide a manual `@impl` instance for the problematic field type
- If it's a type you don't own (from a library, such as `Feature` from
  `@types/geojson`), declare its instance once in a module of your own and
  import that module: by hand, or derived with
  `export const cloneFeature = derived<Clone<Feature>>();`. The TS9001 help
  says so for such a type. See
  [Instances for types you don't own](./typeclasses.md#external-types).

### Instance Derived in Place (TS9009, warning)

When no instance is in scope, `summon<TC<T>>()` and `= implicit()` still
derive one from the type's structure, a new copy at each call site, and warn
once per type per file:

```
warning TS9009: [typesugar] [TS9009] No instance for `Clone<Feature>` in scope; derived one here
  = help: Declare it once with `export const cloneFeature = derived<Clone<Feature>>();` in a module of your own, and import that module where the instance is used. summon and implicit() will stop deriving instances in a future release.
```

This fallback is deprecated. Declare the instance once, with `@derive` on a
type you own or `derived<TC<T>>()` for one you don't. A summon that is itself
the initializer of a top-level const (`export const cloneFeature =
summon<Clone<Feature>>()`) is already that declaration: write
`derived<Clone<Feature>>()` there.

### Derive Field Error

Auto-derivation builds instances from field instances. If a field's type doesn't have the
required instance, the error names the field:

```typescript
/** @derive(Eq) */
interface UserProfile {
  id: number;
  metadata: unknown;
}
```

```
error TS9106: [typesugar] [TS9106] Cannot derive Eq for 'UserProfile'
  = note: resolution trace for Eq<UserProfile>:
  1. derivation-strategy: Eq — ok
  2. generic-meta: GenericMeta for UserProfile: { id: number, metadata: unknown } — FAILED — one or more fields lack required instance
    field-check: field `id`: number — ok — number has Eq
    field-check: field `metadata`: unknown — FAILED — unknown lacks Eq
```

Use a concrete type instead of `unknown`, or provide the instance by hand.

### Non-Exhaustive Match (Pattern Matching)

The fluent `match().case().then()` API requires all cases to be handled. Missing cases produce a compile error:

```typescript
type Color = "red" | "green" | "blue";
match(color).case("red").then(0xff0000);
```

```
error TS9226: [typesugar] [TS9226] Non-exhaustive match — missing cases: "green", "blue"
  = help: Add the missing cases or use .else() / _ to handle remaining values.
```

For non-enumerable types (string, number, objects), you must add `.else()` or a `_` wildcard:

```
error TS9226: [typesugar] [TS9226] Non-exhaustive match — missing a fallback: the scrutinee type is not enumerable
  = help: Add .else() or a _ wildcard to handle all remaining values.
```

**Fixes:**

- Add the missing `.case()` arms for literal unions and discriminated unions
- Use `.else(value)` or `.case(_).then(value)` for catch-all
- Runtime safety net: when the arms can't be shown to cover the value, the generated code ends in a throw of `MatchError` with `.value` set to the unmatched value ([Runtime Safety Net](./pattern-matching.md#runtime-safety-net))
- The statement form, a `match:` label on a `switch`, reports a missing case with the same TS9226

### Import Suggestion (TS9061, TS9062)

> **Planned, not emitted in 1.0.** TS9061 ("Macro `comptime` is not defined", with an import
> suggestion) and TS9062 ("Method `clamp` does not exist on type `number`", suggesting
> `import { clamp } from "@typesugar/std"`) are reserved codes. Today a missing macro import gives
> TypeScript's own TS2304 ("Cannot find name 'comptime'"), and a missing extension import gives
> TS2339 — or, for a method `@typesugar/std` declares globally such as `(42).clamp()`, a runtime
> `TypeError` because the call is not rewritten. Import the macro or extension function by name.

### Coherence Violation (TS9050)

> **Planned, not emitted in 1.0.** typesugar does not check coherence yet, so two
> instances for the same (typeclass, type) pair currently compile silently. The
> output below is the intended diagnostic.

Two instances for the same (typeclass, type) pair would be reported like this:

```
error[TS9050]: Conflicting instance of `Show` for type `Point`
  --> src/rendering.ts:10:1
   |
 4 |   @instance const debugShow: Show<Point> = { ... };
   |   --------- first instance defined here
   |
10 |   @instance const prettyShow: Show<Point> = { ... };
   |   ^^^^^^^^^ conflicting instance
   |
   = note: Each (typeclass, type) pair must have exactly one instance
   = help: Remove one instance, or use a newtype wrapper for different behaviors
```

### Comptime Evaluation Error (TS9209)

When compile-time code throws:

```typescript
const cfg = comptime({ fs: "read" }, () => {
  return JSON.parse(fs.readFileSync("./missing.json", "utf8"));
});
```

```
error TS9209: [typesugar] [TS9209] Cannot evaluate expression at compile time
  = note: Compile-time evaluation failed at src/config.ts:3:13
  Source: comptime(() => {
    return JSON.parse(fs.readFileSync("./missing.json", "utf8"));
})
  Error: ENOENT: no such file or directory, open '/path/to/project/src/missing.json'
```

Relative paths resolve against the source file's directory, and file access is confined to the
project (tsconfig) directory.

### Tail Recursion Error

`@tailrec` tells you which function it couldn't optimize and the line of the call:

```typescript
/** @tailrec */
function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
```

```
error TS9220: [typesugar] [TS9220] @tailrec: could not optimize 'factorial' — recursive call is not in tail position (line 7)
```

Rewrite with an accumulator — `function factorial(n: number, acc = 1): number`, returning
`factorial(n - 1, n * acc)`.

### Auto-Specialization Skipped (TS9602)

Specialization is an always-on compiler optimization (PEP-053) — there is no
macro to call for it. When a call passes a known typeclass instance but the
transformer can't prove the inlining is sound, it falls back to dictionary
passing (always correct, just not zero-cost) and emits a TS9602 warning:

```typescript
function processItems<A>(M: Mapper<A>, items: A): A {
  try {
    return M.map(items, (x) => x + 1);
  } catch (e) {
    return items;
  }
}

const r = processItems(boxMapper, { v: 1 });
```

```
warning TS9602: [typesugar] [TS9602] Auto-specialization of processItems skipped — try/catch. Move error handling outside the specialized function
```

Common reasons for skipping:

- **Function body not resolvable**: Can't find the function definition (for example, it comes from a compiled package). Use `const fn = ...` or named `function` in your own code.
- **Early return**: Multiple return paths prevent inlining. Extract into helpers.
- **try/catch**: Error handling blocks inlining. Handle errors at a higher level.
- **Loops**: Iteration prevents inlining. Use Array methods or recursive helpers.
- **Mutable variables**: `let` bindings prevent inlining. Use `const` or fold/reduce patterns.
- **Propagated `= implicit()` call**: The body calls another `= implicit()` function without passing the instance, so the instance would be dropped from that inner call. Pass the instance through explicitly if you want the inner call inlined too.

Opt a call out of specialization entirely with `// @no-specialize` (same line or
the line above), or keep specialization but silence the warning with
`// @no-specialize-warn`:

```typescript
// @no-specialize-warn
const r2 = processItems(boxMapper, { v: 2 }); // no warning
```

## Explaining a Code

There is no `--explain` CLI flag. Every code has a page in the
[Error Code Reference](/errors/) — `/errors/TS9001` and so on — with the explanation, causes and
fixes. Codes marked _reserved_ there are defined but not emitted by the compiler yet.

## Resolution Traces

When typeclass resolution fails (e.g., `summon<Eq<Point>>()` can't find an instance), the error includes a resolution trace showing exactly what was tried and why each path failed (this is the trace from the example at the top of the page):

```
= note: resolution trace for Eq<Point>:
= note:   1. explicit-instance: Eq<Point> — not found — no @impl/@instance value for this type in scope
= note:   2. auto-derive via Generic: Eq<Point> — FAILED — see child attempts
= note:     derivation-strategy: Eq — ok
= note:     generic-meta: GenericMeta for Point: { x: number, y: number, color: Color } — FAILED — one or more fields lack required instance
= note:       field-check: field `x`: number — ok — number has Eq
= note:       field-check: field `y`: number — ok — number has Eq
= note:       field-check: field `color`: Color — FAILED — Color lacks Eq
= help: Add @derive(Eq) to Color, or provide @instance Eq<Color>
```

The trace shows:

1. **Resolution steps** — each attempt the compiler made (explicit instance lookup, auto-derivation, etc.)
2. **Nested children** — for auto-derivation, the per-field instance checks
3. **Pass/fail indicators** — "ok" for successful checks, "FAILED" for the blocker
4. **Contextual help** — based on what failed, suggests the most specific fix

This makes debugging typeclass issues much easier — instead of guessing why derivation failed, you can see exactly which field type is missing the required instance.

### Resolution Trace Sources

Resolution traces appear in error messages from:

| Source             | When traces appear                                             |
| ------------------ | -------------------------------------------------------------- |
| `summon<TC<T>>()`  | No explicit or auto-derived instance found                     |
| `= implicit()`     | Implicit parameter resolution failed                           |
| `derived<TC<T>>()` | The type, or one of its fields, can't be derived               |
| Operator rewriting | No typeclass with `Op<"+">` found (verbose mode only)          |
| Extension methods  | No typeclass or standalone extension found (verbose mode only) |

## For Macro Authors

The `DiagnosticBuilder` API lets you emit the same quality of error messages from your own macros:

```typescript
import { DiagnosticBuilder, TS9201 } from "@typesugar/core";

new DiagnosticBuilder(TS9201, sourceFile, emitter)
  .at(callExpr)
  .withArgs({ macro: "myMacro", expected: "2", received: "0" })
  .label(parentNode, "called from here")
  .note("myMacro requires a callback and a fallback value")
  .help("myMacro(callback, fallback)")
  .suggestion(callExpr, "add-args", "myMacro(() => x, defaultValue)")
  .emit();
```

Rendered with `renderDiagnosticCLI` (also from `@typesugar/core`), this looks like:

```
error[TS9201]: myMacro expects 2 argument(s), got 0
  --> src/example.ts:7:5
   |
 5 |   function process() {
   |   --------- called from here
   |
 7 |     myMacro()
   |     ^^^^^^^^^ expected 2 arguments
   |
   = note: myMacro requires a callback and a fallback value
   = help: myMacro(callback, fallback)
   = suggestion: add-args
     + myMacro(() => x, defaultValue)
```

You can also define custom error codes by adding to the `DIAGNOSTIC_CATALOG`. See the [Writing Macros](/writing-macros/) guide.
