import { describe, it, expect, beforeEach } from "vitest";
import { workspace, Uri, resetMockState } from "../test/mocks/vscode-mock";
import { ManifestLoader, createDefaultManifest, type MacroManifest } from "../src/manifest";

describe("ManifestLoader", () => {
  beforeEach(() => {
    resetMockState();
  });

  describe("default manifest", () => {
    it("has built-in expression macros", () => {
      const loader = new ManifestLoader();
      const names = loader.expressionMacroNames;
      expect(names.has("comptime")).toBe(true);
      expect(names.has("summon")).toBe(true);
      expect(names.has("ops")).toBe(true);
      expect(names.has("pipe")).toBe(true);
      expect(names.has("compose")).toBe(true);
      expect(names.has("extend")).toBe(true);
      expect(names.has("typeInfo")).toBe(true);
      expect(names.has("fieldNames")).toBe(true);
      expect(names.has("validator")).toBe(true);
      expect(names.has("Do")).toBe(true);
      expect(names.has("forYield")).toBe(true);
      expect(names.has("asyncDo")).toBe(true);
    });

    it("has built-in decorator macros", () => {
      const loader = new ManifestLoader();
      const names = loader.decoratorMacroNames;
      expect(names.has("derive")).toBe(true);
      expect(names.has("typeclass")).toBe(true);
      expect(names.has("instance")).toBe(true);
      expect(names.has("operators")).toBe(true);
      expect(names.has("reflect")).toBe(true);
      expect(names.has("deriving")).toBe(true);
      expect(names.has("inline")).toBe(true);
    });

    it("has built-in tagged template macros", () => {
      const loader = new ManifestLoader();
      const names = loader.taggedTemplateMacroNames;
      expect(names.has("sql")).toBe(true);
      expect(names.has("html")).toBe(true);
      expect(names.has("regex")).toBe(true);
      expect(names.has("fmt")).toBe(true);
      expect(names.has("json")).toBe(true);
      expect(names.has("raw")).toBe(true);
      expect(names.has("units")).toBe(true);
    });

    it("has built-in labeled block macros with continuations", () => {
      const loader = new ManifestLoader();
      const labels = loader.labeledBlockLabels;
      expect(labels.has("let")).toBe(true);
      expect(labels.has("yield")).toBe(true);
      expect(labels.has("pure")).toBe(true);
    });

    it("has built-in extension methods", () => {
      const loader = new ManifestLoader();
      const names = loader.extensionMethodNames;
      expect(names.has("show")).toBe(true);
      expect(names.has("eq")).toBe(true);
      expect(names.has("neq")).toBe(true);
      expect(names.has("compare")).toBe(true);
      expect(names.has("hash")).toBe(true);
      expect(names.has("combine")).toBe(true);
      expect(names.has("empty")).toBe(true);
      expect(names.has("map")).toBe(true);
    });

    it("has built-in derive arguments", () => {
      const loader = new ManifestLoader();
      const names = loader.deriveArgNames;
      expect(names.has("Eq")).toBe(true);
      expect(names.has("Ord")).toBe(true);
      expect(names.has("Clone")).toBe(true);
      expect(names.has("Debug")).toBe(true);
      expect(names.has("Hash")).toBe(true);
      expect(names.has("Default")).toBe(true);
      expect(names.has("Json")).toBe(true);
      expect(names.has("Builder")).toBe(true);
    });
  });

  describe("loading from disk", () => {
    it("loads and merges custom manifest", async () => {
      const customManifest: MacroManifest = {
        version: 1,
        macros: {
          expression: {
            myMacro: { module: "custom", description: "Custom macro" },
          },
          decorator: {},
          taggedTemplate: {},
          labeledBlock: {},
          type: {},
          extensionMethods: {},
        },
      };

      (workspace as any)._setFsReadFile(async () => {
        return new TextEncoder().encode(JSON.stringify(customManifest));
      });

      const loader = new ManifestLoader();
      const workspaceFolder = {
        uri: Uri.file("/test-workspace"),
        name: "test",
        index: 0,
      };

      await loader.initialize(workspaceFolder as any);

      // Custom macro should be present
      expect(loader.expressionMacroNames.has("myMacro")).toBe(true);
      // Built-in macros should still be present (merged)
      expect(loader.expressionMacroNames.has("comptime")).toBe(true);
    });

    it("falls back to defaults when no manifest file exists", async () => {
      // Default fs handler rejects (file not found)
      const loader = new ManifestLoader();
      const workspaceFolder = {
        uri: Uri.file("/test-workspace"),
        name: "test",
        index: 0,
      };

      await loader.initialize(workspaceFolder as any);

      // Should still have defaults
      expect(loader.expressionMacroNames.has("comptime")).toBe(true);
      expect(loader.decoratorMacroNames.has("derive")).toBe(true);
    });

    it("falls back to defaults for malformed JSON", async () => {
      (workspace as any)._setFsReadFile(async () => {
        return new TextEncoder().encode("{ not valid json!!!");
      });

      const loader = new ManifestLoader();
      const workspaceFolder = {
        uri: Uri.file("/test-workspace"),
        name: "test",
        index: 0,
      };

      await loader.initialize(workspaceFolder as any);

      // Should fall back to defaults
      expect(loader.expressionMacroNames.has("comptime")).toBe(true);
    });

    it("rejects unsupported manifest version", async () => {
      const futureManifest = {
        version: 99,
        macros: {
          expression: { future: { module: "future" } },
          decorator: {},
          taggedTemplate: {},
          labeledBlock: {},
          type: {},
          extensionMethods: {},
        },
      };

      (workspace as any)._setFsReadFile(async () => {
        return new TextEncoder().encode(JSON.stringify(futureManifest));
      });

      const loader = new ManifestLoader();
      const workspaceFolder = {
        uri: Uri.file("/test-workspace"),
        name: "test",
        index: 0,
      };

      await loader.initialize(workspaceFolder as any);

      // Should not have the future macro (version check failed)
      expect(loader.expressionMacroNames.has("future")).toBe(false);
      // Should still have defaults
      expect(loader.expressionMacroNames.has("comptime")).toBe(true);
    });

    it("handles manifest with extra unknown fields", async () => {
      const manifest = {
        version: 1,
        unknownTopLevel: "ignored",
        macros: {
          expression: { comptime: { module: "typesugar", extraField: true } },
          decorator: {},
          taggedTemplate: {},
          labeledBlock: {},
          type: {},
          extensionMethods: {},
          unknownCategory: {},
        },
      };

      (workspace as any)._setFsReadFile(async () => {
        return new TextEncoder().encode(JSON.stringify(manifest));
      });

      const loader = new ManifestLoader();
      const workspaceFolder = {
        uri: Uri.file("/test-workspace"),
        name: "test",
        index: 0,
      };

      // Should not throw
      await loader.initialize(workspaceFolder as any);
      expect(loader.expressionMacroNames.has("comptime")).toBe(true);
    });

    it("overlays custom macros on top of defaults", async () => {
      const customManifest: MacroManifest = {
        version: 1,
        macros: {
          expression: {
            comptime: { module: "custom-override", description: "Overridden" },
            newMacro: { module: "custom", description: "New macro" },
          },
          decorator: {},
          taggedTemplate: {},
          labeledBlock: {},
          type: {},
          extensionMethods: {},
        },
      };

      (workspace as any)._setFsReadFile(async () => {
        return new TextEncoder().encode(JSON.stringify(customManifest));
      });

      const loader = new ManifestLoader();
      const workspaceFolder = {
        uri: Uri.file("/test-workspace"),
        name: "test",
        index: 0,
      };

      await loader.initialize(workspaceFolder as any);

      // Override should win
      const manifest = loader.current;
      expect(manifest.macros.expression.comptime?.module).toBe("custom-override");
      // New macro should be present
      expect(loader.expressionMacroNames.has("newMacro")).toBe(true);
      // Other defaults should still exist
      expect(loader.expressionMacroNames.has("summon")).toBe(true);
    });
  });

  describe("events", () => {
    it("fires onDidChange when manifest loads", async () => {
      const manifest: MacroManifest = {
        version: 1,
        macros: {
          expression: { newMacro: { module: "test" } },
          decorator: {},
          taggedTemplate: {},
          labeledBlock: {},
          type: {},
          extensionMethods: {},
        },
      };

      (workspace as any)._setFsReadFile(async () => {
        return new TextEncoder().encode(JSON.stringify(manifest));
      });

      const loader = new ManifestLoader();
      let fired = false;
      loader.onDidChange(() => {
        fired = true;
      });

      const workspaceFolder = {
        uri: Uri.file("/test-workspace"),
        name: "test",
        index: 0,
      };

      await loader.initialize(workspaceFolder as any);
      expect(fired).toBe(true);
    });

    it("fires onDidChange when manifest file changes", async () => {
      const manifest1: MacroManifest = {
        version: 1,
        macros: {
          expression: { macro1: { module: "test" } },
          decorator: {},
          taggedTemplate: {},
          labeledBlock: {},
          type: {},
          extensionMethods: {},
        },
      };

      const manifest2: MacroManifest = {
        version: 1,
        macros: {
          expression: { macro2: { module: "test" } },
          decorator: {},
          taggedTemplate: {},
          labeledBlock: {},
          type: {},
          extensionMethods: {},
        },
      };

      let readCount = 0;
      (workspace as any)._setFsReadFile(async () => {
        readCount++;
        const manifest = readCount === 1 ? manifest1 : manifest2;
        return new TextEncoder().encode(JSON.stringify(manifest));
      });

      const loader = new ManifestLoader();
      let changeCount = 0;
      loader.onDidChange(() => {
        changeCount++;
      });

      const workspaceFolder = {
        uri: Uri.file("/test-workspace"),
        name: "test",
        index: 0,
      };

      await loader.initialize(workspaceFolder as any);
      expect(changeCount).toBe(1);
      expect(loader.expressionMacroNames.has("macro1")).toBe(true);

      // Simulate file change
      const watcher = (workspace as any)._fileSystemWatcher;
      watcher?._simulateChange(Uri.file("/test-workspace/typesugar.manifest.json"));

      // Wait for async loadFromDisk to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(changeCount).toBe(2);
      expect(loader.expressionMacroNames.has("macro2")).toBe(true);
    });

    it("reverts to defaults when manifest file is deleted", async () => {
      const manifest: MacroManifest = {
        version: 1,
        macros: {
          expression: { customMacro: { module: "custom" } },
          decorator: {},
          taggedTemplate: {},
          labeledBlock: {},
          type: {},
          extensionMethods: {},
        },
      };

      (workspace as any)._setFsReadFile(async () => {
        return new TextEncoder().encode(JSON.stringify(manifest));
      });

      const loader = new ManifestLoader();
      const workspaceFolder = {
        uri: Uri.file("/test-workspace"),
        name: "test",
        index: 0,
      };

      await loader.initialize(workspaceFolder as any);
      expect(loader.expressionMacroNames.has("customMacro")).toBe(true);

      // Simulate file deletion via watcher
      const watcher = (workspace as any)._fileSystemWatcher;
      watcher?._simulateDelete(Uri.file("/test-workspace/typesugar.manifest.json"));

      // Custom macro should be gone, defaults remain
      expect(loader.expressionMacroNames.has("customMacro")).toBe(false);
      expect(loader.expressionMacroNames.has("comptime")).toBe(true);
    });

    it("fires onDidChange when manifest file is created", async () => {
      let fileExists = false;
      (workspace as any)._setFsReadFile(async () => {
        if (!fileExists) {
          throw new Error("File not found");
        }
        const manifest: MacroManifest = {
          version: 1,
          macros: {
            expression: { newMacro: { module: "test" } },
            decorator: {},
            taggedTemplate: {},
            labeledBlock: {},
            type: {},
            extensionMethods: {},
          },
        };
        return new TextEncoder().encode(JSON.stringify(manifest));
      });

      const loader = new ManifestLoader();
      let changeCount = 0;
      loader.onDidChange(() => {
        changeCount++;
      });

      const workspaceFolder = {
        uri: Uri.file("/test-workspace"),
        name: "test",
        index: 0,
      };

      await loader.initialize(workspaceFolder as any);
      expect(changeCount).toBe(0); // No file initially

      // Simulate file creation
      fileExists = true;
      const watcher = (workspace as any)._fileSystemWatcher;
      watcher?._simulateCreate(Uri.file("/test-workspace/typesugar.manifest.json"));

      // Wait for async loadFromDisk to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(changeCount).toBe(1);
      expect(loader.expressionMacroNames.has("newMacro")).toBe(true);
    });
  });

  describe("current manifest snapshot", () => {
    it("returns the current manifest", () => {
      const loader = new ManifestLoader();
      const manifest = loader.current;
      expect(manifest.version).toBe(1);
      expect(manifest.macros).toBeDefined();
    });

    it("reflects updates after loading", async () => {
      const customManifest: MacroManifest = {
        version: 1,
        macros: {
          expression: { testMacro: { module: "test" } },
          decorator: {},
          taggedTemplate: {},
          labeledBlock: {},
          type: {},
          extensionMethods: {},
        },
      };

      (workspace as any)._setFsReadFile(async () => {
        return new TextEncoder().encode(JSON.stringify(customManifest));
      });

      const loader = new ManifestLoader();
      const workspaceFolder = {
        uri: Uri.file("/test-workspace"),
        name: "test",
        index: 0,
      };

      await loader.initialize(workspaceFolder as any);

      const manifest = loader.current;
      expect(manifest.macros.expression.testMacro).toBeDefined();
    });
  });

  describe("dispose", () => {
    it("cleans up without throwing", async () => {
      const loader = new ManifestLoader();
      const workspaceFolder = {
        uri: Uri.file("/test-workspace"),
        name: "test",
        index: 0,
      };

      await loader.initialize(workspaceFolder as any);
      expect(() => loader.dispose()).not.toThrow();
    });

    it("can be disposed multiple times safely", async () => {
      const loader = new ManifestLoader();
      const workspaceFolder = {
        uri: Uri.file("/test-workspace"),
        name: "test",
        index: 0,
      };

      await loader.initialize(workspaceFolder as any);
      loader.dispose();
      expect(() => loader.dispose()).not.toThrow();
    });
  });
});

describe("createDefaultManifest", () => {
  it("returns a valid manifest with version 1", () => {
    const manifest = createDefaultManifest();
    expect(manifest.version).toBe(1);
    expect(manifest.macros).toBeDefined();
    expect(manifest.macros.expression).toBeDefined();
    expect(manifest.macros.decorator).toBeDefined();
    expect(manifest.macros.taggedTemplate).toBeDefined();
    expect(manifest.macros.labeledBlock).toBeDefined();
    expect(manifest.macros.type).toBeDefined();
    expect(manifest.macros.extensionMethods).toBeDefined();
  });

  it("returns independent copies", () => {
    const m1 = createDefaultManifest();
    const m2 = createDefaultManifest();
    m1.macros.expression.test = { module: "test" };
    expect(m2.macros.expression.test).toBeUndefined();
  });

  it("includes all expected built-in macros", () => {
    const manifest = createDefaultManifest();

    // Expression macros
    expect(manifest.macros.expression.comptime).toBeDefined();
    expect(manifest.macros.expression.summon).toBeDefined();

    // Decorator macros
    expect(manifest.macros.decorator.derive).toBeDefined();
    expect(manifest.macros.decorator.typeclass).toBeDefined();
    expect(manifest.macros.decorator.instance).toBeDefined();

    // Tagged template macros
    expect(manifest.macros.taggedTemplate.sql).toBeDefined();
    expect(manifest.macros.taggedTemplate.html).toBeDefined();
    expect(manifest.macros.taggedTemplate.regex).toBeDefined();

    // Labeled block macros
    expect(manifest.macros.labeledBlock.let).toBeDefined();
    expect(manifest.macros.labeledBlock.let.continuations).toContain("yield");
    expect(manifest.macros.labeledBlock.let.continuations).toContain("pure");

    // Extension methods
    expect(manifest.macros.extensionMethods.show).toBeDefined();
    expect(manifest.macros.extensionMethods.eq).toBeDefined();
    expect(manifest.macros.extensionMethods.compare).toBeDefined();
  });

  it("derive decorator has all expected args", () => {
    const manifest = createDefaultManifest();
    const deriveArgs = manifest.macros.decorator.derive?.args ?? [];
    expect(deriveArgs).toContain("Eq");
    expect(deriveArgs).toContain("Ord");
    expect(deriveArgs).toContain("Clone");
    expect(deriveArgs).toContain("Debug");
    expect(deriveArgs).toContain("Hash");
    expect(deriveArgs).toContain("Default");
    expect(deriveArgs).toContain("Json");
    expect(deriveArgs).toContain("Builder");
  });
});
