---
name: macro-authoring
description: Reference for writing and modifying typesugar macros. Covers macro kinds, MacroContext API, quasiquoting, pipeline, hygiene, transformer behavior, and all built-in macro subsystems. Use when writing macros, modifying macro expand functions, working with MacroContext, quasiquoting, the transformer, or any built-in macro (typeclass, extension, operators, derives, comptime, do-notation).
---

# Macro Authoring Reference

## Macro Kinds

6 kinds of macros, each with a different trigger:

| Kind                | Trigger                         | Signature                                                         | Registration                  |
| ------------------- | ------------------------------- | ----------------------------------------------------------------- | ----------------------------- |
| **Expression**      | Function call `macroName(...)`  | `expand(ctx, callExpr, args) → Expression`                        | `defineExpressionMacro()`     |
| **Attribute**       | Decorator `@macroName(...)`     | `expand(ctx, decorator, target, args) → Node \| Node[]`           | `defineAttributeMacro()`      |
| **Derive**          | `@derive(MacroName)`            | `expand(ctx, target, typeInfo) → Statement[]`                     | `defineDeriveMacro()`         |
| **Tagged Template** | `` tag`...` ``                  | `expand(ctx, node) → Expression`                                  | `defineTaggedTemplateMacro()` |
| **Type**            | Type reference `MacroType<...>` | `expand(ctx, typeRef, args) → TypeNode`                           | `defineTypeMacro()`           |
| **Labeled Block**   | `label: { ... }`                | `expand(ctx, mainBlock, continuation) → Statement \| Statement[]` | `defineLabeledBlockMacro()`   |

All registration functions are in `packages/core/src/registry.ts`.

## MacroContext API

Every macro's `expand` function receives a `MacroContext` (`ctx`). Source: `packages/core/src/context.ts`, interface in `packages/core/src/types.ts`.

**Compiler access:**
- `ctx.program`, `ctx.typeChecker`, `ctx.sourceFile`, `ctx.factory`, `ctx.transformContext`

**Node creation:**
- `ctx.createIdentifier(name)`, `ctx.createNumericLiteral(value)`, `ctx.createStringLiteral(value)`
- `ctx.createBooleanLiteral(value)`, `ctx.createArrayLiteral(elements)`, `ctx.createObjectLiteral(properties)`
- `ctx.parseExpression(code)`, `ctx.parseStatements(code)`

**Type utilities:**
- `ctx.getTypeOf(node)` → `ts.Type`
- `ctx.getTypeString(node)` → string
- `ctx.isAssignableTo(source, target)` → boolean
- `ctx.getPropertiesOfType(type)` → `ts.Symbol[]`
- `ctx.getSymbol(node)` → `ts.Symbol | undefined`

**Diagnostics:**
- `ctx.reportError(node, message)`, `ctx.reportWarning(node, message)`

**Compile-time evaluation:**
- `ctx.evaluate(node)` → `ComptimeValue`, `ctx.isComptime(node)` → boolean

**Hygiene:**
- `ctx.generateUniqueName(prefix)` → `ts.Identifier`
- `ctx.safeRef(symbol, from)` → `ts.Identifier` (detects conflicts with user names)

## Quasiquoting

Preferred way to construct AST. Source: `packages/macros/src/quote.ts`.

```typescript
import { quote, quoteStatements, quoteType, quoteBlock } from "@typesugar/macros";
import { spread, ident, raw } from "@typesugar/macros";

const expr = quote(ctx)`${left} + ${right}`;

const stmts = quoteStatements(ctx)`
  const ${ident("x")} = ${initializer};
  console.log(${ident("x")});
`;

const typeNode = quoteType(ctx)`Array<${elementType}>`;
```

Splice helpers: `spread(stmts)` — array splice, `ident(name)` — force identifier, `raw(name)` — unhygienic identifier.

Convenience: `quoteCall`, `quotePropAccess`, `quoteMethodCall`, `quoteConst`, `quoteLet`, `quoteReturn`, `quoteIf`, `quoteArrow`, `quoteFunction`.

## Macro Pipeline

Chain transformations into a registered macro. Source: `packages/core/src/pipeline.ts`.

```typescript
import { pipeline } from "@typesugar/core";

pipeline("myMacro", "my-module")
  .pipe((ctx, expr) => /* step 1 */)
  .pipeIf(condition, (ctx, expr) => /* conditional */)
  .mapElements((ctx, elem) => /* per-element */)
  .build();
```

## Lexical Hygiene

Source: `packages/core/src/hygiene.ts`.

```typescript
import { globalHygiene } from "@typesugar/core";

globalHygiene.withScope(() => {
  const id = globalHygiene.createIdentifier("temp");
});
```

Three-tier reference resolution (O(1) conflict detection):
- Tier 0: Known globals (Error, Array, JSON) — always safe
- Tier 1: Import map — safe if from same module
- Tier 2: Local declarations — conflict if declared at file level

## Expansion Tracking & Caching

Source: `packages/core/src/source-map.ts`, `packages/core/src/cache.ts`.

```typescript
import { globalExpansionTracker } from "@typesugar/core";
globalExpansionTracker.recordExpansion(macroName, originalNode, sourceFile, expandedText, fromCache);

import { MacroExpansionCache } from "@typesugar/core";
const cache = new MacroExpansionCache(cacheDir);
```

## Capabilities

Declarative permissions. Source: `packages/core/src/capabilities.ts`.

```typescript
import { createRestrictedContext, MacroCapabilities } from "@typesugar/core";

const caps: MacroCapabilities = {
  needsTypeChecker: true,
  needsFileSystem: false,
  needsProjectIndex: false,
  canEmitDiagnostics: true,
  maxTimeout: 5000,
};
const restricted = createRestrictedContext(ctx, caps, "myMacro");
```

## Configuration

Source: `packages/core/src/config.ts`.

```typescript
import { config, defineConfig } from "@typesugar/core";

config.get("contracts.enabled");
config.evaluate("contracts.enabled && !production");
config.when("debug", debugCode, releaseCode);
```

---

## Transformer

Source: `packages/transformer/src/index.ts`.

Key behaviors:
1. Single-pass, top-to-bottom — recursively re-visits macro expansion results
2. Decorator ordering — respects `expandAfter` dependencies
3. Import cleanup — removes imports of macro-only symbols after expansion
4. Extension method rewriting — scans imports for matching functions (Scala 3-style)
5. Implicit resolution — `= implicit()` parameters resolved at compile time
6. Auto-specialization — inlines typeclass instance method bodies at call sites
7. Transitive derivation — `@deriving` builds a plan of dependent types

### Opt-Out System

Source: `packages/core/src/resolution-scope.ts`.

| Scope    | Syntax                                  |
| -------- | --------------------------------------- |
| File     | `"use no typesugar"` at top of file     |
| Function | `"use no typesugar"` as first statement |
| Line     | `// @ts-no-typesugar` comment           |
| Feature  | `"use no typesugar extensions"`         |

### Import Suggestion System

Source: `packages/core/src/import-suggestions.ts`.

```typescript
getSuggestionsForSymbol("Eq");        // → suggests "@typesugar/std"
getSuggestionsForMethod("clamp", "number"); // → suggests "@typesugar/std"
getSuggestionsForMacro("comptime");   // → suggests "typesugar"
```

---

## Built-in Macros

### Typeclass System

Source: `packages/macros/src/typeclass.ts`, `packages/macros/src/specialize.ts`, `packages/macros/src/implicits.ts`.

**Preferred JSDoc syntax:**

| JSDoc Tag               | Purpose                                             |
| ----------------------- | --------------------------------------------------- |
| `/** @typeclass */`     | Declares a typeclass interface                      |
| `/** @impl TC<T> */`   | Provides custom typeclass instance                  |
| `/** @deriving ... */`  | Documents auto-derivation (not required to activate)|
| `/** @op + */`          | Maps method to operator                             |

**Resolution flow:**
1. Compiler sees `===` or `.show()` on a type
2. Identifies the relevant typeclass (Eq, Show, etc.)
3. Checks for explicit `@impl` — use it if found
4. Auto-derives via Mirror — extracts type structure from TypeChecker
5. Auto-specializes — inlines method body at call site (zero-cost)

**Key functions:**
- `inlineMethod(ctx, method, callArgs)` — inlines a method body
- `registerInstanceMethods(dictName, brand, methods)` — registers methods for inlining
- `findInstance(typeclassName, typeName)` — looks up a registered instance
- `getTypeclass(name)` — retrieves typeclass metadata
- `extractMetaFromTypeChecker(ctx, typeName)` — Mirror-style metadata for auto-derivation

**Registries:**
- `typeclassRegistry` — typeclass metadata (methods, type params)
- `instanceRegistry` — registered instances (typeclass x type → instance)

### Extension Methods

Source: `packages/macros/src/extension.ts`, `packages/transformer/src/index.ts`.

UFCS for TypeScript. Import-scoped (Scala 3 model).

```typescript
import { clamp, isEven } from "@typesugar/std";
n.clamp(0, 100);    // → clamp(n, 0, 100)
(42).isEven();       // → isEven(42) → true
```

Resolution order: native property → extension functions in scope → typeclass methods.

Ambiguity: multiple matches → compile error with candidate list.

### Operators

Use `/** @op + */` JSDoc on typeclass method signatures:

```typescript
/** @typeclass */
interface Numeric<A> {
  /** @op + */
  add(a: A, b: A): A;
  /** @op * */
  mul(a: A, b: A): A;
}
```

### Derive Macros

Source: `packages/macros/src/derive.ts`, `packages/macros/src/custom-derive.ts`.

Built-in: Eq, Ord, Clone, Debug, Hash, Default, Json, Builder, TypeGuard.

Custom derives:
```typescript
import { defineCustomDerive, defineFieldDerive } from "@typesugar/macros";

defineCustomDerive("MyDerive", (typeInfo) => `export function process${typeInfo.name}(...) { ... }`);
defineFieldDerive("Validate", (field) => `if (!isValid(value.${field.name})) throw ...`);
```

### Compile-Time Evaluation

Source: `packages/macros/src/comptime.ts`.

```typescript
const result = comptime(() => fibonacci(10));
const schema = comptime({ fs: "read" }, () => fs.readFileSync("./schema.json", "utf8"));
```

Permissions: `fs: 'read' | 'write' | true`, `env: 'read' | true`.

### FlatMap & Do-Notation

Source: `packages/std/src/macros/let-yield.ts`, `packages/std/src/macros/par-yield.ts`.

```typescript
let: {
  x << Some(1);
  y << Some(x * 2);
  if (y > 0) {}        // guard
  z = y + 10;          // pure map
}
yield: { x + z }

par: {
  user << fetchUser(id);
  config << loadConfig();
}
yield: ({ user, config })
```

`let:` syntax: `x << expr` (bind), `x << expr || fallback`, `_ << expr` (discard), `x = expr` (pure map), `if (cond) {}` (guard).

`par:` restrictions: no guards, no fallbacks, bindings must be independent.

### Other Built-in Macros

| Macro | Source | Purpose |
| --- | --- | --- |
| `@reflect` / `typeInfo<T>()` / `fieldNames<T>()` | `packages/macros/src/reflect.ts` | Compile-time type metadata |
| `@tailrec` | `packages/macros/src/tailrec.ts` | Tail-call → while loop |
| `cfg()` / `@cfgAttr` | `packages/macros/src/cfg.ts` | Conditional compilation |
| `includeStr()` / `includeJson()` | `packages/macros/src/include.ts` | Compile-time file I/O |
| `static_assert()` | `packages/macros/src/static-assert.ts` | Compile-time assertions |
| `defineSyntaxMacro()` | `packages/macros/src/syntax-macro.ts` | Pattern-based macros (macro_rules!) |
| `collectTypes()` / `moduleIndex()` | `packages/macros/src/module-graph.ts` | Project introspection |
| `@genericDerive` | `packages/macros/src/generic.ts` | Structural type representations |

### Primitives

Pre-registered typeclass instances for: `number`, `string`, `boolean`, `bigint`, `null`, `undefined`, `Array<T>`.

Typeclasses covered: Show, Eq, Ord, Hash, Semigroup, Monoid.

Coverage checking: `registerPrimitive()`, `validateCoverageOrError()` in `packages/macros/src/coverage.ts`.
