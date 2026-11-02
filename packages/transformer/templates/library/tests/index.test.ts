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
    expect(printAll([1, 2, 3])).toBe("1, 2, 3");
  });
});

describe("Point", () => {
  it("has equality", () => {
    const p1 = new Point(1, 2);
    const p2 = new Point(1, 2);
    const p3 = new Point(3, 4);

    expect(Point.Eq.equals(p1, p2)).toBe(true);
    expect(Point.Eq.equals(p1, p3)).toBe(false);
  });

  it("clones correctly", () => {
    const p1 = new Point(1, 2);
    const p2 = Point.Clone.clone(p1);

    expect(p2).not.toBe(p1);
    expect(Point.Eq.equals(p2, p1)).toBe(true);
  });

  it("debugs correctly", () => {
    const debug = Point.Debug.debug(new Point(1, 2));
    expect(debug).toContain("Point");
    expect(debug).toContain("1");
    expect(debug).toContain("2");
  });

  it("prints through its Printable instance", () => {
    expect(printPoint(new Point(1, 2))).toBe("(1, 2)");
    expect(printAll([new Point(1, 2), new Point(3, 4)])).toBe("(1, 2), (3, 4)");
  });
});
