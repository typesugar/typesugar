/**
 * Every typesugar diagnostic code is in the catalog (`DIAGNOSTIC_CATALOG`,
 * @typesugar/core), so it has a docs/errors page and `--explain` text.
 * TS9602 (auto-specialization skipped) was written as a raw "[TS9602]"
 * string at six sites and was the one code without a descriptor.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { DIAGNOSTIC_CATALOG, getDiagnosticDescriptor } from "@typesugar/core";

const packagesDir = path.resolve(__dirname, "..", "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) sourceFiles(full, out);
    else if (/\.ts$/.test(ent.name) && !/\.(test|spec)\.ts$/.test(ent.name)) out.push(full);
  }
  return out;
}

describe("diagnostic catalog coverage", () => {
  it("every [TS9xxx] code a package's source writes is catalogued", () => {
    const missing = new Set<string>();
    for (const pkg of fs.readdirSync(packagesDir)) {
      const src = path.join(packagesDir, pkg, "src");
      if (!fs.existsSync(src)) continue;
      for (const file of sourceFiles(src)) {
        for (const m of fs.readFileSync(file, "utf-8").matchAll(/\[TS(9\d{3})\]/g)) {
          if (!DIAGNOSTIC_CATALOG.has(Number(m[1]))) {
            missing.add(`TS${m[1]} in ${path.relative(packagesDir, file)}`);
          }
        }
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("TS9602 (auto-specialization skipped) is a warning", () => {
    const d = getDiagnosticDescriptor(9602);
    expect(d?.severity).toBe("warning");
    expect(d?.messageTemplate).toBe("Auto-specialization of {fn} skipped — {reason}");
  });

  it("specialization.ts emits TS9602 through the catalog, not as a raw string", () => {
    const text = fs.readFileSync(
      path.join(packagesDir, "transformer-core", "src", "specialization.ts"),
      "utf-8"
    );
    expect(text).not.toContain("[TS9602]");
    expect(text).toContain(".diagnostic(TS9602)");
  });
});
