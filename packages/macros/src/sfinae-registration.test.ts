/**
 * Tests for unified SFINAE registration (PEP-034 Wave 1B)
 *
 * Verifies:
 * 1. registerAllSfinaeRules() registers the expected set of rules
 * 2. Calling it twice doesn't duplicate rules
 * 3. Without positionMapFn, MacroGenerated is omitted
 * 4. With positionMapFn, MacroGenerated is included
 */

import { describe, it, expect, beforeEach } from "vitest";
import { clearSfinaeRules, getSfinaeRules } from "@typesugar/core";
import { registerAllSfinaeRules, ALL_SFINAE_RULE_NAMES } from "./sfinae-registration.js";

describe("registerAllSfinaeRules", () => {
  beforeEach(() => {
    clearSfinaeRules();
  });

  it("registers all non-positional rules when called without options", () => {
    const registered = registerAllSfinaeRules();
    const rules = getSfinaeRules();
    const ruleNames = rules.map((r) => r.name);

    expect(registered).toEqual([
      "ExtensionMethodCall",
      "MacroDecorator",
      "NewtypeAssignment",
      "OperatorOverload",
      "TypeRewriteAssignment",
    ]);
    expect(ruleNames).toEqual(registered);
  });

  it("registers MacroGenerated when positionMapFn is provided", () => {
    const dummyMapFn = (_fileName: string, _pos: number): number | null => null;
    const registered = registerAllSfinaeRules({ positionMapFn: dummyMapFn });
    const rules = getSfinaeRules();
    const ruleNames = rules.map((r) => r.name);

    expect(registered).toContain("MacroGenerated");
    expect(ruleNames).toContain("MacroGenerated");
    expect(rules).toHaveLength(6);
  });

  it("returns empty array on duplicate registration", () => {
    registerAllSfinaeRules();
    const second = registerAllSfinaeRules();
    expect(second).toEqual([]);
    // Rules should still be there, just not re-registered
    expect(getSfinaeRules()).toHaveLength(5);
  });

  it("ALL_SFINAE_RULE_NAMES contains every rule", () => {
    const dummyMapFn = (_fileName: string, _pos: number): number | null => null;
    registerAllSfinaeRules({ positionMapFn: dummyMapFn });
    const ruleNames = getSfinaeRules().map((r) => r.name);
    expect(ruleNames).toEqual([...ALL_SFINAE_RULE_NAMES]);
  });
});
