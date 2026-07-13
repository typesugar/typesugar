/**
 * Tests for `typesugar init`'s bundler-config patching (PEP-058 Wave 2).
 *
 * The pre-PEP-058 `patchBundlerConfig` computed-but-discarded its result
 * when a bundler config already existed — it never patched an existing
 * vite/webpack/rollup config, silently no-oping in the most common
 * brownfield case. These tests pin the repaired behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { patchBundlerConfig, injectPluginIntoConfig } from "../src/init.js";

describe("injectPluginIntoConfig", () => {
  it("patches an ESM vite config with an existing plugins array", () => {
    const input = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
`;
    const result = injectPluginIntoConfig(input, "vite");
    expect(result).toBeDefined();
    expect(result).toContain('import typesugar from "unplugin-typesugar/vite";');
    expect(result).toContain("plugins: [typesugar(), react()]");
    // Import inserted after the last existing import, not at the top.
    const lines = result!.split("\n");
    expect(lines[2]).toBe('import typesugar from "unplugin-typesugar/vite";');
  });

  it("patches an empty plugins array without a trailing separator", () => {
    const input = `import { defineConfig } from "vite";

export default defineConfig({
  plugins: [],
});
`;
    const result = injectPluginIntoConfig(input, "vite");
    expect(result).toContain("plugins: [typesugar()]");
  });

  it("patches a multi-line plugins array", () => {
    const input = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
  ],
});
`;
    const result = injectPluginIntoConfig(input, "vite");
    expect(result).toContain("plugins: [typesugar(), \n    react(),");
  });

  it("patches a CJS webpack config using require and .default", () => {
    const input = `const path = require("path");

module.exports = {
  entry: "./src/index.ts",
  plugins: [],
};
`;
    const result = injectPluginIntoConfig(input, "webpack");
    expect(result).toBeDefined();
    expect(result).toContain('const typesugar = require("unplugin-typesugar/webpack").default;');
    expect(result).toContain("plugins: [typesugar()]");
    // require inserted after the existing require.
    const lines = result!.split("\n");
    expect(lines[1]).toBe('const typesugar = require("unplugin-typesugar/webpack").default;');
  });

  it("returns undefined when there is no plugins array (caller falls back to hint)", () => {
    const input = `import { defineConfig } from "vite";
export default defineConfig({ build: { target: "es2020" } });
`;
    expect(injectPluginIntoConfig(input, "vite")).toBeUndefined();
  });

  it("prepends the import when only multi-line imports exist (safe anchor fallback)", () => {
    const input = `import {
  defineConfig,
} from "vite";

export default defineConfig({
  plugins: [],
});
`;
    const result = injectPluginIntoConfig(input, "vite");
    expect(result).toBeDefined();
    // No single-line import to anchor after — plugin import lands at the top,
    // never in the middle of the multi-line import.
    expect(result!.split("\n")[0]).toBe('import typesugar from "unplugin-typesugar/vite";');
    expect(result).toContain("plugins: [typesugar()]");
  });
});

describe("patchBundlerConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-init-patch-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("patches an existing vite config in place", () => {
    const configPath = path.join(tmpDir, "vite.config.ts");
    fs.writeFileSync(
      configPath,
      `import { defineConfig } from "vite";\n\nexport default defineConfig({\n  plugins: [],\n});\n`
    );

    const result = patchBundlerConfig(tmpDir, "vite", "vite.config.ts");

    expect(result.patched).toBe(true);
    expect(result.created).toBe(false);
    const written = fs.readFileSync(configPath, "utf-8");
    expect(written).toContain("unplugin-typesugar/vite");
    expect(written).toContain("plugins: [typesugar()]");
  });

  it("is idempotent: reports alreadyConfigured on a second run", () => {
    const configPath = path.join(tmpDir, "vite.config.ts");
    fs.writeFileSync(
      configPath,
      `import { defineConfig } from "vite";\n\nexport default defineConfig({\n  plugins: [],\n});\n`
    );

    patchBundlerConfig(tmpDir, "vite", "vite.config.ts");
    const second = patchBundlerConfig(tmpDir, "vite", "vite.config.ts");

    expect(second.patched).toBe(false);
    expect(second.alreadyConfigured).toBe(true);
    const written = fs.readFileSync(configPath, "utf-8");
    expect(written.match(/typesugar\(\)/g)?.length).toBe(1);
  });

  it("still creates a fresh config when none exists", () => {
    const result = patchBundlerConfig(tmpDir, "vite", undefined);
    expect(result.created).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "vite.config.ts"))).toBe(true);
  });

  it("falls back to hint (patched: false, file set) for a config with no plugins array", () => {
    const configPath = path.join(tmpDir, "vite.config.ts");
    const original = `import { defineConfig } from "vite";\nexport default defineConfig({});\n`;
    fs.writeFileSync(configPath, original);

    const result = patchBundlerConfig(tmpDir, "vite", "vite.config.ts");

    expect(result.patched).toBe(false);
    expect(result.alreadyConfigured).toBeUndefined();
    expect(result.file).toBe("vite.config.ts");
    // Untouched — nothing half-written.
    expect(fs.readFileSync(configPath, "utf-8")).toBe(original);
  });

  it("leaves esbuild build scripts hint-only even when they have a plugins array", () => {
    const configPath = path.join(tmpDir, "build.js");
    const original = `const { build } = require("esbuild");\nbuild({ plugins: [] });\n`;
    fs.writeFileSync(configPath, original);

    const result = patchBundlerConfig(tmpDir, "esbuild", "build.js");

    expect(result.patched).toBe(false);
    expect(fs.readFileSync(configPath, "utf-8")).toBe(original);
  });

  it("does nothing for next (unsupported) and none", () => {
    expect(patchBundlerConfig(tmpDir, "next", "next.config.js")).toEqual({
      created: false,
      patched: false,
    });
    expect(patchBundlerConfig(tmpDir, "none", undefined)).toEqual({
      created: false,
      patched: false,
    });
  });
});
