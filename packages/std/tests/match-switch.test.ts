/**
 * `match:` — the statement form of pattern matching (Turf case study, F21).
 *
 * Every behavioural assertion runs the emitted JavaScript (match-exec-helpers),
 * so control flow — break, return, continue, throw, fallthrough — is checked
 * by executing it, not by grepping the output.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { transformAndRun } from "./match-exec-helpers.js";

const ACTIVATE = `import "@typesugar/std/syntax/match";\n`;

const GEOMETRY = `
type Geometry =
  | { type: "Point"; coordinates: number[] }
  | { type: "LineString"; coordinates: number[][] }
  | { type: "Polygon"; coordinates: number[][][] };
`;

/** The emitted JavaScript of `code` compiled through the transformer (no macros: as written). */
function js(code: string): string {
  return transformAndRun(code).js;
}

describe("match: switch — literal cases", () => {
  const body = `
export function kind(type: "Point" | "LineString" | "Polygon"): number {
  let n = 0;
  // a comment the output keeps
  switch (type) {
    case "Point":
      n = 1;
      break;
    case "LineString":
      n = 2;
      break;
    case "Polygon":
      return 3;
  }
  return n;
}
`;

  it("compiles to the hand-written switch, byte for byte, with no runtime import", () => {
    const handWritten = js(body);
    const withLabel = transformAndRun(
      ACTIVATE + body.replace("  switch (type)", "  match: switch (type)")
    );
    expect(withLabel.errors).toEqual([]);
    expect(withLabel.warnings).toEqual([]);
    expect(withLabel.js).toBe(handWritten);
    expect(withLabel.js).not.toContain("typesugar");
    expect((withLabel.exports.kind as (t: string) => number)("LineString")).toBe(2);
  });

  it("reports a missing case as TS9226, naming it", () => {
    const r = transformAndRun(`${ACTIVATE}
export function f(t: "a" | "b" | "c"): number {
  match: switch (t) {
    case "a":
      return 1;
    case "b":
      return 2;
  }
  return 0;
}
`);
    expect(r.errors).toEqual([
      expect.stringContaining('Non-exhaustive match — missing cases: "c"'),
    ]);
  });

  it("counts grouped (fall-through) cases, constants and enum members", () => {
    const r = transformAndRun(`${ACTIVATE}
enum Dir { Up, Down }
const C = "c" as const;
export function f(t: "a" | "b" | "c", d: Dir): string {
  let out = "";
  match: switch (t) {
    case "a":
    case "b":
      out += "ab";
      break;
    case C:
      out += "c";
  }
  match: switch (d) {
    case Dir.Up:
      out += "^";
      break;
    case Dir.Down:
      out += "v";
      break;
  }
  return out;
}
`);
    expect(r.errors).toEqual([]);
    const f = r.exports.f as (t: string, d: number) => string;
    expect(f("b", 1)).toBe("abv");
    expect(f("c", 0)).toBe("c^");
  });

  it("checks booleans and nullable literal unions", () => {
    const r = transformAndRun(`${ACTIVATE}
export function f(b: boolean, k: "x" | null): void {
  match: switch (b) {
    case true:
      break;
  }
  match: switch (k) {
    case "x":
      break;
  }
}
`);
    expect(r.errors).toEqual([
      expect.stringContaining("missing cases: false"),
      expect.stringContaining("missing cases: null"),
    ]);
  });

  it("a default: covers the rest; one that only throws keeps the check on", () => {
    const r = transformAndRun(`${ACTIVATE}
export function covered(t: "a" | "b"): number {
  match: switch (t) {
    case "a":
      return 1;
    default:
      return 0;
  }
}
export function safetyNet(t: "a" | "b"): number {
  match: switch (t) {
    case "a":
      return 1;
    default:
      throw new Error("unknown " + t);
  }
}
`);
    expect(r.errors).toEqual([expect.stringContaining('missing cases: "b"')]);
  });

  it("warns about a default: that can never run, but not about a throwing safety net", () => {
    const r = transformAndRun(`${ACTIVATE}
export function dead(t: "a" | "b"): number {
  match: switch (t) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      return 0;
  }
}
export function net(t: "a" | "b"): number {
  match: switch (t) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      throw new Error("not a or b");
  }
}
`);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([expect.stringContaining("unreachable default")]);
  });

  it("keeps every control-flow form: break, return, continue, throw, fallthrough", () => {
    const r = transformAndRun(`${ACTIVATE}
export function run(items: ("skip" | "stop" | "boom" | "a" | "b")[]): string {
  let log = "";
  for (const it of items) {
    match: switch (it) {
      case "skip":
        continue;
      case "stop":
        return log + "|stop";
      case "boom":
        throw new Error("boom:" + log);
      case "a":
        log += "a";
      // falls through
      case "b":
        log += "b";
        break;
    }
    log += ".";
  }
  return log;
}
`);
    expect(r.errors).toEqual([]);
    const run = r.exports.run as (xs: string[]) => string;
    expect(run(["a", "b", "skip", "a"])).toBe("ab.b.ab.");
    expect(run(["a", "stop", "b"])).toBe("ab.|stop");
    expect(() => run(["b", "boom"])).toThrow("boom:b.");
  });

  it("`break match;` leaves the switch: the label is kept when the body names it", () => {
    const r = transformAndRun(`${ACTIVATE}
export function g(xs: ("c" | "r" | "t")[]): number {
  let n = 0;
  for (const x of xs) {
    match: switch (x) {
      case "c":
        continue;
      case "r":
        n++;
        break;
      case "t":
        for (let i = 0; i < 3; i++) {
          if (n > 5) break match;
          n += 10;
        }
        n += 100;
        break;
    }
    n += 1000;
  }
  return n;
}
`);
    expect(r.errors).toEqual([]);
    expect(r.runError).toBeUndefined();
    const g = r.exports.g as (xs: string[]) => number;
    // "r": 1, +1000; "t": n > 5 at once, so break match skips the +100; +1000; "c": continue.
    expect(g(["r", "t", "c"])).toBe(2001);
    // "t" first: n += 10 once, then n > 5, break match: no +100.
    expect(g(["t"])).toBe(1010);
  });

  it("`break match;` in a pattern switch and in nested match: switches targets its own switch", () => {
    const r = transformAndRun(`${ACTIVATE}${GEOMETRY}
export function f(gs: Geometry[], stop: boolean): string {
  let log = "";
  for (const geom of gs) {
    match: switch (geom) {
      case { type: "Point", coordinates }:
        if (stop) break match;
        log += "P" + coordinates.length;
        break;
      case { type: "LineString", coordinates }:
        match: switch (coordinates.length > 1 ? "many" : "one") {
          case "many":
            if (stop) break match;
            log += "M";
            break;
          case "one":
            log += "O";
            break;
        }
        log += "L";
        break;
      case { type: "Polygon" }:
        log += "G";
        break;
    }
    log += ".";
  }
  return log;
}
`);
    expect(r.errors).toEqual([]);
    expect(r.runError).toBeUndefined();
    const f = r.exports.f as (gs: unknown[], stop: boolean) => string;
    const gs = [
      { type: "Point", coordinates: [1, 2] },
      { type: "LineString", coordinates: [[1], [2]] },
      { type: "Polygon", coordinates: [] },
    ];
    expect(f(gs, false)).toBe("P2.ML.G.");
    expect(f(gs, true)).toBe(".L.G.");
  });

  it("without the activation import it is a plain labelled switch, with the TS9224 hint", () => {
    const r = transformAndRun(`
export function f(t: "a" | "b"): number {
  match: switch (t) {
    case "a":
      return 1;
  }
  return 0;
}
`);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([expect.stringContaining("@typesugar/std/syntax/match")]);
    expect(r.js).toContain("match: switch");
  });

  it("leaves an ordinary label on a block or loop alone", () => {
    const r = transformAndRun(`${ACTIVATE}
export function f(): number {
  let n = 0;
  match: for (let i = 0; i < 3; i++) {
    if (i === 2) break match;
    n++;
  }
  return n;
}
`);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect((r.exports.f as () => number)()).toBe(2);
  });
});

describe("match: switch — destructuring patterns", () => {
  it("compiles object patterns to a switch on the discriminant plus destructuring", () => {
    const r = transformAndRun(`${ACTIVATE}${GEOMETRY}
export function describe(geom: Geometry): string {
  match: switch (geom) {
    case { type: "Point", coordinates: [x, y] }:
      return "P" + (x + y);
    case { type: "LineString", coordinates }:
      for (const c of coordinates) if (c.length === 0) return "empty";
      return "L" + coordinates.length;
    case { type: "Polygon" }:
      return "G";
  }
}
`);
    expect(r.errors).toEqual([]);
    expect(r.code).toContain("switch (geom.type)");
    expect(r.code).toMatch(/case "Point": \{\s*const \[x, y\] = geom\.coordinates;/);
    expect(r.code).toMatch(/case "LineString": \{\s*const coordinates = geom\.coordinates;/);
    expect(r.code).toMatch(/case "Polygon":\s*return "G";/);
    expect(r.code).not.toMatch(/=>|MatchError|typesugar/);
    const d = r.exports.describe as (g: unknown) => string;
    expect(d({ type: "Point", coordinates: [1, 2] })).toBe("P3");
    expect(d({ type: "LineString", coordinates: [[0], [1]] })).toBe("L2");
    expect(d({ type: "LineString", coordinates: [[]] })).toBe("empty");
    expect(d({ type: "Polygon", coordinates: [] })).toBe("G");
  });

  it("reports a missing variant as TS9226", () => {
    const r = transformAndRun(`${ACTIVATE}${GEOMETRY}
export function f(geom: Geometry): number {
  match: switch (geom) {
    case { type: "Point", coordinates: [x] }:
      return x;
  }
  return 0;
}
`);
    expect(r.errors).toEqual([
      expect.stringContaining('missing variants: "LineString", "Polygon" (discriminant: "type")'),
    ]);
  });

  it("binds several properties, rest and nested destructuring in one const", () => {
    const r = transformAndRun(`${ACTIVATE}
type Shape =
  | { kind: "rect"; w: number; h: number; style: { fill: string } }
  | { kind: "circle"; r: number; label: string };
export function f(s: Shape): string {
  match: switch (s) {
    case { kind: "rect", w, h, style: { fill } }:
      return fill + w * h;
    case { kind: "circle", ...rest }:
      return JSON.stringify(rest);
  }
}
`);
    expect(r.errors).toEqual([]);
    expect(r.code).toContain("const { w, h, style: { fill } } = s;");
    expect(r.code).toContain("const { kind: _excl_kind, ...rest } = s;");
    const f = r.exports.f as (s: unknown) => string;
    expect(f({ kind: "rect", w: 2, h: 3, style: { fill: "red" } })).toBe("red6");
    expect(f({ kind: "circle", r: 1, label: "c" })).toBe('{"r":1,"label":"c"}');
  });

  it("hoists a non-identifier scrutinee into a const, read once", () => {
    const r = transformAndRun(`${ACTIVATE}${GEOMETRY}
let reads = 0;
const holder = { get geometry(): Geometry { reads++; return { type: "Point", coordinates: [4, 5] }; } };
export function f(): number {
  match: switch (holder.geometry) {
    case { type: "Point", coordinates: [x, y] }:
      return x * y;
    default:
      return -1;
  }
}
export const count = () => reads;
`);
    expect(r.errors).toEqual([]);
    expect(r.code).toMatch(/const _geometry = holder\.geometry;\s*switch \(_geometry\.type\)/);
    expect((r.exports.f as () => number)()).toBe(20);
    expect((r.exports.count as () => number)()).toBe(1);
  });

  it("keeps break / continue / fallthrough meaning inside pattern cases", () => {
    const r = transformAndRun(`${ACTIVATE}${GEOMETRY}
export function sum(gs: Geometry[]): number {
  let total = 0;
  for (const g of gs) {
    match: switch (g) {
      case { type: "Point", coordinates: [x] }:
        if (x < 0) continue;
        total += x;
        break;
      case { type: "LineString" }:
        total += 100;
      // falls through
      case { type: "Polygon" }:
        total += 1000;
        break;
    }
    total += 1;
  }
  return total;
}
`);
    expect(r.errors).toEqual([]);
    const sum = r.exports.sum as (g: unknown[]) => number;
    expect(
      sum([
        { type: "Point", coordinates: [5] },
        { type: "Point", coordinates: [-5] },
        { type: "LineString", coordinates: [] },
      ])
    ).toBe(5 + 1 + 1100 + 1);
  });

  it("uses the built-in extractors on fp's Option (A | null) with a switch(true)", () => {
    const r = transformAndRun(`${ACTIVATE}
import { Some, None, type Option } from "@typesugar/fp";
export function show(o: Option<number>): string {
  match: switch (o) {
    case Some(v):
      return "some " + v;
    case None:
      return "none";
  }
}
`);
    expect(r.errors).toEqual([]);
    // fp's Option is @opaque: `o != null` doesn't narrow it for the checker,
    // so `v` is asserted to the payload type destructureSome declares.
    expect(r.code).toMatch(
      /switch \(true\) \{\s*case o != null: \{\s*const v = o as unknown as number;/
    );
    expect(r.code).toMatch(/case o == null:\s*return "none";/);
  });

  it("mixes case null with object patterns (switch(true), null-safe tests)", () => {
    const r = transformAndRun(`${ACTIVATE}${GEOMETRY}
export function f(g: Geometry | null): string {
  match: switch (g) {
    case { type: "Point", coordinates: [x] }:
      return "P" + x;
    case null:
      return "null";
    default:
      return "other";
  }
}
`);
    expect(r.errors).toEqual([]);
    expect(r.code).toContain('case g != null && g.type === "Point": {');
    const f = r.exports.f as (g: unknown) => string;
    expect(f(null)).toBe("null");
    expect(f({ type: "Point", coordinates: [7] })).toBe("P7");
    expect(f({ type: "Polygon", coordinates: [] })).toBe("other");
  });

  it("rejects a nested test, which a destructuring case can't express", () => {
    const r = transformAndRun(`${ACTIVATE}
type T = { kind: "a"; inner: { tag: "x" | "y" } } | { kind: "b" };
export function f(t: T): number {
  match: switch (t) {
    case { kind: "a", inner: { tag: "x" } }:
      return 1;
    default:
      return 0;
  }
}
`);
    expect(r.errors).toEqual([expect.stringContaining("only top-level properties can be tested")]);
  });

  it("rejects bindings on a case that falls through with no body", () => {
    const r = transformAndRun(`${ACTIVATE}${GEOMETRY}
export function f(g: Geometry): number {
  match: switch (g) {
    case { type: "Point", coordinates }:
    case { type: "LineString" }:
      return 1;
    default:
      return 0;
  }
}
`);
    expect(r.errors).toEqual([expect.stringContaining("binds names but has no statements")]);
  });

  it("the expanded code type-checks: the bound names have the variant's types", () => {
    const r = transformAndRun(`${ACTIVATE}${GEOMETRY}
export function f(geom: Geometry): number {
  match: switch (geom) {
    case { type: "Point", coordinates: [x, y] }:
      return x + y;
    case { type: "LineString", coordinates }:
      return coordinates[0][0];
    case { type: "Polygon", coordinates }:
      return coordinates[0][0][0];
  }
}
`);
    expect(r.errors).toEqual([]);
    const program = ts.createProgram({
      rootNames: ["/x.ts"],
      options: { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, types: [] },
      host: (() => {
        const h = ts.createCompilerHost({});
        const orig = h.getSourceFile.bind(h);
        h.getSourceFile = (fn, lv, ...rest) =>
          fn === "/x.ts" ? ts.createSourceFile(fn, r.code, lv, true) : orig(fn, lv, ...rest);
        h.fileExists = (fn) => fn === "/x.ts" || ts.sys.fileExists(fn);
        return h;
      })(),
    });
    const diags = ts.getPreEmitDiagnostics(program).filter((d) => d.file?.fileName === "/x.ts");
    expect(diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
  });
});
