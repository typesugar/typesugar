/**
 * Emit-time helpers that catch a checker failure and degrade must say so
 * (CLAUDE.md: "a caught exception with no visible trace is a worse outcome
 * than the exception itself"). Each test makes the checker throw at the call
 * the helper guards, and expects one visible `[typesugar]` warning.
 *
 * - keep-imports: a re-export whose "is this a derived value?" check threw
 *   was treated as "no", so `export { Vec } from "./vec"` could be dropped
 *   from the emit silently.
 * - declaration-annotations: a file whose exports couldn't be read got no
 *   @opaque annotations, silently.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as ts from "typescript";
import * as path from "node:path";
import { registerTypeRewrite, clearTypeRewrites } from "@typesugar/core";
import { keepMacroReferencedImports } from "../src/keep-imports.js";
import { annotateInferredOpaqueTypes } from "../src/declaration-annotations.js";

const dir = path.resolve(__dirname, "__degraded_emit__");

function makeProgram(files: Record<string, string>): ts.Program {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    types: [],
  };
  const abs = new Map(Object.entries(files).map(([k, v]) => [path.join(dir, k), v]));
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = (f) => abs.get(f) ?? readFile(f);
  host.fileExists = (f) => abs.has(f) || fileExists(f);
  return ts.createProgram([...abs.keys()], options, host);
}

/** `program` whose checker throws from `method`. */
function withThrowingChecker(program: ts.Program, method: keyof ts.TypeChecker): ts.Program {
  const checker = program.getTypeChecker();
  const throwing = new Proxy(checker, {
    get(target, prop, receiver) {
      if (prop === method) {
        return () => {
          throw new Error(`checker ${String(method)} failed`);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return new Proxy(program, {
    get(target, prop, receiver) {
      if (prop === "getTypeChecker") return () => throwing;
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

const warnings = () =>
  (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));

afterEach(() => {
  vi.restoreAllMocks();
  clearTypeRewrites();
});

describe("a degraded emit helper leaves a visible warning", () => {
  it("keep-imports: a re-export whose derived-value check threw", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const program = makeProgram({
      "vec.ts": `export interface Vec { x: number }\n`,
      "index.ts": `export { Vec } from "./vec";\n`,
    });
    const index = program.getSourceFile(path.join(dir, "index.ts"))!;
    program.emit(index, () => {}, undefined, false, {
      before: [keepMacroReferencedImports(withThrowingChecker(program, "getSymbolAtLocation"))],
    });
    const w = warnings();
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/\[typesugar\].*re-export.*Vec.*index\.ts/s);
  });

  it("declaration-annotations: a file whose exports couldn't be read", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    registerTypeRewrite({ typeName: "Opt", underlyingTypeText: "A | null" });
    const program = makeProgram({ "a.ts": `export const a = 1;\n` });
    const file = program.getSourceFile(path.join(dir, "a.ts"))!;
    const out = annotateInferredOpaqueTypes(
      withThrowingChecker(program, "getSymbolAtLocation"),
      file,
      file
    );
    expect(out).toBe(file);
    const w = warnings();
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/\[typesugar\] declarations:.*a\.ts/s);
  });
});
