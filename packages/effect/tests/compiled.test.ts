/**
 * Compiled Macro Tests
 *
 * Note: The actual @compiled and compileGen() macro transformations happen at compile time.
 * These tests verify the runtime placeholder functionality and exports.
 */
import { describe, it, expect } from "vitest";
import { compileGen, compiled, compiledAttribute, compileGenExpression } from "../src/macros/compiled.js";

describe("compileGen() expression macro", () => {
  it("should export the compileGen runtime placeholder", () => {
    expect(typeof compileGen).toBe("function");
  });

  it("should throw at runtime indicating transformer is required", () => {
    const mockEffect = { _tag: "Effect" } as any;
    expect(() => compileGen(mockEffect)).toThrow(/transformer/);
  });

  it("should export the macro definition", () => {
    expect(compileGenExpression).toBeDefined();
    expect(compileGenExpression.name).toBe("compileGen");
  });
});

describe("@compiled attribute macro", () => {
  it("should export the compiled decorator placeholder", () => {
    expect(typeof compiled).toBe("function");
  });

  it("should pass through the target at runtime (placeholder behavior)", () => {
    // The actual transformation happens at compile time
    // At runtime, the placeholder just returns the input
    const target = { name: "test" };
    expect(compiled(target)).toBe(target);
  });

  it("should export the macro definition", () => {
    expect(compiledAttribute).toBeDefined();
    expect(compiledAttribute.name).toBe("compiled");
  });
});

describe("Compiled macro structure", () => {
  it("should export all necessary symbols from macros/compiled.js", async () => {
    const compiled = await import("../src/macros/compiled.js");
    
    expect(compiled.compileGen).toBeDefined();
    expect(compiled.compiled).toBeDefined();
    expect(compiled.compiledAttribute).toBeDefined();
    expect(compiled.compileGenExpression).toBeDefined();
  });

  it("should export all necessary symbols from main index", async () => {
    const index = await import("../src/index.js");
    
    expect(index.compileGen).toBeDefined();
    expect(index.compiled).toBeDefined();
    expect(index.compiledAttribute).toBeDefined();
    expect(index.compileGenExpression).toBeDefined();
  });
});
