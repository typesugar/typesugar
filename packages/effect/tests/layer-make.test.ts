/**
 * layerMake<R>() Macro Tests
 *
 * The actual compile-time transformation is tested via integration tests.
 * These tests verify the runtime placeholder, exports, and macro registration.
 */
import { describe, it, expect } from "vitest";
import { layerMake, layerMakeMacro } from "../src/macros/layer-make.js";

describe("layerMake() expression macro", () => {
  it("should export the layerMake runtime placeholder", () => {
    expect(typeof layerMake).toBe("function");
  });

  it("should throw at runtime indicating transformer is required", () => {
    expect(() => layerMake("fake-layer" as any)).toThrow(/transformer/);
  });

  it("should export the macro definition", () => {
    expect(layerMakeMacro).toBeDefined();
    expect(layerMakeMacro.name).toBe("layerMake");
  });

  it("should have a description", () => {
    expect(layerMakeMacro.description).toContain("layer");
  });
});

describe("layerMake exports", () => {
  it("should export the runtime placeholder from the package root", async () => {
    const pkg = await import("../src/index.js");
    expect(typeof pkg.layerMake).toBe("function");
  });

  it("should export the macro definition from the ./macros entry", async () => {
    const macros = await import("../src/macros.js");
    expect(macros.layerMakeMacro).toBeDefined();
  });
});
