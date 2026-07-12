#!/usr/bin/env node
/**
 * Post-release smoke test (PEP-058 Wave 3/8/9).
 *
 * Verifies the PUBLISHED packages, from a consumer's point of view — against
 * the real npm registry, in a temp dir, with no workspace links anywhere. This
 * is the only check that would have caught, before users did:
 *
 *   - `typesugar create` shipping without its templates (found in Wave 2)
 *   - a facade that doesn't export a documented macro (found in Wave 8)
 *
 * Usage:
 *   node scripts/release-smoke.mjs              # test the `latest` dist-tag
 *   node scripts/release-smoke.mjs --version 0.2.0
 *   node scripts/release-smoke.mjs --keep       # don't delete the temp dir
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const versionArg = args.includes("--version") ? args[args.indexOf("--version") + 1] : "latest";
const keep = args.includes("--keep");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-smoke-"));
let failed = 0;

function step(name, fn) {
  process.stdout.write(`\n▶ ${name}\n`);
  try {
    fn();
    process.stdout.write(`✓ ${name}\n`);
  } catch (err) {
    failed++;
    process.stdout.write(`✗ ${name}\n  ${err.message.split("\n").slice(0, 6).join("\n  ")}\n`);
  }
}

function run(cmd, cmdArgs, cwd) {
  return execFileSync(cmd, cmdArgs, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "1" },
  });
}

console.log(`typesugar release smoke test`);
console.log(`  version:  ${versionArg}`);
console.log(`  temp dir: ${tmp}`);

// --- 1. scaffold from the REGISTRY (not this repo) --------------------------
const appDir = path.join(tmp, "demo");
step(`npx typesugar@${versionArg} create app demo`, () => {
  run("npx", ["--yes", `typesugar@${versionArg}`, "create", "app", "demo"], tmp);
  if (!fs.existsSync(path.join(appDir, "package.json"))) {
    throw new Error("create produced no package.json — are templates missing from the tarball?");
  }
});

// --- 2. the AI context ships and is scaffolded ------------------------------
step("create scaffolds AI context (AGENTS.md + skill)", () => {
  const agents = path.join(appDir, "AGENTS.md");
  if (!fs.existsSync(agents)) throw new Error("no AGENTS.md");
  const body = fs.readFileSync(agents, "utf-8");
  for (const needle of ["typesugar:begin", "typesugar check", "typesugar expand", "llms.txt"]) {
    if (!body.includes(needle)) throw new Error(`AGENTS.md missing: ${needle}`);
  }
  if (!fs.existsSync(path.join(appDir, ".claude", "skills", "typesugar", "SKILL.md"))) {
    throw new Error("Claude Code skill not installed");
  }
});

// --- 3. install + build the scaffolded app ----------------------------------
step("npm install", () => run("npm", ["install", "--no-audit", "--no-fund"], appDir));
step("npm run build", () => run("npm", ["run", "build"], appDir));

// --- 4. doctor must be green -----------------------------------------------
step("typesugar doctor", () => {
  const out = run("npx", ["typesugar", "doctor"], appDir);
  if (/✗/.test(out)) throw new Error(`doctor reported failures:\n${out}`);
});

// --- 5. the standalone hello-world builds against the registry --------------
const helloSrc = path.resolve("examples/standalone/hello-world");
if (fs.existsSync(helloSrc)) {
  const helloDir = path.join(tmp, "hello-world");
  step("standalone hello-world: install + build from npm", () => {
    fs.cpSync(helloSrc, helloDir, { recursive: true });
    fs.rmSync(path.join(helloDir, "node_modules"), { recursive: true, force: true });
    run("npm", ["install", "--no-audit", "--no-fund"], helloDir);
    run("npm", ["run", "build"], helloDir);
  });

  step("hello-world: macros actually expanded (comptime inlined)", () => {
    const out = run("npx", ["typesugar", "expand", "src/main.ts"], helloDir);
    if (!out.includes("5050")) {
      throw new Error("comptime did not inline the sum — macros are not expanding");
    }
    if (!/Point\.Eq\.equals/.test(out)) {
      throw new Error("`===` was not rewritten to the derived Eq instance");
    }
  });
}

// --- 6. the compiler's own help URLs resolve --------------------------------
step("error catalog is live (typesugar.org/errors/TS9001)", () => {
  const code = run("curl", [
    "-s",
    "-o",
    "/dev/null",
    "-w",
    "%{http_code}",
    "https://typesugar.org/errors/TS9001",
  ]);
  if (code.trim() !== "200") throw new Error(`expected 200, got ${code}`);
});

step("llms.txt is live", () => {
  const out = run("curl", ["-sL", "https://typesugar.org/llms.txt"]);
  if (!out.includes("llms-full.txt")) throw new Error("llms.txt missing or malformed");
});

// ---------------------------------------------------------------------------
if (!keep) fs.rmSync(tmp, { recursive: true, force: true });
else console.log(`\n(kept ${tmp})`);

console.log(
  failed === 0 ? `\n✅ release smoke test PASSED` : `\n❌ release smoke test FAILED (${failed})`
);
process.exit(failed === 0 ? 0 : 1);
