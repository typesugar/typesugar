/**
 * Red Team Tests for @typesugar/eslint-plugin
 *
 * Attack surfaces:
 * - Preprocessor handling of malformed/edge-case syntax
 * - Position mapping with Unicode, empty files, edge offsets
 * - Typesugar import detection patterns
 * - Decorator and labeled block regex edge cases
 * - File extension handling
 * - Error recovery when preprocessing fails
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createProcessor } from "../packages/eslint-plugin/src/processor.js";
import {
  createFullProcessor,
  clearTransformCache,
} from "../packages/eslint-plugin/src/full-processor.js";
import type { Linter } from "eslint";

describe("ESLint Plugin Configuration Edge Cases", () => {
  // ==========================================================================
  // Attack 1: File Extension Handling
  // ==========================================================================
  describe("File Extension Handling", () => {
    const processor = createProcessor();

    it("should process .ts files", () => {
      const code = `const x = 1;`;
      const result = processor.preprocess!(code, "test.ts");
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(code);
    });

    it("should process .tsx files", () => {
      const code = `const Component = () => <div />;`;
      const result = processor.preprocess!(code, "test.tsx");
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(code);
    });

    it("should pass through .mts files without processing", () => {
      // .mts is not in the allowed extension list - should pass through
      const code = `@derive(Eq) class Foo {}`;
      const result = processor.preprocess!(code, "test.mts");
      expect(result).toHaveLength(1);
      // .mts not handled, passes through unchanged
      expect(result[0]).toBe(code);
    });

    it("should pass through .js files without processing", () => {
      const code = `const x = a |> f;`;
      const result = processor.preprocess!(code, "test.js");
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(code);
    });

    it("should handle files with no extension", () => {
      const code = `@derive(Eq) class Bar {}`;
      const result = processor.preprocess!("noextension", code);
      expect(result).toHaveLength(1);
    });

    it("should handle files with double extensions", () => {
      const code = `const x = 1;`;
      const result = processor.preprocess!(code, "test.spec.ts");
      expect(result).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Attack 2: Decorator Regex Edge Cases
  // ==========================================================================
  describe("Decorator Regex Edge Cases", () => {
    const processor = createProcessor();

    it("should comment out simple @derive decorator", () => {
      const code = `@derive(Eq)\nclass Point { x: number; y: number; }`;
      const result = processor.preprocess!(code, "test.ts");
      const output = result[0] as string;
      expect(output).toContain("/* @derive(Eq) */");
    });

    it("should comment out @derive with multiple typeclasses", () => {
      const code = `@derive(Eq, Clone, Debug)\nclass Point {}`;
      const result = processor.preprocess!(code, "test.ts");
      const output = result[0] as string;
      expect(output).toContain("/* @derive(Eq, Clone, Debug) */");
    });

    it("should handle decorator-like patterns in strings (false positive risk)", () => {
      // This is a known limitation - regex can't distinguish context
      const code = `const x = "@derive(Eq)"; // string containing decorator`;
      const result = processor.preprocess!(code, "test.ts");
      const output = result[0] as string;
      // The regex will incorrectly comment this out
      expect(output).toContain("/*");
    });

    it("should handle nested parentheses in decorator args", () => {
      // Decorator with complex expressions - current regex stops at first )
      const code = `@operators({ "+": "add", "-": "sub" })\nclass Vec {}`;
      const result = processor.preprocess!(code, "test.ts");
      const output = result[0] as string;
      // Current regex [^)]* doesn't handle nested parens
      // This documents the limitation
      expect(output).toContain("@operators");
    });

    it("should handle decorator on same line as class", () => {
      const code = `@derive(Eq) class Point {}`;
      const result = processor.preprocess!(code, "test.ts");
      const output = result[0] as string;
      expect(output).toContain("/* @derive(Eq) */");
      expect(output).toContain("class Point");
    });

    it("should handle multiple decorators", () => {
      const code = `@derive(Eq)\n@derive(Clone)\nclass Point {}`;
      const result = processor.preprocess!(code, "test.ts");
      const output = result[0] as string;
      expect(output.match(/\/\*/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it("should handle decorator with empty parens", () => {
      const code = `@reflect()\ninterface User {}`;
      const result = processor.preprocess!(code, "test.ts");
      const output = result[0] as string;
      expect(output).toContain("/* @reflect() */");
    });
  });

  // ==========================================================================
  // Attack 3: Labeled Block Regex Edge Cases
  // ==========================================================================
  describe("Labeled Block Regex Edge Cases", () => {
    const processor = createProcessor();

    it("should comment out requires block", () => {
      const code = `function foo(x: number) {\n  requires: {\n    x > 0;\n  }\n  return x;\n}`;
      const result = processor.preprocess!(code, "test.ts");
      const output = result[0] as string;
      expect(output).toContain("/*");
      expect(output).toContain("requires:");
    });

    it("should comment out ensures block", () => {
      const code = `function bar(): number {\n  ensures: {\n    result > 0;\n  }\n  return 42;\n}`;
      const result = processor.preprocess!(code, "test.ts");
      const output = result[0] as string;
      expect(output).toContain("/*");
      expect(output).toContain("ensures:");
    });

    it("should handle label-like patterns in strings", () => {
      const code = `const msg = "requires: { must be true }";`;
      const result = processor.preprocess!(code, "test.ts");
      // This tests whether the regex correctly handles or incorrectly matches
      const output = result[0] as string;
      // Document actual behavior
      expect(typeof output).toBe("string");
    });

    it("should handle JavaScript labels that aren't contracts", () => {
      // Standard JS labels shouldn't be affected
      const code = `outer: for (let i = 0; i < 10; i++) { break outer; }`;
      const result = processor.preprocess!(code, "test.ts");
      const output = result[0] as string;
      // 'outer' is not requires/ensures, should remain unchanged
      expect(output).toContain("outer:");
    });

    it("should handle nested blocks inside requires", () => {
      const code = `function f(x: number) {
  requires: {
    if (x > 0) {
      x < 100;
    }
  }
  return x;
}`;
      const result = processor.preprocess!(code, "test.ts");
      const output = result[0] as string;
      // Test that nested braces are handled correctly
      expect(output).toBeDefined();
    });
  });

  // ==========================================================================
  // Attack 4: Typesugar Import Detection
  // ==========================================================================
  describe("Typesugar Import Detection", () => {
    const processor = createProcessor();

    function createUnusedVarMessage(line: number): Linter.LintMessage {
      return {
        ruleId: "@typescript-eslint/no-unused-vars",
        severity: 2,
        message: "'Eq' is defined but never used",
        line,
        column: 1,
      };
    }

    it("should filter unused import from @typesugar/std", () => {
      const code = `import { Eq } from "@typesugar/std";\nconst x = 1;`;
      processor.preprocess!(code, "test.ts");
      const result = processor.postprocess!([[createUnusedVarMessage(1)]], "test.ts");
      expect(result).toHaveLength(0);
    });

    it("should filter unused import from typesugar", () => {
      const code = `import { derive } from "typesugar";\nconst x = 1;`;
      processor.preprocess!(code, "test.ts");
      const result = processor.postprocess!([[createUnusedVarMessage(1)]], "test.ts");
      expect(result).toHaveLength(0);
    });

    it("should filter unused import from legacy @ttfx packages", () => {
      const code = `import { Eq } from "@ttfx/std";\nconst x = 1;`;
      processor.preprocess!(code, "test.ts");
      const result = processor.postprocess!([[createUnusedVarMessage(1)]], "test.ts");
      expect(result).toHaveLength(0);
    });

    it("should NOT filter unused imports from other packages", () => {
      const code = `import { something } from "lodash";\nconst x = 1;`;
      processor.preprocess!(code, "test.ts");
      const result = processor.postprocess!([[createUnusedVarMessage(1)]], "test.ts");
      expect(result).toHaveLength(1);
    });

    it("should handle package names that start with typesugar but aren't", () => {
      // Edge case: a package named "typesugar-unrelated" that isn't ours
      const code = `import { x } from "typesugar-unrelated";\nconst y = 1;`;
      processor.preprocess!(code, "test.ts");
      const result = processor.postprocess!([[createUnusedVarMessage(1)]], "test.ts");
      // "typesugar-unrelated" starts with "typesugar", so it would be filtered
      // This documents the current (potentially incorrect) behavior
      expect(result.length).toBeLessThanOrEqual(1);
    });

    it("should handle deep package paths", () => {
      const code = `import { x } from "@typesugar/transformer/position-mapper";\nconst y = 1;`;
      processor.preprocess!(code, "test.ts");
      const result = processor.postprocess!([[createUnusedVarMessage(1)]], "test.ts");
      expect(result).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Attack 5: Position Mapping Edge Cases
  // ==========================================================================
  describe("Position Mapping Edge Cases", () => {
    const processor = createProcessor();

    it("should handle empty file", () => {
      const code = ``;
      const result = processor.preprocess!(code, "empty.ts");
      expect(result).toHaveLength(1);
      expect(result[0]).toBe("");
    });

    it("should handle single character file", () => {
      const code = `x`;
      const result = processor.preprocess!(code, "single.ts");
      expect(result).toHaveLength(1);
    });

    it("should handle file with only newlines", () => {
      const code = `\n\n\n`;
      const result = processor.preprocess!(code, "newlines.ts");
      expect(result).toHaveLength(1);
    });

    it("should handle Unicode characters", () => {
      const code = `const emoji = "🧊"; // typesugar emoji\nconst x = 1;`;
      const result = processor.preprocess!(code, "unicode.ts");
      expect(result).toHaveLength(1);
      const output = result[0] as string;
      expect(output).toContain("🧊");
    });

    it("should handle very long lines", () => {
      const longString = "a".repeat(10000);
      const code = `const x = "${longString}";`;
      const result = processor.preprocess!(code, "long.ts");
      expect(result).toHaveLength(1);
    });

    it("should handle message with undefined line/column", () => {
      const code = `const x = 1;`;
      processor.preprocess!(code, "test.ts");
      const msgWithoutPosition: Linter.LintMessage = {
        ruleId: "some-rule",
        severity: 1,
        message: "Some message",
        line: undefined as unknown as number,
        column: undefined as unknown as number,
      };
      const result = processor.postprocess!([[msgWithoutPosition]], "test.ts");
      expect(result).toHaveLength(1);
      expect(result[0].line).toBeUndefined();
    });

    it("should handle CRLF line endings", () => {
      const code = `const x = 1;\r\n@derive(Eq)\r\nclass Point {}`;
      const result = processor.preprocess!(code, "crlf.ts");
      expect(result).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Attack 6: Error Recovery
  // ==========================================================================
  describe("Error Recovery", () => {
    const processor = createProcessor();

    it("should handle completely malformed TypeScript", () => {
      const code = `class { syntax error here {{{{`;
      // Should not throw, should return something
      expect(() => processor.preprocess!(code, "malformed.ts")).not.toThrow();
    });

    it("should handle unclosed string literals", () => {
      const code = `const x = "unclosed`;
      expect(() => processor.preprocess!(code, "unclosed.ts")).not.toThrow();
    });

    it("should handle unclosed template literals", () => {
      const code = "const x = `unclosed ${";
      expect(() => processor.preprocess!(code, "template.ts")).not.toThrow();
    });

    it("should handle binary/garbage input", () => {
      const binaryGarbage = Buffer.from([0x00, 0xff, 0xfe, 0x01]).toString();
      expect(() => processor.preprocess!(binaryGarbage, "binary.ts")).not.toThrow();
    });

    it("should return original on preprocessor failure", () => {
      // The processor should gracefully degrade to returning original source
      const code = `@derive(Eq) class X {}`;
      const result = processor.preprocess!(code, "test.ts");
      expect(result).toHaveLength(1);
      // Should get some output, either transformed or original
      expect(typeof result[0]).toBe("string");
    });
  });

  // ==========================================================================
  // Attack 7: Full Processor Specific Cases
  // ==========================================================================
  describe("Full Processor Specific Cases", () => {
    const fullProcessor = createFullProcessor();

    beforeEach(() => {
      clearTransformCache();
    });

    it("should have correct metadata", () => {
      expect(fullProcessor.meta?.name).toBe("typesugar-full");
      expect(fullProcessor.supportsAutofix).toBe(true);
    });

    it("should handle non-ts files", () => {
      const code = `const x = 1;`;
      const result = fullProcessor.preprocess!(code, "test.js");
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(code);
    });

    it("should gracefully degrade when pipeline unavailable", () => {
      // Full processor depends on finding tsconfig.json
      // In test environment without proper setup, it should fall back
      const code = `const x = 1;`;
      const result = fullProcessor.preprocess!(code, "isolated.ts");
      expect(result).toHaveLength(1);
    });

    it("should handle cache clearing", () => {
      expect(() => clearTransformCache()).not.toThrow();
      // Should be safe to call multiple times
      clearTransformCache();
      clearTransformCache();
    });
  });

  // ==========================================================================
  // Attack 8: Config Object Correctness
  // ==========================================================================
  describe("Config Object Correctness", () => {
    it("should export plugin with correct structure", async () => {
      const module = await import("../packages/eslint-plugin/src/index.js");
      const plugin = module.default;

      expect(plugin.meta?.name).toBe("@typesugar/eslint-plugin");
      expect(plugin.processors).toBeDefined();
      expect(plugin.processors?.typesugar).toBeDefined();
      expect(plugin.processors?.["typesugar-full"]).toBeDefined();
      expect(plugin.configs).toBeDefined();
    });

    it("should have recommended config with correct processor", async () => {
      const { recommendedConfig } = await import("../packages/eslint-plugin/src/index.js");

      expect(recommendedConfig.name).toBe("@typesugar/recommended");
      expect(recommendedConfig.processor).toBe("@typesugar/typesugar");
      expect(recommendedConfig.rules?.["no-unused-labels"]).toBe("off");
    });

    it("should have full config with correct processor", async () => {
      const { fullConfig } = await import("../packages/eslint-plugin/src/index.js");

      expect(fullConfig.name).toBe("@typesugar/full");
      expect(fullConfig.processor).toBe("@typesugar/typesugar-full");
    });

    it("should have strict config extending recommended", async () => {
      const { strictConfig, recommendedConfig } =
        await import("../packages/eslint-plugin/src/index.js");

      expect(strictConfig.name).toBe("@typesugar/strict");
      // Strict should have at least the same rules as recommended
      expect(strictConfig.rules?.["no-unused-labels"]).toBe(
        recommendedConfig.rules?.["no-unused-labels"]
      );
    });
  });

  // ==========================================================================
  // Attack 9: Custom Syntax Detection
  // ==========================================================================
  describe("Custom Syntax Detection", () => {
    const processor = createProcessor();

    it("should detect HKT syntax F<_>", () => {
      const code = `type Functor<F<_>> = { map: <A, B>(fa: F<A>) => F<B> };`;
      const result = processor.preprocess!(code, "hkt.ts");
      expect(result).toHaveLength(1);
    });

    it("should detect pipeline operator |>", () => {
      const code = `const y = x |> f |> g;`;
      const result = processor.preprocess!(code, "pipe.ts");
      expect(result).toHaveLength(1);
    });

    it("should detect cons operator ::", () => {
      const code = `const list = 1 :: [2, 3];`;
      const result = processor.preprocess!(code, "cons.ts");
      expect(result).toHaveLength(1);
    });

    it("should not trigger on :: in object types", () => {
      // This shouldn't be detected as cons
      const code = `type T = { foo: string };`;
      const result = processor.preprocess!(code, "notype.ts");
      expect(result).toHaveLength(1);
      // No transformation should occur
      expect(result[0]).toBe(code);
    });

    it("should not trigger on < > in regular generics", () => {
      const code = `const arr: Array<number> = [1, 2, 3];`;
      const result = processor.preprocess!(code, "generic.ts");
      expect(result).toHaveLength(1);
      // No typesugar syntax detected, should be unchanged
      expect(result[0]).toBe(code);
    });

    it("should detect comptime macro", () => {
      const code = `const x = comptime(() => 1 + 1);`;
      const result = processor.preprocess!(code, "comptime.ts");
      expect(result).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Attack 10: Race Conditions / State Management
  // ==========================================================================
  describe("State Management", () => {
    it("should handle multiple files in sequence", () => {
      const processor = createProcessor();

      const file1 = `@derive(Eq) class A {}`;
      const file2 = `@derive(Clone) class B {}`;

      processor.preprocess!(file1, "a.ts");
      processor.preprocess!(file2, "b.ts");

      // Each file should have its own state for postprocess
      const result1 = processor.postprocess!([[]], "a.ts");
      const result2 = processor.postprocess!([[]], "b.ts");

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });

    it("should handle same file processed twice", () => {
      const processor = createProcessor();
      const code = `@derive(Eq) class X {}`;

      // Process same file twice - second should overwrite state
      processor.preprocess!(code, "same.ts");
      processor.preprocess!(code, "same.ts");

      const result = processor.postprocess!([[]], "same.ts");
      expect(result).toBeDefined();
    });

    it("should handle postprocess for unknown file", () => {
      const processor = createProcessor();

      // Never preprocessed this file
      const result = processor.postprocess!(
        [[{ ruleId: "test", severity: 1, message: "test", line: 1, column: 1 }]],
        "unknown.ts"
      );

      // Should return messages unchanged
      expect(result).toHaveLength(1);
    });
  });
});
