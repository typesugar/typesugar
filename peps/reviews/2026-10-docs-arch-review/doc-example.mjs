#!/usr/bin/env node
// Compile (and optionally run) one documentation example through the real
// typesugar pipeline, using the already-built packages/*/dist.
//
//   node doc-example.mjs <example.ts> [--run] [--under <repo-subdir>]
//
// The example is copied to <repo>/<under>/.typesugar/doc-examples/ (gitignored)
// so `@typesugar/*` and `typesugar` imports resolve through that directory's
// node_modules. Default <under> is the repo root; packages not linked at the
// root (e.g. @typesugar/math) need `--under packages/<pkg>`.
//
// Prints: macro diagnostics, output type errors (strictOutput), the generated
// code, and with --run the result of executing it under node.
//
// <repo> is the checkout this script is in (three directories up), so it runs
// against that worktree's dist; set REPO=/path/to/checkout to use another one.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(process.env.REPO || fileURLToPath(new URL("../../..", import.meta.url)));
const args = process.argv.slice(2);
const run = args.includes("--run");
const underIdx = args.indexOf("--under");
const under = underIdx >= 0 ? args[underIdx + 1] : ".";
const src = args.find((a, i) => !a.startsWith("--") && (underIdx < 0 || i !== underIdx + 1));
if (!src) {
  console.error("usage: doc-example.mjs <example.ts> [--run] [--under <repo-subdir>]");
  process.exit(2);
}

const dir = path.join(REPO, under, ".typesugar", "doc-examples");
fs.mkdirSync(dir, { recursive: true });
const stem = path.basename(src).replace(/\.(ts|tsx|sts)$/, "");
// Prefix with a hash of the source path so agents using the same file names
// (d1.ts, ...) in different scratch dirs never overwrite each other's copies.
const base = `${createHash("sha1").update(path.resolve(src)).digest("hex").slice(0, 8)}-${stem}`;
const tsFile = path.join(dir, `${base}.ts`);
const code = fs.readFileSync(src, "utf8");
fs.writeFileSync(tsFile, code);

const require = createRequire(path.join(REPO, "package.json"));
const { transformCode } = await import(path.join(REPO, "packages/transformer/dist/index.js"));
const ts = require("typescript");

let result;
try {
  result = transformCode(code, { fileName: tsFile, strictOutput: true });
} catch (e) {
  console.log("TRANSFORM THREW:", e && e.stack ? e.stack : e);
  process.exit(1);
}

const diags = result.diagnostics ?? [];
console.log(`== diagnostics (${diags.length})`);
for (const d of diags) {
  const msg = typeof d.message === "string" ? d.message : JSON.stringify(d.message ?? d);
  console.log(`- [${d.severity ?? d.category ?? "?"}] ${msg}`);
}
console.log("== output");
console.log(result.code);

if (run) {
  const js = ts.transpileModule(result.code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const jsFile = path.join(dir, `${base}.mjs`);
  fs.writeFileSync(jsFile, js);
  const r = spawnSync(process.execPath, [jsFile], { encoding: "utf8", timeout: 30000 });
  console.log(`== run (exit ${r.status})`);
  if (r.stdout) console.log(r.stdout);
  if (r.stderr) console.log(r.stderr);
}
