## int-misc report

All my files pass now: 17 files and 497 tests (packages/sql, eslint-plugin, unplugin-typesugar, tests/match-destructure, tests/red-team-unplugin-typesugar, and the macros diagnostic-suppression rules and registration tests). Nothing of mine is still running. Prettier is clean, and `tsc --noEmit` is clean for unplugin-typesugar.

### 1 & 2. sql `instanceof Query/Update` failures and the SQL-4 "fd" TypeError: case (a). Fixed outside my files; I made no code change.

- **Cause:** the tooling fix (d1ecfbdc) switched include/exclude from substrings to globs. The root `vitest.config.ts` exclude list (`"tests"`, `"packages/transformer"`, ...) then stopped matching anything, so the root plugin started macro-expanding test files.
  - In the sql tests, `sql\`...\``expanded to`\_\_sql_build`imported from`"@typesugar/sql"`. That is the dist build, so its Fragment produced the dist `\_Query`/`Update`, and `instanceof` against the src classes failed.
  - The "fd" error came from the extension rewrite turning `UserMeta.read(...)`/`.write(...)` into calls on the test's `import * as fs`.
- **Fix:** another agent has already changed `vitest.config.ts` (uncommitted) to the glob equivalents: `packages/core/**`, `packages/transformer*/**`, `**/tests/**`, `**/__tests__/**` and so on. All three sql files pass with it. Whoever commits should include that change.

### 3. eslint-plugin full-processor-buffer `"path" argument ... Array`: case (a), same cause as 1 and 2. It passes now with no change to macro-loader.

- **Mechanism:** with the test file being transformed, the array's own `.join(...)` was rewritten to `join(arr, ...)` from the test's `import { join } from "node:path"`.
- **Real bug that is still live** (transformer-core, not mine; see Needs): a named import whose name matches the method still hijacks native methods. I reproduced it against the current dist with `import { join } from "node:path"; xs.join("/")`, which becomes `join(xs, "/")`.

### 4. tests/red-team-unplugin-typesugar.test.ts: case (b), plus a latent bug fixed (case c)

- **Tests updated to glob semantics (b):**
  - Ids are absolute, as bundlers pass them.
  - `["src/**", "lib/**"]` and `["**/__tests__/**", "**/*.spec.*"]` match; bare `"src/"` or `"__tests__"` no longer act as substrings.
  - `"src/components/**"` matches with both `/` and `\` separators.
  - "custom exclude overrides node_modules" became "node_modules stays excluded with a custom exclude; an include pattern naming node_modules opts in". That behaviour change came from d1ecfbdc.
- **Code fixes in `packages/unplugin-typesugar/src/unplugin.ts` (`createTransformFilter`), dist rebuilt:**
  - **`include: []`:** createFilter treats `[]` as "no include filter", which would have transformed every module, CSS and JSON included. I kept the old meaning: `include: []` now matches nothing, via an explicit early return.
  - **node_modules check:** the regex was `/\/node_modules\//`, so a relative or Windows-relative id like `node_modules\lodash\index.js` slipped through. It is now `/(^|\/)node_modules\//`.

### 5. tests/match-destructure.test.ts: case (b), changed by b3b647e8

- The scrutinees are bare identifiers with no `_tag` in their type, so the fp representation is correct and this is not a regression.
- I updated the 9 tests to the new codegen: `!= null` / `== null` checks, `"left" in` / `"right" in`, `Some(v)` binding the value itself, and `Some(42)` comparing `_opt === 42`.
- I added a `run()` helper that evaluates the printed expansion, so each test now also executes the output against real values. The `_tag`-typed path is still covered by packages/std/tests/match-execution.test.ts.

### 6. NewtypeAssignment (Rule 3): it is dead for the real library, but I updated the comment instead of removing it

- **Proof:** a new test in `packages/macros/src/diagnostic-suppression-rules.test.ts` ("NewtypeAssignment rule — no longer needed by @typesugar/type-system", 2 tests). It compiles the real `packages/type-system/src/newtype.ts` with no rules registered:
  - `wrap<UserId>(42)`, `newtypeCtor` and `validatedNewtype` give no TS2345.
  - Exactly the two real errors remain: `const x: UserId = 42` (TS2322) and `U("x")` (TS2345).
  - The rule suppresses nothing in that program.
- **Why not removed:** the rule still fires only for the old inferred-base `UnwrapNewtype` shape. That shape is exactly what the fixtures in tests/diagnostic-suppression-{newtype,must-report,cli-pipeline,opaque-integration,type-rewrite}.test.ts declare, and those files belong to another integration agent. Removing it would also drop a public export, `createNewtypeAssignmentRule` from @typesugar/macros. So I marked it LEGACY / candidate for removal in the rule's comment and the file header, and left the deletion as a decision for you.

### Needs from other owners

- **transformer-core (`import-resolution.ts`, `checkImportedSymbolForExtension` / `receiverMatchesFirstParam`):** a named import named after the method shadows native methods, and a rest parameter's array type matches an array receiver. So `import { join } from "node:path"; xs.join("/")` becomes `join(xs, "/")` in user code, which is a runtime crash.
  - Suggested fix: when the first parameter is a rest parameter, match the receiver against its element type.
  - Possibly also: don't let the bare named-import form replace a method the receiver natively has unless it is a real `@extension`.
- **Commit the `vitest.config.ts` exclude glob change** (made by another agent); items 1–3 depend on it.
- **If you want Rule 3 removed:** delete `createNewtypeAssignmentRule` and its helpers from diagnostic-suppression-rules.ts, its registration and the name lists in diagnostic-suppression-registration.ts (and its test), and the export in packages/macros/src/index.ts. Then remove or retarget the NewtypeAssignment cases in the five tests/diagnostic-suppression-\*.test.ts files and tests/diagnostic-parity.test.ts.

### Files changed

- /Users/deapovey/src/personal/typesugar/packages/unplugin-typesugar/src/unplugin.ts (dist rebuilt)
- /Users/deapovey/src/personal/typesugar/tests/red-team-unplugin-typesugar.test.ts
- /Users/deapovey/src/personal/typesugar/tests/match-destructure.test.ts
- /Users/deapovey/src/personal/typesugar/packages/macros/src/diagnostic-suppression-rules.ts (comments only)
- /Users/deapovey/src/personal/typesugar/packages/macros/src/diagnostic-suppression-rules.test.ts

**What the docs should say:** `include: []` means "transform nothing". Dependencies under node_modules are skipped even for relative ids, unless an include pattern names node_modules.
