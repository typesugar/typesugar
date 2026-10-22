/**
 * PEP-060 item 13 (smallest version): each derive marker `typesugar`
 * exports is also a TYPE, the typeclass it derives, so one import serves both
 * `@derive(Clone)` and `Clone<Point>`.
 *
 * Before, `Clone` from `typesugar` was only a value, so plain TypeScript
 * reported TS2749 on `summon<Clone<Point>>()`, typed the call as an error
 * (`any`), and `copy === p` was never rewritten to `Point.Eq.equals` unless
 * `copy` was annotated: the operator rewrite needs `copy`'s type.
 *
 * These tests read the BUILT package (`dist/*.d.ts`), as a consumer does.
 */
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as ts from "typescript";
import { transformCode } from "@typesugar/transformer";

const pkgRoot = path.resolve(__dirname, "..");
const FILE = path.join(pkgRoot, "tests", "__derive_marker_types__.ts");

/** Plain `tsc` (no typesugar) on `code`, resolving `typesugar` to the built package. */
function plainTsc(code: string) {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    experimentalDecorators: true,
    skipLibCheck: false,
    noEmit: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = (f) => (f === FILE ? code : readFile(f));
  host.fileExists = (f) => f === FILE || fileExists(f);
  const program = ts.createProgram([FILE], options, host);
  const sf = program.getSourceFile(FILE)!;
  const checker = program.getTypeChecker();
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
  const typeOf = (name: string): string => {
    let out = "?";
    const visit = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) {
        out = checker.typeToString(checker.getTypeAtLocation(n.name));
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  };
  return { diagnostics, typeOf };
}

const POINT = `class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}`;

describe("derive markers are types too", () => {
  it("summon<Clone<Point>>() type-checks under plain tsc and returns a Clone<Point>", () => {
    const r = plainTsc(`import { derive, summon, Eq, Clone } from "typesugar";
@derive(Eq, Clone)
${POINT}
const p = new Point(1, 2);
export const copy = summon<Clone<Point>>().clone(p);
export const eq = summon<Eq<Point>>().equals(p, copy);
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.typeOf("copy")).toBe("Point");
    expect(r.typeOf("eq")).toBe("boolean");
  });

  it("every marker with a typeclass interface is that interface", () => {
    const r =
      plainTsc(`import type { Eq, Ord, Clone, Debug, Hash, Json, Show, Semigroup, Monoid } from "typesugar";
import type * as std from "@typesugar/std";
import type * as fp from "@typesugar/fp";
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const checks: [
  Same<Eq<number>, std.Eq<number>>,
  Same<Ord<number>, std.Ord<number>>,
  Same<Clone<number>, std.Clone<number>>,
  Same<Debug<number>, std.Debug<number>>,
  Same<Hash<number>, std.Hash<number>>,
  Same<Json<number>, std.Json<number>>,
  Same<Show<number>, fp.Show<number>>,
  Same<Semigroup<number>, std.Semigroup<number>>,
  Same<Monoid<number>, std.Monoid<number>>,
] = [true, true, true, true, true, true, true, true, true];
`);
    expect(r.diagnostics).toEqual([]);
  });
});

describe("the transformer sees the marker type", () => {
  const activate = `import "@typesugar/std/syntax/eq/ops";\n`;

  it("`copy === p` is Eq when copy comes from summon<Clone<Point>>() unannotated", () => {
    const r = transformCode(
      `${activate}import { derive, summon, Eq, Clone } from "typesugar";
@derive(Eq, Clone)
${POINT}
const p = new Point(1, 2);
const copy = summon<Clone<Point>>().clone(p);
export const same = copy === p;
`,
      { fileName: FILE }
    );
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.code).toContain("const copy = Point.Clone.clone(p);");
    expect(r.code).toMatch(/export const same = Point\.Eq\.equals\(copy, p\)|a\.x === b\.x/);
    expect(r.code).not.toContain("copy === p");
  });

  it("a renamed import resolves to the same typeclass (by identity, not by its local name)", () => {
    const r = transformCode(
      `import { derive, summon, Clone, Clone as Copyable } from "typesugar";
@derive(Clone)
${POINT}
const p = new Point(1, 2);
export const copy = summon<Copyable<Point>>().clone(p);
`,
      { fileName: FILE }
    );
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.code).toContain("export const copy = Point.Clone.clone(p);");
  });
});
