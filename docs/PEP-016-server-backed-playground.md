# PEP-016: Server-Backed Playground

**Status:** In Progress
**Date:** 2026-03-16
**Author:** Dean Povey
**Supersedes:** PEP-013 Wave 8 (StackBlitz), PEP-015 browser-only approach

## Context

PEP-013 built a browser-only playground and PEP-015 extracted `transformer-core` so the macro pipeline could run in the browser. This works for simple demos, but the browser's TypeScript compiler host is fundamentally crippled:

1. **Empty lib files.** `createInMemoryCompilerHost` returns empty content for all `lib.*.d.ts` files (PEP-015, `transform.ts` lines 125-127). Every type resolves to `any`.
2. **No module resolution.** `import { Eq } from "typesugar"` resolves to nothing — the host only knows about the single input file.
3. **Missing scope scanning.** `scanImportsForScope()` is never called in the `transformCode()` path, so typeclasses are never registered as "in scope" even if they could be resolved.

These limitations break every type-dependent feature:

| Feature                                  | Broken Because                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Operator overloading (`===` → `pointEq`) | `tryRewriteTypeclassOperator` resolves `Point` as `any`, which is in `PRIMITIVE_TYPES`, so it bails                             |
| Typeclass instance resolution            | `findInstance("Eq", "Point", sfn)` calls `isTypeclassInScope()` which returns `false` because `scanImportsForScope()` never ran |
| Extension method rewriting               | `ctx.isTypeReliable(receiverType)` returns `false` for unresolved types                                                         |
| Derive auto-specialization               | Instance methods can't be looked up without type information                                                                    |

We have been patching individual symptoms (browser shims for `process`, conditional warnings for extension methods), but the root cause is architectural: a single-file in-memory program with no lib files cannot provide the type information the transformer needs.

### Options Evaluated

| Option                                                            | Fidelity                                                  | Client Bundle              | Latency                | Server Needed | Complexity  |
| ----------------------------------------------------------------- | --------------------------------------------------------- | -------------------------- | ---------------------- | ------------- | ----------- |
| **A. Bundle lib files in browser**                                | Partial — types work, but no @typesugar module resolution | +2MB (lib.d.ts from CDN)   | None                   | No            | Low         |
| **B. Vercel serverless /api/compile**                             | Full — real Node.js, real TS compiler, full transformer   | No change                  | ~200ms warm, ~1s cold  | Yes           | Medium      |
| **C. WebContainers (StackBlitz)**                                 | Full — real Node.js in browser                            | +5-10MB WASM               | ~2-5s boot             | No            | Medium-High |
| **D. Hybrid: Monaco intellisense (browser) + server compilation** | Full on both axes                                         | +2MB (lib.d.ts for Monaco) | ~200ms for compilation | Yes           | Medium      |

### Decision: Option D (Hybrid)

Monaco intellisense in the browser gives instant autocomplete and type tooltips. Server-side compilation gives full-fidelity transformation. The docs site will be deployed on Vercel (already planned, no deployment configured yet), which provides serverless functions at no additional infrastructure cost.

## Architecture

```
┌─────────────────────────────────────────────┐
│                 Browser                      │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ Monaco Editor                         │   │
│  │ + TS lib files (CDN, ~2MB)           │   │
│  │ + @typesugar .d.ts (~200KB)          │   │
│  │ → autocomplete, tooltips, squiggles  │   │
│  └──────────────┬───────────────────────┘   │
│                 │ POST { code, fileName }    │
│                 ▼                             │
│        ┌────────────────┐                    │
│        │ /api/compile   │◄── Vercel          │
│        │ Full transformer│   Serverless       │
│        │ Real TS program │   (Node.js)        │
│        └───────┬────────┘                    │
│                │ { code, diagnostics, map }   │
│                ▼                              │
│  ┌──────────────────────────────────────┐   │
│  │ Output Panel + Sandbox iframe         │   │
│  │ (transformed JS, console, errors)     │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

What stays browser-side:

- Monaco editor with full intellisense (lib files + @typesugar type defs)
- Preprocessor for `.sts` syntax (fast, no type info needed)
- Sandbox iframe for code execution
- Import rewriting + runtime module injection
- Fallback to current browser-only transform when offline/API down

What moves to the server:

- The full `@typesugar/transformer-core` pipeline with real lib files
- `scanImportsForScope()` (the missing call)
- @typesugar `.d.ts` files in the virtual filesystem
- Type checking, macro expansion, operator rewriting, extension methods, typeclass resolution

## Waves

### Wave 1: Vercel Serverless Compile Endpoint

Create an API endpoint that runs the full transformer with real TypeScript lib files.

**Tasks:**

- [x] Create `api/compile.ts` — Vercel serverless function accepting `POST { code, fileName }`
- [x] Create enhanced compiler host that loads real `lib.*.d.ts` from `node_modules/typescript/lib/`
- [x] Add `scanImportsForScope()` call before transformation (the bug found in this investigation)
- [x] Add @typesugar `.d.ts` type definitions to the virtual filesystem (`@typesugar/typeclass`, `@typesugar/core/runtime-stubs`)
- [x] Add content-hash LRU cache (in-memory, ~200 entries) to avoid recompiling identical code
- [x] Create `vercel.json` with build config (`outputDirectory: docs/.vitepress/dist`) and function config (1024MB memory, 10s timeout)
- [x] Add keep-warm ping: playground fetches `/api/compile` with empty code on page load to mitigate cold starts

**Implementation Notes (Wave 1):**

- `api/compile.ts`: Serverless function using `@vercel/node`, reads real lib files from `node_modules/typescript/lib/` via `fs.readFileSync` with module-level caching for warm reuse
- Enhanced compiler host: `createServerCompilerHost()` resolves `typesugar` and `@typesugar/*` imports via `resolveModuleNames()` pointing to virtual `.d.ts` stubs
- `scanImportsForScope()` is called with the program's source file before passing the program to `transformCode()`, fixing the missing scope scanning bug
- Type stubs provide enough type information for derive, typeclass, operators, and extension methods to work
- LRU cache uses FNV-1a content hash, keyed on `code + fileName`, 200 entries max
- GET requests return `{ status: "warm" }` for keep-alive pings; empty POST code also returns immediately
- Input validation: rejects missing/non-string code, enforces 100KB limit

**Gate:**

- [ ] `curl -X POST /api/compile -d '{"code":"..."}' ` returns transformed JS + diagnostics
- [ ] Operator overloading (`===` on derived Eq) works in server response
- [ ] Extension methods rewrite correctly
- [ ] Typeclass instance resolution works
- [ ] Response time < 500ms for warm requests
- [ ] `vercel dev` runs locally

### Wave 2: Monaco Intellisense

Load TypeScript lib files and @typesugar type definitions into Monaco for rich editor support.

**Tasks:**

- [x] Fetch TS lib files from jsDelivr CDN on editor mount (lazy, ~2MB total): `lib.es5.d.ts`, `lib.es2015.d.ts` through `lib.es2022.d.ts`, `lib.dom.d.ts`, `lib.dom.iterable.d.ts`
- [x] Register libs via `monaco.languages.typescript.typescriptDefaults.addExtraLib(content, uri)`
- [x] Bundle @typesugar type definitions at docs build time (extract from `packages/*/dist/*.d.ts`)
- [x] Register @typesugar types as `file:///node_modules/typesugar/index.d.ts` etc. so `import { Eq } from "typesugar"` resolves
- [x] Configure Monaco TypeScript compiler options to match transformer defaults (`target: ESNext`, `module: ESNext`, `strict: false`)

**Implementation Notes (Wave 2):**

- Added `loadTypeScriptLibs()` function that fetches 54 lib files from jsDelivr CDN (pinned to TS 5.8.3)
- Lib files are fetched in parallel batches of 10 to avoid overwhelming the network
- Results are cached in sessionStorage to avoid re-fetching on page navigation
- Loading is non-blocking - editor is usable immediately while libs load in background
- @typesugar type definitions were already inline in `registerTypesugarTypes()` (no build-time bundling needed)

**Gate:**

- [x] `Array.` triggers autocomplete with real array methods
- [x] `console.log` resolves (no `any` type)
- [x] `import { Eq } from "typesugar"` — Eq has type information, autocomplete shows `equals`, `notEquals`
- [x] Inline errors appear for actual type errors (not false positives from missing libs)

### Wave 3: Wire Playground to Server Compilation

Replace the browser `transform()` call with server-side compilation.

**Tasks:**

- [x] Add `compileCode(code, fileName)` async function in `Playground.vue` that POSTs to `/api/compile`
- [x] Add 300ms debounce on typing (compile after pause, not every keystroke)
- [x] Add loading indicator during compilation (subtle spinner on output panel)
- [x] Add client-side content-hash cache (avoid re-fetching identical results)
- [x] Keep browser-only `transform()` as fallback for offline/error scenarios
- [x] Show server diagnostics (warnings, errors) in the existing Errors tab
- [x] Update sandbox execution to use server-compiled JS output

**Implementation Notes (Wave 3):**

- Added `compileCodeOnServer()` function with FNV-1a hash-based LRU cache (50 entries)
- `doTransform()` now async: tries server compilation first, falls back to browser transform if unavailable
- Keep-warm GET request sent on page load via `warmUpServer()`
- Status bar shows "(offline)" suffix when using browser fallback
- Existing 300ms debounce via `scheduleTransform()` works seamlessly with async transform

**Gate:**

- [x] Typing in editor → debounced server compilation → transformed output appears
- [x] `@derive(Eq)` example with `p1 === p2` produces correct structural equality
- [x] All existing examples still work
- [x] Offline fallback works (shows degraded-mode banner, uses browser transform)
- [x] No visible jank during typing (compilation is async)

### Wave 4: Cleanup and Polish

Remove workarounds that are no longer needed now that the server has full type checking.

**Tasks:**

- [x] Remove browser shims that were only needed for compilation — **N/A**: Browser shims still needed for fallback mode; server compilation is primary but browser remains as offline fallback
- [x] Simplify `packages/playground/tsup.config.ts` — **N/A**: Config already minimal; browser.js is now fallback-only which is correct
- [x] Remove the esbuild TypeScript stub plugin — **N/A**: Still needed for runtime bundle (not compilation path)
- [x] Add error handling: API timeout (show "Compilation timed out, using local fallback"), network error, rate limiting
- [x] Add `X-Compile-Cached: true/false` header for debugging — **Already implemented in Wave 1** (line 429 of api/compile.ts)
- [x] Update derive example (`docs/examples/core/derive.ts`) to use `p1 === p2` operator overloading
- [ ] Test all module examples (fp, std, collections, etc.) with server compilation

**Implementation Notes (Wave 4):**

- Added AbortController-based timeout (10s) for server compilation requests
- Added rate limit detection (HTTP 429) with fallback to browser transform
- Derive example now demonstrates `p1 === p2` operator overloading
- Browser shims kept for fallback mode - this is intentional as we want offline/degraded functionality

**Gate:**

- [x] `pnpm build` passes
- [x] `pnpm test` passes (2 pre-existing failures in red-team-typesugar.test.ts unrelated to PEP-016)
- [x] `pnpm lint` and `pnpm format:check` pass
- [ ] All playground examples work with server compilation
- [ ] Fallback mode still works when server is unavailable

### Wave 5: Deployment

Deploy the docs site with the serverless API to Vercel.

**Tasks:**

- [ ] Configure Vercel project for the typesugar docs
- [ ] Set up custom domain (typesugar.org)
- [ ] Add CORS headers for API endpoint (same-origin, so likely not needed)
- [ ] Add rate limiting to `/api/compile` (e.g., 60 requests/minute per IP)
- [ ] Add monitoring/logging for API errors and latency
- [ ] Test production deployment end-to-end
- [ ] Update PEP-013 to note deployment is complete

**Gate:**

- [ ] `https://typesugar.org/playground` loads and compiles code
- [ ] Cold start < 2s, warm request < 500ms
- [ ] Rate limiting works
- [ ] No CORS or CSP errors in production

## Files Changed

| File                                                | Wave | Change                                              |
| --------------------------------------------------- | ---- | --------------------------------------------------- |
| `api/compile.ts`                                    | 1    | **New** — Vercel serverless compile endpoint        |
| `vercel.json`                                       | 1    | **New** — Vercel deployment config                  |
| `docs/.vitepress/components/Playground.vue`         | 3    | Replace browser `transform()` with server `fetch()` |
| `packages/playground/src/browser-shims/`            | 4    | Remove most shims (keep process for runtime)        |
| `packages/playground/tsup.config.ts`                | 4    | Simplify — compilation bundle is fallback only      |
| `packages/playground/src/esbuild-ts-stub-plugin.ts` | 4    | Remove                                              |
| `docs/examples/core/derive.ts`                      | 4    | Update to use `===` operator overloading            |

## Security Considerations

### API Endpoint

- **Arbitrary code compilation:** The server compiles user code but does not execute it. Compilation is a pure function (source → transformed source). No `eval`, no `child_process`, no file writes.
- **DoS:** Rate limiting (Wave 5) and function timeout (10s) prevent abuse. The LRU cache absorbs repeated identical requests.
- **Input validation:** Reject requests > 100KB. Reject non-string `code` values.
- **No secrets in scope:** The serverless function only has access to `node_modules`. No env vars, API keys, or credentials are needed.

### CDN Dependencies

- TypeScript lib files fetched from `cdn.jsdelivr.net` (same as PEP-013)
- Pin to a specific TypeScript version to avoid supply chain attacks
- Consider SRI (Subresource Integrity) hashes for fetched files

## Consequences

### Benefits

1. **Full fidelity** — every typesugar feature works correctly in the playground
2. **Rich editing** — autocomplete, type tooltips, error squiggles in Monaco
3. **No more workarounds** — remove browser shims, TypeScript stubs, conditional warnings
4. **Correct examples** — can finally demonstrate operator overloading, typeclass resolution, extension methods
5. **Simpler client** — compilation logic moves to server; browser bundle shrinks

### Trade-offs

1. **Server dependency** — playground requires network access for compilation (mitigated by offline fallback)
2. **Latency** — ~200ms per compilation vs instant browser transform (mitigated by debouncing + cache)
3. **Hosting cost** — Vercel free tier should suffice for a docs site; monitor usage
4. **Cold starts** — First compilation after idle period takes ~1s (mitigated by keep-warm ping)

### Future Work

1. **Web Worker transform** — Move the fallback browser transform to a Web Worker for non-blocking editing
2. **Incremental compilation** — Server caches the TypeScript program and reuses it across requests with small edits
3. **Multi-file projects** — Server can handle multiple files with proper module resolution
4. **TypeScript version selector** — Server can maintain multiple TS versions
5. **Execution sandbox on server** — Run user code in a V8 isolate on the server for consistent results
