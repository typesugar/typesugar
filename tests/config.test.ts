/**
 * Tests for Unified Configuration System
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext } from "../src/core/context.js";
import {
  config,
  defineConfig,
  type TtfxConfig,
} from "../src/core/config.js";

// ============================================================================
// Test Helpers
// ============================================================================

function createTestContext(): MacroContextImpl {
  const sourceText = "const x = 1;";
  const sourceFile = ts.createSourceFile(
    "test.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
  };

  const host = ts.createCompilerHost(options);
  const program = ts.createProgram(["test.ts"], options, {
    ...host,
    getSourceFile: (name) =>
      name === "test.ts"
        ? sourceFile
        : host.getSourceFile(name, ts.ScriptTarget.Latest),
  });

  const transformContext: ts.TransformationContext = {
    factory: ts.factory,
    getCompilerOptions: () => options,
    startLexicalEnvironment: () => {},
    suspendLexicalEnvironment: () => {},
    resumeLexicalEnvironment: () => {},
    endLexicalEnvironment: () => undefined,
    hoistFunctionDeclaration: () => {},
    hoistVariableDeclaration: () => {},
    requestEmitHelper: () => {},
    readEmitHelpers: () => undefined,
    enableSubstitution: () => {},
    enableEmitNotification: () => {},
    isSubstitutionEnabled: () => false,
    isEmitNotificationEnabled: () => false,
    onSubstituteNode: (_hint, node) => node,
    onEmitNode: (_hint, node, emitCallback) => emitCallback(_hint, node),
    addDiagnostic: () => {},
  };

  return createMacroContext(program, sourceFile, transformContext);
}

// ============================================================================
// config.get / config.set Tests
// ============================================================================

describe("config.get and config.set", () => {
  beforeEach(() => {
    config.reset();
  });

  afterEach(() => {
    config.reset();
  });

  it("should return default values", () => {
    expect(config.get("debug")).toBe(false);
    expect(config.get("contracts.mode")).toBe("full");
    expect(config.get("contracts.proveAtCompileTime")).toBe(false);
  });

  it("should set simple values", () => {
    config.set({ debug: true });
    expect(config.get("debug")).toBe(true);
  });

  it("should set nested values", () => {
    config.set({ contracts: { mode: "none" } });
    expect(config.get("contracts.mode")).toBe("none");
  });

  it("should merge nested values", () => {
    config.set({ contracts: { mode: "full" } });
    config.set({ contracts: { proveAtCompileTime: true } });
    expect(config.get("contracts.mode")).toBe("full");
    expect(config.get("contracts.proveAtCompileTime")).toBe(true);
  });

  it("should return undefined for non-existent paths", () => {
    expect(config.get("nonexistent")).toBeUndefined();
    expect(config.get("deeply.nested.path")).toBeUndefined();
  });

  it("should handle feature flags", () => {
    config.set({ features: { experimental: true, legacy: false } });
    expect(config.get("features.experimental")).toBe(true);
    expect(config.get("features.legacy")).toBe(false);
  });
});

// ============================================================================
// config.has Tests
// ============================================================================

describe("config.has", () => {
  beforeEach(() => {
    config.reset();
  });

  afterEach(() => {
    config.reset();
  });

  it("should return true for truthy values", () => {
    config.set({ debug: true });
    expect(config.has("debug")).toBe(true);
  });

  it("should return false for falsy values", () => {
    expect(config.has("debug")).toBe(false);
    config.set({ debug: false });
    expect(config.has("debug")).toBe(false);
  });

  it("should return false for undefined paths", () => {
    expect(config.has("nonexistent")).toBe(false);
  });

  it("should return true for truthy nested values", () => {
    config.set({ features: { experimental: true } });
    expect(config.has("features.experimental")).toBe(true);
  });
});

// ============================================================================
// config.getAll Tests
// ============================================================================

describe("config.getAll", () => {
  beforeEach(() => {
    config.reset();
  });

  afterEach(() => {
    config.reset();
  });

  it("should return all config values", () => {
    config.set({ debug: true, features: { test: true } });
    const all = config.getAll();
    expect(all.debug).toBe(true);
    expect(all.features).toEqual({ test: true });
  });

  it("should include defaults", () => {
    const all = config.getAll();
    expect(all.contracts).toBeDefined();
    expect(all.contracts?.mode).toBe("full");
  });
});

// ============================================================================
// config.evaluate Tests
// ============================================================================

describe("config.evaluate", () => {
  beforeEach(() => {
    config.reset();
  });

  afterEach(() => {
    config.reset();
  });

  it("should evaluate simple truthy paths", () => {
    config.set({ debug: true });
    expect(config.evaluate("debug")).toBe(true);
    expect(config.evaluate("production")).toBe(false);
  });

  it("should evaluate negation", () => {
    config.set({ debug: true });
    expect(config.evaluate("!debug")).toBe(false);
    expect(config.evaluate("!production")).toBe(true);
  });

  it("should evaluate AND expressions", () => {
    config.set({ debug: true, verbose: true });
    expect(config.evaluate("debug && verbose")).toBe(true);
    config.set({ verbose: false });
    expect(config.evaluate("debug && verbose")).toBe(false);
  });

  it("should evaluate OR expressions", () => {
    config.set({ debug: true, verbose: false });
    expect(config.evaluate("debug || verbose")).toBe(true);
    expect(config.evaluate("production || verbose")).toBe(false);
  });

  it("should evaluate equality", () => {
    config.set({ contracts: { mode: "full" } });
    expect(config.evaluate("contracts.mode == 'full'")).toBe(true);
    expect(config.evaluate("contracts.mode == 'none'")).toBe(false);
  });

  it("should evaluate inequality", () => {
    config.set({ contracts: { mode: "full" } });
    expect(config.evaluate("contracts.mode != 'none'")).toBe(true);
    expect(config.evaluate("contracts.mode != 'full'")).toBe(false);
  });

  it("should evaluate parenthesized expressions", () => {
    config.set({ debug: true, test: false, verbose: true });
    expect(config.evaluate("(debug || test) && verbose")).toBe(true);
    expect(config.evaluate("debug || (test && verbose)")).toBe(true);
    expect(config.evaluate("(debug && test) || verbose")).toBe(true);
    expect(config.evaluate("(debug && test) && verbose")).toBe(false);
  });

  it("should handle complex nested expressions", () => {
    config.set({ 
      debug: true, 
      contracts: { mode: "full" },
      features: { experimental: true }
    });
    expect(config.evaluate("debug && contracts.mode == 'full'")).toBe(true);
    expect(config.evaluate("!debug || features.experimental")).toBe(true);
    expect(config.evaluate("(debug && features.experimental) || contracts.mode == 'none'")).toBe(true);
  });
});

// ============================================================================
// config.when Tests
// ============================================================================

describe("config.when", () => {
  beforeEach(() => {
    config.reset();
  });

  afterEach(() => {
    config.reset();
  });

  it("should return thenValue when condition is true", () => {
    config.set({ debug: true });
    expect(config.when("debug", "yes", "no")).toBe("yes");
  });

  it("should return elseValue when condition is false", () => {
    config.set({ debug: false });
    expect(config.when("debug", "yes", "no")).toBe("no");
  });

  it("should return undefined when condition is false and no elseValue", () => {
    config.set({ debug: false });
    expect(config.when("debug", "yes")).toBeUndefined();
  });

  it("should call thenValue factory when condition is true", () => {
    config.set({ debug: true });
    let called = false;
    const result = config.when("debug", () => {
      called = true;
      return "computed";
    });
    expect(called).toBe(true);
    expect(result).toBe("computed");
  });

  it("should call elseValue factory when condition is false", () => {
    config.set({ debug: false });
    let thenCalled = false;
    let elseCalled = false;
    const result = config.when(
      "debug",
      () => { thenCalled = true; return "then"; },
      () => { elseCalled = true; return "else"; }
    );
    expect(thenCalled).toBe(false);
    expect(elseCalled).toBe(true);
    expect(result).toBe("else");
  });

  it("should not call factory when not needed", () => {
    config.set({ debug: true });
    let elseCalled = false;
    config.when(
      "debug",
      "yes",
      () => { elseCalled = true; return "no"; }
    );
    expect(elseCalled).toBe(false);
  });

  it("should work with complex conditions", () => {
    config.set({ debug: true, contracts: { mode: "full" } });
    expect(config.when("debug && contracts.mode == 'full'", "both", "not")).toBe("both");
  });
});

// ============================================================================
// defineConfig Helper Tests
// ============================================================================

describe("defineConfig", () => {
  it("should return the same config object", () => {
    const cfg: TtfxConfig = {
      debug: true,
      contracts: { mode: "none" },
    };
    const result = defineConfig(cfg);
    expect(result).toBe(cfg);
  });

  it("should work for type checking", () => {
    const cfg = defineConfig({
      debug: true,
      contracts: {
        mode: "full",
        proveAtCompileTime: true,
        strip: {
          preconditions: false,
        },
      },
      features: {
        experimental: true,
      },
    });
    expect(cfg.debug).toBe(true);
    expect(cfg.contracts?.mode).toBe("full");
  });
});

// ============================================================================
// Environment Variable Tests
// ============================================================================

describe("environment variable loading", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    config.reset();
  });

  afterEach(() => {
    // Restore original environment
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("TTFX_")) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
    config.reset();
  });

  it("should load TTFX_DEBUG=1 as true", () => {
    process.env.TTFX_DEBUG = "1";
    config.reset();
    expect(config.get("debug")).toBe(true);
  });

  it("should load TTFX_DEBUG=true as true", () => {
    process.env.TTFX_DEBUG = "true";
    config.reset();
    expect(config.get("debug")).toBe(true);
  });

  it("should load TTFX_DEBUG=0 as false", () => {
    process.env.TTFX_DEBUG = "0";
    config.reset();
    expect(config.get("debug")).toBe(false);
  });

  it("should load TTFX_CONTRACTS_MODE as nested value", () => {
    process.env.TTFX_CONTRACTS_MODE = "none";
    config.reset();
    expect(config.get("contracts.mode")).toBe("none");
  });

  it("should load double underscore as deeper nesting", () => {
    process.env.TTFX_CONTRACTS__STRIP__PRECONDITIONS = "1";
    config.reset();
    expect(config.get("contracts.strip.preconditions")).toBe(true);
  });

  it("should parse numeric values", () => {
    process.env.TTFX_CUSTOM_NUMBER = "42";
    config.reset();
    expect(config.get("custom.number")).toBe(42);
  });

  it("should keep string values as strings", () => {
    process.env.TTFX_CUSTOM_VALUE = "hello";
    config.reset();
    expect(config.get("custom.value")).toBe("hello");
  });
});

// ============================================================================
// config.reset Tests
// ============================================================================

describe("config.reset", () => {
  it("should reset config to defaults", () => {
    config.set({ debug: true, custom: "value" });
    expect(config.get("debug")).toBe(true);
    expect(config.get("custom")).toBe("value");
    
    config.reset();
    
    expect(config.get("debug")).toBe(false);
    expect(config.get("custom")).toBeUndefined();
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("edge cases", () => {
  beforeEach(() => {
    config.reset();
  });

  afterEach(() => {
    config.reset();
  });

  it("should handle empty condition strings", () => {
    expect(config.evaluate("")).toBe(false);
  });

  it("should handle whitespace in conditions", () => {
    config.set({ debug: true });
    expect(config.evaluate("  debug  ")).toBe(true);
    expect(config.evaluate("debug  &&  debug")).toBe(true);
  });

  it("should handle deeply nested config", () => {
    config.set({ 
      a: { 
        b: { 
          c: { 
            d: true 
          } 
        } 
      } 
    });
    expect(config.get("a.b.c.d")).toBe(true);
    expect(config.has("a.b.c.d")).toBe(true);
  });

  it("should return config reference (Readonly at type level)", () => {
    config.set({ debug: true });
    const all = config.getAll();
    // Note: Readonly<T> provides TypeScript compile-time protection only
    // Runtime mutation is possible but not recommended
    expect(all.debug).toBe(true);
    expect(all.contracts?.mode).toBe("full");
  });
});
