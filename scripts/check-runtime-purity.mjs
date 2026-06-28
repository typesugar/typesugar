#!/usr/bin/env node
/**
 * check-runtime-purity — enforce PEP-050's Case-1/Case-2 separation.
 *
 * A typesugar *runtime library* must not pull `typescript` into its `.` runtime
 * entry: `typescript` is multi-MB and build-time only. Macro definitions (which
 * import `typescript`) belong in an isolated `./macros` entry that the transformer
 * loads at build time and bundlers tree-shake out of the app.
 *
 * This check inspects each package's built `.` entry (dist/index.js[.cjs]) and
 * fails if it imports/requires `typescript`. Build-time/infra packages (compiler,
 * transformer, plugins, macro provider) are exempt via ALLOWLIST.
 *
 * Run: node scripts/check-runtime-purity.mjs   (exits 1 on any leak)
 * Requires packages to be built first (CI builds before checking).
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PKGS_DIR = join(ROOT, "packages");

/**
 * Build-time / compiler-infrastructure packages: importing `typescript` is correct
 * (they run inside the toolchain, never in an app's runtime bundle).
 */
const ALLOWLIST = new Set([
  "core", // MacroContext, registry, hygiene — the macro authoring API
  "macros", // the central macro provider
  "transformer", // the transformer itself
  "transformer-core", // shared transformer helpers
  "lsp-common",
  "lsp-server",
  "eslint-plugin",
  "prettier-plugin",
  "ts-plugin",
  "vscode",
  "testing", // test harness (MacroContext mocks)
  "playground",
  "unplugin-typesugar", // bundler plugin (Vite/Rollup/Webpack/esbuild) — build-time
]);

const TS_IMPORT_RE = /(?:from\s*["']typescript["']|require\(\s*["']typescript["']\s*\))/;

const leaks = [];
for (const name of readdirSync(PKGS_DIR)) {
  if (ALLOWLIST.has(name)) continue;
  const pkgDir = join(PKGS_DIR, name);
  const entries = [join(pkgDir, "dist/index.js"), join(pkgDir, "dist/index.cjs")];
  for (const entry of entries) {
    if (!existsSync(entry)) continue;
    const code = readFileSync(entry, "utf8");
    // Ignore the sourcemap comment line; only count real import/require.
    if (TS_IMPORT_RE.test(code)) {
      const count = (code.match(new RegExp(TS_IMPORT_RE.source, "g")) || []).length;
      leaks.push({ name, entry: entry.replace(ROOT + "/", ""), count });
      break; // one report per package
    }
  }
}

if (leaks.length > 0) {
  console.error(
    "✗ Runtime-purity check failed — these runtime libraries pull `typescript` into their `.` entry:"
  );
  for (const l of leaks) {
    console.error(`  - ${l.name}: ${l.count} typescript import(s) in ${l.entry}`);
  }
  console.error(
    "\nMove macro definitions to an isolated `./macros` entry (PEP-050 Wave 2) so the\n" +
      "runtime `.` entry stays typescript-free. If a package is genuinely build-time\n" +
      "infrastructure, add it to ALLOWLIST in scripts/check-runtime-purity.mjs."
  );
  process.exit(1);
}

console.log(
  "✓ Runtime-purity check passed — no runtime library leaks `typescript` into its `.` entry."
);
