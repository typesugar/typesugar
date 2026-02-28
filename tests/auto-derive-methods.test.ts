/**
 * Tests for auto-derivation method filtering
 *
 * Verifies that extractMetaFromTypeChecker skips methods when
 * extracting GenericMeta for auto-derivation.
 *
 * Bug: Classes with methods (like Unit<D>) were failing auto-derivation
 * because methods were included in fieldTypes, and hasFieldInstance
 * returned false for function types.
 *
 * Fix: Skip properties with call signatures in extractMetaFromTypeChecker.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { transformCode } from "@typesugar/transformer";
import {
  clearRegistries,
  clearSyntaxRegistry,
  registerTypeclassDef,
  registerInstanceWithMeta,
  clearDerivationCaches,
} from "@typesugar/macros";

// Import macros package to ensure summonMacro is registered
import "@typesugar/macros";

beforeEach(() => {
  // Clear typeclass-specific registries but NOT the global macro registry
  // since we need summonMacro to remain registered
  clearSyntaxRegistry();
  clearRegistries();
  clearDerivationCaches();
});

function setupEqTypeclass() {
  registerTypeclassDef({
    name: "Eq",
    typeParams: ["T"],
    methods: [{ name: "eq", params: ["a", "b"], returnType: "boolean" }],
    syntax: new Map([["===", "eq"]]),
  });
  registerInstanceWithMeta({
    typeclassName: "Eq",
    forType: "number",
    instanceName: "eqNumber",
    derived: false,
  });
  registerInstanceWithMeta({
    typeclassName: "Eq",
    forType: "string",
    instanceName: "eqString",
    derived: false,
  });
}

function setupShowTypeclass() {
  registerTypeclassDef({
    name: "Show",
    typeParams: ["T"],
    methods: [{ name: "show", params: ["a"], returnType: "string" }],
    syntax: new Map(),
  });
  registerInstanceWithMeta({
    typeclassName: "Show",
    forType: "number",
    instanceName: "showNumber",
    derived: false,
  });
  registerInstanceWithMeta({
    typeclassName: "Show",
    forType: "string",
    instanceName: "showString",
    derived: false,
  });
}

// ============================================================================
// 1. Classes with methods should auto-derive correctly
// ============================================================================

describe("auto-derive method filtering", () => {
  it("should skip methods when extracting GenericMeta for a class", () => {
    setupEqTypeclass();

    const code = `
      import { summon } from "typesugar";

      // Class with both data properties and methods
      class Point {
        constructor(public x: number, public y: number) {}

        add(other: Point): Point {
          return new Point(this.x + other.x, this.y + other.y);
        }

        scale(factor: number): Point {
          return new Point(this.x * factor, this.y * factor);
        }

        toString(): string {
          return \`Point(\${this.x}, \${this.y})\`;
        }
      }

      // This should auto-derive Eq for Point, only considering x and y (not methods)
      const eq = summon<Eq<Point>>();
    `;

    const r = transformCode(code, { fileName: "auto-derive-class.ts", verbose: true });

    // The transformation should succeed without errors
    const errors = r.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(0);

    // The output should contain derived Eq implementation
    expect(r.code).toContain("a.x === b.x");
    expect(r.code).toContain("a.y === b.y");

    // The output should NOT contain method names in the comparison
    expect(r.code).not.toContain("a.add");
    expect(r.code).not.toContain("a.scale");
    expect(r.code).not.toContain("a.toString");
  });

  it("should skip methods in interfaces with method signatures", () => {
    setupEqTypeclass();

    const code = `
      import { summon } from "typesugar";

      // Interface with both data properties and method signatures
      interface Entity {
        id: number;
        name: string;
        clone(): Entity;
        validate(): boolean;
      }

      const eq = summon<Eq<Entity>>();
    `;

    const r = transformCode(code, { fileName: "auto-derive-interface.ts" });

    const errors = r.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(0);

    // Should compare data properties
    expect(r.code).toContain("a.id === b.id");
    expect(r.code).toContain("a.name === b.name");

    // Should NOT try to compare methods
    expect(r.code).not.toContain("a.clone");
    expect(r.code).not.toContain("a.validate");
  });

  it("should handle types with only methods (no data properties)", () => {
    setupEqTypeclass();

    const code = `
      import { summon } from "typesugar";

      // Interface with only method signatures
      interface Behavior {
        execute(): void;
        cancel(): void;
      }

      const eq = summon<Eq<Behavior>>();
    `;

    const r = transformCode(code, { fileName: "auto-derive-methods-only.ts" });

    // Should fail to derive because there are no data properties
    // (empty fieldNames after filtering methods)
    const errors = r.diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("No instance found");
  });
});

// ============================================================================
// 2. Show derivation should also skip methods
// ============================================================================

describe("auto-derive Show with methods", () => {
  it("should derive Show for class with methods", () => {
    setupShowTypeclass();

    const code = `
      import { summon } from "typesugar";

      class Counter {
        constructor(public value: number, public label: string) {}

        increment(): Counter {
          return new Counter(this.value + 1, this.label);
        }

        reset(): Counter {
          return new Counter(0, this.label);
        }
      }

      const show = summon<Show<Counter>>();
    `;

    const r = transformCode(code, { fileName: "auto-derive-show.ts" });

    const errors = r.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(0);

    // Should generate Show that uses data properties
    expect(r.code).toContain("Counter");
    expect(r.code).toContain("value");
    expect(r.code).toContain("label");

    // Extract the derived Show expression (the part after "const show = ")
    const showExpr = r.code.match(/const show = \(([^;]+)\);/)?.[1] ?? "";

    // The derived Show should reference value and label but NOT methods
    expect(showExpr).toContain("value");
    expect(showExpr).toContain("label");
    expect(showExpr).not.toContain("increment");
    expect(showExpr).not.toContain("reset");
  });
});

// ============================================================================
// 3. Mixed property types (getters, setters, regular methods)
// ============================================================================

describe("auto-derive with getters and setters", () => {
  it("should include getter properties but skip methods", () => {
    setupEqTypeclass();

    const code = `
      import { summon } from "typesugar";

      class Rectangle {
        constructor(public width: number, public height: number) {}

        // Getter - treated as property, should be skipped as it has no value declaration
        get area(): number {
          return this.width * this.height;
        }

        // Method - should be skipped
        scale(factor: number): Rectangle {
          return new Rectangle(this.width * factor, this.height * factor);
        }
      }

      const eq = summon<Eq<Rectangle>>();
    `;

    const r = transformCode(code, { fileName: "auto-derive-getters.ts" });

    const errors = r.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(0);

    // Should compare data properties
    expect(r.code).toContain("a.width === b.width");
    expect(r.code).toContain("a.height === b.height");

    // Should NOT compare method or getter (getters are computed, not stored data)
    expect(r.code).not.toContain("a.scale");
  });
});

// ============================================================================
// 4. Regression: Unit<D> style class (the original bug report)
// ============================================================================

describe("auto-derive Unit<D> style class", () => {
  it("should derive Eq for a class with many methods like Unit<D>", () => {
    setupEqTypeclass();

    const code = `
      import { summon } from "typesugar";

      // Simulating the Unit<D> class structure from the bug report
      class Unit {
        constructor(public value: number, public symbol: string) {}

        // Arithmetic methods
        add(other: Unit): Unit {
          return new Unit(this.value + other.value, this.symbol);
        }

        sub(other: Unit): Unit {
          return new Unit(this.value - other.value, this.symbol);
        }

        mul(other: Unit): Unit {
          return new Unit(this.value * other.value, this.symbol);
        }

        div(other: Unit): Unit {
          return new Unit(this.value / other.value, this.symbol);
        }

        scale(factor: number): Unit {
          return new Unit(this.value * factor, this.symbol);
        }

        neg(): Unit {
          return new Unit(-this.value, this.symbol);
        }

        // Comparison and conversion methods
        equals(other: Unit): boolean {
          return this.value === other.value && this.symbol === other.symbol;
        }

        toString(): string {
          return \`\${this.value} \${this.symbol}\`;
        }
      }

      // This was the failing case - summon<Eq<Unit>> would fail because
      // methods like "add" were included in fieldTypes as "(other: Unit) => Unit"
      // which hasFieldInstance rejected.
      const eq = summon<Eq<Unit>>();
    `;

    const r = transformCode(code, { fileName: "auto-derive-unit.ts", verbose: true });

    // This should now succeed
    const errors = r.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(0);

    // Should compare only value and symbol
    expect(r.code).toContain("a.value === b.value");
    expect(r.code).toContain("a.symbol === b.symbol");

    // Should NOT contain any method comparisons
    expect(r.code).not.toContain("a.add");
    expect(r.code).not.toContain("a.sub");
    expect(r.code).not.toContain("a.mul");
    expect(r.code).not.toContain("a.div");
    expect(r.code).not.toContain("a.scale");
    expect(r.code).not.toContain("a.neg");
    expect(r.code).not.toContain("a.equals");
    expect(r.code).not.toContain("a.toString");
  });
});
