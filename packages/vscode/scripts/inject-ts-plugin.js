#!/usr/bin/env node
/**
 * Injects @typesugar/ts-plugin and @typesugar/transformer into the vsix after vsce packages it.
 * vsce with --no-dependencies doesn't include node_modules, so we add it manually.
 */

import { execSync } from "child_process";
import { mkdirSync, cpSync, rmSync, existsSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const vscodeDir = join(__dirname, "..");

// Find the vsix file
const vsixFiles = readdirSync(vscodeDir).filter((f) => f.endsWith(".vsix"));
if (vsixFiles.length === 0) {
  console.error("No .vsix file found");
  process.exit(1);
}
const vsixFile = join(vscodeDir, vsixFiles[0]);
console.log(`Processing ${vsixFile}`);

// Create temp directory
const tempDir = join(vscodeDir, ".vsix-temp");
if (existsSync(tempDir)) {
  rmSync(tempDir, { recursive: true });
}
mkdirSync(tempDir);

try {
  // Extract vsix (it's a zip file)
  execSync(`unzip -q "${vsixFile}" -d "${tempDir}"`);

  // Helper to copy package files
  function copyPackage(packageName, files) {
    const dest = join(tempDir, "extension", "node_modules", "@typesugar", packageName);
    mkdirSync(dest, { recursive: true });

    const src = join(vscodeDir, "node_modules", "@typesugar", packageName);
    for (const file of files) {
      const srcFile = join(src, file);
      const destFile = join(dest, file);
      if (existsSync(srcFile)) {
        cpSync(srcFile, destFile);
        console.log(`  Added ${packageName}/${file}`);
      } else {
        console.warn(`  Warning: ${packageName}/${file} not found`);
      }
    }
  }

  // Copy ts-plugin files
  copyPackage("ts-plugin", ["index.js", "index.d.ts", "package.json"]);

  // Copy transformer files (needed for language-service) - using fully-bundled version
  copyPackage("transformer", [
    "language-service-bundled.cjs",
    "language-service-bundled.cjs.map",
    "package.json",
  ]);

  // Remove old vsix and create new one
  rmSync(vsixFile);
  execSync(`cd "${tempDir}" && zip -rq "${vsixFile}" .`);

  console.log(`✓ Injected @typesugar packages into ${vsixFiles[0]}`);
} finally {
  // Cleanup
  rmSync(tempDir, { recursive: true });
}
