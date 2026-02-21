# typesugar - Compile-time Macros for TypeScript

## Overview

typesugar is a compile-time metaprogramming system for TypeScript, inspired by:

- **Rust's proc_macro**: Token-based transformations, derive macros, attribute macros
- **Scala 3's inline/transparent**: Guaranteed inlining, compile-time evaluation, quoted expressions
- **Zig's comptime**: First-class compile-time execution, type-level computation

## Design Principles

### 0. Zero-Cost Abstractions

The foundational philosophy of typesugar: **you should never pay at runtime for
abstractions that can be resolved at compile time.**

This is the same principle that drives Rust's zero-cost abstractions and C++
templates. In TypeScript, the traditional approach to generic programming
(typeclasses, HKT, dictionary passing) introduces runtime overhead:

- **Dictionary passing**: Typeclass instances are objects passed as function arguments
- **Indirect dispatch**: Method calls go through object property lookups
- **Closure allocation**: Derived operations create new function objects
- **Compound overhead**: Derived `map`/`ap` implementations chain through multiple indirections

typesugar eliminates all of this at compile time via the `specialize` macro:

```typescript
// Generic code — write once, works with any Monad
function doubleAll<F>(M: Monad<F>, fa: Kind<F, number>): Kind<F, number> {
  return M.map(fa, (x) => x * 2);
}

// Specialized — zero runtime cost (macro eliminates dictionary at compile time)
const doubleArray = specialize(doubleAll, arrayMonad);
// Compiles to: (fa) => fa.map(x => x * 2)

const doubleOption = specialize(doubleAll, optionMonad);
// Compiles to: (fa) => fa._tag === "Some" ? { _tag: "Some", value: fa.value * 2 } : fa
```

The key insight: the type-level HKT machinery (`Kind<F, A>`, URI branding,
`HKTRegistry`) is already zero-cost — it's completely erased at runtime. The
`specialize` macro extends this to the value level by inlining dictionary
methods at their call sites, eliminating the last source of overhead.

#### How specialization works

1. **Instance registration**: Each typeclass instance registers its method
   implementations (as source code strings) with the specialization registry
   at macro-registration time.

2. **Dictionary elimination**: When `specialize(fn, dict)` is expanded, the
   macro removes the dictionary parameter from the function signature.

3. **Method inlining**: All `Dict.method(args...)` calls in the function body
   are replaced with the concrete implementation, with arguments substituted
   directly.

4. **Type narrowing**: `Kind<F, A>` in the signature resolves to the concrete
   type (e.g., `Array<A>`, `Option<A>`).

5. **Fallback**: If the dictionary isn't known at compile time, the macro falls
   back to partial application: `(...args) => fn(dict, ...args)`.

### 1. Syntax Compatibility

typesugar uses syntax that doesn't break TypeScript's tokenizer:

- **Decorator-style macros**: `@derive(Eq, Ord)`, `@operators({...})` (classes only — TS decorators cannot be applied to interfaces or type aliases)
- **Function call macros**: `comptime(expr)`, `ops(a + b)`, `pipe(x, f, g)`
- **Tagged template literals**: `` sql`SELECT * FROM users` ``, `` units`5 m/s` ``
- **Special type annotations**: `type T = Infer<typeof expr>`

### 2. Four Macro Categories

#### A. Expression Macros

Transform expressions at compile time:

```typescript
// Compile-time evaluation (uses Node's vm module for full JS semantics)
const factorial5 = comptime(() => {
  let result = 1;
  for (let i = 1; i <= 5; i++) result *= i;
  return result;
}); // Becomes: const factorial5 = 120;

// Supports closures, recursion, all JS built-ins
const fib10 = comptime(() => {
  const fib = (n: number): number => (n <= 1 ? n : fib(n - 1) + fib(n - 2));
  return fib(10);
}); // Becomes: const fib10 = 55;
```

#### B. Tagged Template Macros

First-class macro category for tagged template literals:

```typescript
// SQL with parameter binding
const query = sql`SELECT * FROM ${table} WHERE id = ${id}`;

// Units with compile-time dimensional analysis
const speed = units`5 meters`.div(units`2 seconds`);

// Regex with compile-time validation
const pattern = regex`^[a-zA-Z]+$`;
```

#### C. Derive Macros (Declarative)

Auto-generate implementations for classes:

```typescript
@derive(Eq, Ord, Debug, Clone)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}
// Generates: pointEq(), pointCompare(), debugPoint(), clonePoint()
```

> **Note**: TypeScript decorators only work on classes, methods, properties,
> accessors, and parameters. For interfaces and type aliases, use the
> `typeInfo<T>()` expression macro instead of `@derive`.

#### D. Attribute Macros (Procedural)

Transform entire declarations:

```typescript
@operators({ "+": "add", "-": "sub", "*": "mul", "/": "div" })
class Complex {
  constructor(
    public real: number,
    public imag: number
  ) {}

  add(other: Complex): Complex {
    return new Complex(this.real + other.real, this.imag + other.imag);
  }
  // ...
}

// Usage (transformed at compile time)
const c = ops(a + b); // Becomes: a.add(b)
```

### 3. Compile-Time Evaluation

typesugar uses Node's `vm` module for compile-time evaluation, giving you full
JavaScript semantics without maintaining a custom interpreter:

- Full language support: closures, recursion, all operators, built-in methods
- Sandboxed execution with configurable timeout (default 5s)
- Safe globals only (Math, JSON, Array, etc. — no fs, net, process)
- Automatic TypeScript-to-JavaScript transpilation

### 4. Compile-Time Reflection

```typescript
// Get type info directly from the type checker (no decorator needed)
const userFields = typeInfo<User>();
// { name: "User", kind: "interface", fields: [{ name: "id", type: "number" }, ...] }

// Get field names as an array
const names = fieldNames<User>(); // ["id", "name", "email"]

// Generate a runtime validator
const validateUser = validator<User>();
// (value: unknown) => ValidationResult<User>

// @reflect generates a companion metadata const
@reflect
class User {
  id: number;
  name: string;
  email: string;
}
// Also generates: export const __User_meta__ = { ... }
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     TypeScript Source                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      typesugar Transformer                         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  1. Identify macro invocations (calls, decorators,      ││
│  │     tagged templates)                                   ││
│  │  2. Look up macro in registry                           ││
│  │  3. Expand macro (AST → AST transformation)             ││
│  │  4. Report diagnostics through TS pipeline              ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  TypeScript Compiler (tsc)                   │
│  (with ts-patch for transformer integration)                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     JavaScript Output                        │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. MacroContext

Provides access to compilation context:

```typescript
interface MacroContext {
  // Source information
  sourceFile: ts.SourceFile;
  typeChecker: ts.TypeChecker;
  factory: ts.NodeFactory;

  // Code generation
  createIdentifier(name: string): ts.Identifier;
  parseExpression(code: string): ts.Expression;
  parseStatements(code: string): ts.Statement[];

  // Type utilities
  getTypeOf(node: ts.Node): ts.Type;
  isAssignableTo(source: ts.Type, target: ts.Type): boolean;

  // Compile-time evaluation
  evaluate(node: ts.Node): ComptimeValue;

  // Diagnostics (fed into TS diagnostic pipeline)
  reportError(node: ts.Node, message: string): void;
  reportWarning(node: ts.Node, message: string): void;
}
```

### 2. Macro Registry

Four macro categories with type-safe definition helpers:

```typescript
// Expression macro
const myMacro = defineExpressionMacro({
  name: "myMacro",
  expand(ctx, callExpr, args) { ... },
});

// Tagged template macro (first-class, not shoehorned through expression macros)
const sql = defineTaggedTemplateMacro({
  name: "sql",
  validate(ctx, node) { ... },  // optional compile-time validation
  expand(ctx, node) { ... },
});

// Derive macro
const Eq = defineDeriveMacro({
  name: "Eq",
  expand(ctx, target, typeInfo) { ... },
});

// Attribute macro
const reflect = defineAttributeMacro({
  name: "reflect",
  validTargets: ["class"],
  expand(ctx, decorator, target, args) { ... },
});
```

### 3. Error Handling

- Diagnostics are reported through the TypeScript diagnostic pipeline (not just console.log)
- Failed macro expansions emit `throw new Error(...)` expressions so failures are loud at runtime
- Compile-time evaluation has a configurable timeout to prevent infinite loops

## Use Cases

### 1. Units Library (boost::units style)

```typescript
const distance = units`5 meters`;
const time = units`2 seconds`;
const speed = distance.div(time); // Type: Unit<"m/s">

// Compile-time unit checking
const invalid = distance.add(time); // Compile error: incompatible units
```

### 2. Effect/Promise Do-Comprehension

```typescript
// Generator-based syntax for monadic composition
const result = Do(function* () {
  const user = yield* fetchUser(id);
  const posts = yield* fetchPosts(user.id);
  const comments = yield* fetchComments(posts[0].id);
  return { user, posts, comments };
});

// Compiles to nested flatMap chains
```

### 3. Special String Types

```typescript
// SQL with type-safe parameter binding
const query = sql`SELECT ${columns} FROM ${table} WHERE status = ${status}`;

// Regex with compile-time validation
const pattern = regex`^[a-zA-Z]+$`;

// HTML with XSS prevention
const html = html`<div>${unsafeInput}</div>`;
```

### 4. Operator Overloading

```typescript
@operators({ "+": "add", "-": "sub", "*": "mul", "/": "div" })
class Complex {
  constructor(
    public real: number,
    public imag: number
  ) {}
  add(other: Complex): Complex {
    return new Complex(this.real + other.real, this.imag + other.imag);
  }
}

const c = ops(a + b); // Becomes: a.add(b)
```

## Integration

### With ts-patch

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "typesugar/transformer",
        "type": "program"
      }
    ]
  }
}
```

### CLI

```bash
# Compile with macros
npx typesugar build

# Watch mode
npx typesugar watch

# Check macros without emit
npx typesugar check
```

## Safety Guarantees

1. **Type Safety**: All macro expansions are type-checked by tsc after expansion
2. **Determinism**: Same input always produces same output (vm sandbox has no I/O)
3. **Sandboxing**: Compile-time evaluation runs in a restricted vm context with timeout
4. **Debugging**: Source maps point back to original macro invocations
5. **Loud Failures**: Failed expansions emit runtime throws, not silent broken code
6. **Diagnostics**: Errors feed into the TypeScript diagnostic pipeline

## Limitations

1. No runtime side effects in comptime (sandboxed — no fs, net, process)
2. Compile-time evaluation has a 5-second timeout
3. Decorators only work on classes (not interfaces or type aliases) — use expression macros for those
4. IDE support requires language service plugin (not yet implemented)
5. Depends on ts-patch for transformer integration

## Future Directions

1. **Pre-processor Mode**: Run as a source-to-source transform (no ts-patch dependency)
2. **IDE Plugin**: Full IntelliSense for macro-generated code
3. **Caching**: Persistent cache for expensive macro computations
4. **WASM Macros**: Run macros in WASM for additional sandboxing
5. **Macro Composition**: Compose multiple macros together
