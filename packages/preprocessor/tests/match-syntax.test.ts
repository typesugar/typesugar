import { describe, it, expect } from "vitest";
import { preprocess } from "../src/preprocess.js";

function ppMatch(source: string) {
  return preprocess(source, { extensions: ["match-syntax"] });
}

describe("match-syntax extension", () => {
  describe("basic detection", () => {
    it("should not transform match() without pipe arms", () => {
      const source = `const x = match(value).case(1).then("one").else("other")`;
      const { changed } = ppMatch(source);
      expect(changed).toBe(false);
    });

    it("should not transform | on the same line as match()", () => {
      // | on same line is not the preprocessor syntax
      const source = `const x = match(value) | fallback`;
      const { changed } = ppMatch(source);
      expect(changed).toBe(false);
    });
  });

  describe("literal patterns", () => {
    it("should transform integer literal pattern", () => {
      const source = `const y = match(x)\n| 42 => "the answer"\n| _ => "other"`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain('.case(42).then("the answer")');
      expect(code).toContain('.else("other")');
    });

    it("should transform string literal pattern", () => {
      const source = `const y = match(x)\n| "hello" => 1\n| "world" => 2\n| _ => 0`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain('.case("hello").then(1)');
      expect(code).toContain('.case("world").then(2)');
      expect(code).toContain(".else(0)");
    });

    it("should transform boolean literal pattern", () => {
      const source = `const y = match(x)\n| true => "yes"\n| false => "no"`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain('.case(true).then("yes")');
      expect(code).toContain('.case(false).then("no")');
    });
  });

  describe("wildcard pattern", () => {
    it("should transform last wildcard to .else()", () => {
      const source = `const y = match(x)\n| 1 => "one"\n| _ => "default"`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain('.else("default")');
      expect(code).not.toContain(".case(_)");
    });

    it("should keep non-last wildcard as .case(_)", () => {
      const source = `const y = match(x)\n| _ => "first"\n| 1 => "one"`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain('.case(_).then("first")');
      expect(code).toContain('.case(1).then("one")');
    });
  });

  describe("array patterns", () => {
    it("should transform simple array destructuring", () => {
      const source = `const y = match(x)\n| [a, b] => a + b\n| _ => 0`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain(".case([a, b]).then(a + b)");
      expect(code).toContain(".else(0)");
    });

    it("should transform nested array pattern", () => {
      const source = `const y = match(x)\n| [first, _, _] if first > 0 => first\n| [_, second, _] => second\n| _ => 0`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain(".case([first, _, _]).if(first > 0).then(first)");
      expect(code).toContain(".case([_, second, _]).then(second)");
      expect(code).toContain(".else(0)");
    });
  });

  describe("object patterns", () => {
    it("should transform simple object destructuring", () => {
      const source = `const y = match(x)\n| { type: "circle", radius: r } => Math.PI * r * r\n| _ => 0`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain('.case({ type: "circle", radius: r }).then(Math.PI * r * r)');
    });
  });

  describe("guard expressions", () => {
    it("should transform pattern with if guard", () => {
      const source = `const y = match(x)\n| n if n > 0 => "positive"\n| n if n < 0 => "negative"\n| _ => "zero"`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain('.case(n).if(n > 0).then("positive")');
      expect(code).toContain('.case(n).if(n < 0).then("negative")');
      expect(code).toContain('.else("zero")');
    });

    it("should handle complex guard expression", () => {
      const source = `const y = match(x)\n| [a, b] if a > 0 && b > 0 => a * b\n| _ => 0`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain(".case([a, b]).if(a > 0 && b > 0).then(a * b)");
    });
  });

  describe("type patterns", () => {
    it("should transform string type pattern", () => {
      const source = `const y = match(x)\n| s: string => s.length\n| _ => 0`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain(".case(String(s)).then(s.length)");
    });

    it("should transform number type pattern", () => {
      const source = `const y = match(x)\n| n: number => n * 2\n| _ => 0`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain(".case(Number(n)).then(n * 2)");
    });

    it("should transform boolean type pattern", () => {
      const source = `const y = match(x)\n| b: boolean => !b\n| _ => null`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain(".case(Boolean(b)).then(!b)");
    });

    it("should transform class type pattern", () => {
      const source = `const y = match(x)\n| d: Date => d.getTime()\n| _ => 0`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain(".case(Date(d)).then(d.getTime())");
    });
  });

  describe("AS patterns", () => {
    it("should transform AS pattern with array", () => {
      const source = `const y = match(x)\n| p @ [a, b] => p\n| _ => null`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain(".case([a, b]).as(p).then(p)");
    });

    it("should transform AS pattern with object", () => {
      const source = `const y = match(x)\n| p @ { name, age } => p\n| _ => null`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain(".case({ name, age }).as(p).then(p)");
    });
  });

  describe("OR patterns", () => {
    it("should transform simple OR pattern", () => {
      const source = `const y = match(status)\n| 200 | 201 => "ok"\n| 404 => "not found"\n| _ => "error"`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain('.case(200).or(201).then("ok")');
    });

    it("should transform triple OR pattern", () => {
      const source = `const y = match(status)\n| 200 | 201 | 204 => "success"\n| _ => "failure"`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain('.case(200).or(201).or(204).then("success")');
    });

    it("should transform string OR pattern", () => {
      const source = `const y = match(cmd)\n| "quit" | "exit" | "q" => true\n| _ => false`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain('.case("quit").or("exit").or("q").then(true)');
    });
  });

  describe("regex patterns", () => {
    it("should transform bare regex pattern", () => {
      const source = `const y = match(str)\n| /^hello/ => "greeting"\n| _ => "other"`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain('.case(/^hello/).then("greeting")');
    });

    it("should transform regex with as binding", () => {
      const source = `const y = match(str)\n| /^(\\w+)@(\\w+)/ as [_, user, domain] => user\n| _ => null`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain(".case(/^(\\w+)@(\\w+)/).as([_, user, domain]).then(user)");
    });
  });

  describe("extractor patterns", () => {
    it("should pass extractor patterns through", () => {
      const source = `const y = match(x)\n| Some(v) => v\n| None() => 0`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain(".case(Some(v)).then(v)");
      expect(code).toContain(".case(None()).then(0)");
    });
  });

  describe("arrow function disambiguation", () => {
    it("should handle arrow function in result expression", () => {
      const source = `const y = match(x)\n| f => f((x) => x + 1)\n| _ => 0`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain(".case(f).then(f((x) => x + 1))");
    });

    it("should handle arrow function result", () => {
      const source = `const y = match(x)\n| n => (y) => y + n\n| _ => (y) => y`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain(".case(n).then((y) => y + n)");
    });
  });

  describe("multi-expression scrutinee", () => {
    it("should handle complex expression as scrutinee", () => {
      const source = `const y = match(getResult())\n| 1 => "one"\n| _ => "other"`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain("match(getResult())");
      expect(code).toContain('.case(1).then("one")');
    });

    it("should handle nested call as scrutinee", () => {
      const source = `const y = match(obj.method(a, b))\n| true => 1\n| false => 0`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain("match(obj.method(a, b))");
    });
  });

  describe("source map generation", () => {
    it("should generate source map when match syntax is transformed", () => {
      const source = `const y = match(x)\n| 42 => "yes"\n| _ => "no"`;
      const { map, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(map).not.toBeNull();
      expect(map!.version).toBe(3);
      expect(map!.mappings).toBeTruthy();
    });

    it("should preserve line count", () => {
      const source = `const y = match(x)\n| [a, b] => a + b\n| [_, second, _] => second\n| _ => 0`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      const originalLines = source.split("\n").length;
      const outputLines = code.split("\n").length;
      expect(outputLines).toBe(originalLines);
    });
  });

  describe("edge cases", () => {
    it("should handle single arm match", () => {
      const source = `const y = match(x)\n| _ => "default"`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain('.else("default")');
    });

    it("should handle match with semicolon terminator", () => {
      const source = `const y = match(x)\n| 1 => "one"\n| _ => "other";\nconsole.log(y)`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain('.case(1).then("one")');
      expect(code).toContain('.else("other")');
      expect(code).toContain("console.log(y)");
    });

    it("should not interfere with non-match code", () => {
      const source = `const a = 1;\nconst y = match(x)\n| 1 => "one"\n| _ => "other"\nconst b = 2;`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain("const a = 1;");
      expect(code).toContain("const b = 2;");
    });

    it("should handle multiple match expressions in same file", () => {
      const source = `const a = match(x)\n| 1 => "one"\n| _ => "other"\nconst b = match(y)\n| true => 1\n| false => 0`;
      const { code, changed } = ppMatch(source);
      expect(changed).toBe(true);
      expect(code).toContain('.case(1).then("one")');
      expect(code).toContain(".case(true).then(1)");
    });
  });
});
