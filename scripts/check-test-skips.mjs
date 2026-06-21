#!/usr/bin/env node
/**
 * check-test-skips — enforce the AGENTS.md "no naked skips" policy.
 *
 * Every disabled test (`describe/it/test.skip|todo|fails`, `xit`, `xdescribe`)
 * must carry a tracking reference — an issue (`#123`), a PEP (`PEP-049`), or an
 * `issues/…` URL — within 3 lines above or 2 lines below the skip token (the
 * "below" allowance covers multi-line calls whose title carries the reference).
 *
 * Exemptions:
 *  - Conditional gates (`skipIf(...)`, `runIf(...)`) are self-documenting runtime
 *    decisions, not disabled tests — not flagged.
 *  - Empty-body placeholder skips (`it.skip("…", () => {})`) are gated no-ops
 *    (e.g. quarantine lists keyed on a path) rather than disabled real tests.
 *
 * Run: node scripts/check-test-skips.mjs   (exits 1 on any naked skip)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const IGNORE_DIRS = new Set(["node_modules", "dist", "templates", "sandbox", ".git", "out"]);
const TEST_RE = /\.(test|spec)\.tsx?$/;

// A disabled test. `skipIf`/`runIf` are deliberately excluded (conditional gates).
const SKIP_RE = /\b(?:(?:describe|it|test)\.(?:skip|todo|fails)|xit|xdescribe)\s*\(/;
// Title present on the skip's own line, e.g. `it.skip("foo", …)`.
const INLINE_TITLE_RE =
  /\b(?:(?:describe|it|test)\.(?:skip|todo|fails)|xit|xdescribe)\s*\(\s*[`'"]/;
const REF_RE = /#\d+|PEP-\d+|issues\//i;
const EMPTY_BODY_RE = /\(\s*\)\s*=>\s*\{\s*\}\s*\)/; // () => {})

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (TEST_RE.test(entry)) out.push(full);
  }
}

const files = [];
walk(ROOT, files);

const violations = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!SKIP_RE.test(line)) continue;
    if (EMPTY_BODY_RE.test(line)) continue; // gated placeholder, not a disabled test
    const windowLines = [line, lines[i - 1] ?? "", lines[i - 2] ?? "", lines[i - 3] ?? ""];
    // Only consult lines below when the title is NOT on the skip line itself —
    // i.e. a genuine multi-line call whose reference rides on the title. This
    // stops an adjacent documented skip from sheltering a naked one.
    if (!INLINE_TITLE_RE.test(line)) {
      windowLines.push(lines[i + 1] ?? "", lines[i + 2] ?? "");
    }
    const window = windowLines.join("\n");
    if (REF_RE.test(window)) continue;
    violations.push({ file: relative(ROOT, file), line: i + 1, text: line.trim() });
  }
}

if (violations.length > 0) {
  console.error(
    `\n✗ ${violations.length} naked test skip(s) — each .skip/.todo/.fails needs a reason + issue/PEP reference\n` +
      `  (same line or within 3 lines above). See AGENTS.md › "Test skips".\n`
  );
  for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
  console.error("");
  process.exit(1);
}

console.log(`✓ no naked test skips (${files.length} test files scanned)`);
