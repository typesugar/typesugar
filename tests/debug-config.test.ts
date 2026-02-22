import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { config } from "../packages/core/src/index.js";

describe("Debug Config", () => {
  beforeEach(() => {
    console.log("=== beforeEach: calling config.reset() ===");
    config.reset();
    console.log("After reset, config.get('debug'):", config.get("debug"));
    console.log("After reset, config.getAll():", JSON.stringify(config.getAll()));
  });

  it("should set and get debug", () => {
    console.log("=== Test: setting debug: true ===");
    config.set({ debug: true });
    console.log("After set, config.get('debug'):", config.get("debug"));
    console.log("After set, config.getAll():", JSON.stringify(config.getAll()));
    expect(config.get("debug")).toBe(true);
  });
});
