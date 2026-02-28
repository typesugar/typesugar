# Macro Trigger Patterns

This document describes all the ways macros can be triggered in the typesugar transformer. Understanding these patterns is essential for both using existing macros and implementing new ones.

## Overview

The transformer recognizes several distinct trigger patterns:

| Pattern             | AST Node Type              | Example                 | Registration                  |
| ------------------- | -------------------------- | ----------------------- | ----------------------------- |
| Expression Macro    | `CallExpression`           | `comptime(() => ...)`   | `defineExpressionMacro()`     |
| Attribute Macro     | `Decorator`                | `@typeclass`            | `defineAttributeMacro()`      |
| Derive Macro        | `Decorator`                | `@derive(Eq, Clone)`    | `defineDeriveMacro()`         |
| Tagged Template     | `TaggedTemplateExpression` | `` sql`SELECT ...` ``   | `defineTaggedTemplateMacro()` |
| Type Macro          | `TypeReference`            | `Add<3, 4>`             | `defineTypeMacro()`           |
| Labeled Block       | `LabeledStatement`         | `let: { x << Some(1) }` | `defineLabeledBlockMacro()`   |
| HKT Syntax          | `TypeParameter`            | `F<_>`                  | Auto-detected                 |
| Extension Method    | `CallExpression`           | `x.show()`              | Auto via `@instance`          |
| Operator Overload   | `BinaryExpression`         | `a + b`                 | Via `& Op<"+">`               |
| Auto-Specialization | `CallExpression`           | `fn(optionMonad, x)`    | Auto via `@instance`          |

---

## 1. Expression Macros

**Trigger:** Function call syntax `macroName(...)`

**Resolution:** The transformer resolves the function identifier through TypeScript's symbol resolution, tracing imports back to the macro's declared module.

```typescript
// Direct call
const result = comptime(() => fibonacci(10));

// Namespaced call (for macro conflicts)
const result = macro.comptime(() => ...);

// Via namespace import
import * as M from "typesugar";
M.comptime(() => ...);

// Via renamed import
import { comptime as ct } from "typesugar";
ct(() => ...);
```

**Registration:**

```typescript
defineExpressionMacro({
  name: "comptime",
  module: "typesugar",
  expand(ctx, callExpr, args) {
    // callExpr is the full CallExpression node
    // args are the arguments to the call
    return ctx.parseExpression("42"); // inline result
  },
});
```

**Transformer Location:** `tryExpandExpressionMacro()` in `macro-transformer.ts:1305`

---

## 2. Attribute (Decorator) Macros

**Trigger:** Decorator syntax `@macroName` or `@macroName(...)`

**Valid Targets:** Classes, functions, methods, properties, getters, setters

```typescript
@typeclass
interface Show<A> {
  show(a: A): string;
}

@operators({ "+": "add", "*": "mul" })
class Vector {
  add(other: Vector): Vector { ... }
}

@instance("Show<Point>")
const showPoint = {
  show: (p) => `(${p.x}, ${p.y})`,
};
```

**Registration:**

```typescript
defineAttributeMacro({
  name: "typeclass",
  module: "typesugar",
  validTargets: ["interface"],
  expand(ctx, decorator, target, args) {
    // decorator is the Decorator node
    // target is the declaration being decorated
    // args are the decorator arguments
    return [target, ...generatedStatements];
  },
});
```

**Transformer Location:** `tryExpandAttributeMacros()` in `macro-transformer.ts:1866`

---

## 3. Derive Macros

**Trigger:** `@derive(Name1, Name2, ...)` decorator syntax

The `@derive` decorator is a unified handler that routes each argument to the appropriate strategy:

1. **Registered derive macro** — code-gen derives like `Eq`, `Clone`, `TypeGuard`, `Builder`
2. **Built-in typeclass derivation** — `Show`, `Ord`, `Hash`, `Semigroup`, `Monoid`
3. **Typeclass derive macro** — custom `{Name}TC` macros

```typescript
@derive(Eq, Clone, Show, TypeGuard)
interface User {
  id: number;
  name: string;
}
// Generates: equals(), clone(), show(), isUser() functions
```

**Registration:**

```typescript
defineDeriveMacro({
  name: "TypeGuard",
  expand(ctx, target, typeInfo) {
    // typeInfo contains: name, fields, kind, variants (for sum types), etc.
    const code = `export function is${typeInfo.name}(x: unknown): x is ${typeInfo.name} { ... }`;
    return ctx.parseStatements(code);
  },
});
```

**Transformer Location:** `expandDeriveDecorator()` in `macro-transformer.ts:2058`

---

## 4. Tagged Template Macros

**Trigger:** Tagged template literal syntax `` tag`...` ``

```typescript
const query = sql`SELECT * FROM users WHERE id = ${userId}`;
// Compiles to: { text: "SELECT * FROM users WHERE id = $1", values: [userId] }

const msg = fmt`Hello, ${name}!`;
// Compiles to: "Hello, " + name + "!"
```

**Registration:**

```typescript
defineTaggedTemplateMacro({
  name: "sql",
  module: "typesugar/sql",
  expand(ctx, node) {
    // node is TaggedTemplateExpression
    // Access template parts via node.template
    return ctx.parseExpression(`{ text: "...", values: [...] }`);
  },
  validate(ctx, node) {
    // Optional: return false to abort expansion with error
    return true;
  },
});
```

**Transformer Location:** `tryExpandTaggedTemplate()` in `macro-transformer.ts:2448`

---

## 5. Type Macros

**Trigger:** Type reference syntax `MacroType<...>` in type positions

```typescript
// Compile-time arithmetic
type Result = Add<3, 4>; // → 7

// Compile-time string manipulation
type Joined = Concat<"Hello", "World">; // → "HelloWorld"
```

**Registration:**

```typescript
defineTypeMacro({
  name: "Add",
  module: "typesugar",
  expand(ctx, typeRef, args) {
    // typeRef is TypeReferenceNode
    // args are the type arguments
    const a = /* evaluate type arg 0 */;
    const b = /* evaluate type arg 1 */;
    return ctx.factory.createLiteralTypeNode(
      ctx.factory.createNumericLiteral(a + b)
    );
  },
});
```

**Transformer Location:** `tryExpandTypeMacro()` in `macro-transformer.ts:2548`

---

## 6. Labeled Block Macros

**Trigger:** Labeled statement syntax `label: { ... }` with optional continuation labels

This pattern enables Scala/Haskell-style do-notation for monadic code:

```typescript
// Do-notation for Option/Result/Promise
let: {
  x << Some(1);
  y << Some(2);
}
yield: {
  x + y;
}

// Compiles to: Some(1).flatMap(x => Some(2).map(y => x + y))
```

The macro consumes both the main labeled block (`let:`) and any following continuation blocks (`yield:`).

**Registration:**

```typescript
defineLabeledBlockMacro({
  name: "let",
  label: "let",
  continuationLabels: ["yield", "pure"],
  expand(ctx, mainBlock, continuation) {
    // mainBlock is the `let: { ... }` LabeledStatement
    // continuation is the optional `yield: { ... }` LabeledStatement
    // Parse the bindings from mainBlock, build the monadic chain
    return ctx.parseStatements(`Some(1).flatMap(x => ...)`);
  },
});
```

**Transformer Location:** `visitStatementContainer()` in `macro-transformer.ts:949`

---

## 7. HKT `F<_>` Syntax (Auto-Detection)

**Trigger:** Type parameter with `<_>` suffix in interface/type declarations

This is NOT a registered macro—the transformer auto-detects it.

```typescript
// User writes:
interface Functor<F<_>> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}

// Transformer rewrites to:
interface Functor<F> {
  map<A, B>(fa: $<F, A>, f: (a: A) => B): $<F, B>;
}
```

The `F<_>` syntax indicates "F is a type constructor that takes one type argument." The transformer:

1. Strips the `<_>` from the type parameter
2. Rewrites all `F<A>` applications to `$<F, A>` (the HKT encoding)

**Transformer Location:** `tryTransformHKTDeclaration()` in `macro-transformer.ts:2622`

---

## 8. Implicit Extension Methods (Auto-Detection)

**Trigger:** Method call on a type where the method doesn't exist natively but is provided by a typeclass

```typescript
@derive(Show)
interface Point { x: number; y: number; }

const p: Point = { x: 1, y: 2 };
p.show();  // Method doesn't exist on Point!

// Transformer rewrites to:
Show.summon<Point>("Point").show(p);
```

This enables Scala 3-style implicit extension methods. When the transformer sees `x.method()` and TypeScript reports that `.method()` doesn't exist on `x`'s type, it searches the extension method registry for a matching typeclass method.

**Requirements:**

- The type must have a registered typeclass instance (via `@instance` or `@derive`)
- The method must be declared in the typeclass

**Transformer Location:** `tryRewriteExtensionMethod()` in `macro-transformer.ts:2668`

---

## 9. Typeclass Operator Overloading (`& Op<"...">`)

**Trigger:** Binary/unary operators on types that have typeclass instances with `& Op<"...">` annotated methods

This is a workaround for TypeScript's lack of decorator support on interface methods. The `& Op<"+">` intersection type on a method's return type declares that this method should be invoked for the `+` operator.

```typescript
// In typeclass definition:
@typeclass
interface Semigroup<A> {
  combine(a: A, b: A): A & Op<"+">;  // ← declares operator mapping
}

// Register instance:
@instance("Semigroup<Point>")
const semigroupPoint = {
  combine: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
};

// User writes:
const c = a + b;  // where a, b: Point

// Transformer rewrites to (with zero-cost inlining):
const c = { x: a.x + b.x, y: a.y + b.y };
```

**How it works:**

1. `@typeclass` parses `& Op<"+">` annotations and builds an operator→method mapping
2. The transformer sees a binary expression like `a + b`
3. It determines the type of `a` and looks up registered instances
4. If an instance exists with a method mapped to `+`, it rewrites the expression
5. Zero-cost: the method body is inlined when possible

**Built-in operator mappings:**

- `Eq`: `===` → `eq`, `!==` → `neq`
- `Ord`: `<` → `compare` (and others)
- `Semigroup`: `+` → `combine`

**Transformer Location:** `tryRewriteTypeclassOperator()` in `macro-transformer.ts:2796`

---

## 10. Auto-Specialization (Zero-Cost Inlining)

**Trigger:** Function call where an argument is a known typeclass instance dictionary

```typescript
// Generic function using dictionary-passing style
function double<F>(F: Functor<F>): <A>(fa: $<F, A>) => $<F, A> {
  return (fa) => F.map(fa, (x) => x + x);
}

// Usage with concrete instance
const result = double(optionFunctor)(Some(21));

// Transformer auto-specializes to:
const result = ((fa) => (fa !== null ? fa + fa : null))(Some(21));
```

When the transformer sees a call where an argument resolves to a registered instance (like `optionFunctor`), it:

1. Resolves the function body (if accessible)
2. Inlines the dictionary method calls with the instance's implementations
3. Returns a specialized version without dictionary indirection

**Requirements:**

- The instance must be registered via `@instance` with method implementations
- The function body must be resolvable by the type checker

**Opt-out:** Add `// @no-specialize` comment before the call to skip inlining.

**Transformer Location:** `tryAutoSpecialize()` in `macro-transformer.ts:1437`

---

## Summary: Transformation Pipeline

The transformer processes each node in a single pass, checking for macro triggers in this order:

1. **Statement containers** (SourceFile, Block) → scan for labeled block macros first
2. **CallExpression** → expression macro → @implicits → extension method → auto-specialize
3. **TaggedTemplateExpression** → tagged template macro
4. **TypeReferenceNode** → type macro
5. **Decorated declarations** → attribute macros → derive macros
6. **Interface/TypeAlias with `F<_>`** → HKT transformation
7. **BinaryExpression** → typeclass operator overloading

Each transformation may produce new nodes that are recursively visited, allowing macro compositions.
