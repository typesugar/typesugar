/**
 * Tests for import-scoped macro resolution
 *
 * Verifies that macros with a `module` field are only activated when
 * the user imports the placeholder from the declared module (or a
 * re-export barrel), and that macros without `module` still work
 * via name-based lookup (backward compatibility).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createRegistry,
  defineExpressionMacro,
  defineAttributeMacro,
  defineTaggedTemplateMacro,
  defineTypeMacro,
} from "@typesugar/core";
import type { MacroRegistry, MacroContext } from "@typesugar/core";

describe("Import-scoped macro resolution - Registry", () => {
  let registry: MacroRegistry;

  beforeEach(() => {
    registry = createRegistry();
  });

  describe("module-scoped registration", () => {
    it("should index macros by module+exportName", () => {
      const macro = defineExpressionMacro({
        name: "comptime",
        module: "typemacro",
        expand: (_ctx, callExpr) => callExpr,
      });

      registry.register(macro);

      const byModule = registry.getByModuleExport("typemacro", "comptime");
      expect(byModule).toBeDefined();
      expect(byModule?.name).toBe("comptime");
    });

    it("should use exportName when it differs from name", () => {
      const macro = defineExpressionMacro({
        name: "internalName",
        module: "typemacro",
        exportName: "publicName",
        expand: (_ctx, callExpr) => callExpr,
      });

      registry.register(macro);

      // Should be found by exportName
      const byExport = registry.getByModuleExport("typemacro", "publicName");
      expect(byExport).toBeDefined();
      expect(byExport?.name).toBe("internalName");

      // Should NOT be found by internal name via module lookup
      const byName = registry.getByModuleExport("typemacro", "internalName");
      expect(byName).toBeUndefined();
    });

    it("should return undefined for wrong module", () => {
      const macro = defineExpressionMacro({
        name: "comptime",
        module: "typemacro",
        expand: (_ctx, callExpr) => callExpr,
      });

      registry.register(macro);

      const result = registry.getByModuleExport("other-package", "comptime");
      expect(result).toBeUndefined();
    });

    it("should return undefined for wrong export name", () => {
      const macro = defineExpressionMacro({
        name: "comptime",
        module: "typemacro",
        expand: (_ctx, callExpr) => callExpr,
      });

      registry.register(macro);

      const result = registry.getByModuleExport("typemacro", "wrongName");
      expect(result).toBeUndefined();
    });
  });

  describe("isImportScoped", () => {
    it("should return true for macros with module field", () => {
      const macro = defineExpressionMacro({
        name: "comptime",
        module: "typemacro",
        expand: (_ctx, callExpr) => callExpr,
      });

      registry.register(macro);

      expect(registry.isImportScoped("comptime", "expression")).toBe(true);
    });

    it("should return false for macros without module field", () => {
      const macro = defineExpressionMacro({
        name: "legacyMacro",
        expand: (_ctx, callExpr) => callExpr,
      });

      registry.register(macro);

      expect(registry.isImportScoped("legacyMacro", "expression")).toBe(false);
    });

    it("should return false for non-existent macros", () => {
      expect(registry.isImportScoped("nonExistent", "expression")).toBe(false);
    });

    it("should work for all macro kinds", () => {
      const expr = defineExpressionMacro({
        name: "scopedExpr",
        module: "typemacro",
        expand: (_ctx, callExpr) => callExpr,
      });

      const attr = defineAttributeMacro({
        name: "scopedAttr",
        module: "typemacro",
        validTargets: ["class"],
        expand: (_ctx, _decorator, target) => target,
      });

      const tagged = defineTaggedTemplateMacro({
        name: "scopedTag",
        module: "typemacro",
        expand: (_ctx, node) => node.tag,
      });

      const typeMacro = defineTypeMacro({
        name: "ScopedType",
        module: "typemacro",
        expand: (_ctx, typeRef) => typeRef,
      });

      registry.register(expr);
      registry.register(attr);
      registry.register(tagged);
      registry.register(typeMacro);

      expect(registry.isImportScoped("scopedExpr", "expression")).toBe(true);
      expect(registry.isImportScoped("scopedAttr", "attribute")).toBe(true);
      expect(registry.isImportScoped("scopedTag", "tagged-template")).toBe(true);
      expect(registry.isImportScoped("ScopedType", "type")).toBe(true);
    });
  });

  describe("clear", () => {
    it("should clear module-scoped index too", () => {
      const macro = defineExpressionMacro({
        name: "comptime",
        module: "typemacro",
        expand: (_ctx, callExpr) => callExpr,
      });

      registry.register(macro);
      expect(registry.getByModuleExport("typemacro", "comptime")).toBeDefined();

      (registry as any).clear();

      expect(registry.getByModuleExport("typemacro", "comptime")).toBeUndefined();
      expect(registry.getExpression("comptime")).toBeUndefined();
    });
  });

  describe("backward compatibility", () => {
    it("should still allow name-based lookup for all macros", () => {
      const scoped = defineExpressionMacro({
        name: "scopedMacro",
        module: "typemacro",
        expand: (_ctx, callExpr) => callExpr,
      });

      const unscoped = defineExpressionMacro({
        name: "unscopedMacro",
        expand: (_ctx, callExpr) => callExpr,
      });

      registry.register(scoped);
      registry.register(unscoped);

      // Both should be findable by name
      expect(registry.getExpression("scopedMacro")).toBeDefined();
      expect(registry.getExpression("unscopedMacro")).toBeDefined();

      // Only scoped one should be findable by module
      expect(registry.getByModuleExport("typemacro", "scopedMacro")).toBeDefined();
      expect(registry.getByModuleExport("typemacro", "unscopedMacro")).toBeUndefined();
    });
  });

  describe("multiple modules", () => {
    it("should support macros from different modules", () => {
      const coreMacro = defineExpressionMacro({
        name: "comptime",
        module: "typemacro",
        expand: (_ctx, callExpr) => callExpr,
      });

      const unitsMacro = defineTaggedTemplateMacro({
        name: "units",
        module: "typemacro/units",
        expand: (_ctx, node) => node.tag,
      });

      registry.register(coreMacro);
      registry.register(unitsMacro);

      expect(registry.getByModuleExport("typemacro", "comptime")).toBeDefined();
      expect(registry.getByModuleExport("typemacro/units", "units")).toBeDefined();

      // Cross-module lookups should fail
      expect(registry.getByModuleExport("typemacro", "units")).toBeUndefined();
      expect(registry.getByModuleExport("typemacro/units", "comptime")).toBeUndefined();
    });
  });
});

describe("Built-in macros have module field", () => {
  // Verify that all built-in macros from the typemacro package
  // declare their module for import-scoped resolution

  it("should have module set on all core expression macros", async () => {
    // Import the macros to trigger registration
    const {
      comptimeMacro,
      opsMacro,
      pipeMacro,
      composeMacro,
      typeInfoMacro,
      fieldNamesMacro,
      validatorMacro,
      summonMacro,
      extendMacro,
      specializeMacro,
      specializeInlineMacro,
    } = await import("@typesugar/macros");

    for (const macro of [
      comptimeMacro,
      opsMacro,
      pipeMacro,
      composeMacro,
      typeInfoMacro,
      fieldNamesMacro,
      validatorMacro,
      summonMacro,
      extendMacro,
      specializeMacro,
      specializeInlineMacro,
    ]) {
      expect(macro.module, `${macro.name} should have module set`).toBeTruthy();
      expect(typeof macro.module).toBe("string");
      expect((macro.module as string).length).toBeGreaterThan(0);
    }
  });

  it("should have module set on all core attribute macros", async () => {
    const {
      operatorsAttribute,
      reflectAttribute,
      typeclassAttribute,
      instanceAttribute,
      derivingAttribute,
    } = await import("@typesugar/macros");

    for (const macro of [
      operatorsAttribute,
      reflectAttribute,
      typeclassAttribute,
      instanceAttribute,
      derivingAttribute,
    ]) {
      expect(macro.module, `${macro.name} should have module set`).toBeTruthy();
      expect(typeof macro.module).toBe("string");
      expect((macro.module as string).length).toBeGreaterThan(0);
    }
  });

  it("should NOT have module set on derive macros (they are arg-based, not import-based)", async () => {
    const {
      EqDerive,
      OrdDerive,
      CloneDerive,
      DebugDerive,
      HashDerive,
      DefaultDerive,
      JsonDerive,
      BuilderDerive,
    } = await import("@typesugar/macros");

    for (const macro of [
      EqDerive,
      OrdDerive,
      CloneDerive,
      DebugDerive,
      HashDerive,
      DefaultDerive,
      JsonDerive,
      BuilderDerive,
    ]) {
      expect(macro.module, `${macro.name} should NOT have module set`).toBeUndefined();
    }
  });
});
