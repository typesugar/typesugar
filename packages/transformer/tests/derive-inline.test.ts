/**
 * Tests for PEP-019 Wave 4: Auto-Inline Derived Typeclass Instances
 *
 * Gate criteria:
 * - eqPoint.eq(p1, p2) inlines to p1.x === p2.x && p1.y === p2.y
 * - Recursive instances inline fully (no eqNumber.eq in output)
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
// Gate 1: eqPoint.eq(p1, p2) → p1.x === p2.x && p1.y === p2.y
// ============================================================================

describe("Derived instance call inlining", () => {
  it("inlines eqPoint.eq(p1, p2) to field comparisons", () => {
    const code = `
/** @impl Eq<Point> */
const eqPoint = {
  eq: (a: any, b: any) => a.x === b.x && a.y === b.y,
  neq: (a: any, b: any) => !(a.x === b.x && a.y === b.y),
};

const p1 = { x: 1, y: 2 };
const p2 = { x: 1, y: 2 };
console.log(eqPoint.eq(p1, p2));
    `.trim();

    const result = transformCode(code, { fileName: "derive-inline-eq.ts" });

    // Should inline the eq call
    expect(result.code).toContain("p1.x === p2.x && p1.y === p2.y");
    // Should NOT contain eqPoint.eq call
    expect(result.code).not.toContain("eqPoint.eq(");
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("inlines neq method too", () => {
    const code = `
/** @impl Eq<Point> */
const eqPoint = {
  eq: (a: any, b: any) => a.x === b.x && a.y === b.y,
  neq: (a: any, b: any) => !(a.x === b.x && a.y === b.y),
};

const p1 = { x: 1, y: 2 };
const p2 = { x: 3, y: 4 };
console.log(eqPoint.neq(p1, p2));
    `.trim();

    const result = transformCode(code, { fileName: "derive-inline-neq.ts" });

    // Should inline the neq call
    expect(result.code).toContain("!(p1.x === p2.x && p1.y === p2.y)");
    expect(result.code).not.toContain("eqPoint.neq(");
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
// Gate 2: Recursive inlining (no eqNumber.eq in output)
// ============================================================================

describe("Recursive inlining of nested instance calls", () => {
  it("recursively inlines eqNumber.eq to ===", () => {
    const code = `
/** @impl Eq<Point> */
const eqPoint = {
  eq: (a: any, b: any) => eqNumber.eq(a.x, b.x) && eqNumber.eq(a.y, b.y),
  neq: (a: any, b: any) => !(eqNumber.eq(a.x, b.x) && eqNumber.eq(a.y, b.y)),
};

const p1 = { x: 1, y: 2 };
const p2 = { x: 1, y: 2 };
console.log(eqPoint.eq(p1, p2));
    `.trim();

    const result = transformCode(code, { fileName: "derive-inline-recursive.ts" });

    // After recursive inlining, eqNumber.eq(a.x, b.x) should become a.x === b.x
    expect(result.code).not.toContain("eqNumber.eq");
    expect(result.code).toContain("===");
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("handles multiple levels of nesting", () => {
    const code = `
/** @impl Eq<Inner> */
const eqInner = {
  eq: (a: any, b: any) => eqNumber.eq(a.val, b.val),
};

/** @impl Eq<Outer> */
const eqOuter = {
  eq: (a: any, b: any) => eqInner.eq(a.inner, b.inner) && eqString.eq(a.name, b.name),
};

const a = { inner: { val: 1 }, name: "test" };
const b = { inner: { val: 1 }, name: "test" };
console.log(eqOuter.eq(a, b));
    `.trim();

    const result = transformCode(code, { fileName: "derive-inline-nested.ts" });

    // Neither eqInner nor eqNumber/eqString should remain after recursive inlining
    expect(result.code).not.toContain("eqInner.eq");
    expect(result.code).not.toContain("eqNumber.eq");
    expect(result.code).not.toContain("eqString.eq");
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
  eq: (a: any, b: any) => a.x === b.x && a.y === b.y,
};

const p1 = { x: 1, y: 2 };
const p2 = { x: 1, y: 2 };
const areEqual = eqPoint.eq(p1, p2);
    `.trim();

    const result = transformCode(code, { fileName: "derive-dce-removed.ts" });

    // The eqPoint declaration should be removed
    expect(result.code).not.toContain("const eqPoint");
    // The inlined result should be present
    expect(result.code).toContain("p1.x === p2.x && p1.y === p2.y");
  });

  it("removes registration call along with declaration", () => {
    const code = `
/** @impl Eq<Point> */
const eqPoint = {
  eq: (a: any, b: any) => a.x === b.x && a.y === b.y,
};
Eq.registerInstance("Point", eqPoint);

console.log(eqPoint.eq({x:1,y:2}, {x:1,y:2}));
    `.trim();

    const result = transformCode(code, { fileName: "derive-dce-register.ts" });

    // Both declaration and registration should be removed
    expect(result.code).not.toContain("const eqPoint");
    expect(result.code).not.toContain("registerInstance");
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
  eq: (a: any, b: any) => a.x === b.x && a.y === b.y,
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
  eq: (a: any, b: any) => a.x === b.x && a.y === b.y,
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
  eq: (a: any, b: any) => a.x === b.x && a.y === b.y,
};

const p1 = { x: 1, y: 2 };
const p2 = { x: 1, y: 2 };
const areEqual = eqPoint.eq(p1, p2);
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
  it("inlines eqNumber.eq to ===", () => {
    const code = `
const result = eqNumber.eq(1, 2);
    `.trim();

    const result = transformCode(code, { fileName: "intrinsic-eq-number.ts" });

    expect(result.code).toContain("1 === 2");
    expect(result.code).not.toContain("eqNumber.eq");
  });

  it("inlines eqString.eq to ===", () => {
    const code = `
const a = "hello";
const b = "world";
const result = eqString.eq(a, b);
    `.trim();

    const result = transformCode(code, { fileName: "intrinsic-eq-string.ts" });

    expect(result.code).toContain("a === b");
    expect(result.code).not.toContain("eqString.eq");
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
  eq: (a: any, b: any) => a.value === b.value,
};

const w1 = { value: 42 };
const w2 = { value: 42 };
const same = eqWrapper.eq(w1, w2);
    `.trim();

    const result = transformCode(code, { fileName: "derive-no-iife.ts" });

    // Should be a direct expression, not wrapped in an IIFE
    expect(result.code).not.toContain("(() =>");
    expect(result.code).toContain("w1.value === w2.value");
  });
});
