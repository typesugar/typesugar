/**
 * Tests for `typesugar doctor`'s ts-patch detection (PEP-058 Wave 2).
 *
 * The pre-PEP-058 check grepped all of typescript.js for the bare substring
 * "tsp", which false-positives on identifiers like "tspan" in unpatched
 * builds. The repaired check looks for ts-patch's definitive
 * `/// tsp-module:` header marker in the file head.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { checkTsPatchActive } from "../src/doctor.js";

function writeTypescriptJs(tmpDir: string, content: string): void {
  const libDir = path.join(tmpDir, "node_modules", "typescript", "lib");
  fs.mkdirSync(libDir, { recursive: true });
  fs.writeFileSync(path.join(libDir, "typescript.js"), content);
}

describe("checkTsPatchActive", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-doctor-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("passes for a ts-patch-patched typescript.js (tsp-module header)", () => {
    writeTypescriptJs(
      tmpDir,
      `/// tsp-module: {"tsVersion":"5.9.3","patchDetail":{}}\n/// :tsp-module\n"use strict";\nvar ts = {};\n`
    );
    expect(checkTsPatchActive(tmpDir).status).toBe("pass");
  });

  it("fails for an unpatched typescript.js — even one containing 'tspan' (the old false positive)", () => {
    writeTypescriptJs(
      tmpDir,
      `"use strict";\n// renders an SVG tspan element in diagnostics output\nvar tspanKind = 1;\nvar ts = {};\n`
    );
    const result = checkTsPatchActive(tmpDir);
    expect(result.status).toBe("fail");
    expect(result.fix).toContain("ts-patch install");
  });

  it("skips when typescript is not installed", () => {
    expect(checkTsPatchActive(tmpDir).status).toBe("skip");
  });
});
