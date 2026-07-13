---
"@typesugar/transformer": patch
"@typesugar/core": patch
"@typesugar/effect": patch
"@typesugar/lsp-common": patch
"typesugar": patch
---

PEP-058 Wave 2: pre-release onboarding and source corrections.

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
