# typesugar

## 0.2.0

### Minor Changes

- 053978c: PEP-053 Wave 1: specialization is now an always-on compiler optimization, not
  an API.
  - REMOVED: the `specialize()`, `specialize$()`, `mono()`, and `inlineCall()`
    macros and runtime stubs, the `fn.specialize(dict)` extension-method rewrite,
    and the `@typesugar/specialize` package (including the `Specialized<F, N>`
    type). Calls that pass a known typeclass instance auto-specialize — no
    annotation needed; use `// @no-specialize` to opt a call out.
  - REMOVED: `createSpecializedFunction`, `canFlattenToExpression`, and the
    `SpecializeOptions` type from `@typesugar/macros` (dead once the explicit
    surface was gone), and the TS9601/TS9221 diagnostics.
  - FIXED: `// @no-specialize-warn` previously disabled specialization entirely
    (substring collision with `// @no-specialize`); it now only suppresses the
    TS9602 skip warning. Both markers now also work on a comment line
    immediately above the call, matching the documented form.

- 4b78011: `typesugar init` gains a non-interactive mode: `--yes` (accept every default),
  `--persona <end-user|app-developer|extension-author>`. Without a TTY and
  without `--yes`, `init` and `create` now fail immediately with an actionable
  message instead of hanging forever on a prompt nobody can answer — which is
  what happened in CI, and to any AI assistant trying to set typesugar up.
- 076e677: PEP-058 Wave 6: `typesugar init` and `typesugar create` now scaffold AI-assistant
  context into your project — an `AGENTS.md` (read natively by Cursor, Copilot,
  Codex and Zed), a `CLAUDE.md` pointer, and a Claude Code skill. The content
  ships inside the package, is marker-delimited, and re-running `init` refreshes
  only that block, leaving everything you wrote around it untouched. New `--ai` /
  `--no-ai` flags.

### Patch Changes

- ab72bde: PEP-058 Wave 1: declare `engines.node >=20` on all published packages and enable npm provenance attestations in the release pipeline.
- a252187: PEP-058 Wave 2: pre-release onboarding and source corrections.
  - `typesugar init` now actually patches an existing vite/webpack/rollup
    config (previously it computed and silently discarded the patch,
    no-oping in the most common brownfield case), and prints an explicit
    "not yet supported" message for Next.js instead of implying support.
  - `typesugar create` templates now ship inside `@typesugar/transformer` —
    previously they lived only at the monorepo root, so `create` failed for
    every registry install of the CLI.
  - `typesugar doctor`'s ts-patch detection now checks for ts-patch's real
    `/// tsp-module:` header instead of a fuzzy substring that could
    false-positive on unpatched builds.
  - All compiler-emitted diagnostic help URLs (`seeAlso` in the TS9xxx and
    EFFECT0xx catalogs) and CLI next-step links now point at the canonical
    typesugar.org domain (previously typesugar.dev, which is not the site).
  - `@typesugar/lsp-common` gains a README and `sideEffects: false`.

- 2fb4b62: Fix: `summonAll` is now importable. It is a registered macro that declares
  `module: "typesugar"` and is documented as public API, but it shipped with no
  runtime stub and no facade export — so `import { summonAll } from "typesugar"`
  failed to type-check and the feature was unusable.
- Updated dependencies [4f6ad83]
- Updated dependencies [b6a5211]
- Updated dependencies [928566a]
- Updated dependencies [d8f810b]
- Updated dependencies [63bf193]
- Updated dependencies [98adbea]
- Updated dependencies [48b621b]
- Updated dependencies [563e46b]
- Updated dependencies [57d76a1]
- Updated dependencies [e274769]
- Updated dependencies [053978c]
- Updated dependencies [8aaf40f]
- Updated dependencies [855eb1f]
- Updated dependencies [76672a0]
- Updated dependencies [c56886c]
- Updated dependencies [ab72bde]
- Updated dependencies [4b78011]
- Updated dependencies [a252187]
- Updated dependencies [076e677]
- Updated dependencies [2fb4b62]
  - @typesugar/core@0.2.0
  - @typesugar/macros@0.2.0
  - @typesugar/transformer@0.2.0
  - unplugin-typesugar@0.1.2
  - @typesugar/typeclass@0.1.2
  - @typesugar/derive@0.1.2
  - @typesugar/reflect@0.1.2

## 0.1.1

### Patch Changes

- e2cbd69: Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- First stable patch release. Fixes build crash, LSP server stability, Zed extension, and adds pipeline/position-mapper exports to transformer.
- Updated dependencies [e2cbd69]
- Updated dependencies
  - @typesugar/core@0.1.1
  - @typesugar/macros@0.1.1
  - @typesugar/transformer@0.1.1
  - unplugin-typesugar@0.1.1
  - @typesugar/derive@0.1.1
  - @typesugar/typeclass@0.1.1
  - @typesugar/specialize@0.1.1
  - @typesugar/reflect@0.1.1

## 0.1.1-rc.0

### Patch Changes

- Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- Updated dependencies
  - @typesugar/core@0.1.1-rc.0
  - @typesugar/macros@0.1.1-rc.0
  - @typesugar/transformer@0.1.1-rc.0
  - unplugin-typesugar@0.1.1-rc.0
  - @typesugar/derive@0.1.1-rc.0
  - @typesugar/typeclass@0.1.1-rc.0
  - @typesugar/specialize@0.1.1-rc.0
  - @typesugar/reflect@0.1.1-rc.0
