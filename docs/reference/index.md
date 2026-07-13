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

| Reference                             | Description                             |
| ------------------------------------- | --------------------------------------- |
| [MacroContext](./macro-context.md)    | Full MacroContext API for macro authors |
| [Macro Types](./macro-types.md)       | All 6 macro kinds and their signatures  |
| [Macro Triggers](./macro-triggers.md) | How macros are invoked                  |

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

```typescript
// Expression macro: fn()
defineExpressionMacro(name, { expand(ctx, callExpr) {} });

// Attribute macro: @decorator
defineAttributeMacro(name, { expand(ctx, decorator, target) {} });

// Derive macro: @derive(Name)
defineDeriveMacro(name, { expand(ctx, target, typeInfo) {} });

// Tagged template: tag`...`
defineTaggedTemplateMacro(name, { expand(ctx, node) {} });

// Type macro: Type<T>
defineTypeMacro(name, { expand(ctx, typeRef) {} });

// Labeled block: label: { }
defineLabeledBlockMacro(name, { expand(ctx, block) {} });
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
} from "@typesugar/core";

// Quasiquoting
import { quote, quoteStatements, quoteType, ident, raw, spread } from "@typesugar/core/quote";

// Testing
import { expandCode, expandMacro, assertExpands } from "@typesugar/testing";

// Configuration
import { config, cfg, cfgAttr } from "@typesugar/core";
```
