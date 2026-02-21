# Error Messages

typesugar error messages are modeled after Rust's compiler — they show you the problem, the context, and a fix.

## What They Look Like

Here's what happens when you try to compare two values and typesugar can't derive `Eq`:

```
error[TS9001]: No instance found for `Eq<Color>`
  --> src/palette.ts:12:5
   |
10 |   interface Palette { primary: Color; accent: Color }
11 |
12 |   p1 === p2
   |      ^^^ Eq<Palette> requires Eq for all fields
   |
 8 |   interface Color { r: number; g: number; b: number }
   |   --------- field `primary` has type `Color`
   |
   = note: Auto-derivation requires Eq instances for all fields
   = help: Add @derive(Eq) to Color, or provide @instance Eq<Color>
   = suggestion: add-derive-eq
     + @derive(Eq)
     + interface Color { r: number; g: number; b: number }

For more information, see: https://typesugar.dev/errors/TS9001
```

Every error has:

- **Error code** (TS9001) — look up the full explanation with `npx typesugar --explain TS9001`
- **Primary span** — points at exactly what went wrong
- **Secondary labels** — show related code (like the field that caused the problem)
- **Notes** — explain why this happened
- **Help** — tell you what to do
- **Suggestions** — machine-applicable fixes your IDE can apply with one click

## Error Categories

| Range         | Category             | Examples                                                        |
| ------------- | -------------------- | --------------------------------------------------------------- |
| TS9001-TS9099 | Typeclass Resolution | No instance, ambiguous instances, coherence conflicts           |
| TS9101-TS9199 | Derive Failures      | Missing field instance, unsupported type, circular derivation   |
| TS9201-TS9299 | Macro Syntax         | Wrong argument count, invalid target, not compile-time constant |
| TS9301-TS9399 | HKT                  | Invalid type-level function, kind mismatch                      |
| TS9401-TS9499 | Extension Methods    | Method not found, ambiguous extension                           |
| TS9501-TS9599 | Comptime             | Evaluation failed, permission denied                            |
| TS9601-TS9699 | Specialization       | Dictionary not registered, function body not inlineable         |
| TS9701-TS9799 | Import Resolution    | Missing import, ambiguous resolution                            |
| TS9801-TS9899 | Operators            | Invalid overload, preprocessor/typeclass overlap                |

Full reference: [Error Code Reference](/errors/)

## Examples by Category

### Missing Typeclass Instance (TS9001)

The most common error. You're using `===`, `.show()`, or `summon()` on a type that doesn't have the required typeclass.

```
error[TS9001]: No instance found for `Show<ApiResponse>`
  --> src/api.ts:24:10
   |
24 |   console.log(response.show())
   |                        ^^^^ Show<ApiResponse> is required
   |
   = note: ApiResponse has field `headers` of type `Headers` which lacks Show
   = help: Provide @instance Show<Headers>, or use JSON.stringify() instead
```

**Fixes:**

- Add `@derive(Show)` to both `ApiResponse` and `Headers`
- Provide a manual `@instance` for the problematic field type
- If it's a third-party type, create a newtype wrapper

### Derive Field Error (TS9101)

Auto-derivation builds instances from field instances. If a field's type doesn't have the required instance, you get a precise error pointing at the field:

```
error[TS9101]: Cannot auto-derive Eq<UserProfile>: field `metadata` has type `unknown` which lacks Eq
  --> src/user.ts:5:3
   |
 3 |   interface UserProfile {
 4 |     id: number;
 5 |     metadata: unknown;
   |     ^^^^^^^^ this field prevents auto-derivation
   |
   = note: `unknown` cannot implement Eq — it could be anything
   = help: Use a concrete type instead of `unknown`, or provide @instance Eq<UserProfile>
```

### Import Suggestion (TS9061)

Forgot to import something? typesugar knows what's available:

```
error[TS9061]: Macro `comptime` is not defined
  --> src/app.ts:3:15
   |
 3 |   const x = comptime(() => fibonacci(10));
   |             ^^^^^^^
   |
   = help: Did you mean to import?
     + import { comptime } from "typesugar";
```

This also works for typeclasses and extension methods:

```
error[TS9062]: Method `clamp` does not exist on type `number`
  --> src/math.ts:7:20
   |
 7 |   const safe = value.clamp(0, 100);
   |                      ^^^^^ not a native number method
   |
   = help: Did you mean to import?
     + import { NumberExt } from "@typesugar/std";
```

### Coherence Violation (TS9050)

Two instances for the same (typeclass, type) pair? typesugar catches it:

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

### Comptime Evaluation Error (TS9501)

When compile-time code throws:

```
error[TS9501]: Compile-time evaluation failed: Cannot read file './missing.json'
  --> src/config.ts:3:15
   |
 3 |   const cfg = comptime({ fs: 'read' }, () => {
   |               ^^^^^^^
 4 |     return JSON.parse(fs.readFileSync('./missing.json', 'utf8'));
   |                                       ^^^^^^^^^^^^^^^^ file not found
 5 |   });
   |
   = note: comptime blocks run at compile time — file paths are relative to the source file
   = help: Check that the file exists at the expected path
```

### Tail Recursion Error (TS9220)

`@tailrec` tells you exactly which call isn't in tail position:

```
error[TS9220]: @tailrec: recursive call is not in tail position
  --> src/math.ts:4:10
   |
 3 |   @tailrec
 4 |   function factorial(n: number): number {
 5 |     if (n <= 1) return 1;
 6 |     return n * factorial(n - 1);
   |            ^^^^^^^^^^^^^^^^^^^^ `n * ...` wraps the recursive call
   |
   = help: Rewrite with an accumulator:
     + function factorial(n: number, acc = 1): number {
     +   if (n <= 1) return acc;
     +   return factorial(n - 1, n * acc);
     + }
```

### Specialization Fallback Warning (TS9601)

When `specialize()` can't inline a function and falls back to dictionary passing:

```
warning[TS9601]: specialize(processItems): falling back to dictionary passing — try/catch
  --> src/process.ts:12:15
   |
10 |   function processItems<F>(F: Functor<F>, items: Kind<F, Item>) {
11 |     try {
12 |       return F.map(items, validate);
   |              ^^^^^^^^^^^^^^^^^^^^^^^^
13 |     } catch (e) { return items; }
14 |   }
   |
   = help: Move error handling outside the specialized function
```

Common reasons for fallback:
- **Dictionary not registered**: The instance isn't known to the compiler. Use `@instance` or `registerInstanceMethods()`.
- **Function body not resolvable**: Can't find the function definition. Use `const fn = ...` or named `function`.
- **Early return**: Multiple return paths prevent inlining. Extract into helpers.
- **try/catch**: Error handling blocks inlining. Handle errors at a higher level.
- **Loops**: Iteration prevents inlining. Use Array methods or recursive helpers.
- **Mutable variables**: `let` bindings prevent inlining. Use `const` or fold/reduce patterns.

Suppress with `// @no-specialize-warn`:

```typescript
// @no-specialize-warn
const specialized = specialize(fn, dict);  // No warning emitted
```

## CLI: `--explain`

Get the full explanation for any error code:

```bash
$ npx typesugar --explain TS9001

error[TS9001]: No instance found for typeclass

The typeclass system could not find or auto-derive an instance.

Possible causes:
1. The type has no @instance declaration for this typeclass
2. Auto-derivation failed (e.g., a field lacks a required instance)
3. The type is opaque or from a library without typeclass support

Solutions:
- Add @derive(Eq) to the type definition
- Provide an explicit @instance implementation
- Check that all fields have the required instances

See also: https://typesugar.dev/errors/TS9001
```

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

This produces:

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
