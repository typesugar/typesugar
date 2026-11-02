## Authoring group: docs fix report

I fixed all 24 findings in docs-authoring.md (19 fixed outright, 5 partly cut, reworded or marked). One finding is a code bug that the code fixes have already closed. I changed no code and ran no git commands that change state. Nothing I started is still running. Prettier has been run on every file I changed.

### Per finding

- **1 (define\*Macro two-argument form, no registration): fixed.** Every page now uses `globalRegistry.register(define*Macro({ name, ... }))`, says once that defining a macro doesn't register it, and adds `validTargets` to attribute macros. index.md documents `module`/`exportName`, `expandAfter`, and that macro names are global per kind.
- **2 (testing-macros built on APIs that don't exist): fixed.** Rewritten around `transformCode` with an `expand`/`run` helper that executes the output, `diagnostics.filter(d => d.severity === "error")`, and `createMacroTestContext` from `@typesugar/testing/macros` for unit tests of `expand`. The derive test asserts on `Point.Eq.equals` and runs it. The testing sections on the other pages were also rewritten.
- **3 (macros can never be loaded): fixed.** publishing-macros.md has a separate `.`/`./macros` layout, the `typesugar.macros` field, a CJS build of `./macros`, and a new "Getting Discovered" section: the auto-trust rules, the real `UnapprovedMacroPackagesError` text, `typesugar approve-macros` → `security.allowedMacroPackages`, a workspace package for project-local macros, and a link to authoring-libraries.md. I removed `macroModules` from the transformer README.
- **4 (derive patterns, types, helpers): fixed.** Derives now return only the new statements. The `DeriveTypeInfo`, variant and field types match types.ts. `defineCustomDerive`/`defineFieldDerive` are imported from `@typesugar/macros` with AST-returning callbacks. `requires` is replaced by `expandAfter`.
- **5 (`@typesugar/core/quote`): fixed.** It is now `@typesugar/macros` everywhere.
- **6 (std do-notation): fixed.** Added `import "@typesugar/std/syntax/do"` and the `const x = let: …` form. The guard moved to an Array example. I documented that `yield: <expr>` works, and `par:` is in value position.
- **7 (std array/range dot syntax): fixed.** The code fix made this work. I added the missing Range imports (`forEach`, `map`, `filter`, …) and a note that a dot-syntax call needs the function imported.
- **8 (collections hero): fixed.** The README is rewritten to pass `Eq`/`Hash` instances explicitly (constructors and derived operations). I cut the claims about auto-derivation, `= implicit()` and zero cost, and the false effect integration line.
- **9 (contracts quick start): fixed.** Added `import "@typesugar/contracts/syntax"`, plus a note that without it there is only a TS9224 warning.
- **10 (derive hero): fixed.** Now `@derive(Eq, Ord, Clone, Debug) interface User` with `User.Eq.equals` and so on, and the std `syntax/*/ops` activation imports for the operator and method forms.
- **11 (effect hero): fixed.** Uses the `Effect.gen` + `yield* DatabaseTag` body with `layerMake`. It runs and prints "rows for SELECT 42".
- **12 (quasiquote examples): fixed.** `ident` with a declaration now uses `quoteStatements`; arrays use `factory.createArrayLiteralExpression`; `quoteFunction` takes `{name}` objects; `@logged` and `query` are now ts.factory. The page leads with "factory by default".
- **13 (labeled-block signature, try:, measure: output): fixed.** `expand(ctx, mainBlock, continuation)` uses `mainBlock.statement`. The example is now `attempt:`/`recover:`, with a note that reserved words can't be labels. The `measure:` output is the real one.
- **14 (stale docs/writing-macros.md): fixed.** Its body is now a short pointer to /writing-macros/. Two pages still link to it and are not in my files: docs/faq.md:176 and docs/macro-types.md:292. Both still resolve, now to the pointer page; repoint them to `./writing-macros/index.md` if you want to skip the hop.
- **15 (core README API): fixed.** `generateUniqueName` returns `ts.Identifier`, the tagged-template `expand(ctx, node)` is fixed, and lookups use `getExpression`/`getTaggedTemplate`/`getByModuleExport`.
- **16 (editor/syntax claims): fixed.**
  - ts-plugin README: `verbose` (or `TYPESUGAR_VERBOSE=1`) is the only option. Removed `extensions`, `legacyMode` and the VS Code settings, and added one line saying `|>`/`::` are not supported.
  - unplugin README: the options interface now matches the code (globs, `strict: "incremental"`, `cfgConfig`, no `extensions`).
- **17 (VS Code README): fixed.** The name is `typesugar-vscode` (private) and the `pnpm --filter` lines use it. Scripts are now build/build:watch, and I added the real settings and the `showTransformed` command. The page now says plainly that `typesugar build --manifest` doesn't exist, so `generateManifest` produces nothing. I also removed the "From Marketplace" install line, since I couldn't verify a marketplace listing.
- **18 (stability claims): fixed.**
  - The "Frozen … excluded from release" lines are replaced with "Status: experimental — API may change before 1.0." in codec, erased, math, strings, parser, units and lsp-server, and in collections (which only said Frozen). I removed the 🧊 in lsp-common.
  - macros: "internal package" is reworded to point macro authors to it.
  - playground: says it is private, and `preprocessCode` is removed.
- **19 (umbrella typesugar README): fixed.** It now describes the runtime-only root and the `typesugar/core` subpath, says the root exports are stubs rather than namespaces, marks `registerAllMacros` as a deprecated no-op, shows the real `User.Eq`/`User.Debug`/`User.Clone` output, removes Builder and lists `typesugar-vscode`.
- **20 (macros README): fixed.** Uses `comptime({ fs: "read" }, …)` and drops Builder. The zero-overhead guarantee is replaced by a "What Remains at Runtime" section.
- **21 (contracts-refined "eliminated"): fixed.** The README now says both checks are emitted at runtime by default, and points to the guide for when the prover can remove a check.
- **22 (transformer-core staticAssert): fixed.** Now `staticAssert(1 + 1 === 2)`, plus a note on TS9217.
- **23 (Readonly type-macro mis-dispatch): fixed in code.** The tutorial macro is renamed `Frozen`, with a warning not to name type macros after built-in types.
- **24 (low-severity items): mostly fixed.**
  - `evaluate` is documented as returning `ComptimeValue`; the `comptime` example is renamed `constant`, and `assert` is renamed `check` (name collision).
  - `@singleton` uses `let`.
  - `measure:` shows the marker import, and the TS9224 hint is documented.
  - The `quoteBlock` example no longer has braces.
  - parser README: install line, `Parser<number>` annotations, and `ParseError` with line/col.
  - strings: the output now shows `&#039;`.
  - fp: the real output is described.

### Examples re-run

Writing-macros examples were run through a harness (based on the reviewer's) that imports the definitions and then runs `transformCode` with `--run`. The testing-page tests ran under `node --import tsx` with a small vitest shim. All 52 definition blocks in the guide pass a strict tsc check against the dist `.d.ts`.

| Page                                                                                                                                   | Examples                                                   | Passing                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| writing-macros/index                                                                                                                   | 2                                                          | 2                                                               |
| expression-macros                                                                                                                      | 7                                                          | 7                                                               |
| attribute-macros                                                                                                                       | 7                                                          | 7                                                               |
| derive-macros                                                                                                                          | 7                                                          | 7                                                               |
| tagged-template-macros                                                                                                                 | 8                                                          | 8                                                               |
| type-macros                                                                                                                            | 9                                                          | 9                                                               |
| labeled-block-macros                                                                                                                   | 6 + test                                                   | 7                                                               |
| quasiquoting                                                                                                                           | 25 snippets                                                | 25                                                              |
| testing-macros                                                                                                                         | 8 tests + 2 unit                                           | 10                                                              |
| publishing-macros                                                                                                                      | discovery fixture: blocked without approval, expands after | 2                                                               |
| std README                                                                                                                             | 9                                                          | 9                                                               |
| collections                                                                                                                            | 3                                                          | 3 (run with `--under packages/graph`)                           |
| derive, effect, contracts, contracts-refined, macros, typesugar, core, transformer-core, playground, parser (2), strings, fp, validate | 1 each (parser 2)                                          | all; fp and validate pass with strictOutput warnings (bugs 5–6) |

### Code bugs still open

1. **Range variable assigned from a chained call is not rewritten.** `const r3 = (0).to(100).step(10); r3.toArray()` gives `TypeError: r3.toArray is not a function`. Inline chains and single-call variables work. Location: transformer-core rewriting.ts (`inferExtensionCallType` only covers inline chains).
2. **`createMacroTestContext` garbles `quote()` output when printed.** Its `parseExpression`/`parseStatements` return nodes positioned in a temporary source file, so printing them against `ctx.sourceFile` drops or garbles literals (`quote(ctx)\`1 + 2\``prints as` + `). Location: packages/testing/src/macro-context.ts:88-110. The docs route quote-based macros to `transformCode` instead.
3. **A failing `staticAssert` still prints a check mark.** `staticAssert(1 + 1 === 3, "math is broken")` emits the comment `// staticAssert: "math is broken" ✓` even though it reports TS9217.
4. **The `@impl` companion doesn't type-check.** It emits `export const FlatMap = flatMapBox as FlatMap<Box>`, which strictOutput rejects: "'FlatMap' refers to a value…" and "Box requires 1 type argument". Repro: the custom-Box `let:` example in the std README.
5. **The derived Eq companion leaks a user comment.** A trailing comment from a following line ends up inside the generated code: `a.name === // a < b, ...`. Same family as the Json JSDoc leak.
6. **strictOutput type errors in generated output.** `is<User>()` (validate) gives "Property 'name' does not exist on type 'object'". The fp `Some(5).map(...)` output also has errors, from the known annotation-erasure issue.
7. **ts-plugin source still advertises unsupported syntax.** packages/ts-plugin/src/index.ts:8 claims `|>`/`::` transforms; that is code, so I didn't touch it.
8. **Unverified:** I couldn't confirm that contracts-refined removes a proven check, even with `config.set({ contracts: { proveAtCompileTime: true } })`. The README no longer claims it does.

### Outside my files (for whoever owns them)

- docs/faq.md:176 and docs/macro-types.md:292 still link to `./writing-macros.md` (now a pointer page).
- docs/reference/config.md:61 and :77 still document `macroModules`.
- Package descriptions in package.json still start with 🧊.

### Files changed

- /Users/deapovey/src/personal/typesugar/docs/writing-macros.md
- /Users/deapovey/src/personal/typesugar/docs/writing-macros/{index,expression-macros,attribute-macros,derive-macros,tagged-template-macros,type-macros,labeled-block-macros,quasiquoting,testing-macros,publishing-macros}.md
- /Users/deapovey/src/personal/typesugar/packages/{std,collections,codec,erased,math,strings,parser,units,lsp-server,lsp-common,contracts,contracts-refined,derive,effect,macros,transformer-core,core,typesugar,transformer,ts-plugin,unplugin-typesugar,vscode,playground,fp}/README.md

The example sources and harness are in /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/docfix/authoring/. Run output is in the gitignored /Users/deapovey/src/personal/typesugar/.typesugar/doc-examples/authoring-fix/.
