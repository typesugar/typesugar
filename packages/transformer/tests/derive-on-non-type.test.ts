/**
 * `@derive` on something that is not a type declaration is TS9102, not
 * silence. A JSDoc `@derive` on a `const` used to be dropped without a word
 * (CLAUDE.md: a degraded expansion must leave a visible trace), and one on a
 * function only warned.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import { transformCode } from "../src/pipeline.js";

const fileName = path.resolve(__dirname, "__derive_on_non_type__.ts");

function expand(code: string) {
  const r = transformCode(code, { fileName, transformerConfig: { cacheDir: false } });
  return {
    code: r.code,
    diagnostics: r.diagnostics.map((d) => ({
      severity: d.severity,
      code: d.code,
      message: d.message,
      text: code.slice(d.start, d.start + d.length),
    })),
  };
}

describe("TS9102: @derive on a non-type", () => {
  it("a JSDoc @derive on a const is an error at the tag, with help", () => {
    const r = expand(`/** @derive(Eq, Clone) */
export const origin = { x: 0, y: 0 };
`);
    expect(r.diagnostics).toHaveLength(1);
    const [d] = r.diagnostics;
    expect(d.severity).toBe("error");
    expect(d.code).toBe(9102);
    expect(d.message).toContain("@derive(Eq, Clone) requires an interface, class, or type alias");
    expect(d.message).toContain("derived<Eq<Type>>()");
    expect(d.text).toContain("@derive");
    expect(r.code).toContain("export const origin = { x: 0, y: 0 };");
  });

  it("a JSDoc @derive on a function is the same error", () => {
    const r = expand(`/** @derive(Eq) */
export function makePoint() {
  return { x: 0, y: 0 };
}
`);
    expect(r.diagnostics.map((d) => [d.severity, d.code])).toEqual([["error", 9102]]);
    expect(r.diagnostics[0].message).toContain(
      "@derive(Eq) requires an interface, class, or type alias"
    );
  });

  it("on an interface it still derives", () => {
    const r = expand(`/** @derive(Eq) */
export interface Point { x: number; y: number }
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.code).toContain("export const Eq = {");
  });
});
