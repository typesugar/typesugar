# PEP-029: CI Performance Improvements

**Status:** Draft
**Date:** 2026-03-29
**Author:** Claude (with Dean Povey)

## Context

CI currently takes ~13 minutes per push. This is too slow for iterative development — a docs-only change (adding a PEP markdown file) triggers the full test suite across 3 Node versions.

### Current CI Structure

| Job             | Node       | Depends on         | Duration   | What it does                             |
| --------------- | ---------- | ------------------ | ---------- | ---------------------------------------- |
| Test            | 18, 20, 22 | —                  | ~9 min × 3 | `pnpm build` + `pnpm test` (6500+ tests) |
| Lint            | 22         | —                  | ~4 min     | `pnpm build` + format + typecheck        |
| Test-VSCode     | 22         | Test               | ~3 min     | VS Code extension tests (xvfb)           |
| Publish-Dry-Run | 22         | Test, Lint, VSCode | ~2 min     | Verify publish works                     |

Key numbers: **230 test files**, **85K lines of test code**, **6500+ tests**, **build runs 4 times**.

### Problems

1. **No path filtering** — docs-only changes run the full suite
2. **Build runs 4 times** — each job rebuilds from scratch (no artifact sharing)
3. **3× Node matrix** — most bugs are version-independent; 3 versions triple the wall time
4. **No incremental testing** — all 6500 tests run even if only one package changed
5. **Sequential dependency chain** — VSCode and Publish wait for Test to finish

## Waves

### Wave 1: Path Filtering — Skip CI for Docs-Only Changes ✅

**Tasks:**

- [x] Add `paths-ignore` to the CI workflow trigger
- [x] Keep Release workflow unconditional (it handles changesets)

**Gate:**

- [x] Pushing a `.md` file does NOT trigger CI
- [x] Pushing a `.ts` file DOES trigger CI

**Impact:** Eliminates ~13 min CI runs for documentation changes.

### Wave 2: Share Build Artifacts Across Jobs ✅

**Tasks:**

- [x] Add a dedicated `build` job that runs `pnpm build` once
- [x] Upload build artifacts using `actions/upload-artifact@v4`
- [x] Have Test, Lint, VSCode jobs download artifacts instead of rebuilding
- [x] Test-VSCode now runs in parallel with Test and Lint (all depend only on Build)

**Gate:**

- [ ] Build runs exactly once per CI run
- [ ] Total CI time reduced by ~30% (eliminating 3 redundant builds)

### Wave 3: Reduce Node Matrix to 2 Versions ✅

**Tasks:**

- [x] Change matrix from `["18", "20", "22"]` to `["20", "22"]`
- [x] Node 18 reaches EOL April 2025 — already past. Dropped.

**Gate:**

- [ ] CI wall time reduced from ~13 min to ~10 min
- [ ] No regressions on supported Node versions

### Wave 4: Selective Test Running (Turbo/nx-style)

**Tasks:**

- [ ] Use vitest's `--changed` flag or custom script to only run tests for packages
      that changed since the last successful CI run
- [ ] Alternative: use `pnpm --filter` with `--since` to detect changed packages:
  ```bash
  pnpm --filter "...[origin/main]" test
  ```
- [ ] Always run the `tests/playground-examples.test.ts` integration test (it covers all packages)
- [ ] Full test suite runs on `main` merges; selective on PRs

**Gate:**

- [ ] A change to `packages/std/src/` only runs `packages/std/tests` + integration tests
- [ ] A change to `packages/transformer/src/` runs transformer tests + integration tests
- [ ] CI time for single-package changes drops to ~4-5 min

### Wave 5: Parallel Test Optimization

**Tasks:**

- [ ] Profile the slowest test files:
  ```bash
  npx vitest run --reporter=json | jq '.testResults | sort_by(-.endTime + .startTime) | .[0:10] | .[].name'
  ```
- [ ] Split the slowest test files into smaller chunks
- [ ] Consider using vitest's `--shard` flag for parallel execution across CI matrix:
  ```yaml
  strategy:
    matrix:
      shard: [1/3, 2/3, 3/3]
  ```
- [ ] Use sharding instead of Node version matrix for parallelism

**Gate:**

- [ ] No single test file takes more than 30 seconds
- [ ] Total test time reduced to ~5-6 minutes

## Files Changed

| File                       | Change                                           |
| -------------------------- | ------------------------------------------------ |
| `.github/workflows/ci.yml` | Path filters, artifact sharing, matrix reduction |
| `vitest.config.ts`         | (Wave 5 only) Sharding configuration             |

## Consequences

### Benefits

- Docs-only pushes: 0 min (was 13 min)
- Single-package changes: ~4-5 min (was 13 min)
- Full test runs: ~6-8 min (was 13 min)
- Build runs once instead of 4 times
- Faster feedback loop for development

### Trade-offs

- Wave 4 (selective testing) adds complexity to determine what changed
- Dropping Node 18 removes coverage for users on older versions (but it's EOL)
- Artifact sharing adds ~30s upload/download overhead per job

### Recommended Priority

**Wave 1** (path filtering) is the highest-impact, lowest-effort change — implement immediately.
**Wave 2** (artifact sharing) is the next biggest win — saves ~4 min per run.
**Wave 3** (drop Node 18) is trivial — just change the matrix.
**Waves 4-5** are optimizations for when the test suite grows further.
