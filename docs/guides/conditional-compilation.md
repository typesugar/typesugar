# Conditional Compilation

typesugar provides conditional compilation through `cfg()` and `@cfgAttr`.

## Basic Usage

### cfg() Expression

```typescript
import { cfg } from "@typesugar/core";

const logger = cfg(
  "debug",
  { log: (msg: string) => console.log(`[DEBUG] ${msg}`) },
  { log: () => {} } // No-op in production
);

logger.log("Application started");
```

### @cfgAttr Decorator

```typescript
import { cfgAttr } from "@typesugar/core";

@cfgAttr("feature.experimental")
function experimentalFeature(): void {
  // This function is removed if feature.experimental is false
}
```

## Configuration

### Setting Conditions

Configure in your build:

```typescript
// vite.config.ts
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [
    typesugar({
      config: {
        debug: process.env.NODE_ENV !== "production",
        "feature.experimental": false,
        platform: "web",
      },
    }),
  ],
});
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "@typesugar/transformer",
        "config": {
          "debug": true,
          "feature.experimental": false
        }
      }
    ]
  }
}
```

## Condition Types

### Boolean Conditions

```typescript
cfg("debug", debugValue, releaseValue);
```

### String Conditions

```typescript
cfg("platform", {
  web: webImplementation,
  node: nodeImplementation,
  native: nativeImplementation,
});
```

### Expressions

```typescript
config.evaluate("debug && !production");
```

## Use Cases

### Debug Logging

```typescript
const debug = cfg(
  "debug",
  (...args: unknown[]) => console.log("[DEBUG]", ...args),
  () => {}
);

debug("Processing", data); // Removed in production
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
const storage = cfg("platform", {
  web: new WebStorage(),
  node: new FileStorage(),
  native: new NativeStorage(),
});
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
const value = cfg("debug", expensiveDebugComputation(), 0);

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
// Class and all usages removed if feature.admin is false
```

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

## Default Values

```typescript
import { config } from "@typesugar/core";

// Returns undefined if not set
const value = config.get("some.key");

// With default
const value = config.get("some.key") ?? "default";
```

## Runtime Access

For values needed at runtime (not just compile time):

```typescript
import { config } from "@typesugar/core";

// This is evaluated at runtime
const apiUrl = config.get("api.url");
```

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
import typesugar from "unplugin-typesugar/vite";
import { buildConfig } from "./config";

export default defineConfig({
  plugins: [
    typesugar({
      config: {
        ...buildConfig,
        ...buildConfig.features,
      },
    }),
  ],
});
```

Usage in code:

```typescript
import { cfg, cfgAttr } from "@typesugar/core";

@cfgAttr("features.analytics")
function trackEvent(name: string): void {
  analytics.track(name);
}

const logger = cfg("debug", createDebugLogger(), createProductionLogger());
```
