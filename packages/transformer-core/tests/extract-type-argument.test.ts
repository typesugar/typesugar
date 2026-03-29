/**
 * Tests for extractTypeArgumentsContent — bracket-counting type argument extraction.
 */

import { describe, it, expect } from "vitest";
import { extractTypeArgumentsContent } from "@typesugar/core";

describe("extractTypeArgumentsContent", () => {
  it("extracts simple type argument", () => {
    expect(extractTypeArgumentsContent("Impl<number>")).toBe("number");
  });

  it("extracts nested generic", () => {
    expect(extractTypeArgumentsContent("Impl<Map<string, number>>")).toBe("Map<string, number>");
  });

  it("extracts deeply nested generic", () => {
    expect(extractTypeArgumentsContent("Impl<Either<Option<A>, B>>")).toBe("Either<Option<A>, B>");
  });

  it("handles consecutive closing brackets (>>)", () => {
    expect(extractTypeArgumentsContent("Impl<Map<number, string>>")).toBe("Map<number, string>");
  });

  it("returns undefined for no brackets", () => {
    expect(extractTypeArgumentsContent("no brackets")).toBeUndefined();
  });

  it("returns undefined for unbalanced brackets", () => {
    expect(extractTypeArgumentsContent("Impl<Map<string")).toBeUndefined();
  });

  it("handles empty brackets", () => {
    expect(extractTypeArgumentsContent("Impl<>")).toBe("");
  });

  it("handles multiple top-level type params", () => {
    // Returns everything between outermost brackets
    expect(extractTypeArgumentsContent("Pair<string, number>")).toBe("string, number");
  });

  it("handles brackets in string-like content after the type", () => {
    // Only matches the first balanced pair
    expect(extractTypeArgumentsContent("Impl<A> // extra<stuff>")).toBe("A");
  });
});
