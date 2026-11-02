/**
 * The relative specifier `typeToPortableTypeNode` writes for a type declared
 * in another source file of the program (review 8). It replaced the target's
 * extension with `.js` whatever it was, so a type declared in `shapes.mts`
 * became `import("./lib/shapes.js").Shape`, which doesn't resolve (TS2307,
 * and an `any` read where std's match() asserts the scrutinee to it). Each
 * specifier written is checked to resolve, with the program's options, to
 * the file the type is declared in.
 */

import { describe, it, expect, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";
import { typeToPortableTypeNode } from "../src/portable-type-node.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

/**
 * A project where `src/main.ts` reads a `Shape` (declared in `src/lib/shapes.<ext>`)
 * through `./lib/hold<importExt>`, without naming `Shape` itself.
 */
function specifierFor(
  ext: ".ts" | ".mts" | ".cts",
  importExt: string,
  options: ts.CompilerOptions
): { specifier: string; resolvesTo: string | undefined; declaredIn: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-portable-")));
  dirs.push(dir);
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  write("package.json", JSON.stringify({ name: "p", private: true, type: "module" }));
  const shapesJs = { ".ts": ".js", ".mts": ".mjs", ".cts": ".cjs" }[ext];
  const holdImport = options.allowImportingTsExtensions ? ext : shapesJs;
  write(
    `src/lib/shapes${ext}`,
    `export type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };\n`
  );
  write(
    "src/lib/hold.ts",
    `import type { Shape } from "./shapes${holdImport}";\n` +
      `export const holder: { s: Shape } = { s: { kind: "square", side: 3 } };\n`
  );
  const main = path.join(dir, "src/main.ts");
  write(
    main.slice(dir.length + 1),
    `import { holder } from "./lib/hold${importExt}";\nconst s = holder.s;\n`
  );
  const fullOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
    ...options,
  };
  const program = ts.createProgram([main], fullOptions);
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(main)!;
  const decl = (file.statements[1] as ts.VariableStatement).declarationList.declarations[0];
  const node = typeToPortableTypeNode(
    program,
    checker,
    file,
    checker.getTypeAtLocation(decl.name),
    decl
  );
  expect(node, "no portable node").toBeDefined();
  const printed = ts.createPrinter().printNode(ts.EmitHint.Unspecified, node!, file);
  const specifier = /import\("([^"]+)"\)/.exec(printed)?.[1];
  expect(specifier, printed).toBeDefined();
  const resolved = ts.resolveModuleName(specifier!, main, fullOptions, ts.sys).resolvedModule;
  return {
    specifier: specifier!,
    resolvesTo: resolved?.resolvedFileName,
    declaredIn: path.join(dir, `src/lib/shapes${ext}`),
  };
}

const NODENEXT = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
};
const BUNDLER = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
};

describe("the relative specifier for a type in another source file", () => {
  it.each([
    // [declared in, the file's relative-import style, options, expected]
    [".mts", ".js", NODENEXT, "./lib/shapes.mjs"],
    [".cts", ".js", NODENEXT, "./lib/shapes.cjs"],
    [".ts", ".js", NODENEXT, "./lib/shapes.js"],
    [".mts", "", BUNDLER, "./lib/shapes.mjs"],
    [".ts", "", BUNDLER, "./lib/shapes"],
    [".mts", ".ts", { ...BUNDLER, allowImportingTsExtensions: true }, "./lib/shapes.mts"],
    [".ts", ".ts", { ...BUNDLER, allowImportingTsExtensions: true }, "./lib/shapes.ts"],
    [
      ".mts",
      ".ts",
      { ...NODENEXT, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true },
      "./lib/shapes.mts",
    ],
  ] as const)("declared in %s, imports written %s, %o: %s", (ext, importExt, options, expected) => {
    const { specifier, resolvesTo, declaredIn } = specifierFor(ext, importExt, options);
    expect(specifier).toBe(expected);
    expect(resolvesTo).toBe(declaredIn);
  });
});
