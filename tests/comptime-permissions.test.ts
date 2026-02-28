/**
 * Tests for comptime sandbox permissions.
 *
 * These tests verify that:
 * 1. File system access is blocked by default
 * 2. File system access works when { fs: 'read' } is granted
 * 3. Environment access is blocked by default
 * 4. Environment access works when { env: 'read' } is granted
 * 5. Permissions propagate through nested function calls
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import macroTransformerFactory from "@typesugar/transformer";

// Import comptime to register the macro
import "@typesugar/macros";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "comptime-permissions-"));

  // Create test fixture files
  fs.writeFileSync(path.join(tmpDir, "test-data.txt"), "hello from test file");
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify({ key: "value", nested: { num: 42 } })
  );
  fs.mkdirSync(path.join(tmpDir, "pages"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "pages", "home.tsx"), "");
  fs.writeFileSync(path.join(tmpDir, "pages", "about.tsx"), "");
  fs.writeFileSync(path.join(tmpDir, "pages", "contact.tsx"), "");
});

afterAll(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Path to the project root for resolving imports
const projectRoot = path.resolve(__dirname, "..");

/**
 * Transform source code using the macro transformer.
 * Returns the output and whether transformation succeeded (no comptime call remains).
 *
 * @param source - The source code to transform (comptime import is added automatically)
 */
function transformSource(source: string): {
  output: string;
  hasError: boolean;
} {
  // Automatically add the comptime import if not present
  const sourceWithImport = source.includes("import { comptime }")
    ? source
    : `import { comptime } from "typesugar";\n${source}`;

  const mainFile = path.join(
    tmpDir,
    `test_${Date.now()}_${Math.random().toString(36).slice(2)}.ts`
  );
  fs.writeFileSync(mainFile, sourceWithImport);

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    baseUrl: projectRoot,
    paths: {
      typesugar: ["./src/index.ts"],
      typesugar: ["./src/index.ts"],
      "typesugar/*": ["./src/*"],
    },
  };

  const host = ts.createCompilerHost(options);
  const program = ts.createProgram([mainFile], options, {
    ...host,
    getCurrentDirectory: () => tmpDir,
  });
  const sourceFile = program.getSourceFile(mainFile)!;

  const transformerFactory = macroTransformerFactory(program, {
    verbose: false,
  });

  const result = ts.transform(sourceFile, [transformerFactory]);
  const transformed = result.transformed[0];
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const output = printer.printFile(transformed);

  result.dispose();
  fs.unlinkSync(mainFile);

  // Check for error conditions:
  // 1. comptime() call still in output (transformation didn't run)
  // 2. Error-throwing IIFE pattern: throw new Error("comptime evaluation failed: ...")
  // 3. Permission error pattern
  // 4. Macro expansion failure (e.g. "expansion of 'comptime' failed")
  const hasError =
    output.includes("comptime(") ||
    output.includes("comptime evaluation failed") ||
    output.includes("permission denied") ||
    output.includes("expansion of");

  return { output, hasError };
}

describe("comptime permissions", () => {
  describe("default sandbox (no permissions)", () => {
    it("should allow pure computation without permissions", () => {
      const { output, hasError } = transformSource(`
        const result = comptime(() => {
          return 5 * 5 + Math.pow(2, 3);
        });
      `);

      expect(hasError).toBe(false);
      expect(output).toContain("33"); // 25 + 8
    });

    it("should block fs access by default", () => {
      const { hasError } = transformSource(`
        const data = comptime(() => {
          return fs.readFileSync("./test-data.txt", "utf8");
        });
      `);

      expect(hasError).toBe(true);
    });

    it("should block process.env access by default", () => {
      const { hasError } = transformSource(`
        const env = comptime(() => {
          return process.env.NODE_ENV;
        });
      `);

      expect(hasError).toBe(true);
    });
  });

  describe("fs permissions", () => {
    it("should allow reading files with fs: 'read'", () => {
      const { output, hasError } = transformSource(`
        const data = comptime({ fs: 'read' }, () => {
          return fs.readFileSync("./test-data.txt", "utf8");
        });
      `);

      expect(hasError).toBe(false);
      expect(output).toContain("hello from test file");
    });

    it("should allow reading files with fs: true", () => {
      const { output, hasError } = transformSource(`
        const data = comptime({ fs: true }, () => {
          return fs.readFileSync("./test-data.txt", "utf8");
        });
      `);

      expect(hasError).toBe(false);
      expect(output).toContain("hello from test file");
    });

    it("should allow reading JSON files and parsing", () => {
      const { output, hasError } = transformSource(`
        const config = comptime({ fs: 'read' }, () => {
          const content = fs.readFileSync("./config.json", "utf8");
          return JSON.parse(content);
        });
      `);

      expect(hasError).toBe(false);
      // Object literals have unquoted keys like { key: "value" }
      expect(output).toContain("key:");
      expect(output).toContain('"value"');
      expect(output).toContain("42");
    });

    it("should allow reading directories", () => {
      const { output, hasError } = transformSource(`
        const files = comptime({ fs: 'read' }, () => {
          return fs.readdirSync("./pages");
        });
      `);

      expect(hasError).toBe(false);
      expect(output).toContain("home.tsx");
      expect(output).toContain("about.tsx");
      expect(output).toContain("contact.tsx");
    });

    it("should allow checking file existence", () => {
      const { output, hasError } = transformSource(`
        const exists = comptime({ fs: 'read' }, () => {
          return fs.existsSync("./test-data.txt");
        });
      `);

      expect(hasError).toBe(false);
      expect(output).toContain("true");
    });

    it("should block write operations with fs: 'read'", () => {
      const { hasError } = transformSource(`
        const result = comptime({ fs: 'read' }, () => {
          fs.writeFileSync("./output.txt", "test");
          return "done";
        });
      `);

      expect(hasError).toBe(true);
    });
  });

  describe("env permissions", () => {
    it("should allow reading env with env: 'read'", () => {
      // Set a test environment variable
      const originalValue = process.env.COMPTIME_TEST_VAR;
      process.env.COMPTIME_TEST_VAR = "test_value_123";

      try {
        const { output, hasError } = transformSource(`
          const envVar = comptime({ env: 'read' }, () => {
            return process.env.COMPTIME_TEST_VAR;
          });
        `);

        expect(hasError).toBe(false);
        expect(output).toContain("test_value_123");
      } finally {
        if (originalValue === undefined) {
          delete process.env.COMPTIME_TEST_VAR;
        } else {
          process.env.COMPTIME_TEST_VAR = originalValue;
        }
      }
    });

    it("should allow reading env with env: true", () => {
      const originalValue = process.env.COMPTIME_TEST_VAR2;
      process.env.COMPTIME_TEST_VAR2 = "another_value";

      try {
        const { output, hasError } = transformSource(`
          const envVar = comptime({ env: true }, () => {
            return process.env.COMPTIME_TEST_VAR2;
          });
        `);

        expect(hasError).toBe(false);
        expect(output).toContain("another_value");
      } finally {
        if (originalValue === undefined) {
          delete process.env.COMPTIME_TEST_VAR2;
        } else {
          process.env.COMPTIME_TEST_VAR2 = originalValue;
        }
      }
    });
  });

  describe("combined permissions", () => {
    it("should allow both fs and env access when both granted", () => {
      const originalValue = process.env.CONFIG_ENV;
      process.env.CONFIG_ENV = "test";

      try {
        const { output, hasError } = transformSource(`
          const config = comptime({ fs: 'read', env: 'read' }, () => {
            const env = process.env.CONFIG_ENV || 'default';
            const data = fs.readFileSync("./test-data.txt", "utf8");
            return { env, data };
          });
        `);

        expect(hasError).toBe(false);
        expect(output).toContain("test");
        expect(output).toContain("hello from test file");
      } finally {
        if (originalValue === undefined) {
          delete process.env.CONFIG_ENV;
        } else {
          process.env.CONFIG_ENV = originalValue;
        }
      }
    });
  });

  describe("path operations (always allowed)", () => {
    it("should allow path.join without permissions", () => {
      const { output, hasError } = transformSource(`
        const result = comptime(() => {
          return path.join("a", "b", "c");
        });
      `);

      expect(hasError).toBe(false);
      expect(output).toMatch(/a[\/\\]b[\/\\]c/);
    });

    it("should allow path.dirname without permissions", () => {
      const { output, hasError } = transformSource(`
        const result = comptime(() => {
          return path.dirname("/foo/bar/baz.txt");
        });
      `);

      expect(hasError).toBe(false);
      expect(output).toContain("/foo/bar");
    });
  });

  describe("require() function", () => {
    it("should allow require('fs') with fs permission", () => {
      const { output, hasError } = transformSource(`
        const data = comptime({ fs: 'read' }, () => {
          const fs = require('fs');
          return fs.existsSync("./test-data.txt");
        });
      `);

      expect(hasError).toBe(false);
      expect(output).toContain("true");
    });

    it("should allow require('path') without permissions", () => {
      const { output, hasError } = transformSource(`
        const result = comptime(() => {
          const path = require('path');
          return path.basename("/foo/bar/baz.txt");
        });
      `);

      expect(hasError).toBe(false);
      expect(output).toContain("baz.txt");
    });

    it("should block require('fs') without permission", () => {
      const { hasError } = transformSource(`
        const data = comptime(() => {
          const fs = require('fs');
          return fs.readFileSync("./test.txt", "utf8");
        });
      `);

      expect(hasError).toBe(true);
    });

    it("should block unsupported modules", () => {
      const { hasError } = transformSource(`
        const data = comptime(() => {
          const http = require('http');
          return "test";
        });
      `);

      expect(hasError).toBe(true);
    });
  });

  describe("real-world patterns", () => {
    it("should support file-system routing pattern", () => {
      const { output, hasError } = transformSource(`
        const routes = comptime({ fs: 'read' }, () => {
          const files = fs.readdirSync("./pages");
          return files.map(f => ({
            path: "/" + f.replace(".tsx", ""),
            component: f
          }));
        });
      `);

      expect(hasError).toBe(false);
      expect(output).toContain("/home");
      expect(output).toContain("/about");
      expect(output).toContain("/contact");
    });

    it("should support config merging pattern", () => {
      const { output, hasError } = transformSource(`
        const config = comptime({ fs: 'read' }, () => {
          const base = JSON.parse(fs.readFileSync("./config.json", "utf8"));
          return { ...base, loaded: true };
        });
      `);

      expect(hasError).toBe(false);
      // Object literals have unquoted keys like { key: "value" }
      expect(output).toContain("key:");
      expect(output).toContain('"value"');
      expect(output).toContain("loaded:");
      expect(output).toContain("true");
    });
  });
});
