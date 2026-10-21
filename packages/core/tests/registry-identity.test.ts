/**
 * Macro identity in the registry (PEP-060 item 8; arch-engine R5).
 *
 * A macro that declares a `module` is identified by (kind, module,
 * exportName ?? name), not by its bare name: two packages may register the
 * same name and both stay loaded, and the import the user wrote decides which
 * one expands. Concrete case: @typesugar/validate's `assert<T>()` and
 * @typesugar/testing's `assert(cond)` — loading the second used to throw
 * "Expression macro 'assert' is already registered", order-dependently.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import {
  createRegistry,
  defineExpressionMacro,
  defineAttributeMacro,
  defineLabeledBlockMacro,
} from "@typesugar/core";
import type { MacroDefinition, MacroRegistry } from "@typesugar/core";

const id = (_ctx: unknown, call: ts.CallExpression) => call;

const validateAssert = defineExpressionMacro({
  name: "assert",
  module: "@typesugar/validate",
  description: "Generate an assertion function",
  expand: id,
});
const testingAssert = defineExpressionMacro({
  name: "assert",
  module: "@typesugar/testing",
  description: "Assert with sub-expression capture",
  expand: id,
});

function registerAll(registry: MacroRegistry, macros: MacroDefinition[]): void {
  for (const m of macros) registry.register(m);
}

describe("module-qualified macro identity", () => {
  for (const [label, order] of [
    ["validate first", [validateAssert, testingAssert]],
    ["testing first", [testingAssert, validateAssert]],
  ] as const) {
    it(`two modules' same-named macros coexist (${label})`, () => {
      const registry = createRegistry();
      expect(() => registerAll(registry, [...order])).not.toThrow();
      expect(registry.getByModuleExport("@typesugar/validate", "assert", "expression")).toBe(
        validateAssert
      );
      expect(registry.getByModuleExport("@typesugar/testing", "assert", "expression")).toBe(
        testingAssert
      );
      // Candidates are listed in registration order; both are present.
      expect(new Set(registry.getCandidates("assert", "expression"))).toEqual(
        new Set([validateAssert, testingAssert])
      );
      // A bare-name lookup cannot choose between two modules: it never
      // silently returns whichever loaded first.
      expect(registry.getExpression("assert")).toBeUndefined();
      expect(registry.isImportScoped("assert", "expression")).toBe(true);
      expect(registry.getAll().filter((m) => m.name === "assert")).toHaveLength(2);
    });
  }

  it("a bare-name lookup still finds a name with a single provider", () => {
    const registry = createRegistry();
    registry.register(testingAssert);
    expect(registry.getExpression("assert")).toBe(testingAssert);
  });

  it("re-registering the same (module, name) is idempotent and keeps the first object", () => {
    const registry = createRegistry();
    registry.register(validateAssert);
    // An ESM and a CJS (or src and dist) copy of the same package: same
    // identity, same definition, different object.
    const copy = { ...validateAssert };
    expect(() => registry.register(copy)).not.toThrow();
    expect(registry.getByModuleExport("@typesugar/validate", "assert", "expression")).toBe(
      validateAssert
    );
    expect(registry.getCandidates("assert", "expression")).toEqual([validateAssert]);
  });

  it("two different definitions for the same (module, name) still error, naming both", () => {
    const registry = createRegistry();
    registry.register(validateAssert);
    const other = defineExpressionMacro({
      name: "assert",
      module: "@typesugar/validate",
      description: "Something else entirely",
      expand: id,
    });
    expect(() => registry.register(other)).toThrow(
      /'assert'.*@typesugar\/validate.*already registered/s
    );
  });

  it("the same name in different kinds of one module coexists", () => {
    const registry = createRegistry();
    const attr = defineAttributeMacro({
      name: "mock",
      module: "@typesugar/testing",
      expand: (_c, _d, target) => target,
    });
    const expr = defineExpressionMacro({ name: "mock", module: "@typesugar/testing", expand: id });
    registry.register(attr);
    registry.register(expr);
    expect(registry.getByModuleExport("@typesugar/testing", "mock", "attribute")).toBe(attr);
    expect(registry.getByModuleExport("@typesugar/testing", "mock", "expression")).toBe(expr);
  });

  it("a legacy (module-less) macro and a module-qualified one coexist", () => {
    const registry = createRegistry();
    const legacy = defineExpressionMacro({ name: "assert", description: "legacy", expand: id });
    registry.register(testingAssert);
    registry.register(legacy);
    // Name-based lookup is the legacy macro's only way to be found...
    expect(registry.getExpression("assert")).toBe(legacy);
    expect(registry.isImportScoped("assert", "expression")).toBe(false);
    // ...and it never shadows the module-qualified one.
    expect(registry.getByModuleExport("@typesugar/testing", "assert", "expression")).toBe(
      testingAssert
    );
  });

  it("two different legacy (module-less) macros with one name still error", () => {
    const registry = createRegistry();
    registry.register(defineExpressionMacro({ name: "lg", description: "one", expand: id }));
    expect(() =>
      registry.register(defineExpressionMacro({ name: "lg", description: "two", expand: id }))
    ).toThrow(/'lg'.*already registered/s);
  });

  it("labels stay globally unique: they are syntax, with no import to disambiguate", () => {
    const registry = createRegistry();
    const expand = () => [] as ts.Statement[];
    registry.register(defineLabeledBlockMacro({ name: "a", label: "go", module: "pkg-a", expand }));
    expect(() =>
      registry.register(
        defineLabeledBlockMacro({ name: "b", label: "go", module: "pkg-b", expand })
      )
    ).toThrow(/label 'go'.*already registered/s);
  });

  it("getAll lists each macro once (exportName aliases and multi-label macros included)", () => {
    const registry = createRegistry();
    const aliased = defineExpressionMacro({
      name: "config.when",
      exportName: "when",
      module: "typesugar",
      expand: id,
    });
    const multi = defineLabeledBlockMacro({
      name: "multi",
      label: ["m1", "m2"],
      expand: () => [],
    });
    registry.register(aliased);
    registry.register(multi);
    expect(registry.getAll()).toEqual([aliased, multi]);
    expect(registry.getExpression("when")).toBe(aliased);
    expect(registry.getExpression("config.when")).toBe(aliased);
    expect(registry.getLabeledBlock("m2")).toBe(multi);
  });
});
