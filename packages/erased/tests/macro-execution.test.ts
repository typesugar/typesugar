/**
 * Deep review 1.0, finding #21: run erased<[...]>(value) through the REAL
 * transformer pipeline and EXECUTE the emitted code.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as erased from "../src/index.js";
import * as std from "@typesugar/std";

import { TransformationPipeline } from "@typesugar/transformer";

const here = path.dirname(fileURLToPath(import.meta.url));
let counter = 0;

function transformAndRun(code: string): {
  code: string;
  errors: string[];
  exports: Record<string, unknown>;
  runError?: unknown;
} {
  const fileName = path.resolve(here, `__erased_exec_${counter++}.ts`);
  const pipeline = new TransformationPipeline(
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      lib: ["lib.es2023.d.ts"],
    },
    [fileName],
    {
      readFile: (f) => (f === fileName ? code : ts.sys.readFile(f)),
      fileExists: (f) => f === fileName || ts.sys.fileExists(f),
    }
  );
  const result = pipeline.transform(fileName);
  const errors = (result.diagnostics ?? [])
    .filter((d: { severity?: string }) => d.severity === "error")
    .map((d: { message?: string; messageText?: unknown }) => String(d.message ?? d.messageText));
  const js = ts.transpileModule(result.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  const req = (spec: string) => {
    if (spec === "@typesugar/erased") return erased;
    if (spec === "@typesugar/std") return std;
    throw new Error(`unexpected require(${spec}) in emitted code`);
  };
  let runError: unknown;
  try {
    new Function("require", "exports", "module", js)(req, mod.exports, mod);
  } catch (e) {
    runError = e;
  }
  return { code: result.code, errors, exports: mod.exports, runError };
}

describe("erased<[...]>() emits bound names (#21)", () => {
  it("works when only `erased` is imported (eraseWith + instances via module scan)", () => {
    const r = transformAndRun(
      'import { erased } from "@typesugar/erased";\n' +
        'import { clamp } from "@typesugar/std";\n' +
        "export const keep = clamp;\n" +
        "const n: number = 7;\n" +
        "export const e = erased<[Eq, Hash]>(n);\n"
    );
    expect(r.errors).toEqual([]);
    expect(r.runError).toBeUndefined();
    const e = r.exports.e as erased.Erased<[erased.EqCapability, erased.HashCapability]>;
    expect(erased.unwrapErased(e)).toBe(7);
    expect(erased.equals(e, e)).toBe(true);
    expect(erased.hash(e)).toBe(std.hashNumber.hash(7));
  });

  it("works with explicitly imported instances", () => {
    const r = transformAndRun(
      'import { erased } from "@typesugar/erased";\n' +
        'import { eqNumber, hashNumber } from "@typesugar/std";\n' +
        "export const keep = [eqNumber, hashNumber];\n" +
        "declare const n: number;\n" +
        "export const e = erased<[Eq]>(3 as number);\n"
    );
    expect(r.errors).toEqual([]);
    expect(r.runError).toBeUndefined();
    expect(erased.unwrapErased(r.exports.e as erased.Erased<[erased.EqCapability]>)).toBe(3);
  });

  it("resolves instances for literal-typed values (Eq<42> -> Eq<number>)", () => {
    const r = transformAndRun(
      'import { erased } from "@typesugar/erased";\n' +
        'import { eqNumber } from "@typesugar/std";\n' +
        "export const keep = eqNumber;\n" +
        "export const e = erased<[Eq]>(42);\n" +
        'export const s = erased<[Eq]>("hi" as const);\n'
    );
    expect(r.errors).toEqual([]);
    expect(r.runError).toBeUndefined();
    const e = r.exports.e as erased.Erased<[erased.EqCapability]>;
    expect(erased.unwrapErased(e)).toBe(42);
    expect(erased.equals(e, e)).toBe(true);
    expect(erased.unwrapErased(r.exports.s as erased.Erased<[erased.EqCapability]>)).toBe("hi");
  });
});
