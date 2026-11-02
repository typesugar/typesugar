#!/usr/bin/env node
/**
 * Build each `examples/standalone/*` app, and a library scaffolded by
 * `typesugar create library`, against THIS checkout's packages.
 *
 * The standalone examples install typesugar from the npm registry (they are
 * deliberately outside the pnpm workspace, so they can be copied out of the
 * repo), and their dependency ranges name the NEXT release, which may not be
 * published yet. `scripts/release-smoke.mjs` builds them against the registry
 * after a release; this script checks the same source against the code being
 * changed, so an API change that breaks them fails CI instead of the smoke
 * test after the release.
 *
 * It packs every public workspace package (`pnpm pack`, which rewrites
 * `workspace:*` to versions, as a publish would), copies each standalone app
 * to a temp dir, points its typesugar dependencies at the tarballs (direct
 * dependencies, and `overrides` for the transitive ones), then runs
 * `npm install`, `npm run check` and `npm run build`. The scaffolded library
 * also runs its `typecheck` and `test` scripts, and its build must emit
 * declarations. The packages must already be built
 * (`pnpm build`, or CI's build-dist artifact).
 *
 * Usage:
 *   node scripts/build-standalone-examples.mjs          # every standalone example
 *   node scripts/build-standalone-examples.mjs --keep   # keep the temp dir
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const keep = process.argv.includes("--keep");
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-standalone-"));
const tarballs = path.join(tmp, "tarballs");
fs.mkdirSync(tarballs);

function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(" ")}   (in ${path.relative(tmp, cwd) || cwd})`);
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, CI: "1" },
  });
}

// --- 1. pack every public workspace package ---------------------------------
/** package name → `file:` spec of its tarball */
const packed = new Map();
for (const dir of fs.readdirSync(path.join(repo, "packages"))) {
  const pkgDir = path.join(repo, "packages", dir);
  const manifest = path.join(pkgDir, "package.json");
  if (!fs.existsSync(manifest)) continue;
  const pkg = JSON.parse(fs.readFileSync(manifest, "utf-8"));
  if (pkg.private) continue;
  const out = run("pnpm", ["pack", "--pack-destination", tarballs], pkgDir);
  // pnpm prints the tarball path last.
  const file = out.trim().split("\n").pop().trim();
  if (!file.endsWith(".tgz") || !fs.existsSync(file)) {
    throw new Error(`pnpm pack in ${pkgDir} did not report a tarball (got: ${file})`);
  }
  packed.set(pkg.name, `file:${file}`);
}
console.log(`packed ${packed.size} packages`);

// --- 2. install, check, build (and test) each project against the tarballs --
let failed = 0;

/** Point `dir`'s typesugar dependencies at the tarballs, then run `scripts` in order. */
function buildProject(name, dir, scripts, verify) {
  const manifest = path.join(dir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(manifest, "utf-8"));
  for (const field of ["dependencies", "devDependencies"]) {
    for (const dep of Object.keys(pkg[field] ?? {})) {
      if (packed.has(dep)) pkg[field][dep] = packed.get(dep);
    }
  }
  pkg.overrides = { ...pkg.overrides, ...Object.fromEntries(packed) };
  fs.writeFileSync(manifest, JSON.stringify(pkg, null, 2) + "\n");

  console.log(`\n▶ ${name}`);
  try {
    run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], dir);
    for (const script of scripts) {
      if (pkg.scripts?.[script]) process.stdout.write(run("npm", ["run", script], dir));
    }
    verify?.();
    console.log(`✓ ${name}`);
  } catch (err) {
    failed++;
    if (err.stdout) process.stdout.write(err.stdout);
    console.log(`✗ ${name}: ${err.message.split("\n")[0]}`);
  }
}

// The standalone examples, as they are in the repo.
const standaloneRoot = path.join(repo, "examples", "standalone");
for (const name of fs.readdirSync(standaloneRoot)) {
  const src = path.join(standaloneRoot, name);
  if (!fs.existsSync(path.join(src, "package.json"))) continue;
  const dir = path.join(tmp, name);
  fs.cpSync(src, dir, {
    recursive: true,
    filter: (p) => !/(^|[\\/])(node_modules|dist)([\\/]|$)/.test(path.relative(src, p)),
  });
  buildProject(name, dir, ["check", "build"]);
}

// A library scaffolded by `typesugar create library`: its tsup build must
// emit declarations (withTypesugar), and its tests must pass.
{
  const name = "create-library";
  run(
    process.execPath,
    [path.join(repo, "packages", "transformer", "dist", "cli.js"), "create", "library", name],
    tmp
  );
  const dir = path.join(tmp, name);
  buildProject(name, dir, ["typecheck", "build", "test"], () => {
    for (const f of ["index.js", "index.cjs", "index.d.ts", "index.d.cts"]) {
      if (!fs.existsSync(path.join(dir, "dist", f))) throw new Error(`no dist/${f}`);
    }
    const dts = fs.readFileSync(path.join(dir, "dist", "index.d.ts"), "utf-8");
    // The derived companions are only in the EXPANDED program's declarations.
    if (!/namespace Point/.test(dts) || !/Eq/.test(dts)) {
      throw new Error(`dist/index.d.ts has no Point companion namespace:\n${dts}`);
    }
  });
}

if (keep) console.log(`\nkept ${tmp}`);
else fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
