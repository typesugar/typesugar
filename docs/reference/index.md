# Reference

API and configuration reference for typesugar.

::: tip Why there is no generated API reference
This reference is **hand-written on purpose**, not for lack of a typedoc run.
The public surface of a macro system is mostly _syntax_ — `/** @derive(Eq) */`,
`comptime(...)`, `match(...)` — plus the shapes macros generate, none of which
a signature generator can see. Pointing typedoc at the workspace would bury the
small user-facing surface under transformer internals that are not API.

The full rationale, the trigger conditions for revisiting, and the design for
the scoped version we _would_ generate are in
[PLAN-api-reference](../plans/PLAN-api-reference.md).
:::

## Core APIs

| Reference                              | Description                             |
| -------------------------------------- | --------------------------------------- |
| [MacroContext](./macro-context.md)     | Full MacroContext API for macro authors |
| [Macro Types](../macro-types.md)       | All 6 macro kinds and their signatures  |
| [Macro Triggers](../macro-triggers.md) | How macros are invoked                  |

## Tools

| Reference                    | Description               |
| ---------------------------- | ------------------------- |
| [CLI](./cli.md)              | Command-line interface    |
| [Configuration](./config.md) | All configuration options |

## Packages

| Reference                       | Description                |
| ------------------------------- | -------------------------- |
| [Package Matrix](./packages.md) | All packages with features |

## Quick Links

### Registration Functions

Each `define*Macro` takes one definition object and returns it; it does **not**
register the macro. Register with `globalRegistry.register(macro)` (or
`registerMacros(globalRegistry, ...macros)`) in your package's macro entry.

```typescript
// Expression macro: fn()
defineExpressionMacro({ name, module, expand(ctx, callExpr, args) {} });

// Attribute macro: @decorator
defineAttributeMacro({ name, module, validTargets, expand(ctx, decorator, target, args) {} });

// Derive macro: @derive(Name)
defineDeriveMacro({ name, expand(ctx, target, typeInfo) {} });

// Tagged template: tag`...`
defineTaggedTemplateMacro({ name, module, expand(ctx, node) {} });

// Type macro: Type<T>
defineTypeMacro({ name, module, expand(ctx, typeRef, args) {} });

// Labeled block: label: { }
defineLabeledBlockMacro({ name, label, expand(ctx, mainBlock, continuation) {} });

globalRegistry.register(myMacro);
```

### Key Imports

```typescript
// Core registration
import {
  defineExpressionMacro,
  defineAttributeMacro,
  defineDeriveMacro,
  defineTaggedTemplateMacro,
  defineTypeMacro,
  defineLabeledBlockMacro,
  globalRegistry,
} from "@typesugar/core";

// Quasiquoting (string-based; prefer ctx.factory — see the Quasiquoting guide)
import { quote, quoteStatements, quoteType, ident, raw, spread } from "@typesugar/macros";

// Testing: expand with the real pipeline, or unit-test an expand() function
import { transformCode } from "@typesugar/transformer";
import { createMacroTestContext } from "@typesugar/testing/macros";

// Configuration
import { config, defineConfig } from "@typesugar/core";
import { cfg, cfgAttr } from "typesugar"; // the cfg macros (runtime placeholders)
```
