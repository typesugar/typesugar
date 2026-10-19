# Conditional Compilation

typesugar provides conditional compilation through `cfg()` and `@cfgAttr`.

## Basic Usage

### cfg() Expression

```typescript
import { cfg } from "typesugar";

const logger = cfg(
  "debug",
  { log: (msg: string) => console.log(`[DEBUG] ${msg}`) },
  { log: (_msg: string) => {} } // No-op in production
);

logger.log("Application started");
```

### @cfgAttr Decorator

```typescript
import { cfgAttr } from "typesugar";

@cfgAttr("feature.experimental")
function experimentalFeature(): void {
  // This function is removed if feature.experimental is false
}
```

A decorator on a function declaration is not valid TypeScript, so plain `tsc` reports TS1206 on it; the typesugar transformer still handles it. On classes, methods and properties, `@cfgAttr` is an ordinary decorator.

## Configuration

### Setting Conditions

Pass the conditions as `cfgConfig` in your bundler plugin:

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [
    typesugar({
      cfgConfig: {
        debug: process.env.NODE_ENV !== "production",
        feature: { experimental: false },
        platform: "web",
      },
    }),
  ],
});
```

A dotted condition such as `"feature.experimental"` reads a nested object (`{ feature: { experimental: … } }`), not a key containing a dot. A condition that isn't set is `undefined`, so it is false.

### tsconfig.json

The transformer's plugin entry takes the same `cfgConfig` key:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "@typesugar/transformer",
        "cfgConfig": {
          "debug": true,
          "feature": { "experimental": false }
        }
      }
    ]
  }
}
```

### Environment Variables

With no `cfgConfig`, conditions are read from `TYPESUGAR_CFG_<KEY>` environment variables at build time. The key is lowercased and `__` becomes a dot; `1`/`true` mean true, `0`/`false`/empty mean false, and anything else is a string:

```bash
TYPESUGAR_CFG_DEBUG=1 TYPESUGAR_CFG_FEATURE__EXPERIMENTAL=true TYPESUGAR_CFG_PLATFORM=node npx vite build
```

When `cfgConfig` is given, it replaces the environment variables rather than merging with them.

## Condition Types

### Boolean Conditions

```typescript
cfg("debug", debugValue, releaseValue);
```

With no third argument, a false condition gives `undefined`.

### String Conditions

Compare a condition with `===` (or `==`, `!==`, `!=`) and chain `cfg` calls to pick one of several values:

```typescript
cfg(
  "platform === 'web'",
  webImplementation,
  cfg("platform === 'node'", nodeImplementation, nativeImplementation)
);
```

### Function Branches Are Called

If a branch is an arrow function or function expression, `cfg` calls it, so the chosen branch is evaluated lazily and the result is its return value:

```typescript
const value = cfg("debug", () => expensiveDebugComputation(), 0);
// debug on:  const value = (() => expensiveDebugComputation())();
// debug off: const value = 0;
```

To get a function as the value, return it from the branch: `cfg("debug", () => (x: string) => log(x), () => (_x: string) => {})`.

### Condition Grammar

A condition string can use:

- names and dotted paths (`debug`, `feature.experimental`), true when the value is truthy
- `'strings'`, `"strings"`, numbers, `true`, `false`, `null`, `undefined`
- `==`, `===`, `!=`, `!==`
- `&&`, `||`, `!` and parentheses

Anything else is a compile error at the call site, and the call is left unexpanded:

```
error: Unsupported config condition "platform.startsWith('w')": unexpected '(' after a complete
expression. Supported: dotted paths, 'strings', numbers, true/false/null/undefined,
== === != !==, &&, ||, !, and parentheses.
```

## Use Cases

### Debug Logging

```typescript
// Each branch returns the function, because cfg calls function branches
const debug = cfg(
  "debug",
  () =>
    (...args: unknown[]) =>
      console.log("[DEBUG]", ...args),
  () =>
    (..._args: unknown[]) => {}
);

debug("Processing", data); // A no-op in production
```

### Feature Flags

```typescript
@cfgAttr("feature.newUI")
function renderNewUI(): JSX.Element {
  return <NewUI />;
}

function render(): JSX.Element {
  return cfg("feature.newUI",
    renderNewUI(),
    <OldUI />
  );
}
```

### Platform-Specific Code

```typescript
const storage = cfg(
  "platform === 'web'",
  () => new WebStorage(),
  cfg(
    "platform === 'node'",
    () => new FileStorage(),
    () => new NativeStorage()
  )
);
```

### Development Tools

```typescript
@cfgAttr("debug")
function setupDevTools(): void {
  // Only compiled in debug builds
  window.__DEV_TOOLS__ = createDevTools();
}
```

## Dead Code Elimination

cfg() removes unused branches at compile time:

```typescript
// Source
const value = cfg("debug", () => expensiveDebugComputation(), 0);

// Compiled (production, debug = false)
const value = 0;
```

## @cfgAttr

### On Functions

```typescript
@cfgAttr("debug")
function debugOnly(): void { /* ... */ }
// Function is completely removed if debug is false
```

### On Classes

```typescript
@cfgAttr("feature.admin")
class AdminPanel {
  /* ... */
}
// The class declaration is removed if feature.admin is false
```

Only the declaration is removed, not the code that uses it. Guard each usage too (for example with `cfg("feature.admin", () => new AdminPanel())`), or the output throws `ReferenceError: AdminPanel is not defined`. With `strictOutput`, the build warns `Cannot find name 'AdminPanel'`.

### On Methods

```typescript
class Service {
  @cfgAttr("debug")
  debugInfo(): string {
    return JSON.stringify(this);
  }
}
```

### With Conditions

```typescript
@cfgAttr("platform === 'node'")
function readFile(path: string): string {
  return fs.readFileSync(path, "utf8");
}
```

## Combining Conditions

```typescript
// AND
cfg("debug && verbose", ...)

// OR
cfg("platform === 'web' || platform === 'native'", ...)

// NOT
cfg("!production", ...)
```

## Unset Conditions

There are no defaults: a condition that isn't in `cfgConfig` (or the environment) is `undefined`, so `cfg("some.key", a, b)` picks `b`. `cfg` is evaluated at compile time only, and nothing about the configuration is available at runtime. For runtime settings, use your own config or `process.env`.

## Best Practices

### Do

- Use cfg() for environment-specific code
- Use @cfgAttr for entire functions/classes
- Keep condition names descriptive
- Document which conditions your code uses

### Don't

- Use for business logic (use regular if/else)
- Create circular dependencies on conditions
- Assume runtime values are available (cfg is compile-time)

## Comparison to Other Systems

| Feature           | typesugar | Rust cfg        | C preprocessor |
| ----------------- | --------- | --------------- | -------------- |
| Type-safe         | Yes       | Yes             | No             |
| Expressions       | Yes       | Attributes only | Yes            |
| Dead code removal | Yes       | Yes             | Yes            |
| IDE support       | Yes       | Yes             | Partial        |

## Example: Full Build Setup

```typescript
// config/index.ts
export const buildConfig = {
  debug: process.env.NODE_ENV === "development",
  production: process.env.NODE_ENV === "production",
  platform: process.env.PLATFORM ?? "web",
  features: {
    experimental: process.env.ENABLE_EXPERIMENTAL === "true",
    analytics: process.env.ENABLE_ANALYTICS === "true",
  },
};

// vite.config.ts
import { defineConfig } from "vite";
import typesugar from "unplugin-typesugar/vite";
import { buildConfig } from "./config";

export default defineConfig({
  plugins: [
    typesugar({
      cfgConfig: buildConfig, // "features.analytics" reads buildConfig.features.analytics
    }),
  ],
});
```

Usage in code:

```typescript
import { cfg, cfgAttr } from "typesugar";

@cfgAttr("features.analytics")
function trackEvent(name: string): void {
  analytics.track(name);
}

const logger = cfg("debug", createDebugLogger(), createProductionLogger());
```
