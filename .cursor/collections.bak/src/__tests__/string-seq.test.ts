import { describe, it, expect } from "vitest";
import { stringOps } from "../instances/string.js";

describe("stringOps", () => {
  it("iterator supports for...of", () => {
    const result: string[] = [];
    for (const ch of stringOps.iterator("abc")) result.push(ch);
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("foldLeft", () => {
    expect(
      stringOps.foldLeft("abc", "", (acc, ch) => acc + ch.toUpperCase()),
    ).toBe("ABC");
  });

  it("map / filter / concat", () => {
    expect(stringOps.map("abc", (ch) => ch.toUpperCase())).toBe("ABC");
    expect(stringOps.filter("aAbBcC", (ch) => ch === ch.toUpperCase())).toBe(
      "ABC",
    );
    expect(stringOps.concat("hello", " world")).toBe("hello world");
  });

  it("from / empty", () => {
    expect(stringOps.from(["h", "i"])).toBe("hi");
    expect(stringOps.empty()).toBe("");
  });

  it("apply / reverse", () => {
    expect(stringOps.apply("abc", 1)).toBe("b");
    expect(stringOps.reverse("abc")).toBe("cba");
  });

  it("size / isEmpty", () => {
    expect(stringOps.size("abc")).toBe(3);
    expect(stringOps.isEmpty("")).toBe(true);
    expect(stringOps.isEmpty("a")).toBe(false);
  });

  it("head / tail / last", () => {
    expect(stringOps.head("abc")).toBe("a");
    expect(stringOps.head("")).toBeUndefined();
    expect(stringOps.tail("abc")).toBe("bc");
    expect(stringOps.last("abc")).toBe("c");
  });

  it("mkString", () => {
    expect(stringOps.mkString("abc", "-")).toBe("a-b-c");
  });
});
