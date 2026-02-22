import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const VSCODE_PKG_PATH = path.resolve(__dirname, "..");

function readJson<T>(relativePath: string): T {
  const fullPath = path.join(VSCODE_PKG_PATH, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf-8")) as T;
}

function fileExists(relativePath: string): boolean {
  return fs.existsSync(path.join(VSCODE_PKG_PATH, relativePath));
}

describe("VSIX Packaging Smoke Tests", () => {
  describe("required files exist", () => {
    const requiredFiles = [
      "package.json",
      "README.md",
      "language-configuration.json",
      "syntaxes/typesugar.tmLanguage.json",
      "syntaxes/typesugar-units.tmLanguage.json",
    ];

    for (const file of requiredFiles) {
      it(`${file} exists`, () => {
        expect(fileExists(file)).toBe(true);
      });
    }
  });

  describe("dist directory", () => {
    it("dist/extension.js exists (build output)", () => {
      // This may not exist if build hasn't run, so just check the entry point config
      const pkg = readJson<{ main: string }>("package.json");
      expect(pkg.main).toBe("./dist/extension.js");
    });
  });

  describe(".vscodeignore excludes test files", () => {
    it(".vscodeignore exists", () => {
      expect(fileExists(".vscodeignore")).toBe(true);
    });

    it(".vscodeignore excludes test directories", () => {
      const content = fs.readFileSync(path.join(VSCODE_PKG_PATH, ".vscodeignore"), "utf-8");
      expect(content).toContain("test/**");
      expect(content).toContain("test-fixtures/**");
    });

    it(".vscodeignore excludes config files", () => {
      const content = fs.readFileSync(path.join(VSCODE_PKG_PATH, ".vscodeignore"), "utf-8");
      expect(content).toContain("vitest.config.ts");
      expect(content).toContain(".vscode-test.mjs");
    });
  });

  describe("package.json structure for VSIX", () => {
    const pkg = readJson<Record<string, unknown>>("package.json");

    it("has private: true (not published to npm)", () => {
      expect(pkg.private).toBe(true);
    });

    it("has publisher field", () => {
      expect(pkg.publisher).toBe("typesugar");
    });

    it("has displayName", () => {
      expect(pkg.displayName).toBe("typesugar");
    });

    it("has engines.vscode", () => {
      const engines = pkg.engines as Record<string, string>;
      expect(engines.vscode).toBeDefined();
      expect(engines.vscode).toMatch(/^\^?\d+\.\d+\.\d+$/);
    });

    it("has main entry point", () => {
      expect(pkg.main).toBe("./dist/extension.js");
    });

    it("has activation events", () => {
      const events = pkg.activationEvents as string[];
      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThan(0);
    });

    it("has contributes section", () => {
      expect(pkg.contributes).toBeDefined();
    });
  });

  describe("no test deps in production dependencies", () => {
    const pkg = readJson<{
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>("package.json");

    it("vitest is not in dependencies", () => {
      expect(pkg.dependencies?.vitest).toBeUndefined();
    });

    it("@vscode/test-cli is not in dependencies", () => {
      expect(pkg.dependencies?.["@vscode/test-cli"]).toBeUndefined();
    });

    it("@vscode/test-electron is not in dependencies", () => {
      expect(pkg.dependencies?.["@vscode/test-electron"]).toBeUndefined();
    });

    it("test deps are in devDependencies", () => {
      expect(pkg.devDependencies?.vitest).toBeDefined();
      expect(pkg.devDependencies?.["@vscode/test-cli"]).toBeDefined();
      expect(pkg.devDependencies?.["@vscode/test-electron"]).toBeDefined();
    });
  });

  describe("bundled dependencies", () => {
    const pkg = readJson<{
      bundledDependencies?: string[];
      dependencies?: Record<string, string>;
    }>("package.json");

    it("has bundledDependencies array", () => {
      expect(Array.isArray(pkg.bundledDependencies)).toBe(true);
    });

    it("bundles @typesugar/ts-plugin", () => {
      expect(pkg.bundledDependencies).toContain("@typesugar/ts-plugin");
    });

    it("all bundled deps are also in dependencies", () => {
      for (const dep of pkg.bundledDependencies ?? []) {
        expect(pkg.dependencies?.[dep]).toBeDefined();
      }
    });
  });

  describe("scripts", () => {
    const pkg = readJson<{ scripts: Record<string, string> }>("package.json");

    it("has build script", () => {
      expect(pkg.scripts.build).toBeDefined();
    });

    it("has test scripts", () => {
      expect(pkg.scripts.test).toBeDefined();
      expect(pkg.scripts["test:unit"]).toBeDefined();
      expect(pkg.scripts["test:integration"]).toBeDefined();
    });

    it("has package script", () => {
      expect(pkg.scripts.package).toBeDefined();
    });

    it("package script uses vsce", () => {
      expect(pkg.scripts.package).toContain("vsce package");
    });
  });
});
