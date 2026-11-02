#!/usr/bin/env node
/**
 * Bundles @typesugar/ts-plugin AND @typesugar/transformer into node_modules for vsce packaging.
 * vsce can't handle pnpm symlinks, so we copy actual files.
 *
 * Uses the fully-bundled language-service that includes all dependencies
 * (except typescript which is provided by the TS server).
 */

import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const vscodeDir = join(__dirname, "..");
const packagesDir = join(vscodeDir, "..");

// Bundle @typesugar/ts-plugin
const tsPluginSrc = join(packagesDir, "ts-plugin");
const tsPluginDest = join(vscodeDir, "node_modules", "@typesugar", "ts-plugin");

if (existsSync(tsPluginDest)) {
  rmSync(tsPluginDest, { recursive: true });
}
mkdirSync(tsPluginDest, { recursive: true });

// Copy ts-plugin files from dist/
const tsPluginFiles = ["dist/index.js", "dist/index.d.ts", "package.json"];
for (const file of tsPluginFiles) {
  const src = join(tsPluginSrc, file);
  const destFile = file.replace("dist/", ""); // Flatten dist/ folder
  const dest = join(tsPluginDest, destFile);
  if (existsSync(src)) {
    cpSync(src, dest);
    console.log(`Copied ts-plugin/${file} -> ${destFile}`);
  } else {
    console.warn(`Warning: ${file} not found in ts-plugin`);
  }
}

// Bundle @typesugar/transformer (needed for language-service)
const transformerSrc = join(packagesDir, "transformer");
const transformerDest = join(vscodeDir, "node_modules", "@typesugar", "transformer");

if (existsSync(transformerDest)) {
  rmSync(transformerDest, { recursive: true });
}
mkdirSync(transformerDest, { recursive: true });

// Copy the fully-bundled language-service (has all dependencies built in)
const transformerFiles = [
  "dist/language-service-bundled.cjs",
  "dist/language-service-bundled.cjs.map",
  "package.json",
];
for (const file of transformerFiles) {
  const src = join(transformerSrc, file);
  const destFile = file.replace("dist/", ""); // Flatten dist/ folder
  const dest = join(transformerDest, destFile);
  if (existsSync(src)) {
    cpSync(src, dest);
    console.log(`Copied transformer/${file} -> ${destFile}`);
  } else {
    console.warn(`Warning: ${file} not found in transformer`);
  }
}

// Update ts-plugin's package.json to point to index.js (not dist/index.js)
const tsPluginPkgPath = join(tsPluginDest, "package.json");
const tsPluginPkg = JSON.parse(readFileSync(tsPluginPkgPath, "utf-8"));
tsPluginPkg.main = "./index.js";
writeFileSync(tsPluginPkgPath, JSON.stringify(tsPluginPkg, null, 2));
console.log(`Updated ts-plugin/package.json main entry`);

// Update transformer's package.json exports for bundled language-service
const transformerPkgPath = join(transformerDest, "package.json");
const transformerPkg = JSON.parse(readFileSync(transformerPkgPath, "utf-8"));
// Point language-service import to the bundled version
transformerPkg.exports = {
  ".": {
    require: "./language-service-bundled.cjs",
    default: "./language-service-bundled.cjs",
  },
  "./language-service": {
    require: "./language-service-bundled.cjs",
    default: "./language-service-bundled.cjs",
  },
};
transformerPkg.main = "./language-service-bundled.cjs";
writeFileSync(transformerPkgPath, JSON.stringify(transformerPkg, null, 2));
console.log(`Updated transformer/package.json exports`);

console.log("✓ Bundled @typesugar/ts-plugin and @typesugar/transformer for packaging");
