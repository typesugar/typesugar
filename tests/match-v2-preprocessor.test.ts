/**
 * Integration tests for preprocessor match syntax (PEP-008 Wave 6)
 *
 * Verifies that the Scala-style pattern matching syntax in .sts files
 * transforms correctly into the fluent match macro API.
 *
 * These tests exercise all pattern types from Waves 1–5 through the
 * preprocessor pipeline, ensuring end-to-end correctness.
 */

import { describe, it, expect } from "vitest";
import { preprocess } from "../packages/preprocessor/src/index.js";

function pp(source: string) {
  return preprocess(source, { fileName: "test.sts" });
}

describe("Wave 6: Preprocessor pattern matching syntax", () => {
  // ========================================================================
  // Gate criteria #1: Basic syntax compiles correctly
  // ========================================================================
  describe("gate: basic match syntax", () => {
    it("match(x) | [a, b] => a + b | _ => 0 transforms correctly", () => {
      const source = `const r = match(x)\n| [a, b] => a + b\n| _ => 0`;
      const { code, changed } = pp(source);
      expect(changed).toBe(true);
      expect(code).toContain("match(x)");
      expect(code).toContain(".case([a, b]).then(a + b)");
      expect(code).toContain(".else(0)");
    });
  });

  // ========================================================================
  // Gate criteria #2: Source maps
  // ========================================================================
  describe("gate: source maps", () => {
    it("generates valid v3 source map", () => {
      const source = `const r = match(x)\n| 1 => "one"\n| _ => "default"`;
      const { map, changed } = pp(source);
      expect(changed).toBe(true);
      expect(map).not.toBeNull();
      expect(map!.version).toBe(3);
      expect(map!.mappings).toBeTruthy();
      expect(typeof map!.mappings).toBe("string");
    });

    it("preserves line count for simple match", () => {
      const source = [`const r = match(x)`, `| 1 => "one"`, `| 2 => "two"`, `| _ => "other"`].join(
        "\n"
      );
      const { code } = pp(source);
      expect(code.split("\n").length).toBe(source.split("\n").length);
    });

    it("preserves line count for match with guards", () => {
      const source = [
        `const r = match(x)`,
        `| n if n > 0 => "positive"`,
        `| n if n < 0 => "negative"`,
        `| _ => "zero"`,
      ].join("\n");
      const { code } = pp(source);
      expect(code.split("\n").length).toBe(source.split("\n").length);
    });
  });

  // ========================================================================
  // Gate criteria #3: All pattern types from Waves 1-5
  // ========================================================================

  describe("Wave 1 patterns: literals, wildcards, variables, guards", () => {
    it("integer literals", () => {
      const { code } = pp(`match(x)\n| 0 => "zero"\n| 1 => "one"\n| _ => "many"`);
      expect(code).toContain('.case(0).then("zero")');
      expect(code).toContain('.case(1).then("one")');
      expect(code).toContain('.else("many")');
    });

    it("string literals", () => {
      const { code } = pp(`match(cmd)\n| "start" => run()\n| "stop" => halt()\n| _ => noop()`);
      expect(code).toContain('.case("start").then(run())');
      expect(code).toContain('.case("stop").then(halt())');
    });

    it("variable binding with guard", () => {
      const { code } = pp(`match(x)\n| n if n > 0 => n * 2\n| _ => 0`);
      expect(code).toContain(".case(n).if(n > 0).then(n * 2)");
      expect(code).toContain(".else(0)");
    });

    it("wildcard as only arm", () => {
      const { code } = pp(`match(x)\n| _ => fallback`);
      expect(code).toContain(".else(fallback)");
    });

    it("boolean patterns", () => {
      const { code } = pp(`match(flag)\n| true => "on"\n| false => "off"`);
      expect(code).toContain('.case(true).then("on")');
      expect(code).toContain('.case(false).then("off")');
    });

    it("null and undefined patterns", () => {
      const { code } = pp(`match(x)\n| null => "null"\n| undefined => "undef"\n| _ => "val"`);
      expect(code).toContain('.case(null).then("null")');
      expect(code).toContain('.case(undefined).then("undef")');
    });
  });

  describe("Wave 2 patterns: arrays, objects, nested", () => {
    it("array destructuring", () => {
      const { code } = pp(`match(pair)\n| [a, b] => a + b\n| _ => 0`);
      expect(code).toContain(".case([a, b]).then(a + b)");
    });

    it("array with wildcards", () => {
      const { code } = pp(`match(triple)\n| [first, _, _] => first\n| _ => null`);
      expect(code).toContain(".case([first, _, _]).then(first)");
    });

    it("object destructuring", () => {
      const { code } = pp(
        `match(shape)\n| { type: "circle", radius: r } => Math.PI * r * r\n| _ => 0`
      );
      expect(code).toContain('.case({ type: "circle", radius: r }).then(Math.PI * r * r)');
    });

    it("nested array in array", () => {
      const { code } = pp(`match(matrix)\n| [[a, b], [c, d]] => a * d - b * c\n| _ => 0`);
      expect(code).toContain(".case([[a, b], [c, d]]).then(a * d - b * c)");
    });

    it("nested object in array", () => {
      const { code } = pp(`match(items)\n| [{ name: n }, ...rest] => n\n| _ => "empty"`);
      expect(code).toContain(".case([{ name: n }, ...rest]).then(n)");
    });
  });

  describe("Wave 3 patterns: type constructors, OR, AS, regex", () => {
    it("type pattern: string", () => {
      const { code } = pp(`match(x)\n| s: string => s.toUpperCase()\n| _ => ""`);
      expect(code).toContain(".case(String(s)).then(s.toUpperCase())");
    });

    it("type pattern: number", () => {
      const { code } = pp(`match(x)\n| n: number => n.toFixed(2)\n| _ => "NaN"`);
      expect(code).toContain(".case(Number(n)).then(n.toFixed(2))");
    });

    it("type pattern: boolean", () => {
      const { code } = pp(`match(x)\n| b: boolean => !b\n| _ => false`);
      expect(code).toContain(".case(Boolean(b)).then(!b)");
    });

    it("type pattern: class instance", () => {
      const { code } = pp(`match(err)\n| e: TypeError => e.message\n| _ => "unknown"`);
      expect(code).toContain(".case(TypeError(e)).then(e.message)");
    });

    it("OR pattern: numeric", () => {
      const { code } = pp(
        `match(status)\n| 200 | 201 => "ok"\n| 404 => "not found"\n| _ => "error"`
      );
      expect(code).toContain('.case(200).or(201).then("ok")');
    });

    it("OR pattern: string", () => {
      const { code } = pp(`match(cmd)\n| "quit" | "exit" | "q" => shutdown()\n| _ => continue_()`);
      expect(code).toContain('.case("quit").or("exit").or("q").then(shutdown())');
    });

    it("AS pattern: bind to array", () => {
      const { code } = pp(`match(x)\n| p @ [a, b] => [p, a, b]\n| _ => []`);
      expect(code).toContain(".case([a, b]).as(p).then([p, a, b])");
    });

    it("AS pattern: bind to object", () => {
      const { code } = pp(`match(x)\n| whole @ { name } => [whole, name]\n| _ => []`);
      expect(code).toContain(".case({ name }).as(whole).then([whole, name])");
    });

    it("regex pattern: bare", () => {
      const { code } = pp(`match(str)\n| /^\\d+$/ => "number"\n| _ => "other"`);
      expect(code).toContain('.case(/^\\d+$/).then("number")');
    });

    it("regex pattern with as binding", () => {
      const { code } = pp(
        `match(email)\n| /^(\\w+)@(\\w+\\.\\w+)/ as [_, user, domain] => user\n| _ => null`
      );
      expect(code).toContain(".case(/^(\\w+)@(\\w+\\.\\w+)/).as([_, user, domain]).then(user)");
    });
  });

  describe("Wave 4-5 patterns: discriminated unions, extractors", () => {
    it("discriminated union via object pattern", () => {
      const { code } = pp(
        [
          `match(shape)`,
          `| { kind: "circle", radius: r } => Math.PI * r * r`,
          `| { kind: "rect", width: w, height: h } => w * h`,
          `| _ => 0`,
        ].join("\n")
      );
      expect(code).toContain('.case({ kind: "circle", radius: r }).then(Math.PI * r * r)');
      expect(code).toContain('.case({ kind: "rect", width: w, height: h }).then(w * h)');
    });

    it("extractor pattern", () => {
      const { code } = pp(`match(opt)\n| Some(v) => v\n| None() => defaultVal`);
      expect(code).toContain(".case(Some(v)).then(v)");
      expect(code).toContain(".case(None()).then(defaultVal)");
    });
  });

  // ========================================================================
  // Advanced features
  // ========================================================================

  describe("arrow function disambiguation", () => {
    it("arrow in result expression (inside parens)", () => {
      const { code } = pp(`match(xs)\n| arr => arr.map((x) => x * 2)\n| _ => []`);
      expect(code).toContain(".case(arr).then(arr.map((x) => x * 2))");
    });

    it("arrow as result value", () => {
      const { code } = pp(`match(x)\n| n => (y) => y + n\n| _ => (y) => y`);
      expect(code).toContain(".case(n).then((y) => y + n)");
    });
  });

  describe("complex scrutinee expressions", () => {
    it("function call scrutinee", () => {
      const { code } = pp(`match(getResult())\n| 1 => "one"\n| _ => "other"`);
      expect(code).toContain("match(getResult())");
    });

    it("method call scrutinee", () => {
      const { code } = pp(`match(obj.compute(a, b))\n| true => "ok"\n| false => "fail"`);
      expect(code).toContain("match(obj.compute(a, b))");
    });

    it("nested match/function call scrutinee", () => {
      const { code } = pp(`match(arr.filter((x) => x > 0))\n| [] => "empty"\n| _ => "has items"`);
      expect(code).toContain("match(arr.filter((x) => x > 0))");
    });
  });

  describe("multiple match expressions per file", () => {
    it("two consecutive matches", () => {
      const source = [
        `const a = match(x)`,
        `| 1 => "one"`,
        `| _ => "other"`,
        `const b = match(y)`,
        `| true => 1`,
        `| false => 0`,
      ].join("\n");
      const { code, changed } = pp(source);
      expect(changed).toBe(true);
      expect(code).toContain('.case(1).then("one")');
      expect(code).toContain(".case(true).then(1)");
      expect(code).toContain(".case(false).then(0)");
    });
  });

  describe("interaction with other preprocessor extensions", () => {
    it("match syntax works alongside HKT and pipeline", () => {
      const source = [`const r = match(x)`, `| 1 => "one"`, `| _ => "other"`].join("\n");
      // Use all extensions (default behavior)
      const { code, changed } = preprocess(source, { fileName: "test.sts" });
      expect(changed).toBe(true);
      expect(code).toContain('.case(1).then("one")');
    });
  });
});
