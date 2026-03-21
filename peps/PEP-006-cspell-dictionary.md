# PEP-006: cSpell Dictionary for typesugar

**Status:** Draft
**Date:** 2026-03-14
**Author:** Dean Povey

## Context

typesugar introduces many domain-specific terms that cSpell (Code Spell Checker) doesn't know about: `typeclass`, `comptime`, `summon`, `deriving`, `hkt`, `stsx`, `semigroup`, `functor`, `monad`, etc. Without a custom dictionary, cSpell flags these constantly, making it more noise than signal. The extension currently ships without spell-checking support, and the workspace has cSpell disabled entirely.

The right fix isn't disabling spell checking — it's teaching cSpell the vocabulary. Language extensions commonly ship custom dictionaries (Rust, Go, Haskell extensions all do this). typesugar should do the same.

### Goals

1. **Zero false positives on typesugar keywords** — every macro name, typeclass name, and DSL term should be in the dictionary
2. **Ship with the VS Code extension** — users get it automatically
3. **Project-level fallback** — a `cspell.json` in the repo covers contributors who don't use the extension
4. **Easy to maintain** — adding a new macro or typeclass should naturally prompt a dictionary update

## Waves

### Wave 1: Build the Dictionary

**Tasks:**

- [ ] Audit all exported symbols across `packages/*/src/index.ts` to collect typesugar-specific terms
- [ ] Audit macro names (`@typeclass`, `@deriving`, `@hkt`, `@op`, `@impl`, `@extension`, `comptime`, `summon`, `staticAssert`, `includeStr`, `includeJson`, etc.)
- [ ] Audit typeclass names (`Eq`, `Ord`, `Semigroup`, `Monoid`, `Functor`, `Monad`, `FlatMap`, `Show`, `Hash`, `Foldable`, `Traversable`, etc.)
- [ ] Audit type system terms (`newtype`, `refined`, `opaque`, `phantom`, `hkt`, `stsx`, `typesugar`, etc.)
- [ ] Audit architecture terms (`unplugin`, `tspc`, `oxc`, `comptime`, `specialize`, etc.)
- [ ] Create `dictionaries/typesugar.txt` — one word per line, sorted alphabetically
- [ ] Create `cspell.json` at repo root referencing the dictionary

**Gate:**

- [ ] `cspell` lint passes on `packages/*/src/index.ts` with zero false positives for typesugar terms
- [ ] Dictionary file exists and is sorted

### Wave 2: Ship with the VS Code Extension

**Tasks:**

- [ ] Add `cSpell.customDictionaries` contribution to `packages/vscode/package.json`
- [ ] Bundle `dictionaries/typesugar.txt` in the extension package
- [ ] Add activation event or configuration so the dictionary loads for `.ts`, `.tsx`, `.sts`, `.stsx` files
- [ ] Re-enable cSpell in `.vscode/settings.json` (remove `"cSpell.enabled": false`)

**Gate:**

- [ ] Install extension in clean Cursor window, open a typesugar project — no false positives on typesugar keywords
- [ ] cSpell still catches real typos (e.g., `conts` instead of `const`)

### Wave 3: Maintenance Automation

**Tasks:**

- [ ] Add a script (`scripts/update-cspell-dict.ts`) that scans exports and macro names to regenerate the dictionary
- [ ] Add to CI: warn if dictionary is stale (new exports not in dictionary)
- [ ] Document in AGENTS.md: "when adding new macros/typeclasses, update the cSpell dictionary"

**Gate:**

- [ ] Script generates dictionary that matches hand-curated version
- [ ] CI check detects a missing word when a new export is added

## Files Changed

| File                            | Change                                                   |
| ------------------------------- | -------------------------------------------------------- |
| `dictionaries/typesugar.txt`    | New — custom dictionary file                             |
| `cspell.json`                   | New — project-level cSpell config                        |
| `packages/vscode/package.json`  | Add `cSpell.customDictionaries` contribution             |
| `.vscode/settings.json`         | Remove `cSpell.enabled: false`, add dictionary reference |
| `scripts/update-cspell-dict.ts` | New — dictionary generation script                       |
| `AGENTS.md`                     | Add note about dictionary maintenance                    |

## Consequences

1. **Benefits** — cSpell becomes useful instead of noisy; contributors get spell-checking without setup; extension users get it automatically
2. **Trade-offs** — Small maintenance burden when adding new terms; dictionary file needs to stay in sync
3. **Future work** — Could auto-generate dictionary entries from JSDoc `@keyword` tags; could contribute upstream to cSpell's TypeScript dictionary for common FP terms
