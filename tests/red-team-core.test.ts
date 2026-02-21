/**
 * Red Team Tests for @typesugar/core
 *
 * Attack surfaces:
 * - Registry name collisions and duplicate handling strategies
 * - GenericRegistry edge cases (merge without function, skip without valueEquals)
 * - Config system edge cases (missing keys, malformed conditions, env parsing)
 * - Resolution scope opt-out parsing and mode switching
 * - Import suggestion system edge cases (unknown symbols, re-exports)
 * - Coherence checker conflict detection and priority ordering
 * - ExpansionTracker nested expansion handling
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createRegistry,
  defineExpressionMacro,
  defineAttributeMacro,
  defineDeriveMacro,
  defineLabeledBlockMacro,
  createGenericRegistry,
  type GenericRegistry,
  type DuplicateStrategy,
  config,
  ResolutionScopeTracker,
  globalResolutionScope,
  getExportIndex,
  resetExportIndex,
  registerExport,
  getSuggestionsForSymbol,
  getSuggestionsForMethod,
  getSuggestionsForMacro,
  getSuggestionsForTypeclass,
  formatSuggestionsMessage,
  type ExportedSymbol,
  CoherenceChecker,
  globalCoherenceChecker,
  SOURCE_PRIORITY,
  type InstanceLocation,
  type InstanceSource,
  ExpansionTracker,
  globalExpansionTracker,
  preserveSourceMap,
} from "../packages/core/src/index.js";
import * as ts from "typescript";

describe("Core Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Registry Name Collisions
  // ==========================================================================
  describe("Registry Name Collisions", () => {
    it("should throw on duplicate macro with different definition", () => {
      const registry = createRegistry();
      const macro1 = defineExpressionMacro({
        name: "testMacro",
        expand: () => ts.factory.createNull(),
      });
      const macro2 = defineExpressionMacro({
        name: "testMacro",
        module: "different-module",
        expand: () => ts.factory.createTrue(),
      });

      registry.register(macro1);
      expect(() => registry.register(macro2)).toThrow(/already registered/);
    });

    it("should allow idempotent registration of same macro", () => {
      const registry = createRegistry();
      const macro = defineExpressionMacro({
        name: "idempotentMacro",
        module: "test-module",
        expand: () => ts.factory.createNull(),
      });

      registry.register(macro);
      expect(() => registry.register(macro)).not.toThrow();
      expect(registry.getExpression("idempotentMacro")).toBeDefined();
    });

    it("should allow same name macros with same module (re-import scenario)", () => {
      const registry = createRegistry();
      const macro1 = defineExpressionMacro({
        name: "reimportMacro",
        module: "shared-module",
        expand: () => ts.factory.createNull(),
      });
      const macro2 = defineExpressionMacro({
        name: "reimportMacro",
        module: "shared-module",
        expand: () => ts.factory.createTrue(),
      });

      registry.register(macro1);
      expect(() => registry.register(macro2)).not.toThrow();
    });

    it("should handle labeled block macro collisions by label not name", () => {
      const registry = createRegistry();
      const macro1 = defineLabeledBlockMacro({
        name: "first",
        label: "do",
        expand: () => ts.factory.createEmptyStatement(),
      });
      const macro2 = defineLabeledBlockMacro({
        name: "second",
        label: "do",
        module: "different-module",
        expand: () => ts.factory.createEmptyStatement(),
      });

      registry.register(macro1);
      expect(() => registry.register(macro2)).toThrow(/label 'do' is already registered/);
    });

    it("should allow idempotent labeled block registration with same name", () => {
      const registry = createRegistry();
      const macro = defineLabeledBlockMacro({
        name: "doMacro",
        label: "do",
        expand: () => ts.factory.createEmptyStatement(),
      });

      registry.register(macro);
      expect(() => registry.register(macro)).not.toThrow();
    });
  });

  // ==========================================================================
  // Attack 2: GenericRegistry Duplicate Strategies
  // ==========================================================================
  describe("GenericRegistry Duplicate Strategies", () => {
    it("should throw when merge strategy has no merge function", () => {
      expect(() =>
        createGenericRegistry<string, number>({
          duplicateStrategy: "merge",
          name: "BrokenMergeRegistry",
        })
      ).toThrow(/merge function is required/);
    });

    it("should throw on duplicate with error strategy (default)", () => {
      const registry = createGenericRegistry<string, number>({
        name: "ErrorRegistry",
      });
      registry.set("key", 1);
      expect(() => registry.set("key", 2)).toThrow(/entry for key 'key' already exists/);
    });

    it("should skip identical values with skip strategy and valueEquals", () => {
      const registry = createGenericRegistry<string, { id: number }>({
        duplicateStrategy: "skip",
        valueEquals: (a, b) => a.id === b.id,
        name: "SkipRegistry",
      });
      registry.set("key", { id: 1 });
      registry.set("key", { id: 1 });
      expect(registry.size).toBe(1);
    });

    it("should throw on different values with skip strategy and valueEquals", () => {
      const registry = createGenericRegistry<string, { id: number }>({
        duplicateStrategy: "skip",
        valueEquals: (a, b) => a.id === b.id,
        name: "SkipRegistryDifferent",
      });
      registry.set("key", { id: 1 });
      expect(() => registry.set("key", { id: 2 })).toThrow(/different value for key 'key'/);
    });

    it("should silently skip without valueEquals (no comparison)", () => {
      const registry = createGenericRegistry<string, number>({
        duplicateStrategy: "skip",
        name: "SkipNoEquals",
      });
      registry.set("key", 1);
      registry.set("key", 2);
      expect(registry.get("key")).toBe(1);
    });

    it("should replace with replace strategy", () => {
      const registry = createGenericRegistry<string, number>({
        duplicateStrategy: "replace",
        name: "ReplaceRegistry",
      });
      registry.set("key", 1);
      registry.set("key", 2);
      expect(registry.get("key")).toBe(2);
    });

    it("should merge with merge strategy", () => {
      const registry = createGenericRegistry<string, number[]>({
        duplicateStrategy: "merge",
        merge: (existing, incoming) => [...existing, ...incoming],
        name: "MergeRegistry",
      });
      registry.set("key", [1, 2]);
      registry.set("key", [3, 4]);
      expect(registry.get("key")).toEqual([1, 2, 3, 4]);
    });

    it("should be iterable with for...of", () => {
      const registry = createGenericRegistry<string, number>();
      registry.set("a", 1);
      registry.set("b", 2);

      const entries: [string, number][] = [];
      for (const [k, v] of registry) {
        entries.push([k, v]);
      }
      expect(entries).toHaveLength(2);
      expect(entries).toContainEqual(["a", 1]);
      expect(entries).toContainEqual(["b", 2]);
    });
  });

  // ==========================================================================
  // Attack 3: Config System Edge Cases
  // ==========================================================================
  describe("Config System Edge Cases", () => {
    beforeEach(() => {
      config.reset();
    });

    afterEach(() => {
      config.reset();
    });

    it("should return undefined for missing keys", () => {
      expect(config.get("nonexistent.deeply.nested.key")).toBeUndefined();
    });

    it("should handle deeply nested config paths", () => {
      config.set({ deeply: { nested: { value: 42 } } });
      expect(config.get("deeply.nested.value")).toBe(42);
      expect(config.get("deeply.nested")).toEqual({ value: 42 });
    });

    it("should evaluate simple boolean conditions", () => {
      config.set({ debug: true });
      expect(config.evaluate("debug")).toBe(true);
      expect(config.evaluate("!debug")).toBe(false);
    });

    it("should evaluate AND conditions", () => {
      config.set({ debug: true, contracts: { mode: "full" } });
      expect(config.evaluate("debug && contracts.mode")).toBe(true);
      config.set({ debug: false });
      expect(config.evaluate("debug && contracts.mode")).toBe(false);
    });

    it("should evaluate OR conditions", () => {
      config.set({ debug: false, production: true });
      expect(config.evaluate("debug || production")).toBe(true);
      config.set({ production: false });
      expect(config.evaluate("debug || production")).toBe(false);
    });

    it("should evaluate parenthesized conditions", () => {
      config.set({ a: true, b: false, c: true });
      expect(config.evaluate("(a && b) || c")).toBe(true);
      expect(config.evaluate("a && (b || c)")).toBe(true);
      expect(config.evaluate("(a || b) && (b || c)")).toBe(true);
    });

    it("should evaluate equality conditions", () => {
      config.set({ contracts: { mode: "none" } });
      expect(config.evaluate("contracts.mode == 'none'")).toBe(true);
      expect(config.evaluate("contracts.mode == 'full'")).toBe(false);
    });

    it("should evaluate inequality conditions", () => {
      config.set({ contracts: { mode: "none" } });
      expect(config.evaluate("contracts.mode != 'full'")).toBe(true);
      expect(config.evaluate("contracts.mode != 'none'")).toBe(false);
    });

    it("should handle missing paths in conditions as falsy", () => {
      expect(config.evaluate("nonexistent")).toBe(false);
      expect(config.evaluate("!nonexistent")).toBe(true);
    });

    it("should use when() for conditional values", () => {
      config.set({ debug: true });
      const result = config.when("debug", "debug-value", "release-value");
      expect(result).toBe("debug-value");

      config.set({ debug: false });
      const result2 = config.when("debug", "debug-value", "release-value");
      expect(result2).toBe("release-value");
    });

    it("should use when() with lazy evaluation", () => {
      let evaluated = false;
      config.set({ debug: false });

      config.when(
        "debug",
        () => {
          evaluated = true;
          return "debug";
        },
        () => "release"
      );

      expect(evaluated).toBe(false);
    });

    it("should check isInPrelude for known typeclasses", () => {
      expect(config.isInPrelude("Eq")).toBe(true);
      expect(config.isInPrelude("Ord")).toBe(true);
      expect(config.isInPrelude("Show")).toBe(true);
      expect(config.isInPrelude("NonExistentTypeclass")).toBe(false);
    });
  });

  // ==========================================================================
  // Attack 4: Resolution Scope Edge Cases
  // ==========================================================================
  describe("Resolution Scope Edge Cases", () => {
    let tracker: ResolutionScopeTracker;

    beforeEach(() => {
      tracker = new ResolutionScopeTracker();
      config.reset();
    });

    it("should default to automatic mode", () => {
      const scope = tracker.getScope("test.ts");
      expect(scope.mode).toBe("automatic");
    });

    it("should return true for any typeclass in automatic mode", () => {
      expect(tracker.isTypeclassInScope("test.ts", "Show")).toBe(true);
      expect(tracker.isTypeclassInScope("test.ts", "RandomTypeclass")).toBe(true);
    });

    it("should respect import-scoped mode", () => {
      config.set({ resolution: { mode: "import-scoped" } });
      const newTracker = new ResolutionScopeTracker();

      newTracker.registerImportedTypeclass("test.ts", "Eq", "@typesugar/std");
      expect(newTracker.isTypeclassInScope("test.ts", "Eq")).toBe(true);
      expect(newTracker.isTypeclassInScope("test.ts", "Show")).toBe(true);
      expect(newTracker.isTypeclassInScope("test.ts", "CustomTC")).toBe(false);
    });

    it("should handle explicit mode (nothing in scope)", () => {
      config.set({ resolution: { mode: "explicit" } });
      const newTracker = new ResolutionScopeTracker();

      newTracker.registerImportedTypeclass("test.ts", "Eq", "@typesugar/std");
      expect(newTracker.isTypeclassInScope("test.ts", "Eq")).toBe(false);
      expect(newTracker.isTypeclassInScope("test.ts", "Show")).toBe(false);
    });

    it("should handle file-level opt-out", () => {
      tracker.setOptedOut("test.ts", true);
      expect(tracker.isTypeclassInScope("test.ts", "Eq")).toBe(false);
    });

    it("should handle feature-specific opt-out", () => {
      tracker.addOptedOutFeature("test.ts", "operators");
      expect(tracker.isFeatureOptedOut("test.ts", "operators")).toBe(true);
      expect(tracker.isFeatureOptedOut("test.ts", "extensions")).toBe(false);
    });

    it("should clear scope correctly", () => {
      tracker.registerImportedTypeclass("test.ts", "Eq", "@typesugar/std");
      tracker.setOptedOut("test.ts", true);
      tracker.clearScope("test.ts");

      const scope = tracker.getScope("test.ts");
      expect(scope.importedTypeclasses.size).toBe(0);
      expect(scope.optedOut).toBe(false);
    });

    it("should return empty list for opted-out files in getInScopeTypeclasses", () => {
      tracker.registerImportedTypeclass("test.ts", "Eq", "@typesugar/std");
      tracker.setOptedOut("test.ts", true);
      expect(tracker.getInScopeTypeclasses("test.ts")).toEqual([]);
    });
  });

  // ==========================================================================
  // Attack 5: Import Suggestion Edge Cases
  // ==========================================================================
  describe("Import Suggestion Edge Cases", () => {
    beforeEach(() => {
      resetExportIndex();
    });

    it("should return empty suggestions for unknown symbols", () => {
      const suggestions = getSuggestionsForSymbol("CompletelyUnknownSymbol");
      expect(suggestions).toHaveLength(0);
    });

    it("should return suggestions for known symbols", () => {
      const suggestions = getSuggestionsForSymbol("Option");
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some((s) => s.module === "@typesugar/fp")).toBe(true);
    });

    it("should prefer umbrella package over individual packages", () => {
      const suggestions = getSuggestionsForSymbol("Option");
      expect(suggestions[0].module).toBe("typesugar");
      expect(suggestions.some((s) => s.module === "@typesugar/fp")).toBe(true);
    });

    it("should handle custom registered exports", () => {
      const customExport: ExportedSymbol = {
        name: "CustomSymbol",
        module: "my-custom-module",
        kind: "function",
        isReexport: false,
        description: "A custom symbol",
      };
      registerExport(customExport);

      const suggestions = getSuggestionsForSymbol("CustomSymbol");
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].module).toBe("my-custom-module");
    });

    it("should suggest macros correctly", () => {
      const suggestions = getSuggestionsForMacro("comptime");
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].kind).toBe("macro");
    });

    it("should return empty for unknown macros", () => {
      const suggestions = getSuggestionsForMacro("nonExistentMacro");
      expect(suggestions).toHaveLength(0);
    });

    it("should suggest typeclasses correctly", () => {
      const suggestions = getSuggestionsForTypeclass("Eq");
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].kind).toBe("typeclass");
    });

    it("should suggest methods from extensions", () => {
      const suggestions = getSuggestionsForMethod("clamp");
      expect(suggestions.length).toBeGreaterThan(0);
    });

    it("should format suggestions message correctly", () => {
      const suggestions = getSuggestionsForSymbol("Option");
      const message = formatSuggestionsMessage(suggestions);
      expect(message).toContain("Did you mean to import?");
      expect(message).toContain("@typesugar/fp");
    });

    it("should handle empty suggestions in format", () => {
      const message = formatSuggestionsMessage([]);
      expect(message).toBe("");
    });

    it("should truncate long suggestion lists", () => {
      const suggestions = getSuggestionsForSymbol("Option");
      const message = formatSuggestionsMessage(suggestions, 1);
      if (suggestions.length > 1) {
        expect(message).toContain("... and");
      }
    });
  });

  // ==========================================================================
  // Attack 6: Coherence Checker Conflicts
  // ==========================================================================
  describe("Coherence Checker Conflicts", () => {
    let checker: CoherenceChecker;

    beforeEach(() => {
      checker = new CoherenceChecker();
    });

    const createLocation = (
      typeclass: string,
      forType: string,
      source: InstanceSource,
      fileName: string,
      line: number
    ): InstanceLocation => ({
      typeclass,
      forType,
      source,
      fileName,
      line,
      column: 0,
    });

    it("should allow first instance without conflict", () => {
      const loc = createLocation("Show", "Point", "explicit", "test.ts", 1);
      const conflict = checker.registerInstance(loc);
      expect(conflict).toBeUndefined();
    });

    it("should detect conflict between two explicit instances", () => {
      const loc1 = createLocation("Show", "Point", "explicit", "test.ts", 1);
      const loc2 = createLocation("Show", "Point", "explicit", "other.ts", 5);

      checker.registerInstance(loc1);
      const conflict = checker.registerInstance(loc2);

      expect(conflict).toBeDefined();
      expect(conflict!.severity).toBe("error");
      expect(conflict!.typeclass).toBe("Show");
      expect(conflict!.forType).toBe("Point");
    });

    it("should not conflict on duplicate registration (same location)", () => {
      const loc = createLocation("Show", "Point", "explicit", "test.ts", 1);
      checker.registerInstance(loc);
      const conflict = checker.registerInstance(loc);
      expect(conflict).toBeUndefined();
    });

    it("should detect conflict between same-priority sources", () => {
      const loc1 = createLocation("Eq", "User", "derived", "a.ts", 1);
      const loc2 = createLocation("Eq", "User", "derived", "b.ts", 2);

      checker.registerInstance(loc1);
      const conflict = checker.registerInstance(loc2);

      expect(conflict).toBeDefined();
      expect(conflict!.severity).toBe("error");
    });

    it("should allow explicit to shadow auto-derived without error", () => {
      const auto = createLocation("Show", "Point", "auto-derived", "gen.ts", 1);
      const explicit = createLocation("Show", "Point", "explicit", "test.ts", 10);

      checker.registerInstance(auto);
      const conflict = checker.registerInstance(explicit);

      expect(conflict).toBeUndefined();
    });

    it("should warn when local shadows imported", () => {
      const imported = createLocation("Show", "Point", "imported", "lib.ts", 1);
      (imported as any).modulePath = "@some/lib";
      const explicit = createLocation("Show", "Point", "explicit", "local.ts", 5);

      checker.registerInstance(imported);
      const conflict = checker.registerInstance(explicit);

      expect(conflict).toBeDefined();
      expect(conflict!.severity).toBe("warning");
    });

    it("should find best instance by priority", () => {
      const prelude = createLocation("Eq", "number", "prelude", "prelude.ts", 1);
      const autoDerived = createLocation("Eq", "number", "auto-derived", "gen.ts", 1);
      const explicit = createLocation("Eq", "number", "explicit", "custom.ts", 10);

      checker.registerInstance(prelude);
      checker.registerInstance(autoDerived);
      checker.registerInstance(explicit);

      const best = checker.findInstance("Eq", "number");
      expect(best).toBeDefined();
      expect(best!.source).toBe("explicit");
    });

    it("should respect SOURCE_PRIORITY ordering", () => {
      expect(SOURCE_PRIORITY["explicit"]).toBeLessThan(SOURCE_PRIORITY["derived"]);
      expect(SOURCE_PRIORITY["derived"]).toBeLessThan(SOURCE_PRIORITY["imported"]);
      expect(SOURCE_PRIORITY["imported"]).toBeLessThan(SOURCE_PRIORITY["library"]);
      expect(SOURCE_PRIORITY["library"]).toBeLessThan(SOURCE_PRIORITY["auto-derived"]);
      expect(SOURCE_PRIORITY["auto-derived"]).toBeLessThan(SOURCE_PRIORITY["prelude"]);
    });

    it("should return all instances for a type", () => {
      checker.registerInstance(createLocation("Show", "Point", "explicit", "a.ts", 1));
      checker.registerInstance(createLocation("Show", "Point", "prelude", "b.ts", 1));

      const all = checker.getAllInstances("Show", "Point");
      expect(all.length).toBe(2);
    });

    it("should return empty for unknown typeclass/type pair", () => {
      const best = checker.findInstance("Unknown", "Unknown");
      expect(best).toBeUndefined();
    });

    it("should clear conflicts correctly", () => {
      const loc1 = createLocation("Show", "Point", "explicit", "a.ts", 1);
      const loc2 = createLocation("Show", "Point", "explicit", "b.ts", 2);

      checker.registerInstance(loc1);
      checker.registerInstance(loc2);

      expect(checker.hasConflicts()).toBe(true);
      checker.clearConflicts();
      expect(checker.hasConflicts()).toBe(false);
      expect(checker.findInstance("Show", "Point")).toBeDefined();
    });

    it("should provide diagnostic data for conflicts", () => {
      const loc1 = createLocation("Eq", "User", "explicit", "a.ts", 1);
      const loc2 = createLocation("Eq", "User", "explicit", "b.ts", 2);

      checker.registerInstance(loc1);
      checker.registerInstance(loc2);

      const diagnostics = checker.getConflictDiagnosticData();
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0].code).toBe(9050);
      expect(diagnostics[0].typeclass).toBe("Eq");
    });
  });

  // ==========================================================================
  // Attack 7: ExpansionTracker Edge Cases
  // ==========================================================================
  describe("ExpansionTracker Edge Cases", () => {
    let tracker: ExpansionTracker;

    beforeEach(() => {
      tracker = new ExpansionTracker();
    });

    const createSourceFile = (content: string, fileName: string = "test.ts"): ts.SourceFile => {
      return ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
    };

    it("should start with zero expansions", () => {
      expect(tracker.count).toBe(0);
      expect(tracker.getAllExpansions()).toHaveLength(0);
    });

    it("should record expansion with correct metadata", () => {
      const source = "const x = comptime(1 + 2);";
      const sf = createSourceFile(source, "test.ts");
      const callExpr = (sf.statements[0] as any).declarationList.declarations[0].initializer;

      tracker.recordExpansion("comptime", callExpr, sf, "3", false);

      expect(tracker.count).toBe(1);
      const expansions = tracker.getAllExpansions();
      expect(expansions[0].macroName).toBe("comptime");
      expect(expansions[0].originalFile).toBe("test.ts");
      expect(expansions[0].expandedText).toBe("3");
      expect(expansions[0].fromCache).toBe(false);
    });

    it("should filter expansions by file", () => {
      const sf1 = createSourceFile("const x = 1;", "a.ts");
      const sf2 = createSourceFile("const y = 2;", "b.ts");

      tracker.recordExpansion("macro", sf1.statements[0], sf1, "expanded1", false);
      tracker.recordExpansion("macro", sf2.statements[0], sf2, "expanded2", false);

      expect(tracker.getExpansionsForFile("a.ts")).toHaveLength(1);
      expect(tracker.getExpansionsForFile("b.ts")).toHaveLength(1);
      expect(tracker.getExpansionsForFile("c.ts")).toHaveLength(0);
    });

    it("should clear all expansions", () => {
      const sf = createSourceFile("const x = 1;", "test.ts");
      tracker.recordExpansion("macro", sf.statements[0], sf, "expanded", false);
      expect(tracker.count).toBe(1);

      tracker.clear();
      expect(tracker.count).toBe(0);
    });

    it("should generate null source map for no expansions", () => {
      const map = tracker.generateSourceMap("const x = 1;", "test.ts");
      expect(map).toBeNull();
    });

    it("should generate source map for expansions", () => {
      const source = "const x = macro();";
      const sf = createSourceFile(source, "test.ts");
      const callExpr = (sf.statements[0] as any).declarationList.declarations[0].initializer;

      tracker.recordExpansion("macro", callExpr, sf, "42", false);

      const map = tracker.generateSourceMap(source, "test.ts");
      expect(map).not.toBeNull();
      expect(map!.version).toBe(3);
      expect(map!.sources).toContain("test.ts");
    });

    it("should handle nested expansions by skipping inner ones", () => {
      const source = "const x = outer(inner());";
      const sf = createSourceFile(source, "test.ts");
      const outerCall = (sf.statements[0] as any).declarationList.declarations[0].initializer;
      const innerCall = outerCall.arguments[0];

      tracker.recordExpansion("inner", innerCall, sf, "innerExpanded", false);
      tracker.recordExpansion("outer", outerCall, sf, "outerExpanded", false);

      const map = tracker.generateSourceMap(source, "test.ts");
      expect(map).not.toBeNull();
    });

    it("should throw on synthetic nodes (known limitation)", () => {
      const sf = createSourceFile("const x = 1;", "test.ts");
      const syntheticNode = ts.factory.createNull();

      expect(() => {
        tracker.recordExpansion("macro", syntheticNode, sf, "null", false);
      }).toThrow(/position cannot precede the beginning of the file/);
    });

    it("should handle real nodes with valid positions", () => {
      const source = "const x = null;";
      const sf = createSourceFile(source, "test.ts");
      const decl = (sf.statements[0] as any).declarationList.declarations[0];
      const nullNode = decl.initializer;

      tracker.recordExpansion("macro", nullNode, sf, "undefined", false);

      const expansions = tracker.getAllExpansions();
      expect(expansions[0].originalText).toBe("null");
    });
  });

  // ==========================================================================
  // Attack 8: preserveSourceMap Utility
  // ==========================================================================
  describe("preserveSourceMap Utility", () => {
    it("should copy source map range from original to new node", () => {
      const sf = ts.createSourceFile("test.ts", "const x = 1;", ts.ScriptTarget.Latest, true);
      const originalNode = sf.statements[0];
      const newNode = ts.factory.createVariableStatement(
        undefined,
        ts.factory.createVariableDeclarationList([])
      );

      const result = preserveSourceMap(newNode, originalNode);

      expect(result).toBe(newNode);
      const range = ts.getSourceMapRange(result);
      expect(range.pos).toBe(originalNode.pos);
      expect(range.end).toBe(originalNode.end);
    });

    it("should handle synthetic original node", () => {
      const syntheticOriginal = ts.factory.createNull();
      const newNode = ts.factory.createTrue();

      expect(() => preserveSourceMap(newNode, syntheticOriginal)).not.toThrow();
    });
  });
});
