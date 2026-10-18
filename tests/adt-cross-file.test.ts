/**
 * Deep review macros-other #3 (ADT side): a file that imports an @adt's
 * generated constructor and calls it must keep the call. @adt used to
 * register every variant as `{ kind: "custom", value: "Circle" }`, and the
 * erasure pass replaced `Circle(5)` with the bare identifier `Circle`.
 *
 * Runs the real macro transformer over a three-file program (declaring
 * file, importing file, unrelated file with a same-named function) and
 * checks the printed output of each.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import macroTransformerFactory from "@typesugar/transformer";
import "@typesugar/macros";
import { clearTypeRewrites } from "@typesugar/core";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "adt-cross-file-"));
  fs.writeFileSync(
    path.join(tmpDir, "shapes.ts"),
    `export interface Circle { radius: number }
export interface Square { side: number }
export interface Empty {}
export interface Nil {}
/** @adt { Nil: null } */
export type Shape = Circle | Square | Empty | Nil;
`
  );
  fs.writeFileSync(
    path.join(tmpDir, "use.ts"),
    `import { Circle, Empty, Square, Nil, isCircle, type Shape } from "./shapes";
export const c: Shape = Circle(5);
export const e: Shape = Empty();
export const q: Shape = Square(2);
export const n: Shape = Nil;
export const ok = isCircle(c);
`
  );
  fs.writeFileSync(
    path.join(tmpDir, "other.ts"),
    `function Square(n: number) { return { n, area: n * n }; }
export const s = Square(3);
`
  );
});

afterAll(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  clearTypeRewrites();
});

function transformAll(): Record<string, string> {
  clearTypeRewrites();
  const files = ["shapes.ts", "use.ts", "other.ts"].map((f) => path.join(tmpDir, f));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };
  const program = ts.createProgram(files, options);
  const factory = macroTransformerFactory(program, { verbose: false, cacheDir: false } as any);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const out: Record<string, string> = {};
  // Declaring file first, as a build would visit it.
  for (const f of files) {
    const res = ts.transform(program.getSourceFile(f)!, [factory]);
    out[path.basename(f)] = printer.printFile(res.transformed[0]);
    res.dispose();
  }
  return out;
}

describe("@adt constructors across files", () => {
  it("keeps calls to generated constructor functions in an importing file", () => {
    const out = transformAll();
    expect(out["use.ts"]).toContain("Circle(5)");
    expect(out["use.ts"]).toContain("Empty()");
    expect(out["use.ts"]).toContain("Square(2)");
  });

  it("does not touch an unrelated same-named function in another file", () => {
    const out = transformAll();
    expect(out["other.ts"]).toContain("Square(3)");
  });

  it("the declaring file still defines the constructors it is called with", () => {
    const out = transformAll();
    expect(out["shapes.ts"]).toMatch(/export function Circle\(/);
    expect(out["shapes.ts"]).toMatch(/export function Square\(/);
  });
});
