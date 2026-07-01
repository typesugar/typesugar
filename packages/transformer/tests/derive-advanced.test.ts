/**
 * Integration tests for advanced derive macro features.
 *
 * Covers:
 * - Sum type (discriminated union) derivation
 * - Builtin auto-derivation with instance/extension registry
 * - Intra-derive dependency sorting
 * - Primitive type alias handling
 * - Recursive type detection
 * - Unknown derive import suggestions
 * - {Name}TC convention macros
 * - Decorator stripping on interfaces and type aliases
 */

import { describe, it, expect, beforeEach } from "vitest";
import { transformCode } from "../src/pipeline.js";
import { clearRegistries, clearSyntaxRegistry, registerTypeclassMacros } from "@typesugar/macros";
import { globalRegistry } from "@typesugar/core";
import type { DeriveTypeInfo } from "@typesugar/core";

beforeEach(() => {
  clearSyntaxRegistry();
  clearRegistries();
  globalRegistry.clear();
  registerTypeclassMacros();
});

// ============================================================================
// 1. Sum type (discriminated union) derivation
// ============================================================================

describe("Sum type derivation", () => {
  it("@derive(Eq) on discriminated union generates sum-type equality with switch", () => {
    const code = `
interface Circle { kind: "circle"; radius: number; }
interface Square { kind: "square"; side: number; }
@derive(Eq)
type Shape = Circle | Square;
    `.trim();

    const result = transformCode(code, { fileName: "derive-sum-eq.ts" });

    expect(result.code).toContain("switch");
    expect(result.code).toContain("kind");
    expect(result.changed).toBe(true);
  });

  it("@derive(Show) on discriminated union generates sum-type show with switch", () => {
    const code = `
interface Circle { kind: "circle"; radius: number; }
interface Square { kind: "square"; side: number; }
@derive(Show)
type Shape = Circle | Square;
    `.trim();

    const result = transformCode(code, { fileName: "derive-sum-show.ts" });

    expect(result.code).toContain("switch");
    expect(result.code).toContain("kind");
    expect(result.changed).toBe(true);
  });

  it("extracts correct discriminant field from union using _tag", () => {
    const code = `
interface Dog { _tag: "dog"; name: string; }
interface Cat { _tag: "cat"; lives: number; }
@derive(Eq)
type Animal = Dog | Cat;
    `.trim();

    const result = transformCode(code, { fileName: "derive-sum-tag.ts" });

    expect(result.code).toContain("_tag");
    expect(result.code).toContain("switch");
  });

  it("sum type derive detected as kind sum in typeInfo", () => {
    let receivedTypeInfo: DeriveTypeInfo | undefined;

    globalRegistry.register({
      kind: "derive",
      name: "TestSum",
      expand(_ctx, _target, typeInfo) {
        receivedTypeInfo = typeInfo;
        return [];
      },
    });

    const code = `
interface A { kind: "a"; x: number; }
interface B { kind: "b"; y: string; }
@derive(TestSum)
type AB = A | B;
    `.trim();

    transformCode(code, { fileName: "derive-sum-info.ts" });

    expect(receivedTypeInfo).toBeDefined();
    expect(receivedTypeInfo?.kind).toBe("sum");
    expect(receivedTypeInfo?.discriminant).toBe("kind");
    expect(receivedTypeInfo?.variants).toHaveLength(2);
  });
});

// ============================================================================
// 2. Builtin auto-derivation with instance registry
// ============================================================================

describe("Builtin auto-derivation", () => {
  it("@derive(Eq) on interface generates eq instance and registers it", () => {
    const code = `
@derive(Eq)
interface Point { x: number; y: number; }
    `.trim();

    const result = transformCode(code, { fileName: "derive-eq-reg.ts" });

    expect(result.code).toContain("namespace Point");
    expect(result.code).toContain("export const Eq");
    expect(result.code).toContain("equals:");
    expect(result.changed).toBe(true);
  });

  // PEP-033 N1: multi-arg @derive on an interface must NOT emit a companion
  // `const X: Record<string, any> = {}`. That const cannot declaration-merge with
  // the generated `namespace X` (TS2451 "Cannot redeclare ..."), and was emitted
  // once per derive arg (duplicate const). The namespace alone provides the runtime
  // value and merges legally with the interface, so the companion form
  // `X.Eq.equals` type-checks.
  it("@derive(Eq, Clone) on interface emits no companion const and no duplicate declarations", () => {
    const code = `
@derive(Eq, Clone)
interface User { id: number; name: string; }
    `.trim();

    const result = transformCode(code, { fileName: "derive-n1.ts" });

    // No companion const (the TS2451 source) for any arg.
    expect(result.code).not.toMatch(/const User\s*:\s*Record<string,\s*any>\s*=\s*\{\}/);
    // One namespace per derived typeclass, both present.
    expect(result.code).toContain("namespace User");
    expect(result.code).toContain("export const Eq");
    expect(result.code).toContain("export const Clone");
    // No bare `const User =` / `var User =` companion left to clash with the namespace.
    expect(result.code).not.toMatch(/^\s*(export\s+)?(const|var|let)\s+User\s*[:=]/m);
  });

  it("@derive(Eq) on a class still works (namespace merges with the class)", () => {
    const code = `
@derive(Eq)
class P { constructor(public x: number) {} }
    `.trim();

    const result = transformCode(code, { fileName: "derive-n1-class.ts" });
    expect(result.code).toContain("namespace P");
    expect(result.code).toContain("export const Eq");
    // Classes never had a companion const; ensure that's still true.
    expect(result.code).not.toMatch(/const P\s*:\s*Record<string,\s*any>/);
  });

  // PEP-033 N3: instance-method sugar — `p.equals(q)` on a derived type is
  // rewritten to the companion call `P.Eq.equals(p, q)` (receiver → first arg).
  it("rewrites instance-method sugar `p.equals(q)` to the companion call", () => {
    // clearRegistries() (beforeEach) wipes the standard typeclass defs that
    // getTypeclassesForMethod("equals") relies on — restore them.
    const code = `
@derive(Eq)
class P { constructor(public x: number) {} }
const p1 = new P(1);
const p2 = new P(1);
export const same = p1.equals(p2);
    `.trim();

    const result = transformCode(code, { fileName: "derive-n3-sugar.ts" });
    expect(result.code).toContain("P.Eq.equals(p1, p2)");
    expect(result.code).not.toMatch(/p1\.equals\(/);
  });

  it("@derive(Show) generates show instance code", () => {
    const code = `
@derive(Show)
interface User { name: string; age: number; }
    `.trim();

    const result = transformCode(code, { fileName: "derive-show.ts" });

    expect(result.code).toContain("show");
    expect(result.code).toContain("namespace User");
    expect(result.code).toContain("export const Show");
    expect(result.changed).toBe(true);
  });

  it("@derive(Ord) generates comparison instance code", () => {
    const code = `
@derive(Ord)
interface Score { value: number; }
    `.trim();

    const result = transformCode(code, { fileName: "derive-ord.ts" });

    expect(result.code).toContain("compare");
    expect(result.code).toContain("namespace Score");
    expect(result.code).toContain("export const Ord");
    expect(result.changed).toBe(true);
  });

  it("@derive(Hash) generates hash instance code", () => {
    const code = `
@derive(Hash)
interface Key { id: number; name: string; }
    `.trim();

    const result = transformCode(code, { fileName: "derive-hash.ts" });

    expect(result.code).toContain("hash");
    expect(result.code).toContain("namespace Key");
    expect(result.code).toContain("export const Hash");
    expect(result.changed).toBe(true);
  });

  it("multiple derives in one decorator all register instances", () => {
    const code = `
@derive(Eq, Show)
interface Pair { a: number; b: number; }
    `.trim();

    const result = transformCode(code, { fileName: "derive-multi.ts" });

    expect(result.code).toContain("namespace Pair");
    expect(result.code).toContain("export const Eq");
    expect(result.code).toContain("export const Show");
  });
});

// ============================================================================
// 3. Intra-derive dependency sorting
// ============================================================================

describe("Derive argument dependency sorting", () => {
  it("sorts Ord after Eq when both present (via expandAfter)", () => {
    const expandOrder: string[] = [];

    globalRegistry.register({
      kind: "derive",
      name: "Eq",
      expand(_ctx, _target, _typeInfo) {
        expandOrder.push("Eq");
        return [];
      },
    });

    globalRegistry.register({
      kind: "derive",
      name: "Ord",
      expandAfter: ["Eq"],
      expand(_ctx, _target, _typeInfo) {
        expandOrder.push("Ord");
        return [];
      },
    });

    const code = `
@derive(Ord, Eq)
interface Val { n: number; }
    `.trim();

    transformCode(code, { fileName: "derive-sort-builtin.ts" });

    expect(expandOrder).toEqual(["Eq", "Ord"]);
  });

  it("sorts Monoid after Semigroup when both present (via expandAfter)", () => {
    const expandOrder: string[] = [];

    globalRegistry.register({
      kind: "derive",
      name: "Semigroup",
      expand(_ctx, _target, _typeInfo) {
        expandOrder.push("Semigroup");
        return [];
      },
    });

    globalRegistry.register({
      kind: "derive",
      name: "Monoid",
      expandAfter: ["Semigroup"],
      expand(_ctx, _target, _typeInfo) {
        expandOrder.push("Monoid");
        return [];
      },
    });

    const code = `
@derive(Monoid, Semigroup)
interface Accum { total: number; }
    `.trim();

    transformCode(code, { fileName: "derive-sort-monoid.ts" });

    expect(expandOrder).toEqual(["Semigroup", "Monoid"]);
  });

  it("preserves original order when no dependencies exist", () => {
    const expandOrder: string[] = [];

    globalRegistry.register({
      kind: "derive",
      name: "Foo",
      expand(_ctx, _target, _typeInfo) {
        expandOrder.push("Foo");
        return [];
      },
    });

    globalRegistry.register({
      kind: "derive",
      name: "Bar",
      expand(_ctx, _target, _typeInfo) {
        expandOrder.push("Bar");
        return [];
      },
    });

    const code = `
@derive(Foo, Bar)
interface Item { id: number; }
    `.trim();

    transformCode(code, { fileName: "derive-sort-none.ts" });

    expect(expandOrder).toEqual(["Foo", "Bar"]);
  });

  it("handles diamond dependencies without cycles", () => {
    const expandOrder: string[] = [];

    globalRegistry.register({
      kind: "derive",
      name: "Base",
      expand(_ctx, _target, _typeInfo) {
        expandOrder.push("Base");
        return [];
      },
    });

    globalRegistry.register({
      kind: "derive",
      name: "Left",
      expandAfter: ["Base"],
      expand(_ctx, _target, _typeInfo) {
        expandOrder.push("Left");
        return [];
      },
    });

    globalRegistry.register({
      kind: "derive",
      name: "Right",
      expandAfter: ["Base"],
      expand(_ctx, _target, _typeInfo) {
        expandOrder.push("Right");
        return [];
      },
    });

    globalRegistry.register({
      kind: "derive",
      name: "Top",
      expandAfter: ["Left", "Right"],
      expand(_ctx, _target, _typeInfo) {
        expandOrder.push("Top");
        return [];
      },
    });

    const code = `
@derive(Top, Right, Left, Base)
interface Thing { v: number; }
    `.trim();

    transformCode(code, { fileName: "derive-sort-diamond.ts" });

    expect(expandOrder[0]).toBe("Base");
    expect(expandOrder[expandOrder.length - 1]).toBe("Top");
    expect(expandOrder.indexOf("Left")).toBeGreaterThan(expandOrder.indexOf("Base"));
    expect(expandOrder.indexOf("Right")).toBeGreaterThan(expandOrder.indexOf("Base"));
  });

  it("falls back to original order on cyclic dependencies", () => {
    const expandOrder: string[] = [];

    globalRegistry.register({
      kind: "derive",
      name: "CycA",
      expandAfter: ["CycB"],
      expand(_ctx, _target, _typeInfo) {
        expandOrder.push("CycA");
        return [];
      },
    });

    globalRegistry.register({
      kind: "derive",
      name: "CycB",
      expandAfter: ["CycA"],
      expand(_ctx, _target, _typeInfo) {
        expandOrder.push("CycB");
        return [];
      },
    });

    const code = `
@derive(CycA, CycB)
interface X { v: number; }
    `.trim();

    const result = transformCode(code, { fileName: "derive-sort-cycle.ts" });

    // Falls back to original order on cycle
    expect(expandOrder).toEqual(["CycA", "CycB"]);
    expect(result.diagnostics.every((d) => !d.message.includes("cycle"))).toBe(true);
  });
});

// ============================================================================
// 4. Primitive type alias handling
// ============================================================================

describe("Primitive type alias detection", () => {
  it("@derive on primitive type alias detects kind as primitive", () => {
    let receivedKind: string | undefined;

    globalRegistry.register({
      kind: "derive",
      name: "TestPrim",
      expand(_ctx, _target, typeInfo) {
        receivedKind = typeInfo.kind;
        return [];
      },
    });

    const code = `
@derive(TestPrim)
type UserId = string;
    `.trim();

    transformCode(code, { fileName: "derive-prim.ts" });

    expect(receivedKind).toBe("primitive");
  });

  it("@derive on non-primitive interface is detected as product", () => {
    let receivedKind: string | undefined;

    globalRegistry.register({
      kind: "derive",
      name: "TestProd",
      expand(_ctx, _target, typeInfo) {
        receivedKind = typeInfo.kind;
        return [];
      },
    });

    const code = `
@derive(TestProd)
interface Point { x: number; y: number; }
    `.trim();

    transformCode(code, { fileName: "derive-prod.ts" });

    expect(receivedKind).toBe("product");
  });
});

// ============================================================================
// 5. Recursive type detection
// ============================================================================

describe("Recursive type detection", () => {
  it("@derive on recursive type sets isRecursive flag", () => {
    let receivedTypeInfo: DeriveTypeInfo | undefined;

    globalRegistry.register({
      kind: "derive",
      name: "TestRec",
      expand(_ctx, _target, typeInfo) {
        receivedTypeInfo = typeInfo;
        return [];
      },
    });

    const code = `
@derive(TestRec)
interface TreeNode {
  value: number;
  left: TreeNode | null;
  right: TreeNode | null;
}
    `.trim();

    transformCode(code, { fileName: "derive-rec.ts" });

    expect(receivedTypeInfo).toBeDefined();
    expect(receivedTypeInfo?.isRecursive).toBe(true);
  });

  it("@derive on non-recursive type does not set isRecursive", () => {
    let receivedTypeInfo: DeriveTypeInfo | undefined;

    globalRegistry.register({
      kind: "derive",
      name: "TestFlat",
      expand(_ctx, _target, typeInfo) {
        receivedTypeInfo = typeInfo;
        return [];
      },
    });

    const code = `
@derive(TestFlat)
interface Flat { a: number; b: string; }
    `.trim();

    transformCode(code, { fileName: "derive-flat.ts" });

    expect(receivedTypeInfo).toBeDefined();
    expect(receivedTypeInfo?.isRecursive).toBeFalsy();
  });
});

// ============================================================================
// 6. Unknown derive import suggestions
// ============================================================================

describe("Unknown derive import suggestions", () => {
  it("reports error for unknown derive name", () => {
    const code = `
@derive(NonExistent)
interface Foo { x: number; }
    `.trim();

    const result = transformCode(code, { fileName: "derive-unknown.ts" });

    const errorDiag = result.diagnostics.find(
      (d) => d.message.includes("Unknown derive") && d.message.includes("NonExistent")
    );
    expect(errorDiag).toBeDefined();
  });

  it("error message includes derive name and resolution paths tried", () => {
    const code = `
@derive(Missing)
interface Bar { v: number; }
    `.trim();

    const result = transformCode(code, { fileName: "derive-missing.ts" });

    const errorDiag = result.diagnostics.find((d) => d.message.includes("Missing"));
    expect(errorDiag).toBeDefined();
    expect(errorDiag?.message).toContain("MissingTC");
    expect(errorDiag?.message).toContain("auto-derivation");
  });
});

// ============================================================================
// 7. {Name}TC convention macros
// ============================================================================

describe("{Name}TC convention macros", () => {
  it("falls through to {Name}TC when no direct derive or builtin match", () => {
    let tcExpanded = false;

    globalRegistry.register({
      kind: "derive",
      name: "CustomTC",
      expand(_ctx, _target, _typeInfo) {
        tcExpanded = true;
        return [];
      },
    });

    const code = `
@derive(Custom)
interface Widget { id: number; }
    `.trim();

    transformCode(code, { fileName: "derive-tc.ts" });

    expect(tcExpanded).toBe(true);
  });

  it("prefers direct derive macro over {Name}TC convention", () => {
    let directExpanded = false;
    let tcExpanded = false;

    globalRegistry.register({
      kind: "derive",
      name: "Direct",
      expand(_ctx, _target, _typeInfo) {
        directExpanded = true;
        return [];
      },
    });

    globalRegistry.register({
      kind: "derive",
      name: "DirectTC",
      expand(_ctx, _target, _typeInfo) {
        tcExpanded = true;
        return [];
      },
    });

    const code = `
@derive(Direct)
interface Item { v: number; }
    `.trim();

    transformCode(code, { fileName: "derive-tc-pref.ts" });

    expect(directExpanded).toBe(true);
    expect(tcExpanded).toBe(false);
  });
});

// ============================================================================
// 8. Decorator stripping on interfaces and type aliases
// ============================================================================

describe("Decorator stripping", () => {
  it("strips @derive decorator from interface output", () => {
    globalRegistry.register({
      kind: "derive",
      name: "Strip",
      expand(_ctx, _target, _typeInfo) {
        return [];
      },
    });

    const code = `
@derive(Strip)
interface Clean { v: number; }
    `.trim();

    const result = transformCode(code, { fileName: "derive-strip.ts" });

    expect(result.code).not.toContain("@derive");
    expect(result.code).toContain("interface Clean");
  });

  it("strips @derive decorator from type alias output", () => {
    globalRegistry.register({
      kind: "derive",
      name: "StripAlias",
      expand(_ctx, _target, _typeInfo) {
        return [];
      },
    });

    const code = `
@derive(StripAlias)
type Alias = string;
    `.trim();

    const result = transformCode(code, { fileName: "derive-strip-alias.ts" });

    expect(result.code).not.toContain("@derive");
    expect(result.code).toContain("type Alias");
  });
});

// ============================================================================
// 9. Edge cases
// ============================================================================

describe("Derive edge cases", () => {
  it("@derive on class works", () => {
    let expandCalled = false;

    globalRegistry.register({
      kind: "derive",
      name: "TestClass",
      expand(_ctx, _target, typeInfo) {
        expandCalled = true;
        expect(typeInfo.kind).toBe("product");
        return [];
      },
    });

    const code = `
@derive(TestClass)
class MyClass {
  x: number = 0;
  y: string = "";
}
    `.trim();

    transformCode(code, { fileName: "derive-class.ts" });

    expect(expandCalled).toBe(true);
  });

  it("@derive with non-identifier argument reports error", () => {
    const code = `
@derive("NotAnIdentifier")
interface Z { v: number; }
    `.trim();

    const result = transformCode(code, { fileName: "derive-bad-arg.ts" });

    const errorDiag = result.diagnostics.find((d) =>
      d.message.includes("derive arguments must be identifiers")
    );
    expect(errorDiag).toBeDefined();
  });

  it("derive macro expansion failure reports error gracefully", () => {
    globalRegistry.register({
      kind: "derive",
      name: "Broken",
      expand(_ctx, _target, _typeInfo) {
        throw new Error("intentional failure");
      },
    });

    const code = `
@derive(Broken)
interface Oops { v: number; }
    `.trim();

    const result = transformCode(code, { fileName: "derive-broken.ts" });

    const errorDiag = result.diagnostics.find(
      (d) =>
        d.message.includes("Derive macro expansion failed") &&
        d.message.includes("intentional failure")
    );
    expect(errorDiag).toBeDefined();
  });

  it("@derive on type alias with product type works", () => {
    let receivedTypeInfo: DeriveTypeInfo | undefined;

    globalRegistry.register({
      kind: "derive",
      name: "TestAlias",
      expand(_ctx, _target, typeInfo) {
        receivedTypeInfo = typeInfo;
        return [];
      },
    });

    const code = `
interface Point { x: number; y: number; }
@derive(TestAlias)
type MyPoint = Point;
    `.trim();

    transformCode(code, { fileName: "derive-alias.ts" });

    expect(receivedTypeInfo).toBeDefined();
    expect(receivedTypeInfo?.name).toBe("MyPoint");
  });
});
