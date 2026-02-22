/**
 * Red Team Tests for unplugin-typesugar
 *
 * Attack surfaces:
 * - File filtering edge cases (include/exclude patterns)
 * - Configuration validation (tsconfig paths, extensions)
 * - Transform error recovery (graceful degradation)
 * - Bundler-specific export correctness
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { unplugin, unpluginFactory, type TypesugarPluginOptions } from "unplugin-typesugar";

// ==========================================================================
// Attack 1: File Filtering Edge Cases
// ==========================================================================
describe("File Filtering Edge Cases", () => {
  describe("include pattern handling", () => {
    it("should handle RegExp include patterns", () => {
      const options: TypesugarPluginOptions = {
        include: /\.tsx?$/,
      };
      const plugin = unpluginFactory(options);

      // transformInclude is the filter function
      expect(plugin.transformInclude!("src/app.ts")).toBe(true);
      expect(plugin.transformInclude!("src/app.tsx")).toBe(true);
      expect(plugin.transformInclude!("src/app.js")).toBe(false);
    });

    it("should handle string array include patterns", () => {
      const options: TypesugarPluginOptions = {
        include: ["src/", "lib/"],
      };
      const plugin = unpluginFactory(options);

      expect(plugin.transformInclude!("src/app.ts")).toBe(true);
      expect(plugin.transformInclude!("lib/utils.ts")).toBe(true);
      expect(plugin.transformInclude!("test/app.ts")).toBe(false);
    });

    it("should handle empty include array (nothing matches)", () => {
      const options: TypesugarPluginOptions = {
        include: [],
      };
      const plugin = unpluginFactory(options);

      // Empty array means no pattern matches
      expect(plugin.transformInclude!("src/app.ts")).toBe(false);
      expect(plugin.transformInclude!("anything.tsx")).toBe(false);
    });
  });

  describe("exclude pattern handling", () => {
    it("should handle RegExp exclude patterns", () => {
      const options: TypesugarPluginOptions = {
        exclude: /\.test\.ts$/,
      };
      const plugin = unpluginFactory(options);

      expect(plugin.transformInclude!("src/app.ts")).toBe(true);
      expect(plugin.transformInclude!("src/app.test.ts")).toBe(false);
    });

    it("should handle string array exclude patterns", () => {
      const options: TypesugarPluginOptions = {
        exclude: ["__tests__", ".spec."],
      };
      const plugin = unpluginFactory(options);

      expect(plugin.transformInclude!("src/app.ts")).toBe(true);
      expect(plugin.transformInclude!("src/__tests__/app.ts")).toBe(false);
      expect(plugin.transformInclude!("src/app.spec.ts")).toBe(false);
    });

    it("should exclude node_modules by default", () => {
      const plugin = unpluginFactory({});

      expect(plugin.transformInclude!("src/app.ts")).toBe(true);
      expect(plugin.transformInclude!("node_modules/lodash/index.js")).toBe(false);
    });

    it("should allow custom exclude to override node_modules default", () => {
      const options: TypesugarPluginOptions = {
        exclude: /\.test\.ts$/, // Custom exclude, no node_modules
      };
      const plugin = unpluginFactory(options);

      // node_modules should now be included (custom exclude takes over)
      expect(plugin.transformInclude!("node_modules/lodash/index.js")).toBe(true);
    });
  });

  describe("path normalization", () => {
    it("should normalize Windows backslashes", () => {
      const plugin = unpluginFactory({});

      // Windows-style paths should work
      expect(plugin.transformInclude!("src\\app.ts")).toBe(true);
      expect(plugin.transformInclude!("node_modules\\lodash\\index.js")).toBe(false);
    });

    it("should handle mixed path separators", () => {
      const options: TypesugarPluginOptions = {
        include: ["src/components"],
      };
      const plugin = unpluginFactory(options);

      expect(plugin.transformInclude!("src/components/Button.tsx")).toBe(true);
      expect(plugin.transformInclude!("src\\components\\Button.tsx")).toBe(true);
    });
  });

  describe("file extension edge cases", () => {
    it("should match .js files by default", () => {
      const plugin = unpluginFactory({});

      expect(plugin.transformInclude!("src/app.js")).toBe(true);
      expect(plugin.transformInclude!("src/app.jsx")).toBe(true);
    });

    it("should not match non-JS/TS files by default", () => {
      const plugin = unpluginFactory({});

      expect(plugin.transformInclude!("src/styles.css")).toBe(false);
      expect(plugin.transformInclude!("src/data.json")).toBe(false);
      expect(plugin.transformInclude!("src/image.png")).toBe(false);
    });

    it("should handle files without extensions", () => {
      const plugin = unpluginFactory({});

      expect(plugin.transformInclude!("Makefile")).toBe(false);
      expect(plugin.transformInclude!(".gitignore")).toBe(false);
    });

    it("should handle .mts and .cts extensions", () => {
      const plugin = unpluginFactory({});

      // These match the /\.[jt]sx?$/ default pattern
      expect(plugin.transformInclude!("src/app.ts")).toBe(true);
      // .mts and .cts don't match the default pattern
      expect(plugin.transformInclude!("src/app.mts")).toBe(false);
      expect(plugin.transformInclude!("src/app.cts")).toBe(false);
    });
  });
});

// ==========================================================================
// Attack 2: Configuration Edge Cases
// ==========================================================================
describe("Configuration Edge Cases", () => {
  describe("tsconfig handling", () => {
    it("should accept undefined options gracefully", () => {
      // Should not throw
      expect(() => unpluginFactory(undefined)).not.toThrow();
      expect(() => unpluginFactory()).not.toThrow();
    });

    it("should accept empty options object", () => {
      expect(() => unpluginFactory({})).not.toThrow();
    });

    it("should accept explicit tsconfig path", () => {
      const options: TypesugarPluginOptions = {
        tsconfig: "./tsconfig.build.json",
      };
      // Should not throw during factory creation
      expect(() => unpluginFactory(options)).not.toThrow();
    });
  });

  describe("extensions configuration", () => {
    it("should accept valid extension names", () => {
      const options: TypesugarPluginOptions = {
        extensions: ["hkt", "pipeline", "cons"],
      };
      expect(() => unpluginFactory(options)).not.toThrow();
    });

    it("should accept partial extensions", () => {
      const options: TypesugarPluginOptions = {
        extensions: ["hkt"],
      };
      expect(() => unpluginFactory(options)).not.toThrow();
    });

    it("should accept empty extensions array", () => {
      const options: TypesugarPluginOptions = {
        extensions: [],
      };
      expect(() => unpluginFactory(options)).not.toThrow();
    });
  });

  describe("verbose option", () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it("should accept boolean verbose option", () => {
      const options: TypesugarPluginOptions = {
        verbose: true,
      };
      expect(() => unpluginFactory(options)).not.toThrow();
    });

    it("should default verbose to false", () => {
      const plugin = unpluginFactory({});
      // verbose default is false, so no logging on factory creation
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });
});

// ==========================================================================
// Attack 3: Transform Error Recovery
// ==========================================================================
describe("Transform Error Recovery", () => {
  describe("graceful degradation", () => {
    it("should return null when pipeline is not initialized", () => {
      const plugin = unpluginFactory({});

      // transform before buildStart is called (pipeline not ready)
      const result = plugin.transform!("const x = 1;", "test.ts");

      expect(result).toBeNull();
    });

    it("should handle transform with null code gracefully", () => {
      const plugin = unpluginFactory({});

      // Even with null/undefined code, should not crash
      const result = plugin.transform!(null as unknown as string, "test.ts");
      expect(result).toBeNull();
    });
  });

  describe("plugin lifecycle", () => {
    it("should have required plugin properties", () => {
      const plugin = unpluginFactory({});

      expect(plugin.name).toBe("typesugar");
      expect(plugin.enforce).toBe("pre");
      expect(typeof plugin.buildStart).toBe("function");
      expect(typeof plugin.transform).toBe("function");
      expect(typeof plugin.transformInclude).toBe("function");
      expect(typeof plugin.watchChange).toBe("function");
    });

    it("should handle watchChange before pipeline initialization", () => {
      const plugin = unpluginFactory({});

      // watchChange before buildStart should not crash
      expect(() => plugin.watchChange!("src/app.ts", { event: "update" })).not.toThrow();
    });
  });
});

// ==========================================================================
// Attack 4: Bundler Export Correctness
// ==========================================================================
describe("Bundler Export Correctness", () => {
  describe("unplugin factory", () => {
    it("should export unplugin object with bundler methods", () => {
      expect(unplugin).toBeDefined();
      expect(typeof unplugin.vite).toBe("function");
      expect(typeof unplugin.webpack).toBe("function");
      expect(typeof unplugin.esbuild).toBe("function");
      expect(typeof unplugin.rollup).toBe("function");
    });

    it("should export unpluginFactory function", () => {
      expect(typeof unpluginFactory).toBe("function");
    });
  });

  describe("bundler plugin creation", () => {
    it("should create Vite plugin", () => {
      const vitePlugin = unplugin.vite({});
      expect(vitePlugin).toBeDefined();
      // Vite plugins have name property
      expect(vitePlugin.name).toBe("typesugar");
    });

    it("should create Rollup plugin", () => {
      const rollupPlugin = unplugin.rollup({});
      expect(rollupPlugin).toBeDefined();
      expect(rollupPlugin.name).toBe("typesugar");
    });

    it("should create esbuild plugin", () => {
      const esbuildPlugin = unplugin.esbuild({});
      expect(esbuildPlugin).toBeDefined();
      expect(esbuildPlugin.name).toBe("typesugar");
    });

    it("should create webpack plugin", () => {
      const WebpackPlugin = unplugin.webpack({});
      expect(WebpackPlugin).toBeDefined();
      // Webpack plugins are classes/constructors
    });

    it("should pass options through to each bundler", () => {
      const options: TypesugarPluginOptions = {
        include: /\.tsx?$/,
        verbose: false,
      };

      // All should accept the same options without error
      expect(() => unplugin.vite(options)).not.toThrow();
      expect(() => unplugin.rollup(options)).not.toThrow();
      expect(() => unplugin.esbuild(options)).not.toThrow();
      expect(() => unplugin.webpack(options)).not.toThrow();
    });
  });

  describe("plugin naming consistency", () => {
    it("should use consistent plugin name across bundlers", () => {
      const vitePlugin = unplugin.vite({});
      const rollupPlugin = unplugin.rollup({});
      const esbuildPlugin = unplugin.esbuild({});

      expect(vitePlugin.name).toBe("typesugar");
      expect(rollupPlugin.name).toBe("typesugar");
      expect(esbuildPlugin.name).toBe("typesugar");
    });
  });
});

// ==========================================================================
// Attack 5: Type Safety
// ==========================================================================
describe("Type Safety", () => {
  describe("TypesugarPluginOptions interface", () => {
    it("should allow all documented options", () => {
      const fullOptions: TypesugarPluginOptions = {
        tsconfig: "./tsconfig.json",
        include: /\.ts$/,
        exclude: /node_modules/,
        verbose: true,
        extensions: ["hkt", "pipeline", "cons"],
      };

      expect(() => unpluginFactory(fullOptions)).not.toThrow();
    });

    it("should allow include as string array", () => {
      const options: TypesugarPluginOptions = {
        include: ["src/", "lib/"],
      };

      expect(() => unpluginFactory(options)).not.toThrow();
    });

    it("should allow exclude as string array", () => {
      const options: TypesugarPluginOptions = {
        exclude: ["node_modules", "dist"],
      };

      expect(() => unpluginFactory(options)).not.toThrow();
    });
  });
});
