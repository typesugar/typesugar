/**
 * keepMacroReferencedImports rescues an import binding TypeScript would elide
 * only when the expanded code references it as a value. A binding the code
 * uses only as a type must stay elided: the emitted `import { Shape }` of an
 * interface is "no export named 'Shape'" under ESM.
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

const DIR = path.resolve(__dirname, "__keep_imports_review__");

function emitJs(files: Record<string, string>, extra: ts.CompilerOptions = {}): string {
  const abs = new Map(Object.entries(files).map(([n, c]) => [path.join(DIR, n), c]));
  const options = { ...OPTS, ...extra };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  const get = host.getSourceFile.bind(host);
  host.readFile = (f) => abs.get(f) ?? read(f);
  host.fileExists = (f) => abs.has(f) || ts.sys.fileExists(f);
  host.getSourceFile = (f, lang, onError, create) =>
    abs.has(f) ? ts.createSourceFile(f, abs.get(f)!, lang, true) : get(f, lang, onError, create);
  const main = path.join(DIR, Object.keys(files)[0]);
  const program = ts.createProgram([main], options, host);
  let js = "";
  program.emit(
    program.getSourceFile(main),
    (name, text) => {
      if (/\.jsx?$/.test(name)) js = text;
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

describe("keepMacroReferencedImports: type-only uses stay elided", () => {
  it("does not rescue an import used only in implements / interface extends", () => {
    const js = emitJs({
      "main.ts": `import { Shape, Base } from "./types";
export interface I extends Base { extra: string }
export class C implements Shape { area = 1 }
`,
      "types.ts": `export interface Shape { area: number }
export interface Base { b: number }
`,
    });
    expect(js).toMatch(/class C/);
    expect(js).not.toMatch(/\bShape\b/);
    expect(js).not.toMatch(/\bBase\b/);
  });

  it("still keeps a class's `extends Base` (a value)", () => {
    const js = emitJs({
      "main.ts": `import { Base } from "./types";
export class C extends Base {}
`,
      "types.ts": `export class Base {}
`,
    });
    expect(js).toMatch(/import \{ Base \} from "\.\/types"/);
  });

  it("does not rescue an import for a JSX name the checker gives no symbol", () => {
    const js = emitJs(
      {
        "main.tsx": `import { title } from "./types";
declare const t: typeof title;
export const el = <svg xlink:title="x" />;
`,
        "types.ts": `export declare const title: number;
`,
      },
      { jsx: ts.JsxEmit.Preserve }
    );
    expect(js).toMatch(/<svg xlink:title="x"/);
    expect(js).not.toMatch(/import/);
  });
});
