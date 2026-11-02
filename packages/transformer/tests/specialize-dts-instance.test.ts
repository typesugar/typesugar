/**
 * An instance from a package's compiled `.d.ts` has no method bodies to
 * inline, so a call passing it keeps dictionary passing. A call that names
 * the instance said so (TS9602); the same call completed by `= implicit()`
 * did not, and docs/guides/specialize.md claimed it was specialized.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import { transformCode } from "../src/pipeline.js";

const fileName = path.resolve(__dirname, "__specialize_dts_instance__.ts");

const SORT = `function sortWith<T>(items: T[], ord: Ord<T> = implicit()): T[] {
  return items.slice().sort((a, b) => ord.compare(a, b));
}
`;

function expand(code: string) {
  const r = transformCode(code, { fileName, transformerConfig: { cacheDir: false } });
  return {
    code: r.code,
    warnings: r.diagnostics
      .filter((d) => d.severity === "warning")
      .map((d) => ({ message: d.message, text: code.slice(d.start, d.start + d.length) })),
    errors: r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message),
  };
}

describe("TS9602 for an instance from a .d.ts (std's ordNumber)", () => {
  it("implicit() fills ordNumber, keeps dictionary passing, and says so at the call", () => {
    const r = expand(`import { implicit } from "typesugar";
import { ordNumber, type Ord } from "@typesugar/std";
${SORT}
export const viaImplicit = sortWith([3, 1, 2]);
export const named = sortWith([3, 1, 2], ordNumber);
`);
    expect(r.errors).toEqual([]);
    expect(r.code).toContain("export const viaImplicit = sortWith([3, 1, 2], ordNumber);");
    expect(r.code).toContain("export const named = sortWith([3, 1, 2], ordNumber);");
    expect(r.warnings).toEqual([
      {
        message: expect.stringMatching(
          /\[TS9602\] Auto-specialization of sortWith skipped — instance 'ordNumber' is only visible as a declaration \(from a \.d\.ts\)/
        ),
        text: "sortWith([3, 1, 2])",
      },
      {
        message: expect.stringMatching(/\[TS9602\].*'ordNumber'/),
        text: "sortWith([3, 1, 2], ordNumber)",
      },
    ]);
  });

  it("implicit() with only the type imported: the instance is imported, and the same warning", () => {
    const r = expand(`import { implicit } from "typesugar";
import type { Ord } from "@typesugar/std";
${SORT}
export const viaImplicit = sortWith([3, 1, 2]);
`);
    expect(r.errors).toEqual([]);
    expect(r.code).toMatch(/import \{ ordNumber \} from "@typesugar\/std";/);
    expect(r.warnings.map((w) => w.message)).toEqual([
      expect.stringMatching(
        /\[TS9602\] Auto-specialization of sortWith skipped — instance 'ordNumber'/
      ),
    ]);
  });

  it("an instance in source is still specialized, with no warning", () => {
    const r = expand(`import { implicit } from "typesugar";
import type { Ord } from "@typesugar/std";
/** @impl Ord<number> */
const numberOrd: Ord<number> = {
  compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  equals: (a, b) => a === b,
  notEquals: (a, b) => a !== b,
  lessThan: (a, b) => a < b,
  lessThanOrEqual: (a, b) => a <= b,
  greaterThan: (a, b) => a > b,
  greaterThanOrEqual: (a, b) => a >= b,
};
${SORT}
export const viaImplicit = sortWith([3, 1, 2]);
`);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.code).toMatch(
      /export const viaImplicit = __typesugar___sortWith_\w+__\(\[3, 1, 2\]\);/
    );
  });
});
