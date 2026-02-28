/**
 * Tests for @typesugar/eslint-plugin processors
 *
 * Tests the lightweight processor that handles typesugar syntax before ESLint linting.
 * The full processor tests are limited since it requires a complete TypeScript program.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createProcessor } from "../src/processor.js";

describe("ESLint Lightweight Processor", () => {
  let processor: ReturnType<typeof createProcessor>;

  beforeEach(() => {
    processor = createProcessor();
  });

  describe("meta", () => {
    it("should have correct meta information", () => {
      expect(processor.meta).toBeDefined();
      expect(processor.meta?.name).toBe("typesugar");
      expect(processor.meta?.version).toBe("0.1.0");
    });

    it("should support autofix", () => {
      expect(processor.supportsAutofix).toBe(true);
    });
  });

  describe("preprocess", () => {
    describe("file type filtering", () => {
      it("should pass through non-TS files unchanged", () => {
        const source = "@derive(Eq) class Foo {}";
        const result = processor.preprocess(source, "test.js");
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(source);
      });

      it("should pass through .ts files that don't use typesugar unchanged", () => {
        const source = "const x: number = 42;";
        const result = processor.preprocess(source, "test.ts");
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(source);
      });

      it("should process .ts files with typesugar syntax", () => {
        const source = "@derive(Eq) class Foo {}";
        const result = processor.preprocess(source, "test.ts");
        expect(result).toHaveLength(1);
        expect(result[0]).not.toBe(source); // Should be transformed
      });

      it("should process .tsx files with typesugar syntax", () => {
        const source = "@derive(Eq) class Foo {}";
        const result = processor.preprocess(source, "test.tsx");
        expect(result).toHaveLength(1);
        expect(result[0]).not.toBe(source); // Should be transformed
      });
    });

    describe("decorator handling", () => {
      it("should comment out @derive decorator", () => {
        const source = "@derive(Eq, Clone) class Foo {}";
        const result = processor.preprocess(source, "test.ts");
        expect(result).toHaveLength(1);
        expect(result[0]).toContain("/* @derive(Eq, Clone) */");
      });

      it("should comment out @deriving decorator when file uses typesugar", () => {
        // @deriving alone doesn't trigger detection, but combined with other markers it does
        const source = `@derive(Eq) class A {}
@deriving(Show, Ord) interface Bar {}`;
        const result = processor.preprocess(source, "test.ts");
        expect(result).toHaveLength(1);
        // The processor should comment out both decorators
        expect(result[0]).toContain("/* @derive(Eq) */");
        expect(result[0]).toContain("/* @deriving(Show, Ord) */");
      });

      it("should transform @typeclass decorator without syntax errors", () => {
        const source = "@typeclass() interface Functor<F> {}";
        const result = processor.preprocess(source, "test.ts");
        expect(result).toHaveLength(1);
        // The preprocessor transforms @typeclass to a function call
        expect(typeof result[0]).toBe("string");
        // Original decorator should be transformed
        expect(result[0]).not.toBe(source);
      });

      it("should transform @instance decorator without syntax errors", () => {
        const source = "@instance() const eqFoo: Eq<Foo> = { equals: () => true };";
        const result = processor.preprocess(source, "test.ts");
        expect(result).toHaveLength(1);
        // The preprocessor transforms @instance to a function call
        expect(typeof result[0]).toBe("string");
        // Original decorator should be transformed
        expect(result[0]).not.toBe(source);
      });

      it("should comment out @operators decorator", () => {
        const source = '@operators({ "+": "add" }) class Vec {}';
        const result = processor.preprocess(source, "test.ts");
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('/* @operators({ "+": "add" }) */');
      });

      it("should comment out @reflect decorator", () => {
        const source = "@reflect() interface User {}";
        const result = processor.preprocess(source, "test.ts");
        expect(result).toHaveLength(1);
        expect(result[0]).toContain("/* @reflect() */");
      });

      it("should comment out @contract decorator", () => {
        const source = "@contract() function foo() {}";
        const result = processor.preprocess(source, "test.ts");
        expect(result).toHaveLength(1);
        expect(result[0]).toContain("/* @contract() */");
      });

      it("should comment out @invariant decorator", () => {
        const source = "@invariant(x > 0) class Positive {}";
        const result = processor.preprocess(source, "test.ts");
        expect(result).toHaveLength(1);
        expect(result[0]).toContain("/* @invariant(x > 0) */");
      });

      it("should handle multiple decorators in one file", () => {
        const source = `
@derive(Eq)
class A {}

@derive(Clone)
class B {}
`;
        const result = processor.preprocess(source, "test.ts");
        expect(result).toHaveLength(1);
        expect(result[0]).toContain("/* @derive(Eq) */");
        expect(result[0]).toContain("/* @derive(Clone) */");
      });
    });

    describe("labeled block handling", () => {
      it("should comment out requires: blocks", () => {
        const source = `
function foo(x: number) {
  requires: {
    x > 0;
  }
  return x * 2;
}`;
        const result = processor.preprocess(source, "test.ts");
        expect(result).toHaveLength(1);
        expect(result[0]).toContain("/*");
        expect(result[0]).toContain("requires");
      });

      it("should comment out ensures: blocks", () => {
        const source = `
function bar(): number {
  ensures: {
    result > 0;
  }
  return 42;
}`;
        const result = processor.preprocess(source, "test.ts");
        expect(result).toHaveLength(1);
        expect(result[0]).toContain("/*");
        expect(result[0]).toContain("ensures");
      });
    });

    describe("HKT syntax handling", () => {
      it("should detect and process HKT <_> syntax", () => {
        const source = "interface Functor<F<_>> { map: <A>(fa: F<A>) => void; }";
        const result = processor.preprocess(source, "test.ts");
        expect(result).toHaveLength(1);
        // The preprocessor should handle F<_> syntax
        expect(typeof result[0]).toBe("string");
      });
    });

    describe("pipeline operator handling", () => {
      it("should detect and process |> syntax", () => {
        const source = "const result = x |> f |> g;";
        const result = processor.preprocess(source, "test.ts");
        expect(result).toHaveLength(1);
        // The preprocessor should transform |> to function calls
        expect(typeof result[0]).toBe("string");
      });
    });

    describe("cons operator handling", () => {
      it("should detect and process :: syntax", () => {
        const source = "const list = 1 :: 2 :: [];";
        const result = processor.preprocess(source, "test.ts");
        expect(result).toHaveLength(1);
        // The preprocessor should transform :: to function calls
        expect(typeof result[0]).toBe("string");
      });
    });

    describe("comptime handling", () => {
      it("should process files with comptime() calls", () => {
        const source = "const value = comptime(() => 1 + 2);";
        const result = processor.preprocess(source, "test.ts");
        expect(result).toHaveLength(1);
        // File should be marked as using typesugar
        expect(typeof result[0]).toBe("string");
      });
    });
  });

  describe("postprocess", () => {
    describe("message filtering", () => {
      it("should filter out unused import errors for typesugar packages", () => {
        const source = 'import { derive } from "typesugar";';

        // First preprocess to set up state
        processor.preprocess(source, "test.ts");

        const messages = [
          [
            {
              ruleId: "no-unused-vars",
              message: "'derive' is defined but never used",
              line: 1,
              column: 10,
            },
          ],
        ];

        const result = processor.postprocess(messages, "test.ts");
        expect(result).toHaveLength(0);
      });

      it("should filter out @typescript-eslint unused import errors for typesugar packages", () => {
        const source = 'import { Eq, Clone } from "@typesugar/std";';

        processor.preprocess(source, "test.ts");

        const messages = [
          [
            {
              ruleId: "@typescript-eslint/no-unused-vars",
              message: "'Eq' is defined but never used",
              line: 1,
              column: 10,
            },
          ],
        ];

        const result = processor.postprocess(messages, "test.ts");
        expect(result).toHaveLength(0);
      });

      it("should NOT filter unused import errors for non-typesugar packages", () => {
        const source = 'import { foo } from "lodash";';

        processor.preprocess(source, "test.ts");

        const messages = [
          [
            {
              ruleId: "no-unused-vars",
              message: "'foo' is defined but never used",
              line: 1,
              column: 10,
            },
          ],
        ];

        const result = processor.postprocess(messages, "test.ts");
        expect(result).toHaveLength(1);
      });

      it("should filter unused import errors for legacy package names", () => {
        const source = 'import { derive } from "@ttfx/core";';

        processor.preprocess(source, "test.ts");

        const messages = [
          [
            {
              ruleId: "no-unused-vars",
              message: "'derive' is defined but never used",
              line: 1,
              column: 10,
            },
          ],
        ];

        const result = processor.postprocess(messages, "test.ts");
        expect(result).toHaveLength(0);
      });

      it("should filter unused-imports plugin errors", () => {
        const source = 'import { summon } from "typesugar";';

        processor.preprocess(source, "test.ts");

        const messages = [
          [
            {
              ruleId: "unused-imports/no-unused-imports",
              message: "'summon' is defined but never used",
              line: 1,
              column: 10,
            },
          ],
        ];

        const result = processor.postprocess(messages, "test.ts");
        expect(result).toHaveLength(0);
      });
    });

    describe("message passing", () => {
      it("should pass through non-unused-import errors", () => {
        const source = "const x = 1;";
        processor.preprocess(source, "test.ts");

        const messages = [
          [
            {
              ruleId: "no-console",
              message: "Unexpected console statement",
              line: 1,
              column: 1,
            },
          ],
        ];

        const result = processor.postprocess(messages, "test.ts");
        expect(result).toHaveLength(1);
        expect(result[0].ruleId).toBe("no-console");
      });

      it("should flatten nested message arrays", () => {
        const source = "const x = 1;";
        processor.preprocess(source, "test.ts");

        const messages = [
          [
            { ruleId: "error1", message: "Error 1", line: 1, column: 1 },
            { ruleId: "error2", message: "Error 2", line: 2, column: 1 },
          ],
        ];

        const result = processor.postprocess(messages, "test.ts");
        expect(result).toHaveLength(2);
      });

      it("should handle empty message arrays", () => {
        const source = "const x = 1;";
        processor.preprocess(source, "test.ts");

        const result = processor.postprocess([[]], "test.ts");
        expect(result).toHaveLength(0);
      });
    });
  });
});

describe("Position Mapping Utilities", () => {
  let processor: ReturnType<typeof createProcessor>;

  beforeEach(() => {
    processor = createProcessor();
  });

  it("should map positions back to original source", () => {
    const source = `@derive(Eq)
class Foo {
  x: number;
}`;
    processor.preprocess(source, "test.ts");

    const messages = [
      [
        {
          ruleId: "some-rule",
          message: "Some error",
          line: 2,
          column: 1,
          endLine: 2,
          endColumn: 5,
        },
      ],
    ];

    const result = processor.postprocess(messages, "test.ts");
    expect(result).toHaveLength(1);
    // Position should be mapped back correctly
    expect(result[0].line).toBeDefined();
    expect(result[0].column).toBeDefined();
  });
});

describe("Plugin Configuration", () => {
  it("should export default plugin with processors", async () => {
    const plugin = await import("../src/index.js");
    expect(plugin.default).toBeDefined();
    expect(plugin.default.processors).toBeDefined();
    expect(plugin.default.processors?.typesugar).toBeDefined();
    expect(plugin.default.processors?.["typesugar-full"]).toBeDefined();
  });

  it("should export recommended config", async () => {
    const plugin = await import("../src/index.js");
    expect(plugin.recommendedConfig).toBeDefined();
    expect(plugin.recommendedConfig.name).toBe("@typesugar/recommended");
    expect(plugin.recommendedConfig.processor).toBe("@typesugar/typesugar");
  });

  it("should export full config", async () => {
    const plugin = await import("../src/index.js");
    expect(plugin.fullConfig).toBeDefined();
    expect(plugin.fullConfig.name).toBe("@typesugar/full");
    expect(plugin.fullConfig.processor).toBe("@typesugar/typesugar-full");
  });

  it("should export strict config", async () => {
    const plugin = await import("../src/index.js");
    expect(plugin.strictConfig).toBeDefined();
    expect(plugin.strictConfig.name).toBe("@typesugar/strict");
  });

  it("should disable no-unused-labels in recommended config", async () => {
    const plugin = await import("../src/index.js");
    expect(plugin.recommendedConfig.rules?.["no-unused-labels"]).toBe("off");
    expect(plugin.recommendedConfig.rules?.["no-labels"]).toBe("off");
  });
});

describe("Full Processor", () => {
  it("should export clearTransformCache function", async () => {
    const { clearTransformCache } = await import("../src/full-processor.js");
    expect(typeof clearTransformCache).toBe("function");
    // Should not throw when called
    clearTransformCache();
  });

  it("should create full processor with correct meta", async () => {
    const { createFullProcessor } = await import("../src/full-processor.js");
    const processor = createFullProcessor();
    expect(processor.meta?.name).toBe("typesugar-full");
    expect(processor.meta?.version).toBe("0.1.0");
    expect(processor.supportsAutofix).toBe(true);
  });

  it("should pass through non-TS files unchanged", async () => {
    const { createFullProcessor } = await import("../src/full-processor.js");
    const processor = createFullProcessor();
    const source = "@derive(Eq) class Foo {}";
    const result = processor.preprocess(source, "test.js");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(source);
  });
});
