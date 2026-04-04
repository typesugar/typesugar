#!/usr/bin/env node
/**
 * Build the .vercel/output directory for --prebuilt deployment.
 *
 * 1. Copies docs/.vitepress/dist → .vercel/output/static
 * 2. Bundles each api/*.ts → .vercel/output/functions/api/<name>.func/
 *
 * Run after `pnpm build && pnpm docs:build`.
 */

import { mkdirSync, cpSync, writeFileSync, readdirSync, rmSync, existsSync } from "fs";
import { join, basename } from "path";
import { build } from "esbuild";

const root = process.cwd();
const outputDir = join(root, ".vercel/output");

// Clean previous output
if (existsSync(outputDir)) {
  rmSync(outputDir, { recursive: true });
}

// 1. Static files
console.log("Copying static files...");
mkdirSync(join(outputDir, "static"), { recursive: true });
cpSync(join(root, "docs/.vitepress/dist"), join(outputDir, "static"), { recursive: true });

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
    format: "cjs",
    outfile: join(funcDir, "index.js"),
    external: ["@vercel/node"],
  });

  // Function config
  writeFileSync(
    join(funcDir, ".vc-config.json"),
    JSON.stringify(
      {
        runtime: "nodejs20.x",
        handler: "index.js",
        launcherType: "Nodejs",
        memory: 1024,
        maxDuration: 10,
      },
      null,
      2
    )
  );
}

console.log(`\nOutput ready: ${outputDir}`);
console.log("Deploy with: npx vercel deploy --prebuilt --prod --yes");
