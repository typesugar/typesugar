/**
 * Fused Macro Tests
 *
 * Note: The actual @fused and fusePipeline() macro transformations happen at compile time.
 * These tests verify the runtime placeholder functionality and exports.
 */
import { describe, it, expect } from "vitest";
import {
  fusePipeline,
  fused,
  fusedAttribute,
  fusePipelineExpression,
} from "../src/macros/fused.js";

describe("fusePipeline() expression macro", () => {
  it("should export the fusePipeline runtime placeholder", () => {
    expect(typeof fusePipeline).toBe("function");
  });

  it("should throw at runtime indicating transformer is required", () => {
    const mockEffect = { _tag: "Effect" } as any;
    expect(() => fusePipeline(mockEffect)).toThrow(/transformer/);
  });

  it("should export the macro definition", () => {
    expect(fusePipelineExpression).toBeDefined();
    expect(fusePipelineExpression.name).toBe("fusePipeline");
  });
});

describe("@fused attribute macro", () => {
  it("should export the fused decorator placeholder", () => {
    expect(typeof fused).toBe("function");
  });

  it("should pass through the target at runtime (placeholder behavior)", () => {
    const target = { name: "test" };
    expect(fused(target)).toBe(target);
  });

  it("should export the macro definition", () => {
    expect(fusedAttribute).toBeDefined();
    expect(fusedAttribute.name).toBe("fused");
  });
});

describe("Fused macro structure", () => {
  it("should export all necessary symbols from macros/fused.js", async () => {
    const fused = await import("../src/macros/fused.js");

    expect(fused.fusePipeline).toBeDefined();
    expect(fused.fused).toBeDefined();
    expect(fused.fusedAttribute).toBeDefined();
    expect(fused.fusePipelineExpression).toBeDefined();
  });

  it("should export all necessary symbols from main index", async () => {
    const index = await import("../src/index.js");

    expect(index.fusePipeline).toBeDefined();
    expect(index.fused).toBeDefined();
    expect(index.fusedAttribute).toBeDefined();
    expect(index.fusePipelineExpression).toBeDefined();
  });
});
