import { describe, it, expect, vi } from "vitest";
import { assertExpands, expandCode } from "@typesugar/testing";

describe("logged macro", () => {
  it("expands to logging wrapper", async () => {
    // Register macros
    await import("../src/macros/index.js");

    const source = `
      import { logged } from "my-typesugar-macros";
      const add = logged((a: number, b: number) => a + b);
    `;

    const result = await expandCode(source);

    // Should contain console.log calls
    expect(result).toContain("console.log");

    // Should preserve the function body
    expect(result).toContain("a + b");
  });

  it("runtime behavior logs correctly", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Simulated expansion result
    const add = ((...args: [number, number]) => {
      console.log("Call:", ...args);
      const result = args[0] + args[1];
      console.log("Result:", result);
      return result;
    }) as (a: number, b: number) => number;

    const result = add(1, 2);

    expect(result).toBe(3);
    expect(consoleSpy).toHaveBeenCalledWith("Call:", 1, 2);
    expect(consoleSpy).toHaveBeenCalledWith("Result:", 3);

    consoleSpy.mockRestore();
  });
});
