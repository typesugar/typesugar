/**
 * The fluent `match()` chain under plain `tsc` (Turf case study, F20).
 *
 * Tools that type-check UNEXPANDED source — plain `tsc` (Turf's `test:types`),
 * tsup's own `.d.ts` step, typescript-eslint, typedoc — see the stub
 * declarations in `match-runtime.ts`, not the macro's output. The chain used
 * to be typed `never`, so every fluent match failed there with TS2339. These
 * tests compile snippets against the real stub declarations with no
 * transformer at all.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeSource = fs.readFileSync(
  path.resolve(here, "../src/macros/match-runtime.ts"),
  "utf-8"
);

/** Plain-tsc diagnostics for `code`, which imports `match` from "./match-runtime". */
function plainTsc(code: string): { diags: ts.Diagnostic[]; typeOf: (name: string) => string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "match-plain-tsc-"));
  fs.writeFileSync(path.join(dir, "match-runtime.ts"), runtimeSource);
  const testFile = path.join(dir, "test.ts");
  fs.writeFileSync(testFile, `import { match } from "./match-runtime";\n${code}`);
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  };
  const program = ts.createProgram([testFile], options);
  const sf = program.getSourceFile(testFile)!;
  const checker = program.getTypeChecker();
  const diags = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)];
  const typeOf = (name: string): string => {
    let found: ts.Node | undefined;
    const visit = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) found = n;
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (!found) throw new Error(`no declaration ${name}`);
    return checker.typeToString(checker.getTypeAtLocation((found as ts.VariableDeclaration).name));
  };
  return { diags, typeOf };
}

const messages = (diags: ts.Diagnostic[]) =>
  diags.map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);

describe("fluent match() stub types under plain tsc", () => {
  it("type-checks Turf's flattenEach match (literal arms, last arm undefined)", () => {
    const { diags } = plainTsc(`
declare const type: "MultiPoint" | "MultiLineString" | "MultiPolygon" | "GeometryCollection";
var geomType = match(type)
  .case("MultiPoint")
  .then("Point")
  .case("MultiLineString")
  .then("LineString")
  .case("MultiPolygon")
  .then("Polygon")
  .case("GeometryCollection")
  .then(undefined);
const ok: "Point" | "LineString" | "Polygon" | undefined = geomType;
`);
    expect(messages(diags)).toEqual([]);
  });

  it("keeps a nullish arm result in the type (sound: not assignable to string)", () => {
    const { diags } = plainTsc(`
declare const k: "a" | "b";
const r = match(k).case("a").then("A").case("b").then(undefined);
const bad: string = r;
`);
    expect(diags.map((d) => d.code)).toEqual([2322]);
  });

  it("types a chain ending in .else() as the union of its results, widened like a ternary", () => {
    const { diags, typeOf } = plainTsc(`
declare const n: number;
const r = match(n).case(1).then("one").case(2).or(3).then(23).else(false);
let w = match(n).case(1).then("one").case(2).or(3).then(23).else(false);
`);
    expect(messages(diags)).toEqual([]);
    // As for the expanded \`n === 1 ? "one" : ... : false\`: literal for const, widened for let.
    expect(typeOf("r")).toBe('false | "one" | 23');
    expect(typeOf("w")).toBe("string | number | boolean");
  });

  it("accepts a match in a function with a literal-union return type", () => {
    const { diags } = plainTsc(`
declare const k: "x" | "y";
function viaElse(): "a" | "b" {
  return match(k).case("x").then("a").else("b");
}
function viaThen(): "a" | "b" {
  return match(k).case("x").then("a").case("y").then("b");
}
const n: number = match(k).case("x").then(1).else(2);
`);
    expect(messages(diags)).toEqual([]);
  });

  it("accepts .or(), .if() and .as() links", () => {
    const { diags } = plainTsc(`
declare const s: number;
const r: string = match(s).case(200).or(201).then("ok").case(500).if(s > 0).then("err").else("other");
`);
    expect(messages(diags)).toEqual([]);
  });

  it("documented limit: names bound by a pattern are still undeclared (TS2304)", () => {
    const { diags } = plainTsc(`
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };
declare const sh: Shape;
const a = match(sh).case({ kind: "circle", radius: r }).then(r * 2).else(0);
`);
    expect(diags.map((d) => d.code)).toEqual([2304, 2304]);
  });

  it("documented limit: continuing after a nullish arm is 'possibly null' to plain tsc", () => {
    const { diags } = plainTsc(`
declare const k: "a" | "b";
const r = match(k).case("a").then(null).case("b").then(1);
`);
    expect(diags.map((d) => d.code)).toEqual([2531]);
  });
});
