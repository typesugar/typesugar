/**
 * Showcase and example file transformation tests.
 *
 * Ensures every example file across the monorepo can be processed by the
 * transformation pipeline without crashing. Files may produce diagnostics
 * (expected for some macros), but must never throw.
 */

import { describe, it, expect } from "vitest";
import { transformCode } from "../src/pipeline.js";
import * as fs from "fs";
import * as path from "path";

// Load macro definitions
import "@typesugar/macros";

const PACKAGES_DIR = path.resolve(__dirname, "../../");

function findExampleFiles(): Array<{ pkg: string; file: string; fullPath: string }> {
  const results: Array<{ pkg: string; file: string; fullPath: string }> = [];

  const packages = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true });
  for (const entry of packages) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;

    const examplesDir = path.join(PACKAGES_DIR, entry.name, "examples");
    if (!fs.existsSync(examplesDir)) continue;

    const files = fs.readdirSync(examplesDir);
    for (const file of files) {
      if (/\.(ts|sts)x?$/.test(file)) {
        results.push({
          pkg: entry.name,
          file,
          fullPath: path.join(examplesDir, file),
        });
      }
    }
  }

  return results.sort((a, b) => `${a.pkg}/${a.file}`.localeCompare(`${b.pkg}/${b.file}`));
}

const exampleFiles = findExampleFiles();

describe("showcase and example files", () => {
  it("found example files to test", () => {
    expect(exampleFiles.length).toBeGreaterThan(30);
  });

  for (const { pkg, file, fullPath } of exampleFiles) {
    it(`${pkg}/examples/${file} transforms without crashing`, () => {
      const code = fs.readFileSync(fullPath, "utf-8");
      const fileName =
        fullPath.endsWith(".sts") || fullPath.endsWith(".stsx") ? fullPath : fullPath;

      // Must not throw — crashes indicate transformer bugs
      let result: ReturnType<typeof transformCode>;
      expect(() => {
        result = transformCode(code, {
          fileName,
          preserveBlankLines: true,
        });
      }).not.toThrow();

      // Log diagnostic count for visibility (not a failure)
      if (result!.diagnostics.length > 0) {
        // Diagnostics are OK (e.g., "Unknown derive: Builder"),
        // but "Transform failed: TypeError" indicates a crash that
        // was caught internally — that IS a bug.
        for (const d of result!.diagnostics) {
          expect(d.message).not.toMatch(
            /Transform failed.*TypeError|Transform failed.*ReferenceError|Transform failed.*Cannot read properties/
          );
        }
      }
    });
  }
});
