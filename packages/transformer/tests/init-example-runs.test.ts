/**
 * `typesugar init` writes src/typesugar-example.ts. That file must survive the
 * real pipeline and RUN: the PEP-052 syntax imports are what make
 * `user1.clone()` etc. rewrite, and `toJson()` returns an object (so the
 * template must stringify it).
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import ts from "typescript";
import { transformCode } from "@typesugar/transformer/pipeline";
import { createExampleFile } from "../src/init.js";

const REPO = path.resolve(__dirname, "../../..");

describe("typesugar init example", () => {
  it("transforms and runs, printing the derived-method results", () => {
    // Inside the repo (gitignored) so `typesugar` / `@typesugar/*` resolve.
    const dir = path.join(REPO, ".typesugar", "init-example-test");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    try {
      createExampleFile(dir);
      const file = path.join(dir, "src", "typesugar-example.ts");
      const source = fs.readFileSync(file, "utf8");

      const result = transformCode(source, { fileName: file });
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

      const js = ts.transpileModule(result.code, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      const out = path.join(dir, "src", "typesugar-example.mjs");
      fs.writeFileSync(out, js);
      const r = spawnSync(process.execPath, [out], { encoding: "utf8", timeout: 30000 });

      expect(r.stderr).not.toMatch(/is not a function/);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("Sum of 1-100: 5050");
      expect(r.stdout).toContain("Equal: true");
      expect(r.stdout).toContain('JSON: {"id":1,"name":"Alice","email":"alice@example.com"}');
      expect(r.stdout).not.toContain("[object Object]");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
