/**
 * An import declaration the macros rebuild (a macro specifier removed) is
 * printed verbatim by TypeScript's JavaScript emit, which elides type-only
 * syntax only in its own parse-tree declarations: `import { match, type
 * Destructure } from "@typesugar/std"` became `import { type Destructure }`
 * in the emitted .js, a syntax error. keepMacroReferencedImports drops that
 * syntax in the JavaScript emit; a pass printed as TypeScript keeps it.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "node:path";
import { macroTransformerFactory } from "../src/pipeline.js";
import { keepMacroReferencedImports } from "../src/keep-imports.js";

const OPTS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
};

const SRC = `import { match, type Destructure } from "@typesugar/std";
import { type Eq } from "typesugar";
/** @derive(Destructure) */
export type Shape = { kind: "c"; r: number } | { kind: "s"; w: number };
export const area = (s: Shape) => match(s).case(C(r)).then(r * r).else(0);
export type E = Eq<number>;
`;

function programFor(
  code: string,
  extra: ts.CompilerOptions = {}
): { program: ts.Program; file: string } {
  const file = path.resolve(__dirname, "__rebuilt_type_only__", "main.ts");
  const host = ts.createCompilerHost({ ...OPTS, ...extra });
  const read = host.readFile.bind(host);
  const get = host.getSourceFile.bind(host);
  host.readFile = (f) => (f === file ? code : read(f));
  host.fileExists = (f) => f === file || ts.sys.fileExists(f);
  host.getSourceFile = (f, lang, onError, create) =>
    f === file ? ts.createSourceFile(f, code, lang, true) : get(f, lang, onError, create);
  return { program: ts.createProgram([file], { ...OPTS, ...extra }, host), file };
}

/** The .js `typesugar build` would write: the macros, then keepMacroReferencedImports. */
function emitJs(program: ts.Program, file: string): string {
  let js = "";
  program.emit(
    program.getSourceFile(file),
    (name, text) => {
      if (name.endsWith(".js")) js = text;
    },
    undefined,
    false,
    {
      before: [
        macroTransformerFactory(program, { cacheDir: false }),
        keepMacroReferencedImports(program),
      ],
    }
  );
  return js;
}

describe("a rebuilt import's type-only syntax in the JavaScript emit", () => {
  it("is dropped, so the emitted module parses", () => {
    const { program, file } = programFor(SRC);
    let js = "";
    program.emit(
      program.getSourceFile(file),
      (name, text) => {
        if (name.endsWith(".js")) js = text;
      },
      undefined,
      false,
      {
        before: [
          macroTransformerFactory(program, { cacheDir: false }),
          keepMacroReferencedImports(program),
        ],
      }
    );
    expect(js).not.toMatch(/\btype (Destructure|Eq)\b/);
    expect(js).not.toMatch(/^import .*from "@typesugar\/std"/m);
    // Parses as JavaScript.
    const parsed = ts.createSourceFile(
      "out.js",
      js,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.JS
    );
    expect((parsed as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics).toEqual([]);
  });

  it("is kept when the expansion is printed as TypeScript", () => {
    const { program, file } = programFor(SRC);
    const result = ts.transform(program.getSourceFile(file)!, [
      macroTransformerFactory(program, { cacheDir: false }),
      keepMacroReferencedImports(program),
    ]);
    const printed = ts.createPrinter().printFile(result.transformed[0]);
    result.dispose();
    expect(printed).toMatch(/type Destructure/);
  });

  it("drops a plain specifier the emitted code uses only as a type", () => {
    // `Show` is only an interface in @typesugar/std: an import of it at run
    // time is "no export named 'Show'".
    const { program, file } = programFor(`import { match, Show } from "@typesugar/std";
import type { Destructure } from "@typesugar/std";
/** @derive(Destructure) */
export type Shape = { kind: "c"; r: number } | { kind: "s"; w: number };
export const area = (s: Shape) => match(s).case(C(r)).then(r * r).else(0);
export type S = Show<number>;
`);
    const js = emitJs(program, file);
    expect(js).not.toMatch(/\bShow\b/);
    expect(js).toMatch(/export function C\(/);
  });

  it("keeps the module's side effects under verbatimModuleSyntax", () => {
    const { program, file } = programFor(SRC, { verbatimModuleSyntax: true });
    const js = emitJs(program, file);
    expect(js).toMatch(/^import "@typesugar\/std";$/m);
    expect(js).not.toMatch(/\btype (Destructure|Eq)\b/);
  });

  it("drops a plain specifier used only in an implements clause", () => {
    const { program, file } = programFor(`import { match, Show } from "@typesugar/std";
import type { Destructure } from "@typesugar/std";
/** @derive(Destructure) */
export type Shape = { kind: "c"; r: number } | { kind: "s"; w: number };
export class Area implements Show<Shape> {
  show(s: Shape) { return String(match(s).case(C(r)).then(r * r).else(0)); }
}
`);
    const js = emitJs(program, file);
    expect(js).not.toMatch(/\bShow\b/);
  });
});
