/**
 * Performance benchmarks for the macro system.
 *
 * Measures hot-path performance of:
 * 1. AST evaluator (lightweight comptime)
 * 2. VM-based comptime evaluation
 * 3. Macro symbol resolution
 * 4. Module specifier resolution
 * 5. Import cleanup
 * 6. Full transformer pipeline
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext } from "@typesugar/core";
import { globalRegistry } from "@typesugar/core";

// Import macros so they register
import "@typesugar/macros";

function createTestContext(sourceText: string): MacroContextImpl {
  const sourceFile = ts.createSourceFile(
    "bench.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  };

  const host = ts.createCompilerHost(options);
  const program = ts.createProgram(["bench.ts"], options, {
    ...host,
    getSourceFile: (name) =>
      name === "bench.ts" ? sourceFile : host.getSourceFile(name, ts.ScriptTarget.Latest),
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

function bench(
  name: string,
  fn: () => void,
  iterations: number = 10_000
): { opsPerSec: number; avgMs: number } {
  // Warmup
  for (let i = 0; i < Math.min(100, iterations / 10); i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;

  const avgMs = elapsed / iterations;
  const opsPerSec = Math.round(1000 / avgMs);

  return { opsPerSec, avgMs };
}

// Skip benchmarks in CI - they have hardcoded thresholds that are machine-dependent
// Run locally with: pnpm vitest run benchmark
describe.skipIf(process.env.CI)("Performance benchmarks", () => {
  let ctx: MacroContextImpl;

  beforeAll(() => {
    ctx = createTestContext("const x = 1;");
  });

  describe("AST evaluator (lightweight comptime)", () => {
    it("numeric literal evaluation", () => {
      const node = ts.factory.createNumericLiteral(42);
      const result = bench("numeric literal", () => ctx.evaluate(node));
      console.log(
        `  numeric literal: ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(100_000);
    });

    it("binary arithmetic evaluation", () => {
      const node = ts.factory.createBinaryExpression(
        ts.factory.createNumericLiteral(5),
        ts.SyntaxKind.PlusToken,
        ts.factory.createNumericLiteral(3)
      );
      const result = bench("binary arithmetic", () => ctx.evaluate(node));
      console.log(
        `  binary arithmetic: ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(30_000);
    });

    it("nested arithmetic evaluation", () => {
      // (2 + 3) * (4 - 1) + 10 / 2
      const node = ts.factory.createBinaryExpression(
        ts.factory.createBinaryExpression(
          ts.factory.createParenthesizedExpression(
            ts.factory.createBinaryExpression(
              ts.factory.createNumericLiteral(2),
              ts.SyntaxKind.PlusToken,
              ts.factory.createNumericLiteral(3)
            )
          ),
          ts.SyntaxKind.AsteriskToken,
          ts.factory.createParenthesizedExpression(
            ts.factory.createBinaryExpression(
              ts.factory.createNumericLiteral(4),
              ts.SyntaxKind.MinusToken,
              ts.factory.createNumericLiteral(1)
            )
          )
        ),
        ts.SyntaxKind.PlusToken,
        ts.factory.createBinaryExpression(
          ts.factory.createNumericLiteral(10),
          ts.SyntaxKind.SlashToken,
          ts.factory.createNumericLiteral(2)
        )
      );
      const result = bench("nested arithmetic", () => ctx.evaluate(node));
      console.log(
        `  nested arithmetic: ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(5_000);
    });

    it("array literal evaluation", () => {
      const node = ts.factory.createArrayLiteralExpression(
        Array.from({ length: 20 }, (_, i) => ts.factory.createNumericLiteral(i))
      );
      const result = bench("array literal (20 elements)", () => ctx.evaluate(node));
      console.log(
        `  array literal (20 elements): ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(5_000);
    });

    it("object literal evaluation", () => {
      const node = ts.factory.createObjectLiteralExpression(
        Array.from({ length: 10 }, (_, i) =>
          ts.factory.createPropertyAssignment(`prop${i}`, ts.factory.createNumericLiteral(i))
        )
      );
      const result = bench("object literal (10 props)", () => ctx.evaluate(node));
      console.log(
        `  object literal (10 props): ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(5_000);
    });

    it("string concatenation chain", () => {
      let node: ts.Expression = ts.factory.createStringLiteral("a");
      for (let i = 0; i < 10; i++) {
        node = ts.factory.createBinaryExpression(
          node,
          ts.SyntaxKind.PlusToken,
          ts.factory.createStringLiteral(String.fromCharCode(98 + i))
        );
      }
      const result = bench("string concat (10 ops)", () => ctx.evaluate(node));
      console.log(
        `  string concat (10 ops): ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(5_000);
    });

    it("ternary expression evaluation", () => {
      const node = ts.factory.createConditionalExpression(
        ts.factory.createBinaryExpression(
          ts.factory.createNumericLiteral(5),
          ts.SyntaxKind.GreaterThanToken,
          ts.factory.createNumericLiteral(3)
        ),
        ts.factory.createToken(ts.SyntaxKind.QuestionToken),
        ts.factory.createStringLiteral("yes"),
        ts.factory.createToken(ts.SyntaxKind.ColonToken),
        ts.factory.createStringLiteral("no")
      );
      const result = bench("ternary expression", () => ctx.evaluate(node));
      console.log(
        `  ternary expression: ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(10_000);
    });
  });

  describe("Registry lookups", () => {
    it("expression macro lookup by name", () => {
      const result = bench(
        "expression lookup",
        () => {
          globalRegistry.getExpression("comptime");
        },
        100_000
      );
      console.log(
        `  expression lookup: ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(1_000_000);
    });

    it("module-scoped macro lookup", () => {
      const result = bench(
        "module-scoped lookup",
        () => {
          globalRegistry.getByModuleExport("typesugar", "comptime");
        },
        100_000
      );
      console.log(
        `  module-scoped lookup: ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(1_000_000);
    });

    it("derive macro lookup (miss)", () => {
      const result = bench(
        "derive lookup (miss)",
        () => {
          globalRegistry.getDerive("NonExistent");
        },
        100_000
      );
      console.log(
        `  derive lookup (miss): ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(1_000_000);
    });
  });

  describe("parseExpression", () => {
    it("simple expression parsing", () => {
      const result = bench(
        "parse simple expr",
        () => {
          ctx.parseExpression("1 + 2");
        },
        1_000
      );
      console.log(
        `  parse simple expr: ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(500);
    });

    it("complex expression parsing", () => {
      const result = bench(
        "parse complex expr",
        () => {
          ctx.parseExpression('Show.summon<Point>("Point").show(p, extra)');
        },
        1_000
      );
      console.log(
        `  parse complex expr: ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(500);
    });
  });

  describe("ComptimeValue to Expression conversion", () => {
    it("primitive value conversion", () => {
      const result = bench("primitive conversion", () => {
        ctx.comptimeValueToExpression({ kind: "number", value: 42 });
        ctx.comptimeValueToExpression({ kind: "string", value: "hello" });
        ctx.comptimeValueToExpression({ kind: "boolean", value: true });
      });
      console.log(
        `  primitive conversion (3 types): ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(100_000);
    });

    it("nested object conversion", () => {
      const props = new Map<string, import("../src/core/types.js").ComptimeValue>();
      for (let i = 0; i < 10; i++) {
        props.set(`key${i}`, { kind: "number", value: i });
      }
      const value: import("../src/core/types.js").ComptimeValue = {
        kind: "object",
        properties: props,
      };
      const result = bench("nested object conversion (10 props)", () => {
        ctx.comptimeValueToExpression(value);
      });
      console.log(
        `  nested object conversion (10 props): ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(10_000);
    });
  });

  describe("isComptime check", () => {
    it("simple literal check", () => {
      const node = ts.factory.createNumericLiteral(42);
      const result = bench("isComptime literal", () => ctx.isComptime(node));
      console.log(
        `  isComptime literal: ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(100_000);
    });

    it("nested expression check", () => {
      const node = ts.factory.createBinaryExpression(
        ts.factory.createBinaryExpression(
          ts.factory.createNumericLiteral(1),
          ts.SyntaxKind.PlusToken,
          ts.factory.createNumericLiteral(2)
        ),
        ts.SyntaxKind.AsteriskToken,
        ts.factory.createNumericLiteral(3)
      );
      const result = bench("isComptime nested", () => ctx.isComptime(node));
      console.log(
        `  isComptime nested: ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(10_000);
    });

    it("array of literals check", () => {
      const node = ts.factory.createArrayLiteralExpression(
        Array.from({ length: 50 }, (_, i) => ts.factory.createNumericLiteral(i))
      );
      const result = bench("isComptime array (50 elements)", () => ctx.isComptime(node));
      console.log(
        `  isComptime array (50 elements): ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(5_000);
    });
  });

  describe("ts.factory node creation", () => {
    it("createIdentifier (the bottleneck in safeRef)", () => {
      const result = bench(
        "createIdentifier",
        () => {
          ts.factory.createIdentifier("someName");
        },
        100_000
      );
      console.log(
        `  createIdentifier: ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(100_000);
    });

    it("createNumericLiteral", () => {
      const result = bench(
        "createNumericLiteral",
        () => {
          ts.factory.createNumericLiteral(42);
        },
        100_000
      );
      console.log(
        `  createNumericLiteral: ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(100_000);
    });

    it("createStringLiteral", () => {
      const result = bench(
        "createStringLiteral",
        () => {
          ts.factory.createStringLiteral("hello");
        },
        100_000
      );
      console.log(
        `  createStringLiteral: ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(100_000);
    });
  });

  describe("Reference Hygiene (safeRef)", () => {
    it("Tier 0: known global (Error)", () => {
      const result = bench("safeRef tier0", () => ctx.safeRef("Error", "@typesugar/std"), 50_000);
      console.log(
        `  safeRef tier0 (global): ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(500_000);
    });

    it("Tier 1: same module import (no conflict)", () => {
      // Create a context with imports
      const sourceWithImports = `
        import { Eq, Ord, Show } from "@typesugar/std";
        import { Option } from "@typesugar/fp";
        const x = 1;
      `;
      const ctxWithImports = createTestContext(sourceWithImports);
      const result = bench(
        "safeRef tier1",
        () => ctxWithImports.safeRef("Eq", "@typesugar/std"),
        50_000
      );
      console.log(
        `  safeRef tier1 (same module): ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(300_000);
    });

    it("Tier 2: no conflict (name not in scope)", () => {
      const result = bench(
        "safeRef tier2",
        () => ctx.safeRef("SomeUnusedName", "@typesugar/std"),
        50_000
      );
      console.log(
        `  safeRef tier2 (not in scope): ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(300_000);
    });

    it("Conflict path: local declaration shadows", () => {
      // Create a context where "Eq" is a local declaration
      const sourceWithLocalEq = `
        const Eq = 42;
        const x = 1;
      `;
      const ctxWithLocalEq = createTestContext(sourceWithLocalEq);
      // First call creates the alias
      ctxWithLocalEq.safeRef("Eq", "@typesugar/std");
      // Subsequent calls should hit the dedup cache
      const result = bench(
        "safeRef conflict (dedup)",
        () => ctxWithLocalEq.safeRef("Eq", "@typesugar/std"),
        50_000
      );
      console.log(
        `  safeRef conflict (dedup): ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(300_000);
    });

    it("FileBindingCache construction (small file)", () => {
      const smallSource = `
        import { a, b, c } from "module-a";
        import { d, e } from "module-b";
        const x = 1;
        function foo() {}
        class Bar {}
      `;
      const sourceFile = ts.createSourceFile(
        "small.ts",
        smallSource,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      );
      const { FileBindingCache } = require("@typesugar/core");
      const result = bench(
        "FileBindingCache small",
        () => new FileBindingCache(sourceFile),
        10_000
      );
      console.log(
        `  FileBindingCache small (5 imports, 3 decls): ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(10_000);
    });

    it("FileBindingCache construction (medium file)", () => {
      const imports = Array.from(
        { length: 50 },
        (_, i) => `import { sym${i} } from "mod${i}";`
      ).join("\n");
      const decls = Array.from({ length: 20 }, (_, i) => `const decl${i} = ${i};`).join("\n");
      const mediumSource = `${imports}\n${decls}`;
      const sourceFile = ts.createSourceFile(
        "medium.ts",
        mediumSource,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      );
      const { FileBindingCache } = require("@typesugar/core");
      const result = bench(
        "FileBindingCache medium",
        () => new FileBindingCache(sourceFile),
        5_000
      );
      console.log(
        `  FileBindingCache medium (50 imports, 20 decls): ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(2_000);
    });

    it("FileBindingCache construction (large file)", () => {
      const imports = Array.from(
        { length: 100 },
        (_, i) => `import { sym${i} } from "mod${i}";`
      ).join("\n");
      const decls = Array.from({ length: 50 }, (_, i) => `const decl${i} = ${i};`).join("\n");
      const largeSource = `${imports}\n${decls}`;
      const sourceFile = ts.createSourceFile(
        "large.ts",
        largeSource,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      );
      const { FileBindingCache } = require("@typesugar/core");
      const result = bench("FileBindingCache large", () => new FileBindingCache(sourceFile), 2_000);
      console.log(
        `  FileBindingCache large (100 imports, 50 decls): ${result.opsPerSec.toLocaleString()} ops/sec (${(result.avgMs * 1000).toFixed(2)}μs/op)`
      );
      expect(result.opsPerSec).toBeGreaterThan(500);
    });
  });
});
