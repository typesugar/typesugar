#!/usr/bin/env node
/**
 * Build the .vercel/output directory for --prebuilt deployment.
 *
 * 1. Copies docs/.vitepress/dist → .vercel/output/static
 * 2. Bundles each api/*.ts → .vercel/output/functions/api/<name>.func/
 *
 * 3. Loads every built function and sends it one request
 *    (scripts/check-vercel-functions.mjs) — a bundle that crashes on import
 *    fails here instead of shipping as a production 500.
 *
 * Run after `pnpm build && pnpm docs:build`.
 *
 * Flags (for CI / local checks — deploys use the defaults):
 *   --out <dir>        write somewhere other than .vercel/output
 *   --functions-only   skip the static docs copy (no docs build needed)
 */

import { mkdirSync, cpSync, writeFileSync, readdirSync, rmSync, existsSync } from "fs";
import { join, basename, resolve } from "path";
import { spawnSync } from "child_process";
import { build } from "esbuild";

const root = process.cwd();
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outputDir = outIdx >= 0 ? resolve(args[outIdx + 1]) : join(root, ".vercel/output");
const functionsOnly = args.includes("--functions-only");

// Clean previous output
if (existsSync(outputDir)) {
  rmSync(outputDir, { recursive: true });
}

// 1. Static files
mkdirSync(join(outputDir, "static"), { recursive: true });
if (!functionsOnly) {
  console.log("Copying static files...");
  cpSync(join(root, "docs/.vitepress/dist"), join(outputDir, "static"), { recursive: true });
}

// 2. Output config
writeFileSync(
  join(outputDir, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        {
          src: "/(?:(.+)/)?index(?:\\.html)?/?$",
          headers: { Location: "/$1" },
          status: 308,
        },
        { src: "/(.*)\\.html/?$", headers: { Location: "/$1" }, status: 308 },
        { handle: "filesystem" },
      ],
      cleanUrls: true,
    },
    null,
    2
  )
);

// 3. Bundle API functions
const apiDir = join(root, "api");
const apiFunctions = readdirSync(apiDir).filter(
  (f) => f.endsWith(".ts") && f !== "playground-declarations.ts"
);

for (const fn of apiFunctions) {
  const name = basename(fn, ".ts");
  const funcDir = join(outputDir, `functions/api/${name}.func`);
  mkdirSync(funcDir, { recursive: true });

  console.log(`Bundling api/${name}...`);

  await build({
    entryPoints: [join(apiDir, fn)],
    bundle: true,
    platform: "node",
    target: "node18",
    // ESM, not CJS: a CJS bundle empties `import.meta`, and both api/*.ts and
    // the @typesugar/* ESM dists call `createRequire(import.meta.url)` /
    // `fileURLToPath(import.meta.url)` — under CJS every function threw on
    // cold start. The banner gives bundled CJS dependencies (typescript, …)
    // the `require`/`__filename`/`__dirname` they expect inside an ES module.
    format: "esm",
    outfile: join(funcDir, "index.mjs"),
    external: ["@vercel/node"],
    // api/compile.ts registers macros through bare side-effect imports
    // (`import "@typesugar/std"`), but the packages declare
    // `"sideEffects": false`, so esbuild would drop those imports and the
    // playground would silently fall back to runtime stubs. A server bundle
    // has no use for tree-shaking by annotation, so honour every import.
    ignoreAnnotations: true,
    banner: {
      js: [
        'import { createRequire as __tsCreateRequire } from "node:module";',
        'import { fileURLToPath as __tsFileURLToPath } from "node:url";',
        'import { dirname as __tsDirname } from "node:path";',
        "const require = __tsCreateRequire(import.meta.url);",
        "const __filename = __tsFileURLToPath(import.meta.url);",
        "const __dirname = __tsDirname(__filename);",
      ].join("\n"),
    },
  });

  // Function config
  writeFileSync(
    join(funcDir, ".vc-config.json"),
    JSON.stringify(
      {
        runtime: "nodejs20.x",
        handler: "index.mjs",
        launcherType: "Nodejs",
        memory: 1024,
        maxDuration: 10,
      },
      null,
      2
    )
  );
}

// 4. Prove every function loads and answers one request before anything ships.
const check = spawnSync(
  process.execPath,
  [join(root, "scripts/check-vercel-functions.mjs"), outputDir],
  { stdio: "inherit" }
);
if (check.status !== 0) {
  console.error("Vercel function check failed — not ready to deploy.");
  process.exit(1);
}

console.log(`\nOutput ready: ${outputDir}`);
console.log("Deploy with: npx vercel deploy --prebuilt --prod --yes");
