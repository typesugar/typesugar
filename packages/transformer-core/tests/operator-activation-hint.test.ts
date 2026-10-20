/**
 * TS9804 — "operator syntax not activated" (the operator counterpart of the
 * TS9224 label hint).
 *
 * PEP-052 made operator syntax opt-in per file. A binary or prefix-unary
 * operator whose operand type has an in-scope instance of a typeclass with a
 * matching `@op` tag, in a file that neither imports that typeclass's
 * `@syntax-operators` marker module nor declares the typeclass, used to stay
 * native with no diagnostic (docs/examples/math/numeric-typeclass.ts printed
 * `undefined + undefinedi`). It now warns once, at the operator, naming the
 * import to add — and stays silent everywhere activating would change nothing.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import { clearTypeRewrites, standaloneExtensionRegistry } from "@typesugar/core";
import "@typesugar/macros";

import { transformCode, type TransformCodeResult } from "../src/transform.js";
import { resetDtsDiscovery } from "../src/dts-opaque-discovery.js";

/** A typeclass library with binary and unary `@op` tags, plus its `/ops` marker. */
const LIB = [
  `export interface Vec2 { x: number; y: number }`,
  `export interface Plain { n: number }`,
  `/** @typeclass */`,
  `export interface VecOps<A> {`,
  `  /** @op + */`,
  `  add(a: A, b: A): A;`,
  `  /** @op - */`,
  `  negate(a: A): A;`,
  `  /** @op === */`,
  `  same(a: A, b: A): boolean;`,
  `}`,
  `/** @impl VecOps<Vec2> */`,
  `export const vecOps: VecOps<Vec2> = {`,
  `  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),`,
  `  negate: (a) => ({ x: -a.x, y: -a.y }),`,
  `  same: (a, b) => a.x === b.x && a.y === b.y,`,
  `};`,
].join("\n");

const MARKER = `/** @syntax-operators VecOps */\nexport const __typesugar_syntax_operators_VecOps = true;\n`;

const PRELUDE = [
  `import { type Vec2, type Plain, vecOps } from "./lib";`,
  `declare const v: Vec2;`,
  `declare const w: Vec2;`,
  `void vecOps;`,
].join("\n");

function transform(main: string): TransformCodeResult {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "op-activation-hint-")));
  try {
    const files: Record<string, string> = {
      "lib.ts": LIB,
      "syntax/vec-ops.ts": MARKER,
      "main.ts": main,
    };
    for (const [name, content] of Object.entries(files)) {
      const p = path.join(dir, name);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    }
    const fileName = path.join(dir, "main.ts");
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    };
    // The marker module is a root file, as it would be in a real project's
    // tsconfig `include`, so its `@syntax-operators` tag is discoverable.
    const program = ts.createProgram(
      [fileName, path.join(dir, "syntax/vec-ops.ts")],
      options,
      ts.createCompilerHost(options)
    );
    const sf = program.getSourceFile(fileName)!;
    return transformCode(sf.text, { program, fileName });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const hintsOf = (r: TransformCodeResult) => r.diagnostics.filter((d) => d.code === 9804);

beforeEach(() => {
  clearTypeRewrites();
  resetDtsDiscovery();
  standaloneExtensionRegistry.length = 0;
});

describe("TS9804: operator syntax not activated", () => {
  it("warns once at a binary operator, naming the marker import", () => {
    const main = [PRELUDE, `export const r = v + w;`].join("\n");
    const result = transform(main);
    const hints = hintsOf(result);
    expect(hints).toHaveLength(1);
    expect(hints[0].severity).toBe("warning");
    expect(hints[0].message).toContain("[TS9804]");
    expect(hints[0].message).toContain("'+'");
    expect(hints[0].message).toContain("Vec2");
    expect(hints[0].message).toContain("VecOps.add");
    expect(hints[0].message).toContain(`import "./syntax/vec-ops";`);
    // The hint is anchored at the operator token itself.
    expect(hints[0].start).toBe(main.indexOf("v + w") + 2);
    // Still native: the hint does not change the output.
    expect(result.code).toContain("v + w");
  });

  it("warns at a prefix-unary operator", () => {
    const main = [PRELUDE, `export const r = -v;`].join("\n");
    const hints = hintsOf(transform(main));
    expect(hints).toHaveLength(1);
    expect(hints[0].message).toContain("'-'");
    expect(hints[0].message).toContain("VecOps.negate");
    expect(hints[0].start).toBe(main.indexOf("-v"));
  });

  it("is gone once the marker is imported (and the operator rewrites)", () => {
    const result = transform(
      [
        PRELUDE,
        `import "./syntax/vec-ops";`,
        `export const r = v + w;`,
        `export const n = -v;`,
      ].join("\n")
    );
    expect(hintsOf(result)).toEqual([]);
    // Dispatched (and then inlined from the instance's arrow bodies).
    expect(result.code).toContain("r = ({ x: v.x + w.x, y: v.y + w.y })");
    expect(result.code).toContain("n = ({ x: -v.x, y: -v.y })");
  });
});

describe("TS9804: no false positives", () => {
  it("primitive operands", () => {
    const result = transform(
      [
        PRELUDE,
        `declare const a: number;`,
        `declare const s: string;`,
        `declare const u: number | string;`,
        `export const r = [a + 1, 1 + 2, s + "x", u + a, -a, a < 3];`,
      ].join("\n")
    );
    expect(hintsOf(result)).toEqual([]);
  });

  it("a type with no instance", () => {
    const result = transform(
      [PRELUDE, `declare const p: Plain;`, `// @ts-ignore`, `export const r = [p + p, -p];`].join(
        "\n"
      )
    );
    expect(hintsOf(result)).toEqual([]);
  });

  it("a right operand that activation would not dispatch either (v + 5)", () => {
    const result = transform([PRELUDE, `// @ts-ignore`, `export const r = v + 5;`].join("\n"));
    expect(hintsOf(result)).toEqual([]);
  });

  it("a file that declares the typeclass itself", () => {
    const result = transform(
      [
        `interface P { n: number }`,
        `/** @typeclass */`,
        `interface Adds<A> {`,
        `  /** @op + */`,
        `  plus(a: A, b: A): A;`,
        `}`,
        `/** @impl Adds<P> */`,
        `const addsP: Adds<P> = { plus: (a, b) => ({ n: a.n + b.n }) };`,
        `declare const p: P;`,
        `export const r = p + p;`,
      ].join("\n")
    );
    expect(hintsOf(result)).toEqual([]);
    expect(result.code).toContain("r = ({ n: p.n + p.n })");
  });

  it('a "use no typesugar" file', () => {
    const result = transform(
      [`"use no typesugar";`, PRELUDE, `export const r = [v + w, -v];`].join("\n")
    );
    expect(hintsOf(result)).toEqual([]);
  });

  it('a "use no typesugar operators" file and a // @ts-no-typesugar operators line', () => {
    expect(
      hintsOf(
        transform([`"use no typesugar operators";`, PRELUDE, `export const r = v + w;`].join("\n"))
      )
    ).toEqual([]);
    expect(
      hintsOf(
        transform([PRELUDE, `export const r = v + w; // @ts-no-typesugar operators`].join("\n"))
      )
    ).toEqual([]);
  });

  it("an operator with no @op mapping", () => {
    const result = transform(
      [PRELUDE, `// @ts-ignore`, `export const r = [v * w, v / w, ~v];`].join("\n")
    );
    expect(hintsOf(result)).toEqual([]);
  });
});

describe("the operators opt-out in an activated file", () => {
  // The rewrite gate used to check only the `extensions` feature, so the
  // documented `operators` opt-out silenced TS9804 but still rewrote here.
  it("// @ts-no-typesugar operators keeps that line native", () => {
    const result = transform(
      [
        PRELUDE,
        `import "./syntax/vec-ops";`,
        `export const r1 = v + w; // @ts-no-typesugar operators`,
        `export const r2 = v + w;`,
      ].join("\n")
    );
    expect(result.code).toContain("r1 = v + w;");
    expect(result.code).toContain("r2 = ({ x: v.x + w.x, y: v.y + w.y })");
  });

  it('"use no typesugar operators" keeps the file native', () => {
    const result = transform(
      [
        `"use no typesugar operators";`,
        PRELUDE,
        `import "./syntax/vec-ops";`,
        `export const r = [v + w, -v];`,
      ].join("\n")
    );
    expect(result.code).toContain("r = [v + w, -v]");
  });
});

describe("TS9804: equality operators", () => {
  // `===` on a type with an Eq-style instance is the same silent failure:
  // without activation it compares references, not structure.
  it("warns for an @op-mapped === (and not for an unmapped !==)", () => {
    const main = [PRELUDE, `export const r = [v === w, v !== w];`].join("\n");
    const hints = hintsOf(transform(main));
    expect(hints).toHaveLength(1); // VecOps maps === only, not !==
    expect(hints[0].message).toContain("VecOps.same");
  });

  it("is silenced on a line by // @ts-no-typesugar operators", () => {
    const main = [PRELUDE, `export const r = v === w; // @ts-no-typesugar operators`].join("\n");
    expect(hintsOf(transform(main))).toEqual([]);
  });
});
