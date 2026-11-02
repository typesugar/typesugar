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
import {
  checkPrepareScript,
  checkTransformerPlugin,
  checkTsPatch,
  checkTsPatchActive,
} from "../src/doctor.js";

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
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ devDependencies: { "ts-patch": "^3.0.0" } })
    );
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

/**
 * The ts-patch checks apply to a project that compiles through a patched
 * tsc. One that builds with `typesugar build`, runs under `node --import
 * typesugar/register` or uses a bundler plugin needs neither ts-patch nor
 * the tsconfig transform plugin; doctor used to fail it unless
 * unplugin-typesugar was a direct dependency.
 */
describe("ts-patch checks only for a project that uses a patched tsc", () => {
  let tmpDir: string;
  const write = (files: Record<string, unknown>) => {
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(tmpDir, name), JSON.stringify(content));
    }
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-doctor-"));
    writeTypescriptJs(tmpDir, `"use strict";\nvar ts = {};\n`);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("typesugar build / node --import typesugar/register: all skipped", () => {
    write({
      "package.json": {
        type: "module",
        scripts: {
          build: "typesugar build",
          start: "node --import typesugar/register src/main.ts",
        },
        devDependencies: { typesugar: "^1.0.0", typescript: "^5.9.0" },
      },
      "tsconfig.json": { compilerOptions: { strict: true } },
    });
    for (const check of [
      checkTsPatch,
      checkTsPatchActive,
      checkPrepareScript,
      checkTransformerPlugin,
    ]) {
      const result = check(tmpDir);
      expect(result.status, `${result.name}: ${result.message}`).toBe("skip");
    }
  });

  it("a tsconfig transform plugin and a tsc build script without ts-patch: fails", () => {
    write({
      "package.json": {
        scripts: { build: "tsc -p ." },
        devDependencies: { typesugar: "^1.0.0", typescript: "^5.9.0" },
      },
      "tsconfig.json": { compilerOptions: { plugins: [{ transform: "@typesugar/transformer" }] } },
    });
    expect(checkTsPatch(tmpDir).status).toBe("fail");
    expect(checkTsPatchActive(tmpDir).status).toBe("fail");
    expect(checkTransformerPlugin(tmpDir).status).toBe("pass");
  });

  it("ts-patch installed without the transform plugin: the plugin check fails", () => {
    write({
      "package.json": {
        scripts: { build: "tspc", prepare: "ts-patch install -s" },
        devDependencies: { "ts-patch": "^3.0.0", typescript: "^5.9.0" },
      },
      "tsconfig.json": { compilerOptions: {} },
    });
    expect(checkTransformerPlugin(tmpDir).status).toBe("fail");
    expect(checkTsPatch(tmpDir).status).toBe("pass");
    expect(checkPrepareScript(tmpDir).status).toBe("pass");
  });
});
