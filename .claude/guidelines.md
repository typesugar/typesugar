# typesugar - Claude Code Guidelines

Reference guide for working with the typesugar codebase. For active rule enforcement, see `.cursor/rules/`.

## Project Overview

**typesugar** — Syntactic sugar for TypeScript with zero calories.

- Core: Zero-cost abstractions via compile-time macro expansion
- Inspired by: Scala 3 (typeclasses, extension methods), Rust (zero-cost, derives), Zig (comptime)

## Quick Reference to Cursor Rules

Cursor rules handle active enforcement. Refer to these for details:

| Rule | Purpose | File |
|------|---------|------|
| Test workflow | Targeted test runs, `pnpm test:failed`, always use `tee` | `.cursor/rules/test-workflow.mdc` |
| Collections | Typeclass hierarchy, MapLike `undefined` handling (never `!== undefined`) | `.cursor/rules/collections-patterns.mdc` |
| HKT conventions | Use `F<_>` not `F[_]`, type-level functions must use `this["_"]` | `.cursor/rules/hkt-conventions.mdc` |
| Zero-cost | `summon()` must be compile-time, favor autoderivation | `.cursor/rules/zero-cost-guidelines.mdc` |
| Code quality | No `as unknown as`, mid-file imports, double iteration | `.cursor/rules/code-quality-checklist.mdc` |
| Design first | Confirm approach for macros/transformer changes | `.cursor/rules/design-before-building.mdc` |
| Branding | Lowercase "typesugar", 🧊 emoji, #8b5cf6 purple | `.cursor/rules/branding.mdc` |
| Check existing | Search `src/macros/`, registries before building | `.cursor/rules/check-existing-first.mdc` |
| TODOs | Place in `packages/<name>/TODO.md`, not repo root | `.cursor/rules/todo-in-packages.mdc` |
| Preferences | Autonomous execution, prefer "everything", Scala 3/Rust/Zig patterns | `.cursor/rules/user-preferences.mdc` |
| Module lifecycle | Package creation checklist, docs linkage, red team tests | `.cursor/rules/module-lifecycle.mdc` |

## Key Directories

```
src/
├── core/               # Macro infrastructure (types, registry, context, cache, pipeline)
├── macros/             # Built-in macros (typeclass, specialize, derive, reflect, etc.)
├── transforms/         # Main transformer orchestrating macro expansion
└── cli/               # CLI tooling

packages/
├── core/               # @typesugar/core — macro registration infrastructure
├── macros/             # @typesugar/macros — built-in macro implementations
├── transformer/        # @typesugar/transformer — ts-patch transformer plugin
├── std/               # @typesugar/std — standard library, match(), FlatMap, do-notation
├── typeclass/          # @typesugar/typeclass — typeclass machinery (@typeclass, @instance)
├── fp/                # @typesugar/fp — Option, Result, IO, List
└── [many more packages] — See AGENTS.md for full tree
```

## Common Patterns

### When working with macros
- Read the full implementation in `src/macros/` before modifying
- Check transformer integration in `src/transforms/macro-transformer.ts`
- Use `quote()` from `src/macros/quote.ts` for AST construction
- Refer to `specialize.ts` for inlining patterns

### When working with typeclasses
- Auto-derivation preferred when all fields have instances
- `summon<TC<T>>()` for explicit resolution in generic code
- Extension methods resolve automatically — no wrapper needed
- `Op<"+">` typeclass return types enable operator overloading

### When testing
- Run targeted tests: `pnpm vitest run <pattern> 2>&1 | tee test-output.txt`
- Re-run failed: `pnpm test:failed 2>&1 | tee test-output.txt`
- Full suite only as final check: `pnpm test`

### When creating packages
- Follow `packages/math/README.md` and `packages/math/examples/showcase.ts` templates
- Add red team tests at `tests/red-team-<name>.test.ts`
- Update all 4 doc locations: `README.md`, `docs/guides/index.md`, `docs/reference/packages.md`, `AGENTS.md`
- Declare all `devDependencies` — don't rely on hoisting

## Git Workflow

- GitHub account: `dpovey`
- Break commits into logical units
- CI must pass before considering work done
- After implementing: Build → Test → Lint → Document → Commit → Push → Verify CI

## CLI Commands Reference

| Command | Purpose |
|---------|---------|
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm test:failed` | Re-run failed tests |
| `pnpm typecheck` | Type check all |
| `typesugar run <file>` | Run a file with macro expansion |
| `gh auth status` / `gh auth switch` | Manage GitHub account |

## Design Inspiration

When unsure about design direction:
1. **Scala 3** — typeclasses, extension methods, HKT encoding, do-comprehension
2. **Rust** — zero-cost abstractions, derive macros, pattern matching
3. **Zig** — comptime evaluation, no hidden allocations

## Old Project Names

If you see `macrots`, `typemacro`, `ttfx`, `@ttfx/*` in code, these are stale references. Update to `typesugar` / `@typesugar/*`.

## Full Architecture Details

See `AGENTS.md` for:
- Complete macro system reference
- All built-in macros
- Package boundaries and responsibilities
- Transformer behavior and opt-out system
- Preprocessor guidelines
