import { describe, it, expect } from "vitest";
import { Point, printAll, printPoint, PrintableNumber, PrintableString } from "../src/index.js";

describe("Printable typeclass", () => {
  it("prints numbers", () => {
    expect(PrintableNumber.print(42)).toBe("42");
  });

  it("prints strings", () => {
    expect(PrintableString.print("hello")).toBe('"hello"');
  });

  it("prints arrays with printAll", () => {
    const result = printAll([1, 2, 3]);
    expect(result).toBe("1, 2, 3");
  });
});

describe("Point", () => {
  it("has equality", () => {
    const p1 = new Point(1, 2);
    const p2 = new Point(1, 2);
    const p3 = new Point(3, 4);

    expect(p1.equals(p2)).toBe(true);
    expect(p1.equals(p3)).toBe(false);
  });

  it("clones correctly", () => {
    const p1 = new Point(1, 2);
    const p2 = p1.clone();

    expect(p2).not.toBe(p1);
    expect(p2.equals(p1)).toBe(true);
  });

  it("debugs correctly", () => {
    const p = new Point(1, 2);
    expect(p.debug()).toContain("Point");
    expect(p.debug()).toContain("1");
    expect(p.debug()).toContain("2");
  });

  it("prints via extension", () => {
    const p = new Point(1, 2);
    const result = printPoint(p);
    expect(result).toBeDefined();
  });
});
