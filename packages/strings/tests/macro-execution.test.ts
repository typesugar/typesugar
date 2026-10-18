/**
 * Deep review 1.0, findings #19/#20: run regex`` / html`` through the REAL
 * transformer pipeline and EXECUTE the emitted code.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as strings from "../src/index.js";

import { TransformationPipeline } from "@typesugar/transformer";

const here = path.dirname(fileURLToPath(import.meta.url));
let counter = 0;

function transformAndRun(code: string): {
  code: string;
  errors: string[];
  exports: Record<string, unknown>;
  runError?: unknown;
} {
  const fileName = path.resolve(here, `__strings_exec_${counter++}.ts`);
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
    if (spec === "@typesugar/strings") return strings;
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

describe("regex`` keeps backslash escapes (#19)", () => {
  it("compiles to the pattern as written, not the cooked string", () => {
    const r = transformAndRun(
      'import { regex } from "@typesugar/strings";\n' + "export const re = regex`^\\d+\\.\\w$`;\n"
    );
    expect(r.errors).toEqual([]);
    expect(r.runError).toBeUndefined();
    const re = r.exports.re as RegExp;
    expect(re).toBeInstanceOf(RegExp);
    expect(re.source).toBe("^\\d+\\.\\w$");
    expect(re.test("12.a")).toBe(true);
    expect(re.test("dd.w")).toBe(false);
  });

  it("validates the raw pattern at compile time", () => {
    const r = transformAndRun(
      'import { regex } from "@typesugar/strings";\n' +
        "export const re = regex`\\k<nope>(?<x>a)`;\n"
    );
    expect(r.errors.join("\n")).toMatch(/Invalid regular expression/);
  });
});

describe("html`` brings its escape helper into scope (#20)", () => {
  it("runs without the user importing __typesugar_escapeHtml", () => {
    const r = transformAndRun(
      'import { html } from "@typesugar/strings";\n' +
        'const user = "<b>";\n' +
        "export const h = html`<a title='${user}'>${user}</a>`;\n"
    );
    expect(r.errors).toEqual([]);
    expect(r.runError).toBeUndefined();
    expect(r.exports.h).toBe("<a title='&lt;b&gt;'>&lt;b&gt;</a>");
  });

  it("does not clash with a user binding of the same name", () => {
    const r = transformAndRun(
      'import { html } from "@typesugar/strings";\n' +
        "const __typesugar_escapeHtml = (s: unknown) => 'HIJACKED';\n" +
        "export const unused = __typesugar_escapeHtml;\n" +
        'const user = "<b>";\n' +
        "export const h = html`<p>${user}</p>`;\n"
    );
    expect(r.errors).toEqual([]);
    expect(r.runError).toBeUndefined();
    expect(r.exports.h).toBe("<p>&lt;b&gt;</p>");
  });
});
