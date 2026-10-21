## Group "start": report

I fixed every finding in my scope by editing docs only, with no code changes. Every example I touched was re-run through doc-example.mjs against the current dist, or through `transformCode` / single-file `tsc --noEmit` for the macro-authoring snippets. Prettier has been run. AGENTS.md was skipped by prettier, apparently because of .prettierignore. No processes of mine are running. I deleted my helper files from `.typesugar/doc-examples`.

The coordinator's mid-task items were already done:

- faq.md and macro-types.md now link to `./writing-macros/`.
- config.md no longer mentions `macroModules`.

### Per finding

1. Syntax-marker imports for derived methods: **fixed** in app-developer, vitest, macro-types, troubleshooting (now listed as cause #1) and macro-triggers §8. jest.md was rewritten (see 9). The `init` template is code and still lacks the imports, so getting-started/index.md has a warning box listing the 4 imports to add.
2. `yield: ({…})`: **re-verified**. The std fix makes it valid, and it runs. I fixed index.md's `yield: { { … } }`.
3. README array extensions: **re-verified**. They work now (`head(arr)`, `chunk(arr, 2)`), and the comments are corrected.
4. README typeclass and operator examples: **fixed**. They now use `/** @typeclass */` + `/** @impl Serialize<Point> */`, and Semigroup + `syntax/semigroup/ops`; both run. I rewrote the `Op<>` section in macro-triggers to the `/** @op */` mechanism, with the real mapping table.
5. ESLint spread: **fixed** in config.md, getting-started/editor-setup.md and troubleshooting. The `.eslintrc` sections are cut.
6. Glob include/exclude: **fixed**. Docs now describe the real picomatch semantics: node_modules always skipped, `include: []` transforms nothing.
7. config.md: **rewritten**. It now covers `typesugar.config.ts` (search order, `TypesugarConfig` keys, `security.allowedMacroPackages`), `TYPESUGAR_*` env mapping, the real tsconfig keys (`verbose`/`cfgConfig`/`cacheDir`) and the 7 real unplugin options including `cfgConfig`. The comptime-timeout section is gone. One thing found while writing it: `cfgConfig` _replaces_ `TYPESUGAR_CFG_*`, it doesn't merge, and the page says so.
8. Webpack CJS `.default`: **fixed** in webpack.md, config.md and troubleshooting.
9. Jest: **cut**. jest.md now says plainly there is no working ts-jest path and points to Vitest. The config.md and troubleshooting entries were updated to match.
10. validator as a boolean guard: **fixed**. app-developer and README show the result object. from-zod is rewritten around `is<T>()` / `validate<T>()` from @typesugar/validate.
11. Macro-authoring API: **fixed**.
    - Rewrote extension-author, reference/index, macro-context (the evaluate section and the example) and from-ts-macros.
    - They now use the single-object `define*Macro` form plus `globalRegistry.register`, `ctx.factory`, `quote` from `@typesugar/macros`, and `transformCode` / `createMacroTestContext` for testing.
    - Added the `typesugar.macros` manifest and approval steps.
    - monorepo.md has a known-issue box for PEP-059 P1 #18.
12. Builder: **cut** everywhere in my files.
13. `tsc --noEmit` as the CI gate: **fixed**. tsc.md now explains emit-time transformation; vite/esbuild/webpack/vitest/monorepo/troubleshooting use `typesugar check`.
14. AGENTS.md: **fixed**.
    - `===` compiles to `Point.Eq.equals`.
    - `ts.factory` over `quote`, per CLAUDE.md (principle 9 and the "When Adding Features" list).
    - Replaced the nonexistent registries and `registerFlatMap`.
    - Package tree: removed hlist/symbolic/prettier-plugin, added typesugar/lsp-\*.
    - `syntax/do` activation.
    - Derive vs auto-derivation table.
    - `defineExpressionMacro` signature.
    - Also fixed `typeRewriteRegistry` and the match-v2 path.
15. Extension ID: **fixed** (`typesugar.typesugar-vscode`).
16. approve-macros: **added** to end-user.md (as Step 5), cli.md (full section), config.md, troubleshooting, extension-author, monorepo and from-ts-macros.
17. Zero-cost claims: **fixed**. The "Compiles to" comments now show the real `User.Eq.equals(...)` etc.
18. README Safety: **fixed**. It now says IO is off by default and that this is not a security boundary.
19. `--explain`: **cut**. README and index.md point to `/errors/<code>`.
20. TS9061/9062: **cut**. README now limits the claim to unknown `@derive` names, and the index.md block is removed.
21. cli.md: **regenerated** from `printHelp()`. It adds approve-macros, the init flags, `--js`, `--strict=incremental` and `--show-suppressed-diagnostics`, plus run's refusal and exit codes and a per-command exit table. It fixes the doctor checklist and the skipLibCheck note, and drops the references/incremental rows and the `check --strict` script. troubleshooting's `--manifest` line is cut.
22. Home-page snippets: **fixed**. comptime uses the function form (fib 20), `ensures` uses the canonical form, `.sum()`→`.chunk(2)`, and `forAll` uses `@derive(Arbitrary)`. `defineSyntaxMacro` was replaced by a working `defineExpressionMacro`, `collectTypes` is cut, and the Effect, TS9001 trace and `match` blocks are now real.
23. SQL table parameter: **fixed** (`Fragment.ident`).
24. Json string in/out: **fixed**. Docs now say `toJson` returns an object and `fromJson` takes `JSON.parse(...)`; the static call works per the core-engine fix.
25. Zod imports: **fixed** (`Positive` from type-system, `wrap`).
26. packages.md exports: **fixed**. Every list was checked by script against the dists; the only remaining hit is a false positive (`S`, a type parameter).
27. `ctx.evaluate`: **fixed** (shows the `ComptimeValue` union).
28. Root editor-setup: **replaced** with a pointer page.
29. Error pages: other group's files. TS9061/9062 are reserved.
30. macro-triggers §8, the op mapping and FAQ comptime fs/cache: **fixed**.
31. Minor items: **fixed**. The fixes:
    - reference/index links, the home "Macro Types" link and the `#pattern-matching` anchor.
    - The `/guides/collections` link.
    - Next.js/Turbopack text: Next 16+ needs `--webpack`. This comes from my knowledge of Next.js, not tested here.
    - Turbo `tasks` key.
    - README "Frozen" text: these packages are published.
    - Examples text: standalone vs dry-runs.
    - The three missing VS Code settings, and the vision wording.
    - The sidebar now includes Macro Kinds, Macro Triggers, Performance and Security.
    - `ignoreDeadLinks: true` is left in place, with a TODO, so the build doesn't break on the remaining links below.

### Examples re-run (all pass unless noted)

| Page                                      | Examples                                                                                         | Passing                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| README.md                                 | hero, Point, extensions, reflect, sql, strings/units, typeclass, operator, Effect + EffectSchema | 9/9 (validator output carries strictOutput warnings, see bugs) |
| docs/index.md                             | quick, macro def (tsc), FP/contracts, comptime/tailrec, std/match, lazy+grammar, Effect, testing | 8/8                                                            |
| getting-started/index.md (init + imports) | 1                                                                                                | 1                                                              |
| app-developer.md                          | derive, reflect                                                                                  | 2/2                                                            |
| vitest.md                                 | comptime/derive, transformCode                                                                   | 2/2                                                            |
| extension-author.md                       | double, FieldNames derive, upper, tests                                                          | 4/4                                                            |
| macro-context.md                          | example macro                                                                                    | 1/1                                                            |
| macro-types.md                            | let/par/guard, attribute, derive table, type macros (tsc)                                        | 4/4                                                            |
| macro-triggers.md                         | §8 Show, §9 @op                                                                                  | 2/2                                                            |
| from-ts-macros.md                         | double/add/quote/showType/keys/logged                                                            | 6/6                                                            |
| from-zod.md                               | is/validate/validator/fieldNames/wrap/union                                                      | 6/6                                                            |
| from-effect.md                            | quick start, layers, resolveLayer, EffectEqual/Hash, bridge                                      | 5/5 (EffectExt marked broken)                                  |
| faq.md                                    | comptime fs                                                                                      | 1/1                                                            |
| config.md                                 | cfg env                                                                                          | 1/1                                                            |

### Code bugs still open

1. `init` template (`packages/transformer/src/init.ts:548-585`): it has no syntax imports, so the generated example crashes with `user1.clone is not a function`. It also prints `JSON: [object Object]`.
2. EffectExt is ambiguous: `import { Effect } from "effect"` plus EffectExt gives "Ambiguous extension method 'map' … Effect.map (from "effect")". This is probably caused by the namespace-import extension support (core-engine fix 2). A chained `.flatMap` after the first call is also not rewritten.
3. Method sugar on the un-annotated result of sugar is not rewritten: `const c = p.clone(); c.equals(p)` gives `c.equals is not a function`. Workaround: `const c: Point = ...`.
4. `import "@typesugar/fp/syntax/show"` alone does not activate `.show()`. It also needs `import type { Show } from "@typesugar/fp"`.
5. `let:` binding a same-file `@service` tag (`db << DatabaseTag`) fails with "Could not infer type constructor" (std (c), deferred).
6. Custom attribute macros only trigger in decorator form; the JSDoc form is limited to the fixed `JSDOC_MACRO_TAGS` list (transformer-core/macro-helpers.ts:54).
7. `validator<T>()` and `is<T>()` output carries strictOutput warnings ("Property 'name' does not exist on type 'object'"). Narrowing `r.success` then `r.errors` also warns.
8. Legacy `match(x, {Ok, Err})` output warns "Property 'tag' does not exist on type 'never'". I switched the home page to the fluent form.
9. `let:` guards on a Promise are a compile error. The docs now say guards only work on Array/Iterable.
10. `resolveModuleSpecifier` maps any `/packages/<x>/` path to `@typesugar/x` (PEP-059 P1 #18). This is documented as a known issue in monorepo.md.

### Dead links in other groups' pages

- `guides/do-notation.md` → `../reference/typeclasses.md#flatmap` and `../reference/macro-types.md#labeled-block-macros`. The page is at `/macro-types`.
- `errors/TS9201.md` → `/reference/macros.md`
- `showcase/effect-comparison/README.md` → `./http-server/`, `./validation/`, `./generator-overhead/`

### Files changed

All under /Users/deapovey/src/personal/typesugar/:

- README.md, AGENTS.md
- docs/index.md, docs/faq.md, docs/editor-setup.md, docs/macro-triggers.md, docs/macro-types.md
- docs/getting-started/{index,app-developer,end-user,extension-author,editor-setup,troubleshooting}.md
- docs/getting-started/environments/{vite,esbuild,webpack,tsc,bun,vitest,jest,monorepo}.md
- docs/reference/{cli,config,index,macro-context,packages}.md
- docs/migration/{from-effect,from-zod,from-ts-macros}.md
- docs/.vitepress/sidebar.ts, docs/.vitepress/config.ts (comment only)

playground.md, playground-test.md, SECURITY.md and PERFORMANCE.md were reviewed and left unchanged.

Scratch repros are in /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/docfix/start/
