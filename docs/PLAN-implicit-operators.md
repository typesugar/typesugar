# Plan: Typeclass-Based Operator Overloading — `Op<>` Design

## Status: IMPLEMENTED

The core infrastructure is implemented. This document describes the design and implementation.

## The Cats/Scala Model

In Scala's Cats library, operators are provided by "syntax" extension methods that
require a typeclass instance:

```scala
// Typeclass — just the interface
trait Semigroup[A] {
  def combine(a: A, b: A): A
}

// Syntax — separately defines operators that REQUIRE a typeclass
final class SemigroupOps[A: Semigroup](lhs: A) {
  def |+|(rhs: A): A = Semigroup[A].combine(lhs, rhs)
}

// Instance — implementation for a specific type
given Semigroup[List[Int]] with
  def combine(a: List[Int], b: List[Int]) = a ++ b

// Usage — operator works because instance exists
List(1, 2) |+| List(3, 4)
```

## typesugar Approach: `Op<S>` Branded Type

Instead of separate syntax declarations, typesugar uses a branded intersection type
`Op<S>` on method return types to declare operator mappings inline:

```typescript
import { Op } from "typesugar";

@typeclass
interface Semigroup<A> {
  concat(a: A, b: A): A & Op<"+">;
}

@instance("Array")
const arraySemigroup: Semigroup<Array<unknown>> = {
  concat: (a, b) => [...a, ...b],
};

// Usage — + works because:
// 1. Op<"+"> on concat declares: + → Semigroup.concat
// 2. Semigroup instance exists for Array
[1, 2] + [3, 4]  // Compiles to: [...[1, 2], ...[3, 4]]
```

`Op<S>` is:

- A compile-time-only branded type (`type Op<_S extends OperatorSymbol> = {}`)
- Stripped from emitted code by the transformer
- Restricted to valid `OperatorSymbol` values for compile-time safety

### Supported Operators

Defined in `src/core/types.ts` as `OPERATOR_SYMBOLS`:

```
+  -  *  /  %  **
<  <=  >  >=
==  ===  !=  !==
&  |  ^  <<  >>
```

## Zero-Cost Abstraction

At compile time we know everything:

1. Which operator is used
2. The type of the operands
3. Which typeclass provides the syntax via `Op<>`
4. Which instance exists for that type
5. The body of the instance method

So instead of runtime lookups, we **inline directly**:

```typescript
// Source:
[1, 2] + [3, 4]

// BEST (zero-cost): Inline the method body
[...[1, 2], ...[3, 4]]

// GOOD (one indirection): Direct instance reference
arraySemigroup.concat([1, 2], [3, 4])
```

## Implementation

### Core Types (`src/core/types.ts`)

```typescript
export const OPERATOR_SYMBOLS = [
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "<",
  "<=",
  ">",
  ">=",
  "==",
  "===",
  "!=",
  "!==",
  "&",
  "|",
  "^",
  "<<",
  ">>",
] as const;

export type OperatorSymbol = (typeof OPERATOR_SYMBOLS)[number];
export type Op<_S extends OperatorSymbol> = {};
```

### TypeclassMethod Extension (`src/macros/typeclass.ts`)

```typescript
interface TypeclassMethod {
  name: string;
  params: Array<{ name: string; typeString: string }>;
  returnType: string;
  isSelfMethod: boolean;
  operatorSymbol?: string; // From Op<> annotation
}
```

### Op<> Parsing (`src/macros/typeclass.ts`)

`extractOpFromReturnType(typeNode)` walks intersection types looking for
`Op<S>` members. Returns `{ operatorSymbol, cleanReturnType }`.

Called during `@typeclass` expansion when extracting method metadata from
the interface. Populates `TypeclassMethod.operatorSymbol` and builds the
`TypeclassInfo.syntax` map.

### Interface Stripping (`src/macros/typeclass.ts`)

`stripOpFromInterface(ctx, iface)` produces a clean interface for emitted
code with `Op<>` removed from all return types.

### Syntax Registry (`src/macros/typeclass.ts`)

```typescript
// Maps: operator → array of { typeclass, method }
const syntaxRegistry = new Map<string, SyntaxEntry[]>();

function registerTypeclassSyntax(tcName: string, syntax: Map<string, string>): void;
function getSyntaxForOperator(op: string): SyntaxEntry[] | undefined;
```

### Transformer (`src/transforms/macro-transformer.ts`)

`tryRewriteTypeclassOperator(node: ts.BinaryExpression)`:

1. Convert `operatorToken.kind` → string via `getOperatorString()`
2. Look up `syntaxRegistry` for that operator
3. Determine left operand type via type checker
4. Check each registered typeclass for an instance matching that type
5. If found: try zero-cost inlining via `inlineMethodForAutoSpec()`
6. Fallback: emit `instanceVar.method(left, right)`
7. Ambiguity: if multiple typeclasses match → compile error

## Standard Typeclasses with Op<>

```typescript
@typeclass
interface Eq<A> {
  eq(a: A, b: A): boolean & Op<"===">;
  neq(a: A, b: A): boolean & Op<"!==">;
}

@typeclass
interface Ord<A> {
  compare(a: A, b: A): (-1 | 0 | 1) & Op<"<">;
}

@typeclass
interface Semigroup<A> {
  combine(a: A, b: A): A & Op<"+">;
}

@typeclass
interface Monoid<A> {
  empty(): A;
  combine(a: A, b: A): A & Op<"+">;
}
```

## Conflict Resolution

When multiple typeclasses provide the same operator for the same type,
the transformer reports a compile error:

```
Ambiguous operator '+' for type 'Foo':
both Semigroup.concat and Num.add apply.
Use explicit method calls to disambiguate.
```

## Migration from `@operators`

The existing `@operators` decorator continues to work for class-level
operator overloading within `ops()` expressions. The new typeclass-based
system works globally without `ops()` wrapping.

## Zero-Cost Levels

| Level           | Output                        | Runtime Cost    | When Used                         |
| --------------- | ----------------------------- | --------------- | --------------------------------- |
| **Full inline** | `[...a, ...b]`                | None            | Method body is simple expression  |
| **Direct call** | `arraySemigroup.concat(a, b)` | 1 function call | Method body too complex to inline |

## Files Changed

- `src/core/types.ts` — `OPERATOR_SYMBOLS`, `OperatorSymbol`, `Op<>`
- `src/index.ts` — Re-exports
- `src/macros/typeclass.ts` — `extractOpFromReturnType()`, `stripOpFromInterface()`, syntax registry, `TypeclassMethod.operatorSymbol`
- `src/macros/operators.ts` — `getOperatorString()` exported
- `src/transforms/macro-transformer.ts` — `tryRewriteTypeclassOperator()`
- `tests/typeclass-operators.test.ts` — 26 tests

## Open Questions

1. **Import-gating**: Should operator overloading only activate when the typeclass
   is imported? (More explicit, more like Cats)

2. **Right-operand fallback**: If `3 * vec` doesn't match (left is primitive),
   should we check the right operand?

3. **Unary operators**: Support for prefix `-` and `!` via separate annotation?

---

## Future: unplugin Type-Aware Transformation Fix

**Status: PLANNED**

### Problem

Currently `unplugin-typesugar` creates the TypeScript Program at `buildStart` with
original source files, then preprocessing happens later in the `load` hook.
This means the type checker sees original content (`F<_>`), not preprocessed
content (`$<F, A>`), breaking type-aware macro transformations.

### Solution

Preprocess files **before** creating the Program using a custom CompilerHost:

```typescript
buildStart() {
  const host = ts.createCompilerHost(config.options);
  const originalReadFile = host.readFile;

  // Intercept file reads to return preprocessed content
  host.readFile = (fileName) => {
    const original = originalReadFile(fileName);
    if (!original || !shouldPreprocess(fileName)) return original;

    // Check disk cache first
    const cached = cache.get(fileName, original);
    if (cached) return cached.code;

    // Preprocess and cache
    const result = preprocess(original, { fileName });
    cache.set(fileName, original, result);
    return result.code;
  };

  // Program now built with preprocessed content
  program = ts.createProgram(config.fileNames, config.options, host);
}
```

### Memory-Efficient Caching

To avoid loading all preprocessed files into memory:

1. **Disk-based cache**: Store in `.typesugar-cache/` or `node_modules/.cache/typesugar/`
2. **Content-addressed**: Key = hash of (file content + preprocessor version)
3. **Lazy loading**: Only preprocess when CompilerHost requests the file
4. **Store source maps**: Alongside preprocessed content for accurate error locations
5. **LRU eviction**: Limit cache size, evict least-recently-used entries

Can reuse infrastructure from `src/core/cache.ts` (`MacroExpansionCache`).

### Watch Mode

- Invalidate cache entry when source file's mtime changes
- Re-preprocess on next CompilerHost.readFile() call
- Consider using file watcher to proactively invalidate

### Implementation Steps

1. Add `PreprocessCache` class with disk-backed storage
2. Modify `buildStart()` to create custom CompilerHost
3. Remove preprocessing from `load` hook (now happens in CompilerHost)
4. Update `transform` hook to use Program's preprocessed SourceFiles directly
5. Add cache invalidation for watch mode
