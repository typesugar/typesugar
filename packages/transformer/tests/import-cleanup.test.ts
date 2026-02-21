/**
 * Tests for macro import cleanup
 *
 * Verifies that import declarations are correctly trimmed or removed
 * when their specifiers resolve to macros during expansion.
 *
 * Uses a name-based (non-module-scoped) test macro so that the full
 * transformer pipeline can resolve it without needing the real typemacro
 * package in node_modules. The import cleanup logic is the same regardless
 * of whether the macro was resolved by module or by name.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { globalRegistry, defineExpressionMacro } from "@typesugar/core";
import type { ExpressionMacro } from "@typesugar/core";
import macroTransformerFactory from "../src/index.js";

// Register a test macro that expands `testMacro(...)` → the first argument.
// This macro is NOT module-scoped, so it will be found by name-based lookup
// regardless of where the import comes from.
let testMacro: ExpressionMacro;

beforeAll(() => {
  testMacro = defineExpressionMacro({
    name: "testMacro",
    expand: (ctx, _callExpr, args) => {
      // Just return the first argument, or a numeric literal 0
      if (args.length > 0) {
        return args[0];
      }
      return ctx.factory.createNumericLiteral(0);
    },
  });
  globalRegistry.register(testMacro);
});

afterAll(() => {
  // The global registry doesn't support unregistration, but since this
  // macro name is unique to tests, it won't interfere with other tests.
});

/**
 * Helper: compile a source string through the macro transformer and return
 * the printed output.
 */
function transformSource(source: string, extraFiles: Record<string, string> = {}): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "typemacro-test-"));
  const mainFile = path.join(tmpDir, "input.ts");

  try {
    fs.writeFileSync(mainFile, source);

    const filePaths = [mainFile];
    for (const [name, content] of Object.entries(extraFiles)) {
      const filePath = path.join(tmpDir, name);
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content);
      filePaths.push(filePath);
    }

    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      baseUrl: tmpDir,
    };

    const program = ts.createProgram(filePaths, options);
    const sourceFile = program.getSourceFile(mainFile)!;
    expect(sourceFile).toBeDefined();

    const transformerFactory = macroTransformerFactory(program);
    const result = ts.transform(sourceFile, [transformerFactory]);
    const transformed = result.transformed[0];

    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    const output = printer.printFile(transformed);

    result.dispose();
    return output;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function hasImportFrom(output: string, moduleSpecifier: string): boolean {
  return output.includes(`from "${moduleSpecifier}"`);
}

function getNamedImports(output: string, moduleSpecifier: string): string[] {
  const regex = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${moduleSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`
  );
  const match = output.match(regex);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// The placeholder module that our test source files import from.
// Exports `testMacro` (which matches our registered macro by name)
// and `someRuntimeFn` (which is not a macro).
const placeholderModule = `
  export declare function testMacro<T>(value: T): T;
  export declare function someRuntimeFn(): void;
`;

describe("Macro import cleanup", () => {
  describe("full import removal", () => {
    it("should remove an import when all specifiers are macros", () => {
      const source = `
        import { testMacro } from "./placeholder";
        const x = testMacro(42);
      `;

      const output = transformSource(source, {
        "placeholder.ts": placeholderModule,
      });

      expect(hasImportFrom(output, "./placeholder")).toBe(false);
      // The macro call should have been expanded to just `42`
      expect(output).toContain("42");
    });

    it("should remove an import with renamed macro specifier", () => {
      const source = `
        import { testMacro as tm } from "./placeholder";
        const x = tm(42);
      `;

      const output = transformSource(source, {
        "placeholder.ts": placeholderModule,
      });

      expect(hasImportFrom(output, "./placeholder")).toBe(false);
      expect(output).toContain("42");
    });
  });

  describe("partial import trimming", () => {
    it("should keep non-macro specifiers when trimming", () => {
      const source = `
        import { testMacro, someRuntimeFn } from "./placeholder";
        const x = testMacro(42);
        someRuntimeFn();
      `;

      const output = transformSource(source, {
        "placeholder.ts": placeholderModule,
      });

      expect(hasImportFrom(output, "./placeholder")).toBe(true);
      const imports = getNamedImports(output, "./placeholder");
      expect(imports).not.toContain("testMacro");
      expect(imports).toContain("someRuntimeFn");
    });

    it("should handle mixed macro and non-macro with rename", () => {
      const source = `
        import { testMacro as tm, someRuntimeFn } from "./placeholder";
        const x = tm(99);
        someRuntimeFn();
      `;

      const output = transformSource(source, {
        "placeholder.ts": placeholderModule,
      });

      expect(hasImportFrom(output, "./placeholder")).toBe(true);
      const imports = getNamedImports(output, "./placeholder");
      expect(imports.some((i) => i.includes("testMacro"))).toBe(false);
      expect(imports.some((i) => i.includes("tm"))).toBe(false);
      expect(imports).toContain("someRuntimeFn");
    });
  });

  describe("side-effect imports", () => {
    it("should never remove side-effect-only imports", () => {
      const source = `
        import "./placeholder";
        const x = 1;
      `;

      const output = transformSource(source, {
        "placeholder.ts": placeholderModule,
      });

      expect(output).toContain(`"./placeholder"`);
    });
  });

  describe("non-macro imports", () => {
    it("should leave non-macro imports untouched", () => {
      const source = `
        import { someRuntimeFn } from "./placeholder";
        someRuntimeFn();
      `;

      const output = transformSource(source, {
        "placeholder.ts": placeholderModule,
      });

      expect(hasImportFrom(output, "./placeholder")).toBe(true);
      const imports = getNamedImports(output, "./placeholder");
      expect(imports).toContain("someRuntimeFn");
    });
  });

  describe("unused macro imports (no call)", () => {
    it("should keep macro imports that are imported but never called", () => {
      const source = `
        import { testMacro } from "./placeholder";
        const x = 1;
      `;

      const output = transformSource(source, {
        "placeholder.ts": placeholderModule,
      });

      // Import should remain since testMacro was never invoked
      expect(hasImportFrom(output, "./placeholder")).toBe(true);
    });
  });

  describe("multiple macro calls", () => {
    it("should remove import even when macro is called multiple times", () => {
      const source = `
        import { testMacro } from "./placeholder";
        const a = testMacro(1);
        const b = testMacro(2);
        const c = testMacro(3);
      `;

      const output = transformSource(source, {
        "placeholder.ts": placeholderModule,
      });

      expect(hasImportFrom(output, "./placeholder")).toBe(false);
    });
  });

  describe("multiple import declarations", () => {
    it("should handle multiple imports independently", () => {
      const otherModule = `
        export declare function otherFn(): number;
      `;

      const source = `
        import { testMacro } from "./placeholder";
        import { otherFn } from "./other";
        const x = testMacro(42);
        const y = otherFn();
      `;

      const output = transformSource(source, {
        "placeholder.ts": placeholderModule,
        "other.ts": otherModule,
      });

      // Macro import should be removed
      expect(hasImportFrom(output, "./placeholder")).toBe(false);
      // Non-macro import should remain
      expect(hasImportFrom(output, "./other")).toBe(true);
    });
  });
});
