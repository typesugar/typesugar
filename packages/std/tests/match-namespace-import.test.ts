/**
 * `match` through a namespace import (`import * as std from "@typesugar/std"`).
 * The macro took any `x.match(...)` callee for a fluent-chain link and failed
 * with "Fluent match chain does not root in a call expression", in all three
 * forms below. The third is the extension call `shape.match(handlers)`, which
 * the transformer rewrites to `std.match(shape, handlers)` (neverthrow case
 * study F12 follow-up, #102 review).
 */
import { describe, it, expect } from "vitest";

import "@typesugar/macros";
import "@typesugar/std/macros";

import { transformCode } from "@typesugar/transformer";

const SHAPE = `type Shape = { kind: "circle"; r: number } | { kind: "square"; s: number };
declare const sh: Shape;
`;

function expand(body: string, fileName: string) {
  const r = transformCode(`import * as std from "@typesugar/std";\n${SHAPE}${body}`, { fileName });
  return {
    errors: r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message),
    code: r.code,
  };
}

describe("match through a namespace import", () => {
  it("object form: std.match(value, handlers) expands", () => {
    const { errors, code } = expand(
      `export const a = std.match(sh, { circle: (c) => c.r, square: (q) => q.s });`,
      "match-ns-object.ts"
    );
    expect(errors).toEqual([]);
    expect(code).toContain(`=== "circle"`);
    expect(code).not.toContain("std.match(");
  });

  it("fluent form: std.match(value).case(...) expands", () => {
    const { errors, code } = expand(
      `export const b = std.match(sh).case({ kind: "circle", r }).then(r).case({ kind: "square", s }).then(s);`,
      "match-ns-fluent.ts"
    );
    expect(errors).toEqual([]);
    expect(code).not.toContain("std.match(");
    expect(code).not.toContain(".case(");
  });

  it("extension call: sh.match(handlers) expands like std.match(sh, handlers)", () => {
    const { errors, code } = expand(
      `export const c = sh.match({ circle: (c) => c.r, square: (q) => q.s });`,
      "match-ns-extension.ts"
    );
    expect(errors).toEqual([]);
    expect(code).toContain(`=== "circle"`);
    expect(code).not.toContain(".match(");
  });
});
