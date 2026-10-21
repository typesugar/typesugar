# Macro Trigger Patterns

This document describes all the ways macros can be triggered in the typesugar transformer. Understanding these patterns is essential for both using existing macros and implementing new ones.

## Overview

The transformer recognizes several distinct trigger patterns:

| Pattern             | AST Node Type              | Example                   | Registration                                    |
| ------------------- | -------------------------- | ------------------------- | ----------------------------------------------- |
| Expression Macro    | `CallExpression`           | `comptime(() => ...)`     | `defineExpressionMacro()`                       |
| Attribute Macro     | `Decorator`                | `@typeclass`              | `defineAttributeMacro()`                        |
| Derive Macro        | `Decorator`                | `@derive(Eq, Clone)`      | Transformer-owned (see `expandDeriveDecorator`) |
| Tagged Template     | `TaggedTemplateExpression` | `` sql`SELECT ...` ``     | `defineTaggedTemplateMacro()`                   |
| Type Macro          | `TypeReference`            | `Add<3, 4>`               | `defineTypeMacro()`                             |
| Labeled Block       | `LabeledStatement`         | `let: { x << Some(1) }`   | `defineLabeledBlockMacro()`                     |
| HKT Syntax          | `TypeParameter`            | `F<A>`                    | Auto-detected                                   |
| Extension Method    | `CallExpression`           | `x.show()`                | Auto via `@impl`                                |
| Operator Overload   | `BinaryExpression`         | `a + b`                   | Via `@op` JSDoc on typeclass methods            |
| Implicit Parameter  | `CallExpression`           | `fn(x, ord = implicit())` | `= implicit()` marker                           |
| Auto-Specialization | `CallExpression`           | `fn(optionMonad, x)`      | Auto via `@impl`                                |

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

**Transformer Location:** `tryExpandExpressionMacro()` in `packages/transformer-core/src/transformer.ts`

---

## 2. Attribute (Decorator) Macros

**Trigger:** Decorator syntax `@macroName` or `@macroName(...)`

**Valid Targets:** Classes, functions, methods, properties, getters, setters

```typescript
@typeclass
interface Show<A> {
  show(a: A): string;
}

// Operator overloading via @op JSDoc on typeclass methods

// A const takes the JSDoc trigger: TypeScript has no decorators on variables.
/** @impl Show<Point> */
const showPoint: Show<Point> = {
  show: (p) => `(${p.x}, ${p.y})`,
};
```

> On interfaces, functions, and type aliases the equivalent JSDoc trigger
> (`/** @typeclass */`) is preferred — plain `tsc` flags the decorator form with
> TS1206 (TypeSugar suppresses it). On a `const` only the JSDoc trigger works
> (`/** @impl Show<Point> */`). See
> [JSDoc vs Decorator Syntax](./guides/jsdoc-vs-decorators.md).

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

**Transformer Location:** `tryExpandAttributeMacros()` in `packages/transformer-core/src/transformer.ts`

---

## 3. Derive Macros

**Trigger:** `@derive(Name1, Name2, ...)` decorator syntax

The `@derive` decorator is a unified handler that routes each argument to the appropriate strategy:

1. **Registered derive macro** — code-gen derives like `Eq`, `Clone`, `TypeGuard`
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

Built-in derives (Eq, Ord, Show, Clone, etc.) are registered via `registerTypeclassMacros()` in `packages/macros/src/typeclass.ts`. Custom derives use `defineDeriveMacro()` from `@typesugar/core`:

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

**Transformer Location:** `expandDeriveDecorator()` in `packages/transformer-core/src/macro-helpers.ts` (handled directly by the transformer; `@deriving` is a deprecated alias for `@derive`)

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

**Transformer Location:** `tryExpandTaggedTemplate()` in `packages/transformer-core/src/rewriting.ts`

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

**Transformer Location:** `tryExpandTypeMacro()` in `packages/transformer-core/src/rewriting.ts`

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

A labeled-block macro can instead be attached to a `switch` (`statement: "switch"`). The
`match:` statement form of pattern matching is one:

```typescript
import "@typesugar/std/syntax/match";

match: switch (geom) {
  case { type: "Point", coordinates: [x, y] }:
    draw(x, y);
    break;
  case { type: "LineString", coordinates }:
    for (const c of coordinates) draw(c[0], c[1]);
    break;
}
// Compiles to: switch (geom.type) { case "Point": { const [x, y] = geom.coordinates; ... } ... }
```

With only literal cases the output is the switch itself, label removed; the macro adds the
exhaustiveness check (TS9226). See [Pattern Matching → Statement form](./guides/pattern-matching.md#statement-form-match-switch).

**Activation (PEP-052):** label syntax is import-scoped. A matching label only expands in files that import a module carrying a `@syntax-labels <macroName>` marker — `import "@typesugar/std/syntax/do";` for the `let:`/`seq:`/`par:`/`all:` comprehensions, `import "@typesugar/std/syntax/match";` for `match:` switches, `import "@typesugar/contracts/syntax";` for the `requires:`/`ensures:` contract trigger labels. Without the import the label is left as plain JavaScript and the transformer warns (TS9224) with a hint naming the `syntaxModule` import to add. Ordinary loop labels that collide with a macro label produce no warning (a label is a candidate only on the statement its macro expects: a block, or a switch for `match:`). A macro whose `syntaxModule` has nothing to run sets `erasableSyntaxModule: true`, and the transformer removes that side-effect import from its output (`syntax/match` does; `syntax/do` also provides instances, so it stays).

**Registration:**

```typescript
defineLabeledBlockMacro({
  name: "let",
  label: "let",
  continuationLabels: ["yield", "pure"],
  syntaxModule: "@typesugar/std/syntax/do", // named in the TS9224 activation hint
  expand(ctx, mainBlock, continuation) {
    // mainBlock is the `let: { ... }` LabeledStatement
    // continuation is the optional `yield: { ... }` LabeledStatement
    // Parse the bindings from mainBlock, build the monadic chain
    return ctx.parseStatements(`Some(1).flatMap(x => ...)`);
  },
});
```

**Transformer Location:** `visitStatementContainer()` in `packages/transformer-core/src/transformer.ts`

---

## 7. HKT `F<A>` Syntax (Auto-Detection)

**Trigger:** A type parameter applied to a type argument (`F<A>`) inside an interface/type declaration

This is NOT a registered macro—the transformer auto-detects it.

```typescript
// User writes:
interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}

// Transformer rewrites to:
interface Functor<F> {
  map<A, B>(fa: Kind<F, A>, f: (a: A) => B): Kind<F, B>;
}
```

Applying a type parameter to a type argument (`F<A>`) signals "F is a type constructor that takes one type argument." The transformer rewrites all `F<A>` applications to `Kind<F, A>` (the HKT encoding). Works in plain `.ts` files.

**Transformer Location:** `tryTransformHKTDeclaration()` in `packages/transformer-core/src/rewriting.ts`

---

## 8. Implicit Extension Methods (Auto-Detection)

**Trigger:** Method call on a type where the method doesn't exist natively but is provided by a typeclass, in a file that has activated that typeclass's method syntax

```typescript
import { derive } from "typesugar";
import "@typesugar/fp/syntax/show"; // activate Show method syntax (PEP-052); enough on its own

@derive(Show)
interface Point { x: number; y: number; }

const p: Point = { x: 1, y: 2 };
p.show();  // Method doesn't exist on Point!

// Transformer rewrites to the resolved instance (here the derived companion):
Point.Show.show(p); // "Point(x = 1, y = 2)"
```

This enables Scala 3-style implicit extension methods. When the transformer sees `x.method()` and TypeScript reports that `.method()` doesn't exist on `x`'s type, it searches the typeclasses whose method syntax is active in this file for a matching method.

**Requirements:**

- Method syntax for the typeclass is active in the file: import its `@syntax-methods` marker module (`@typesugar/std/syntax/eq`, `…/clone`, `…/json`, `@typesugar/fp/syntax/show`, …) or declare the typeclass in the same file. Without it the call is left alone and fails at runtime.
- For a typeclass from a package other than `@typesugar/std`, the typeclass itself must also be imported (a type-only import is enough), as `Show` is above.
- The type has an instance in scope (`@derive`, an explicit `@impl`/`@instance`, or a `derived<TC<T>>()` const). Instances are never ambient.
- The method is declared in the typeclass.

**Transformer Location:** `tryRewriteExtensionMethod()` in `packages/transformer-core/src/rewriting.ts`

---

## 9. Typeclass Operator Overloading (`/** @op */`)

**Trigger:** Binary operators on a type with an instance of a typeclass whose methods carry `/** @op <operator> */` JSDoc tags, in a file that activated that typeclass's operator syntax

The `@op` tag on a typeclass method declares which operator dispatches to it:

```typescript
// In the typeclass definition:
/** @typeclass */
interface Add<A> {
  /** @op + */
  add(a: A, b: A): A;
}

interface Point {
  x: number;
  y: number;
}

// Register an instance:
/** @impl Add<Point> */
const addPoint: Add<Point> = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
};

// User writes:
const c = a + b; // where a, b: Point

// Transformer rewrites to (with zero-cost inlining):
const c = { x: a.x + b.x, y: a.y + b.y };
```

A file that declares the typeclass has its operators active. Any other file opts in
with the typeclass's `/ops` marker, e.g. `import "@typesugar/std/syntax/semigroup/ops"`.
Without it, `a + b` stays the native `+`, and when an instance in scope would have
handled the operator the transformer warns (TS9804) with a hint naming the import to
add: the provider's registered marker specifier, or a project-relative path to a local
`@syntax-operators` marker module. Primitive operands, types with no instance, activated
files and opted-out files produce no warning. A comparison with `null` or `undefined`
(`a == null`) is never rewritten, and `Object.is(a, b)` is a call, so it always compares
references.

**How it works:**

1. The typeclass index reads `/** @op */` tags on typeclass methods and builds an operator→method mapping (a method may carry several tags, one per operator, e.g. std's `Eq.equals` has both `@op ===` and `@op ==`)
2. The transformer sees a binary expression like `a + b` in a file where that typeclass's operator syntax is active
3. It determines the type of `a` and resolves an instance from scope
4. If an instance exists with a method mapped to `+`, it rewrites the expression
5. Zero-cost: the method body is inlined when the instance's source is visible; otherwise the call goes to the instance (e.g. `Point.Eq.equals(a, b)` for a derived `Eq`)

**Built-in operator mappings (`@typesugar/std`):**

| Typeclass                      | Operators → methods                                                                          | Activation import                                |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `Eq`                           | `===`, `==` → `equals`; `!==`, `!=` → `notEquals`                                            | `@typesugar/std/syntax/eq/ops`                   |
| `Ord`                          | `<` → `lessThan`, `<=` → `lessThanOrEqual`, `>` → `greaterThan`, `>=` → `greaterThanOrEqual` | `@typesugar/std/syntax/ord/ops`                  |
| `Semigroup`, `Monoid`, `Group` | `+` → `combine`                                                                              | `…/semigroup/ops`, `…/monoid/ops`, `…/group/ops` |
| `Numeric`                      | `+` → `add`, `-` → `sub`, `*` → `mul`                                                        | `@typesugar/std/syntax/numeric/ops`              |
| `Integral`                     | `/` → `div`, `%` → `mod`                                                                     | `@typesugar/std/syntax/integral/ops`             |
| `Fractional`                   | `/` → `div`                                                                                  | `@typesugar/std/syntax/fractional/ops`           |

**Transformer Location:** `tryRewriteTypeclassOperator()` / `tryRewriteTypeclassUnaryOperator()` in `packages/transformer-core/src/rewriting.ts`; the TS9804 hint in `packages/transformer-core/src/operator-activation.ts`

---

## 10. Auto-Specialization (Zero-Cost Inlining)

**Trigger:** Function call where an argument is a known typeclass instance dictionary

```typescript
// Generic function using dictionary-passing style
function double<F>(F: Functor<F>): <A>(fa: Kind<F, A>) => Kind<F, A> {
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

- The instance must be registered via `@impl`/`@instance` with method implementations
- The instance's and the function's source must be visible to the compiler. An
  instance imported from a published package's compiled `.d.ts` (for example
  `optionFunctor` from `@typesugar/fp`'s dist) has no body to inline, so the call is
  left as a normal dictionary call, without a warning.

**Opt-out:** Add `// @no-specialize` comment before the call to skip inlining.

**Transformer Location:** `tryAutoSpecialize()` in `packages/transformer-core/src/specialization.ts`

---

## Summary: Transformation Pipeline

The transformer processes each node in a single pass, checking for macro triggers in this order:

1. **Statement containers** (SourceFile, Block) → scan for labeled block macros first
2. **CallExpression** → expression macro → `= implicit()` resolution → extension method → auto-specialize
3. **TaggedTemplateExpression** → tagged template macro
4. **TypeReferenceNode** → type macro
5. **Decorated declarations** → attribute macros → derive macros
6. **Interface/TypeAlias with `F<A>`** → HKT transformation
7. **BinaryExpression** → typeclass operator overloading

Each transformation may produce new nodes that are recursively visited, allowing macro compositions.
