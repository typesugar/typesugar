# Compile-Time Evaluation

The `comptime()` macro evaluates expressions at build time and inlines the result.

::: warning Security: comptime is not a sandbox
`comptime` code runs inside the compiler process **with the privileges of your build**. It
runs in a hardened `node:vm` context, but Node documents `vm` as
[not a security mechanism](https://nodejs.org/api/vm.html), and the permissions below are a
guard against accidents, not an isolation boundary. Treat `comptime` blocks — including ones in
dependencies — like build scripts: never build untrusted code outside a disposable, isolated
environment. Editor integrations (the TypeScript plugin and the LSP server) do not evaluate
`comptime` unless explicitly enabled; there the call is left unexpanded with a warning. To enable
it, turn on the VS Code setting `typesugar.comptimeInEditor` (trusted workspaces only), or set
`TYPESUGAR_COMPTIME_IN_EDITOR=1` in the environment the editor's TypeScript server or LSP server
runs in.
:::

::: tip Try in Playground
**[Open in Playground →](https://typesugar.org/playground#code=eJxLSS1OUcjMK0ktLlFwzCsuycnMS9dRSE8tyszPs1LIyy9KUUjOz0ktykvMTQUA4IkN0g%3D%3D)** to see comptime in action.
:::

## Basic Usage

```typescript
import { comptime } from "typesugar";

// Simple expression
const answer = comptime(21 * 2); // → const answer = 42;

// Function call
const buildTime = comptime(new Date().toISOString());
// → const buildTime = "2024-01-15T10:30:00.000Z";

// Arrow function body
const factorial10 = comptime(() => {
  const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
  return fact(10);
});
// → const factorial10 = 3628800;
```

## What Can Be Evaluated

### Supported

- Arithmetic and logical operations
- String manipulation
- Array methods (map, filter, reduce, etc.)
- Object creation and manipulation
- JSON parsing and serialization
- Math functions
- Date operations
- Regular expressions (creation, not execution)
- Recursion (with limits)

### Requires Explicit Permission

The following capabilities are blocked by default but can be explicitly enabled:

- **File system access** — Use `{ fs: 'read' }` or `{ fs: true }`
- **Environment variables** — Use `{ env: 'read' }` or `{ env: true }`
- **Network requests** — Planned, not in 1.0 (there is no network access at all today)

`new Date()` and `Date.now()` need no permission, so a `comptime` value can include the build time.

### Not Supported

- DOM APIs
- External package imports (in most cases)
- Node.js modules other than the bridged `fs`, `path` and `process` helpers
- `eval()` / `new Function()` (string code generation is disabled in the comptime context)

## Permissions

By default, the `fs` and `process.env` helpers available inside `comptime` refuse access. You can explicitly enable them as the first argument:

### File System Access

```typescript
// Read a file at compile time
const schema = comptime({ fs: "read" }, () => {
  return fs.readFileSync("./schema.json", "utf8");
});

// Read + write (use with caution!)
comptime({ fs: "write" }, () => {
  fs.writeFileSync("./generated.ts", "export const x = 42;");
});
```

Available `fs` operations: `readFileSync`, `existsSync`, `readdirSync`, `statSync`, `writeFileSync`, `mkdirSync`. Paths must be relative and stay inside the project root (the `tsconfig.json` directory, see below). `readFileSync` without an encoding returns a `Uint8Array` (with a `toString(encoding)` helper) rather than a Node `Buffer`; `statSync` / `readdirSync({ withFileTypes: true })` return plain objects with `isFile()` / `isDirectory()` / `isSymbolicLink()`.

### Environment Variables

```typescript
// Read environment variables
const apiKey = comptime({ env: "read" }, () => {
  return process.env.API_KEY ?? "default-key";
});
```

### Combined Permissions

```typescript
// Read files and env vars
const config = comptime({ fs: "read", env: "read" }, () => {
  const base = JSON.parse(fs.readFileSync("./config.json", "utf8"));
  return {
    ...base,
    apiKey: process.env.API_KEY,
  };
});
```

### Permission Values

| Permission | Values    | Description                |
| ---------- | --------- | -------------------------- |
| `fs`       | `'read'`  | Read-only file access      |
| `fs`       | `'write'` | Read and write access      |
| `fs`       | `true`    | Same as `'write'`          |
| `env`      | `'read'`  | Read environment variables |
| `env`      | `true`    | Same as `'read'`           |

### How the comptime context works

1. **Separate context**: code runs in a fresh `node:vm` context with its own built-ins (`Math`, `JSON`, `Array`, ...). No host-realm object is placed in it, so tricks like `Object.constructor("return process")()` see the context's own `Function`, not the compiler's.
2. **No string code generation**: `eval` and `new Function` are disabled in the context.
3. **Bridged helpers**: `fs`, `path`, `process` and `require()` are created inside the context and talk to the compiler only by passing strings; permissions are checked on the compiler side of that bridge.
4. **Path resolution**: relative paths resolve from the source file's directory and must stay inside the project root, which is the directory of your `tsconfig.json` (the nearest one above the source file if the build doesn't name one), whatever directory the build runs from.
5. **Timeout**: evaluation (including promise callbacks) is limited to 5 seconds.

This prevents accidental file/env access and closes the well-known `vm` escapes, but it is **defence in depth, not isolation** — see the security warning at the top of this page.

## Use Cases

### Build Information

```typescript
// Reading process.env needs the env permission
const BUILD_INFO = comptime({ env: "read" }, () => ({
  version: "1.0.0",
  buildTime: new Date().toISOString(),
  commit: process.env.GIT_COMMIT ?? "dev",
}));
```

### Lookup Tables

```typescript
const ASCII_TABLE = comptime(() => {
  const table: Record<string, number> = {};
  for (let i = 0; i < 128; i++) {
    table[String.fromCharCode(i)] = i;
  }
  return table;
});
```

### Precomputed Data

```typescript
const PRIMES = comptime(() => {
  const sieve = (n: number): number[] => {
    const prime = new Array(n + 1).fill(true);
    prime[0] = prime[1] = false;
    for (let i = 2; i * i <= n; i++) {
      if (prime[i]) {
        for (let j = i * i; j <= n; j += i) {
          prime[j] = false;
        }
      }
    }
    return prime.map((p, i) => (p ? i : -1)).filter((x) => x > 0);
  };
  return sieve(1000);
});
```

### Configuration Parsing

```typescript
const CONFIG = comptime(() => {
  const raw = `
    host: localhost
    port: 3000
    debug: true
  `;
  const lines = raw.trim().split("\n");
  const config: Record<string, string> = {};
  for (const line of lines) {
    const [key, value] = line.split(":").map((s) => s.trim());
    config[key] = value;
  }
  return config;
});
```

## Evaluation Rules

### Expressions vs Functions

Simple expressions evaluate directly:

```typescript
comptime(1 + 1); // Evaluates: 1 + 1
```

Arrow functions evaluate the function body:

```typescript
comptime(() => {
  // This entire block runs at compile time
  let x = 0;
  for (let i = 0; i < 10; i++) x += i;
  return x;
});
```

### Type Inference

The result type is inferred from the computed value:

```typescript
const num = comptime(42); // number
const str = comptime("hello"); // string
const arr = comptime([1, 2, 3]); // number[]
const obj = comptime({ x: 1 }); // { x: number }
```

### Serialization

Results must be JSON-serializable:

```typescript
// Works
comptime({ x: 1, y: [1, 2] });

// Fails - functions can't be serialized
comptime(() => () => 42);

// Fails - circular references
comptime(() => {
  const obj: any = {};
  obj.self = obj;
  return obj;
});
```

## Error Handling

An exception thrown during evaluation becomes a build error (TS9209, with the source and the error message):

```typescript
// Build error: Expected property name or '}' in JSON at position 1
comptime(() => JSON.parse("{"));

// Build error: Undefined is not a function
comptime(() => {
  const x: any = undefined;
  return x.foo();
});
```

## Timeout

Evaluation has a default 5-second timeout:

```typescript
// Build error: Timeout
comptime(() => {
  while (true) {} // Infinite loop
});
```

## Environment Variables

Environment access is off by default. Enable it with the `env` permission:

```typescript
// Fails: env access was not granted
comptime(() => process.env.API_KEY);

// Works if the var exists at build time
const API_KEY = comptime({ env: "read" }, () => process.env.API_KEY ?? "default");
```

## Debugging

To see what comptime evaluates to:

```bash
npx typesugar expand src/file.ts
```

Or enable verbose mode:

```json
{
  "compilerOptions": {
    "plugins": [{ "transform": "@typesugar/transformer", "verbose": true }]
  }
}
```

## Best Practices

### Do

- Use for expensive computations that don't change
- Pre-compute lookup tables
- Embed build information
- Parse static configuration

### Don't

- Use for runtime-dependent values
- Access external resources
- Create very large objects (increases bundle size)
- Use side effects (they happen at build time!)

## Comparison to Other Systems

| Feature       | typesugar `comptime`            | Zig `comptime` | Rust `const fn` |
| ------------- | ------------------------------- | -------------- | --------------- |
| Full language | Yes                             | Yes            | Limited         |
| Sandboxed     | No (hardened, build privileges) | No             | N/A             |
| Result types  | JSON-serializable               | Any            | Any             |
| Recursion     | Yes (limited)                   | Yes            | Yes             |
| Loops         | Yes                             | Yes            | Yes (nightly)   |
| File I/O      | Opt-in (`fs: 'read'`)           | Yes            | No              |
| Env vars      | Opt-in (`env: 'read'`)          | Yes            | No              |
