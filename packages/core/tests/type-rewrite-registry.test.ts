/**
 * Tests for the type rewrite registry (PEP-012 Wave 1)
 *
 * Covers registration, lookup by name/symbol/module, the full
 * TypeRewriteEntry interface, and backward compatibility with the
 * PEP-011 SFINAE consumer (which uses only typeName, underlyingTypeText,
 * matchesUnderlying).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerTypeRewrite,
  getTypeRewrite,
  hasTypeRewrite,
  getAllTypeRewrites,
  clearTypeRewrites,
  findTypeRewrite,
  getTypeRewritesByModule,
  getTypeRewriteBySymbol,
  type TypeRewriteEntry,
  type ConstructorRewrite,
  type AccessorRewrite,
} from "@typesugar/core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function optionEntry(): TypeRewriteEntry {
  return {
    typeName: "Option",
    underlyingTypeText: "T | null",
    sourceModule: "@typesugar/fp/data/option",
    methods: new Map([
      ["map", "map"],
      ["flatMap", "flatMap"],
      ["getOrElse", "getOrElse"],
    ]),
    constructors: new Map<string, ConstructorRewrite>([
      ["Some", { kind: "identity" }],
      ["None", { kind: "constant", value: "null" }],
    ]),
    accessors: new Map<string, AccessorRewrite>([["value", { kind: "identity" }]]),
    transparent: true,
    matchesUnderlying: (t) => t.split("|").some((p) => p.trim() === "null"),
  };
}

function emailEntry(): TypeRewriteEntry {
  return {
    typeName: "Email",
    underlyingTypeText: "string",
    sourceModule: "@typesugar/fp/data/email",
    methods: new Map(),
    constructors: new Map<string, ConstructorRewrite>([["Email", { kind: "identity" }]]),
    accessors: new Map(),
    transparent: false,
  };
}

function resultEntry(): TypeRewriteEntry {
  return {
    typeName: "Result",
    underlyingTypeText: "{ ok: true; value: T } | { ok: false; error: E }",
    sourceModule: "@typesugar/fp/data/option",
    methods: new Map([
      ["map", "mapResult"],
      ["mapError", "mapError"],
    ]),
    constructors: new Map<string, ConstructorRewrite>([
      ["Ok", { kind: "identity" }],
      ["Err", { kind: "custom", value: "{ ok: false, error: $0 }" }],
    ]),
    accessors: new Map(),
    transparent: true,
  };
}

/** Minimal entry using only PEP-011 fields (backward compat). */
function legacyEntry(): TypeRewriteEntry {
  return {
    typeName: "Percentage",
    underlyingTypeText: "number",
    matchesUnderlying: (t) => t === "number",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TypeRewriteRegistry", () => {
  beforeEach(() => {
    clearTypeRewrites();
  });

  // -------------------------------------------------------------------------
  // Basic CRUD
  // -------------------------------------------------------------------------

  describe("register and lookup by name", () => {
    it("registers and retrieves an entry", () => {
      const entry = optionEntry();
      registerTypeRewrite(entry);

      expect(getTypeRewrite("Option")).toBe(entry);
      expect(hasTypeRewrite("Option")).toBe(true);
    });

    it("returns undefined for unregistered names", () => {
      expect(getTypeRewrite("Nonexistent")).toBeUndefined();
      expect(hasTypeRewrite("Nonexistent")).toBe(false);
    });

    it("overwrites an existing entry with the same typeName", () => {
      registerTypeRewrite(optionEntry());
      const updated: TypeRewriteEntry = { ...optionEntry(), underlyingTypeText: "T | undefined" };
      registerTypeRewrite(updated);

      expect(getTypeRewrite("Option")?.underlyingTypeText).toBe("T | undefined");
    });
  });

  // -------------------------------------------------------------------------
  // getAllTypeRewrites
  // -------------------------------------------------------------------------

  describe("getAllTypeRewrites", () => {
    it("returns all registered entries", () => {
      registerTypeRewrite(optionEntry());
      registerTypeRewrite(emailEntry());

      const all = getAllTypeRewrites();
      expect(all).toHaveLength(2);
      expect(all.map((e) => e.typeName)).toContain("Option");
      expect(all.map((e) => e.typeName)).toContain("Email");
    });

    it("returns an empty array when empty", () => {
      expect(getAllTypeRewrites()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // clearTypeRewrites
  // -------------------------------------------------------------------------

  describe("clearTypeRewrites", () => {
    it("removes all entries from both name and module indices", () => {
      registerTypeRewrite(optionEntry());
      registerTypeRewrite(emailEntry());
      clearTypeRewrites();

      expect(getAllTypeRewrites()).toHaveLength(0);
      expect(getTypeRewritesByModule("@typesugar/fp/data/option")).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // findTypeRewrite (generic-aware)
  // -------------------------------------------------------------------------

  describe("findTypeRewrite", () => {
    it("matches exact type name", () => {
      registerTypeRewrite(optionEntry());
      expect(findTypeRewrite("Option")).toBe(getTypeRewrite("Option"));
    });

    it("strips generic params: Option<number> → Option", () => {
      registerTypeRewrite(optionEntry());
      expect(findTypeRewrite("Option<number>")?.typeName).toBe("Option");
    });

    it("strips nested generics: Result<Option<A>, Error>", () => {
      registerTypeRewrite(resultEntry());
      expect(findTypeRewrite("Result<Option<A>, Error>")?.typeName).toBe("Result");
    });

    it("returns undefined for unregistered type", () => {
      expect(findTypeRewrite("Unknown<T>")).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Lookup by source module
  // -------------------------------------------------------------------------

  describe("getTypeRewritesByModule", () => {
    it("returns entries registered under a module", () => {
      registerTypeRewrite(optionEntry());
      registerTypeRewrite(resultEntry());

      const entries = getTypeRewritesByModule("@typesugar/fp/data/option");
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.typeName).sort()).toEqual(["Option", "Result"]);
    });

    it("returns empty array for unknown module", () => {
      expect(getTypeRewritesByModule("@unknown/module")).toHaveLength(0);
    });

    it("does not include entries without a sourceModule", () => {
      registerTypeRewrite(legacyEntry());
      expect(getTypeRewritesByModule("@typesugar/fp/data/option")).toHaveLength(0);
    });

    it("isolates entries from different modules", () => {
      registerTypeRewrite(optionEntry());
      registerTypeRewrite(emailEntry());

      expect(getTypeRewritesByModule("@typesugar/fp/data/option")).toHaveLength(1);
      expect(getTypeRewritesByModule("@typesugar/fp/data/email")).toHaveLength(1);
    });

    it("handles re-registration under the same module without duplicating", () => {
      registerTypeRewrite(optionEntry());
      registerTypeRewrite({ ...optionEntry(), underlyingTypeText: "T | undefined" });

      const entries = getTypeRewritesByModule("@typesugar/fp/data/option");
      expect(entries).toHaveLength(1);
      expect(entries[0].underlyingTypeText).toBe("T | undefined");
    });
  });

  // -------------------------------------------------------------------------
  // Lookup by symbol name
  // -------------------------------------------------------------------------

  describe("getTypeRewriteBySymbol", () => {
    it("finds an entry by symbol name", () => {
      registerTypeRewrite(optionEntry());
      expect(getTypeRewriteBySymbol("Option")?.typeName).toBe("Option");
    });

    it("returns undefined for unknown symbol", () => {
      expect(getTypeRewriteBySymbol("Unknown")).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Full TypeRewriteEntry fields
  // -------------------------------------------------------------------------

  describe("full TypeRewriteEntry interface", () => {
    it("stores methods map", () => {
      registerTypeRewrite(optionEntry());
      const entry = getTypeRewrite("Option")!;
      expect(entry.methods?.get("map")).toBe("map");
      expect(entry.methods?.get("flatMap")).toBe("flatMap");
      expect(entry.methods?.get("getOrElse")).toBe("getOrElse");
    });

    it("stores constructors map", () => {
      registerTypeRewrite(optionEntry());
      const entry = getTypeRewrite("Option")!;
      expect(entry.constructors?.get("Some")).toEqual({ kind: "identity" });
      expect(entry.constructors?.get("None")).toEqual({ kind: "constant", value: "null" });
    });

    it("stores accessors map", () => {
      registerTypeRewrite(optionEntry());
      const entry = getTypeRewrite("Option")!;
      expect(entry.accessors?.get("value")).toEqual({ kind: "identity" });
    });

    it("stores transparent flag", () => {
      registerTypeRewrite(optionEntry());
      expect(getTypeRewrite("Option")?.transparent).toBe(true);

      registerTypeRewrite(emailEntry());
      expect(getTypeRewrite("Email")?.transparent).toBe(false);
    });

    it("stores sourceModule", () => {
      registerTypeRewrite(optionEntry());
      expect(getTypeRewrite("Option")?.sourceModule).toBe("@typesugar/fp/data/option");
    });

    it("stores custom constructor rewrite", () => {
      registerTypeRewrite(resultEntry());
      const ctor = getTypeRewrite("Result")?.constructors?.get("Err");
      expect(ctor).toEqual({ kind: "custom", value: "{ ok: false, error: $0 }" });
    });
  });

  // -------------------------------------------------------------------------
  // Backward compatibility with PEP-011 SFINAE consumer
  // -------------------------------------------------------------------------

  describe("backward compatibility (PEP-011 SFINAE)", () => {
    it("works with entries that only have typeName and underlyingTypeText", () => {
      registerTypeRewrite(legacyEntry());

      expect(hasTypeRewrite("Percentage")).toBe(true);
      expect(getTypeRewrite("Percentage")?.underlyingTypeText).toBe("number");
    });

    it("matchesUnderlying callback still works", () => {
      registerTypeRewrite(legacyEntry());
      const entry = getTypeRewrite("Percentage")!;
      expect(entry.matchesUnderlying?.("number")).toBe(true);
      expect(entry.matchesUnderlying?.("string")).toBe(false);
    });

    it("findTypeRewrite still works for legacy entries", () => {
      registerTypeRewrite(legacyEntry());
      expect(findTypeRewrite("Percentage")?.typeName).toBe("Percentage");
    });

    it("new optional fields default to undefined for legacy entries", () => {
      registerTypeRewrite(legacyEntry());
      const entry = getTypeRewrite("Percentage")!;
      expect(entry.sourceModule).toBeUndefined();
      expect(entry.methods).toBeUndefined();
      expect(entry.constructors).toBeUndefined();
      expect(entry.accessors).toBeUndefined();
      expect(entry.transparent).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // ConstructorRewrite / AccessorRewrite interface shapes
  // -------------------------------------------------------------------------

  describe("ConstructorRewrite interface", () => {
    it("supports identity kind", () => {
      const cr: ConstructorRewrite = { kind: "identity" };
      expect(cr.kind).toBe("identity");
      expect(cr.value).toBeUndefined();
    });

    it("supports constant kind with value", () => {
      const cr: ConstructorRewrite = { kind: "constant", value: "null" };
      expect(cr.kind).toBe("constant");
      expect(cr.value).toBe("null");
    });

    it("supports custom kind with value", () => {
      const cr: ConstructorRewrite = { kind: "custom", value: "wrap($0)" };
      expect(cr.kind).toBe("custom");
      expect(cr.value).toBe("wrap($0)");
    });
  });

  describe("AccessorRewrite interface", () => {
    it("supports identity kind", () => {
      const ar: AccessorRewrite = { kind: "identity" };
      expect(ar.kind).toBe("identity");
      expect(ar.value).toBeUndefined();
    });

    it("supports custom kind with value", () => {
      const ar: AccessorRewrite = { kind: "custom", value: "unwrap($0)" };
      expect(ar.kind).toBe("custom");
      expect(ar.value).toBe("unwrap($0)");
    });
  });
});
