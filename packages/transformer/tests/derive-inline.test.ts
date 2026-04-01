/**
 * Tests for PEP-019 Wave 4: Auto-Inline Derived Typeclass Instances
 *
 * Gate criteria:
 * - eqPoint.equals(p1, p2) inlines to p1.x === p2.x && p1.y === p2.y
 * - Recursive instances inline fully (no eqNumber.equals in output)
 * - Dictionary declaration is removed when all uses are inlined
 * - Non-inlineable uses (passing as value) keep the declaration
 * - All typeclass and derive tests pass
 */

import { describe, it, expect, beforeEach } from "vitest";
import { transformCode } from "../src/pipeline.js";
import { clearRegistries, clearSyntaxRegistry } from "@typesugar/macros";

beforeEach(() => {
  clearRegistries();
  clearSyntaxRegistry();
});

// ============================================================================
// Gate 1: eqPoint.equals(p1, p2) → p1.x === p2.x && p1.y === p2.y
// ============================================================================

describe("Derived instance call inlining", () => {
  it("inlines eqPoint.equals(p1, p2) to field comparisons", () => {
    const code = `
/** @impl Eq<Point> */
const eqPoint = {
  equals: (a: any, b: any) => a.x === b.x && a.y === b.y,
  notEquals: (a: any, b: any) => !(a.x === b.x && a.y === b.y),
};

const p1 = { x: 1, y: 2 };
const p2 = { x: 1, y: 2 };
console.log(eqPoint.equals(p1, p2));
    `.trim();

    const result = transformCode(code, { fileName: "derive-inline-eq.ts" });

    // Should inline the equals call
    expect(result.code).toContain("p1.x === p2.x && p1.y === p2.y");
    // Should NOT contain eqPoint.equals call
    expect(result.code).not.toContain("eqPoint.equals(");
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("inlines notEquals method too", () => {
    const code = `
/** @impl Eq<Point> */
const eqPoint = {
  equals: (a: any, b: any) => a.x === b.x && a.y === b.y,
  notEquals: (a: any, b: any) => !(a.x === b.x && a.y === b.y),
};

const p1 = { x: 1, y: 2 };
const p2 = { x: 3, y: 4 };
console.log(eqPoint.notEquals(p1, p2));
    `.trim();

    const result = transformCode(code, { fileName: "derive-inline-neq.ts" });

    // Should inline the notEquals call
    expect(result.code).toContain("!(p1.x === p2.x && p1.y === p2.y)");
    expect(result.code).not.toContain("eqPoint.notEquals(");
  });

  it("inlines Show instance method", () => {
    const code = `
/** @impl Show<User> */
const showUser = {
  show: (a: any) => \`User(name=\${a.name}, age=\${a.age})\`,
};

const u = { name: "Alice", age: 30 };
console.log(showUser.show(u));
    `.trim();

    const result = transformCode(code, { fileName: "derive-inline-show.ts" });

    expect(result.code).not.toContain("showUser.show(");
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });
});

// ============================================================================
// Gate 2: Recursive inlining (no eqNumber.equals in output)
// ============================================================================

describe("Recursive inlining of nested instance calls", () => {
  it("recursively inlines eqNumber.equals to ===", () => {
    const code = `
/** @impl Eq<Point> */
const eqPoint = {
  equals: (a: any, b: any) => eqNumber.equals(a.x, b.x) && eqNumber.equals(a.y, b.y),
  notEquals: (a: any, b: any) => !(eqNumber.equals(a.x, b.x) && eqNumber.equals(a.y, b.y)),
};

const p1 = { x: 1, y: 2 };
const p2 = { x: 1, y: 2 };
console.log(eqPoint.equals(p1, p2));
    `.trim();

    const result = transformCode(code, { fileName: "derive-inline-recursive.ts" });

    // The call site should be fully inlined — no eqPoint.equals call remains
    expect(result.code).not.toContain("eqPoint.equals(");
    // The inlined output at the call site should use ===
    expect(result.code).toContain("p1.x === p2.x && p1.y === p2.y");
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("handles multiple levels of nesting", () => {
    const code = `
/** @impl Eq<Inner> */
const eqInner = {
  equals: (a: any, b: any) => eqNumber.equals(a.val, b.val),
};

/** @impl Eq<Outer> */
const eqOuter = {
  equals: (a: any, b: any) => eqInner.equals(a.inner, b.inner) && eqString.equals(a.name, b.name),
};

const a = { inner: { val: 1 }, name: "test" };
const b = { inner: { val: 1 }, name: "test" };
console.log(eqOuter.equals(a, b));
    `.trim();

    const result = transformCode(code, { fileName: "derive-inline-nested.ts" });

    // The call site should be fully inlined — no eqOuter.equals call remains
    expect(result.code).not.toContain("eqOuter.equals(");
    // The inlined output at the call site should use === for deep comparisons
    expect(result.code).toContain("a.inner.val === b.inner.val");
    expect(result.code).toContain("a.name === b.name");
    expect(result.code).toContain("===");
  });
});

// ============================================================================
// Gate 3: Dictionary DCE — removed when all uses are inlined
// ============================================================================

describe("Dead code elimination for fully-inlined dictionaries", () => {
  it("removes dictionary declaration when all uses are inlined", () => {
    const code = `
/** @impl Eq<Point> */
const eqPoint = {
  equals: (a: any, b: any) => a.x === b.x && a.y === b.y,
};

const p1 = { x: 1, y: 2 };
const p2 = { x: 1, y: 2 };
const areEqual = eqPoint.equals(p1, p2);
    `.trim();

    const result = transformCode(code, { fileName: "derive-dce-removed.ts" });

    // The call site should be inlined
    expect(result.code).not.toContain("eqPoint.equals(");
    // The inlined result should be present
    expect(result.code).toContain("p1.x === p2.x && p1.y === p2.y");
    // PEP-032 companion assignment keeps the declaration alive
    expect(result.code).toContain("(Point as any).Eq = eqPoint");
  });

  it("removes registration call along with declaration", () => {
    const code = `
/** @impl Eq<Point> */
const eqPoint = {
  equals: (a: any, b: any) => a.x === b.x && a.y === b.y,
};
Eq.registerInstance("Point", eqPoint);

console.log(eqPoint.equals({x:1,y:2}, {x:1,y:2}));
    `.trim();

    const result = transformCode(code, { fileName: "derive-dce-register.ts" });

    // The call site should be inlined
    expect(result.code).not.toContain("eqPoint.equals(");
    // PEP-032 companion assignment keeps the declaration alive, so
    // registerInstance also stays (it still references eqPoint)
    expect(result.code).toContain("(Point as any).Eq = eqPoint");
  });
});

// ============================================================================
// Gate 4: Non-inlineable uses keep the declaration
// ============================================================================

describe("Non-inlineable uses preserve the declaration", () => {
  it("keeps declaration when instance is passed as a value to a non-specializable function", () => {
    const code = `
/** @impl Eq<Point> */
const eqPoint = {
  equals: (a: any, b: any) => a.x === b.x && a.y === b.y,
};

declare function useEq(eq: any): any;
const result = useEq(eqPoint);
    `.trim();

    const result = transformCode(code, { fileName: "derive-keep-value.ts" });

    // eqPoint is passed as a value to an external function that can't be specialized,
    // so the declaration must be kept
    expect(result.code).toContain("eqPoint");
  });

  it("keeps declaration when instance is assigned to another variable", () => {
    const code = `
/** @impl Eq<Point> */
const eqPoint = {
  equals: (a: any, b: any) => a.x === b.x && a.y === b.y,
};

const myEq = eqPoint;
    `.trim();

    const result = transformCode(code, { fileName: "derive-keep-assign.ts" });

    expect(result.code).toContain("const eqPoint");
  });

  it("keeps declaration when instance has both inlined and value uses", () => {
    const code = `
/** @impl Eq<Point> */
const eqPoint = {
  equals: (a: any, b: any) => a.x === b.x && a.y === b.y,
};

const p1 = { x: 1, y: 2 };
const p2 = { x: 1, y: 2 };
const areEqual = eqPoint.equals(p1, p2);
const stored = eqPoint;
    `.trim();

    const result = transformCode(code, { fileName: "derive-keep-mixed.ts" });

    // Declaration must be kept because of the value reference
    expect(result.code).toContain("const eqPoint");
  });
});

// ============================================================================
// Primitive intrinsic inlining
// ============================================================================

describe("Primitive typeclass intrinsics", () => {
  it("inlines eqNumber.equals to ===", () => {
    const code = `
const result = eqNumber.equals(1, 2);
    `.trim();

    const result = transformCode(code, { fileName: "intrinsic-eq-number.ts" });

    expect(result.code).toContain("1 === 2");
    expect(result.code).not.toContain("eqNumber.equals");
  });

  it("inlines eqString.equals to ===", () => {
    const code = `
const a = "hello";
const b = "world";
const result = eqString.equals(a, b);
    `.trim();

    const result = transformCode(code, { fileName: "intrinsic-eq-string.ts" });

    expect(result.code).toContain("a === b");
    expect(result.code).not.toContain("eqString.equals");
  });

  it("inlines ordNumber.compare", () => {
    const code = `
const cmp = ordNumber.compare(3, 5);
    `.trim();

    const result = transformCode(code, { fileName: "intrinsic-ord-number.ts" });

    expect(result.code).not.toContain("ordNumber.compare");
    expect(result.code).toContain("<");
    expect(result.code).toContain(">");
  });
});

// ============================================================================
// Simple expression inlining (no IIFE wrapper)
// ============================================================================

describe("Simple expression inlining", () => {
  it("produces direct expression without IIFE for simple bodies", () => {
    const code = `
/** @impl Eq<Wrapper> */
const eqWrapper = {
  equals: (a: any, b: any) => a.value === b.value,
};

const w1 = { value: 42 };
const w2 = { value: 42 };
const same = eqWrapper.equals(w1, w2);
    `.trim();

    const result = transformCode(code, { fileName: "derive-no-iife.ts" });

    // Should be a direct expression, not wrapped in an IIFE
    expect(result.code).not.toContain("(() =>");
    expect(result.code).toContain("w1.value === w2.value");
  });
});
