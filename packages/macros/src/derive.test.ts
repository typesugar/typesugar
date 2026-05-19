/**
 * Tests for derive.ts — Derive symbols, primitive companions, and naming conventions
 *
 * Covers:
 * - Derive marker symbols and frozen companion objects
 * - Primitive instance availability on companion objects
 * - createDerivedFunctionName naming conventions for all operations
 * - Edge cases: empty strings, unusual type names
 */

import { describe, it, expect } from "vitest";
import {
  Eq,
  Ord,
  Clone,
  Debug,
  Hash,
  Default,
  Json,
  Builder,
  TypeGuard,
  Show,
  createDerivedFunctionName,
} from "./derive.js";

// ============================================================================
// Derive Marker Symbols
// ============================================================================

describe("derive markers", () => {
  it("Clone is a unique symbol", () => {
    expect(typeof Clone).toBe("symbol");
    expect(Clone.toString()).toContain("Clone");
  });

  it("Debug is a unique symbol", () => {
    expect(typeof Debug).toBe("symbol");
    expect(Debug.toString()).toContain("Debug");
  });

  it("Default is a unique symbol", () => {
    expect(typeof Default).toBe("symbol");
    expect(Default.toString()).toContain("Default");
  });

  it("Json is a unique symbol", () => {
    expect(typeof Json).toBe("symbol");
    expect(Json.toString()).toContain("Json");
  });

  it("Builder is a unique symbol", () => {
    expect(typeof Builder).toBe("symbol");
    expect(Builder.toString()).toContain("Builder");
  });

  it("TypeGuard is a unique symbol", () => {
    expect(typeof TypeGuard).toBe("symbol");
    expect(TypeGuard.toString()).toContain("TypeGuard");
  });

  it("symbol markers are all distinct", () => {
    const symbols = [Clone, Debug, Default, Json, Builder, TypeGuard];
    const unique = new Set(symbols);
    expect(unique.size).toBe(symbols.length);
  });
});

// ============================================================================
// Frozen Companion Objects (Eq, Ord, Hash, Show)
// ============================================================================

describe("Eq companion", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(Eq)).toBe(true);
  });

  it("carries primitive instances", () => {
    expect(Eq.number).toBeDefined();
    expect(Eq.string).toBeDefined();
    expect(Eq.boolean).toBeDefined();
    expect(Eq.bigint).toBeDefined();
    expect(Eq.null).toBeDefined();
    expect(Eq.undefined).toBeDefined();
    expect(Eq.array).toBeDefined();
  });

  it("number instance has equals method", () => {
    expect(typeof Eq.number.equals).toBe("function");
    expect(Eq.number.equals(1, 1)).toBe(true);
    expect(Eq.number.equals(1, 2)).toBe(false);
  });

  it("string instance has equals method", () => {
    expect(Eq.string.equals("a", "a")).toBe(true);
    expect(Eq.string.equals("a", "b")).toBe(false);
  });

  it("boolean instance has equals method", () => {
    expect(Eq.boolean.equals(true, true)).toBe(true);
    expect(Eq.boolean.equals(true, false)).toBe(false);
  });

  it("cannot be mutated", () => {
    expect(() => {
      (Eq as any).newProp = "test";
    }).toThrow();
  });
});

describe("Ord companion", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(Ord)).toBe(true);
  });

  it("carries primitive instances", () => {
    expect(Ord.number).toBeDefined();
    expect(Ord.string).toBeDefined();
    expect(Ord.boolean).toBeDefined();
    expect(Ord.bigint).toBeDefined();
    expect(Ord.array).toBeDefined();
  });

  it("number instance has compare method", () => {
    expect(typeof Ord.number.compare).toBe("function");
    expect(Ord.number.compare(1, 2)).toBeLessThan(0);
    expect(Ord.number.compare(2, 1)).toBeGreaterThan(0);
    expect(Ord.number.compare(1, 1)).toBe(0);
  });
});

describe("Hash companion", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(Hash)).toBe(true);
  });

  it("carries primitive instances", () => {
    expect(Hash.number).toBeDefined();
    expect(Hash.string).toBeDefined();
    expect(Hash.boolean).toBeDefined();
    expect(Hash.bigint).toBeDefined();
    expect(Hash.null).toBeDefined();
    expect(Hash.undefined).toBeDefined();
    expect(Hash.array).toBeDefined();
  });

  it("number instance has hash method", () => {
    expect(typeof Hash.number.hash).toBe("function");
    const h = Hash.number.hash(42);
    expect(typeof h).toBe("number");
  });

  it("same value produces same hash", () => {
    expect(Hash.number.hash(42)).toBe(Hash.number.hash(42));
  });
});

describe("Show companion", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(Show)).toBe(true);
  });

  it("carries primitive instances", () => {
    expect(Show.number).toBeDefined();
    expect(Show.string).toBeDefined();
    expect(Show.boolean).toBeDefined();
    expect(Show.bigint).toBeDefined();
    expect(Show.null).toBeDefined();
    expect(Show.undefined).toBeDefined();
    expect(Show.array).toBeDefined();
  });

  it("number instance has show method", () => {
    expect(typeof Show.number.show).toBe("function");
    expect(Show.number.show(42)).toBe("42");
  });

  it("string instance wraps in quotes", () => {
    expect(Show.string.show("hello")).toBe('"hello"');
  });

  it("boolean instance returns string literal", () => {
    expect(Show.boolean.show(true)).toBe("true");
    expect(Show.boolean.show(false)).toBe("false");
  });
});

// ============================================================================
// createDerivedFunctionName
// ============================================================================

describe("createDerivedFunctionName", () => {
  describe("known operations", () => {
    it("eq → typeNameEq", () => {
      expect(createDerivedFunctionName("eq", "Point")).toBe("pointEq");
    });

    it("ord → typeNameOrd", () => {
      expect(createDerivedFunctionName("ord", "Point")).toBe("pointOrd");
    });

    it("compare → typeNameCompare", () => {
      expect(createDerivedFunctionName("compare", "Point")).toBe("pointCompare");
    });

    it("clone → cloneTypeName", () => {
      expect(createDerivedFunctionName("clone", "Point")).toBe("clonePoint");
    });

    it("debug → debugTypeName", () => {
      expect(createDerivedFunctionName("debug", "Point")).toBe("debugPoint");
    });

    it("hash → hashTypeName", () => {
      expect(createDerivedFunctionName("hash", "Point")).toBe("hashPoint");
    });

    it("default → defaultTypeName", () => {
      expect(createDerivedFunctionName("default", "Point")).toBe("defaultPoint");
    });

    it("toJson → typeNameToJson", () => {
      expect(createDerivedFunctionName("toJson", "Point")).toBe("pointToJson");
    });

    it("fromJson → typeNameFromJson", () => {
      expect(createDerivedFunctionName("fromJson", "Point")).toBe("pointFromJson");
    });

    it("typeGuard → isTypeName", () => {
      expect(createDerivedFunctionName("typeGuard", "Point")).toBe("isPoint");
    });

    it("is → isTypeName", () => {
      expect(createDerivedFunctionName("is", "Point")).toBe("isPoint");
    });
  });

  describe("default fallback", () => {
    it("unknown operation uses uncapitalize(type) + capitalize(op)", () => {
      expect(createDerivedFunctionName("serialize", "Point")).toBe("pointSerialize");
    });

    it("handles single-letter type name", () => {
      expect(createDerivedFunctionName("eq", "A")).toBe("aEq");
    });

    it("handles multi-word type name", () => {
      expect(createDerivedFunctionName("clone", "MyPoint")).toBe("cloneMyPoint");
    });
  });

  describe("uncapitalization", () => {
    it("lowercases first character of type name", () => {
      expect(createDerivedFunctionName("eq", "Either")).toBe("eitherEq");
    });

    it("preserves rest of type name", () => {
      expect(createDerivedFunctionName("eq", "HTTPClient")).toBe("hTTPClientEq");
    });
  });
});
