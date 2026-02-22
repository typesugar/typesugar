/**
 * Integration tests for fn.specialize(dict) extension method rewriting.
 *
 * Verifies that `sortWith.specialize(numberOrd)` gets rewritten to an
 * inlined/specialized function via createSpecializedFunction().
 */

import { describe, it, expect, beforeEach } from "vitest";
import { transformCode } from "../src/pipeline.js";
import { clearRegistries, registerInstanceMethods } from "@typesugar/macros";

beforeEach(() => {
  clearRegistries();
});

function setupOrdInstance(dictName: string) {
  registerInstanceMethods(dictName, "Ord", {
    compare: {
      source: "(a, b) => a < b ? -1 : a > b ? 1 : 0",
      params: ["a", "b"],
    },
  });
}

describe("fn.specialize(dict) extension method", () => {
  it("rewrites fn.specialize(dict) to a specialized function", () => {
    setupOrdInstance("numberOrd");

    const code = `
declare function sortWith<T>(items: T[], ord: { compare(a: T, b: T): number }): T[];
declare const numberOrd: { compare(a: number, b: number): number };
const sortNumbers = sortWith.specialize(numberOrd);
    `.trim();

    const result = transformCode(code, { fileName: "specialize-ext.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).not.toContain(".specialize(");
  });

  it("leaves non-callable receiver alone (not rewritten)", () => {
    const code = `
declare const obj: { x: number };
const result = obj.specialize(42);
    `.trim();

    const result = transformCode(code, { fileName: "specialize-noncallable.ts" });
    expect(result.code).toContain(".specialize(");
  });

  it("reports error when no dict args provided", () => {
    const code = `
declare function sortWith<T>(items: T[], ord: { compare(a: T, b: T): number }): T[];
const specialized = sortWith.specialize();
    `.trim();

    const result = transformCode(code, { fileName: "specialize-no-args.ts" });
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((d) => d.message.includes("requires at least one"))).toBe(true);
  });

  it("falls back to partial application for unregistered dicts with a warning", () => {
    const code = `
declare function sortWith<T>(items: T[], ord: { compare(a: T, b: T): number }): T[];
declare const unknownOrd: { compare(a: string, b: string): number };
const sortStrings = sortWith.specialize(unknownOrd);
    `.trim();

    const result = transformCode(code, { fileName: "specialize-unregistered.ts" });
    expect(result.code).not.toContain(".specialize(");
    const warnings = result.diagnostics.filter((d) => d.severity === "warning");
    expect(warnings.some((d) => d.message.includes("falling back"))).toBe(true);
  });

  it("handles multiple dict arguments", () => {
    setupOrdInstance("numberOrd");
    registerInstanceMethods("numberShow", "Show", {
      show: {
        source: "(a) => String(a)",
        params: ["a"],
      },
    });

    const code = `
declare function showAndSort<T>(
  items: T[],
  show: { show(a: T): string },
  ord: { compare(a: T, b: T): number }
): string[];
declare const numberShow: { show(a: number): string };
declare const numberOrd: { compare(a: number, b: number): number };
const result = showAndSort.specialize(numberShow, numberOrd);
    `.trim();

    const result = transformCode(code, { fileName: "specialize-multi.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).not.toContain(".specialize(");
  });
});
