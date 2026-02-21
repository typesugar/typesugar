import { describe, it, expect } from "vitest";
import {
  literal,
  char,
  charRange,
  anyChar,
  regex,
  eof,
  seq,
  seq3,
  alt,
  many,
  many1,
  optional,
  not,
  map,
  sepBy,
  sepBy1,
  between,
  lazy,
  digit,
  letter,
  whitespace,
  token,
  integer,
  float,
  quotedString,
  ParseError,
} from "../index.js";
import type { Parser } from "../types.js";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

describe("literal", () => {
  it("matches an exact string", () => {
    const p = literal("hello");
    const r = p.parse("hello world");
    expect(r).toEqual({ ok: true, value: "hello", pos: 5 });
  });

  it("fails on mismatch", () => {
    const p = literal("hello");
    const r = p.parse("world");
    expect(r.ok).toBe(false);
  });

  it("fails on partial match at end of input", () => {
    const p = literal("hello");
    const r = p.parse("hel");
    expect(r.ok).toBe(false);
  });

  it("matches empty string", () => {
    const p = literal("");
    const r = p.parse("anything");
    expect(r).toEqual({ ok: true, value: "", pos: 0 });
  });
});

describe("char", () => {
  it("matches a single character", () => {
    expect(char("x").parse("xyz")).toEqual({ ok: true, value: "x", pos: 1 });
  });

  it("fails on wrong character", () => {
    expect(char("x").parse("abc").ok).toBe(false);
  });

  it("fails on empty input", () => {
    expect(char("x").parse("").ok).toBe(false);
  });
});

describe("charRange", () => {
  it("matches characters in range", () => {
    const p = charRange("a", "z");
    expect(p.parse("m")).toEqual({ ok: true, value: "m", pos: 1 });
    expect(p.parse("a")).toEqual({ ok: true, value: "a", pos: 1 });
    expect(p.parse("z")).toEqual({ ok: true, value: "z", pos: 1 });
  });

  it("fails on characters outside range", () => {
    const p = charRange("a", "z");
    expect(p.parse("A").ok).toBe(false);
    expect(p.parse("0").ok).toBe(false);
  });

  it("works for digit range", () => {
    const p = charRange("0", "9");
    expect(p.parse("5")).toEqual({ ok: true, value: "5", pos: 1 });
    expect(p.parse("a").ok).toBe(false);
  });
});

describe("anyChar", () => {
  it("matches any character", () => {
    expect(anyChar().parse("x")).toEqual({ ok: true, value: "x", pos: 1 });
    expect(anyChar().parse("\n")).toEqual({ ok: true, value: "\n", pos: 1 });
  });

  it("fails on empty input", () => {
    expect(anyChar().parse("").ok).toBe(false);
  });
});

describe("regex", () => {
  it("matches a pattern at current position", () => {
    const p = regex(/[0-9]+/);
    expect(p.parse("123abc")).toEqual({ ok: true, value: "123", pos: 3 });
  });

  it("does not match if pattern is not at current position", () => {
    const p = regex(/[0-9]+/);
    expect(p.parse("abc123").ok).toBe(false);
  });

  it("respects position offset", () => {
    const p = regex(/[0-9]+/);
    expect(p.parse("abc123", 3)).toEqual({ ok: true, value: "123", pos: 6 });
  });
});

describe("eof", () => {
  it("succeeds at end of input", () => {
    expect(eof().parse("", 0)).toEqual({ ok: true, value: null, pos: 0 });
    expect(eof().parse("abc", 3)).toEqual({ ok: true, value: null, pos: 3 });
  });

  it("fails when input remains", () => {
    expect(eof().parse("abc", 0).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

describe("seq", () => {
  it("sequences two parsers", () => {
    const p = seq(literal("a"), literal("b"));
    expect(p.parse("abc")).toEqual({ ok: true, value: ["a", "b"], pos: 2 });
  });

  it("fails if first parser fails", () => {
    const p = seq(literal("a"), literal("b"));
    expect(p.parse("bc").ok).toBe(false);
  });

  it("fails if second parser fails", () => {
    const p = seq(literal("a"), literal("b"));
    expect(p.parse("ac").ok).toBe(false);
  });
});

describe("seq3", () => {
  it("sequences three parsers", () => {
    const p = seq3(char("("), literal("ok"), char(")"));
    expect(p.parse("(ok)")).toEqual({ ok: true, value: ["(", "ok", ")"], pos: 4 });
  });
});

describe("alt", () => {
  it("tries first then second", () => {
    const p = alt(literal("foo"), literal("bar"));
    expect(p.parse("foo")).toEqual({ ok: true, value: "foo", pos: 3 });
    expect(p.parse("bar")).toEqual({ ok: true, value: "bar", pos: 3 });
  });

  it("fails if both fail", () => {
    const p = alt(literal("foo"), literal("bar"));
    expect(p.parse("baz").ok).toBe(false);
  });

  it("returns first match (PEG ordered)", () => {
    const p = alt(literal("fo"), literal("foo"));
    const r = p.parse("foo");
    expect(r).toEqual({ ok: true, value: "fo", pos: 2 });
  });
});

describe("many", () => {
  it("matches zero occurrences", () => {
    const p = many(char("a"));
    expect(p.parse("bbb")).toEqual({ ok: true, value: [], pos: 0 });
  });

  it("matches multiple occurrences", () => {
    const p = many(char("a"));
    expect(p.parse("aaab")).toEqual({ ok: true, value: ["a", "a", "a"], pos: 3 });
  });
});

describe("many1", () => {
  it("fails on zero occurrences", () => {
    const p = many1(char("a"));
    expect(p.parse("bbb").ok).toBe(false);
  });

  it("matches one or more", () => {
    const p = many1(char("a"));
    expect(p.parse("aab")).toEqual({ ok: true, value: ["a", "a"], pos: 2 });
  });
});

describe("optional", () => {
  it("returns value when present", () => {
    const p = optional(char("a"));
    expect(p.parse("abc")).toEqual({ ok: true, value: "a", pos: 1 });
  });

  it("returns null when absent", () => {
    const p = optional(char("a"));
    expect(p.parse("xyz")).toEqual({ ok: true, value: null, pos: 0 });
  });
});

describe("not", () => {
  it("succeeds when inner fails", () => {
    const p = not(char("a"));
    expect(p.parse("xyz")).toEqual({ ok: true, value: null, pos: 0 });
  });

  it("fails when inner succeeds", () => {
    const p = not(char("a"));
    expect(p.parse("abc").ok).toBe(false);
  });

  it("does not consume input", () => {
    const p = seq(not(char("a")), char("b"));
    expect(p.parse("bc")).toEqual({ ok: true, value: [null, "b"], pos: 1 });
  });
});

describe("map", () => {
  it("transforms the result", () => {
    const p = map(integer(), (n) => n * 2);
    expect(p.parse("21")).toEqual({ ok: true, value: 42, pos: 2 });
  });

  it("propagates failure", () => {
    const p = map(integer(), (n) => n * 2);
    expect(p.parse("abc").ok).toBe(false);
  });
});

describe("sepBy", () => {
  it("matches zero items", () => {
    const p = sepBy(integer(), char(","));
    expect(p.parse("abc")).toEqual({ ok: true, value: [], pos: 0 });
  });

  it("matches one item", () => {
    const p = sepBy(integer(), char(","));
    expect(p.parse("42")).toEqual({ ok: true, value: [42], pos: 2 });
  });

  it("matches multiple items", () => {
    const p = sepBy(integer(), char(","));
    expect(p.parse("1,2,3")).toEqual({ ok: true, value: [1, 2, 3], pos: 5 });
  });

  it("stops at trailing separator", () => {
    const p = sepBy(integer(), char(","));
    const r = p.parse("1,2,");
    expect(r).toEqual({ ok: true, value: [1, 2], pos: 3 });
  });
});

describe("sepBy1", () => {
  it("fails on zero items", () => {
    const p = sepBy1(integer(), char(","));
    expect(p.parse("abc").ok).toBe(false);
  });

  it("matches one or more items", () => {
    const p = sepBy1(integer(), char(","));
    expect(p.parse("10,20")).toEqual({ ok: true, value: [10, 20], pos: 5 });
  });
});

describe("between", () => {
  it("extracts content between delimiters", () => {
    const p = between(char("("), integer(), char(")"));
    expect(p.parse("(42)")).toEqual({ ok: true, value: 42, pos: 4 });
  });

  it("fails on missing open", () => {
    expect(between(char("("), integer(), char(")")).parse("42)").ok).toBe(false);
  });

  it("fails on missing close", () => {
    expect(between(char("("), integer(), char(")")).parse("(42").ok).toBe(false);
  });
});

describe("lazy", () => {
  it("enables recursive grammars", () => {
    // Nested parentheses: value = '(' value ')' | digit
    const value: Parser<string> = lazy(() =>
      alt(
        map(seq3(char("("), value, char(")")), ([, inner]) => `(${inner})`),
        map(digit(), (d) => d)
      )
    );
    expect(value.parse("((3))")).toEqual({ ok: true, value: "((3))", pos: 5 });
    expect(value.parse("7")).toEqual({ ok: true, value: "7", pos: 1 });
  });
});

// ---------------------------------------------------------------------------
// Convenience parsers
// ---------------------------------------------------------------------------

describe("digit", () => {
  it("matches ASCII digits", () => {
    expect(digit().parse("5")).toEqual({ ok: true, value: "5", pos: 1 });
    expect(digit().parse("a").ok).toBe(false);
  });
});

describe("letter", () => {
  it("matches ASCII letters", () => {
    expect(letter().parse("a")).toEqual({ ok: true, value: "a", pos: 1 });
    expect(letter().parse("Z")).toEqual({ ok: true, value: "Z", pos: 1 });
    expect(letter().parse("5").ok).toBe(false);
  });
});

describe("whitespace", () => {
  it("matches one or more whitespace chars", () => {
    const r = whitespace().parse("  \t\n");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("  \t\n");
  });

  it("fails on empty", () => {
    expect(whitespace().parse("").ok).toBe(false);
  });
});

describe("token", () => {
  it("skips surrounding whitespace", () => {
    const p = token(integer());
    expect(p.parse("  42  ")).toEqual({ ok: true, value: 42, pos: 6 });
  });
});

describe("integer", () => {
  it("parses positive integers", () => {
    expect(integer().parse("123")).toEqual({ ok: true, value: 123, pos: 3 });
  });

  it("parses negative integers", () => {
    expect(integer().parse("-7")).toEqual({ ok: true, value: -7, pos: 2 });
  });

  it("fails on non-digits", () => {
    expect(integer().parse("abc").ok).toBe(false);
  });
});

describe("float", () => {
  it("parses integers", () => {
    expect(float().parse("42")).toEqual({ ok: true, value: 42, pos: 2 });
  });

  it("parses decimals", () => {
    expect(float().parse("3.14")).toEqual({ ok: true, value: 3.14, pos: 4 });
  });

  it("parses negative floats", () => {
    expect(float().parse("-0.5")).toEqual({ ok: true, value: -0.5, pos: 4 });
  });

  it("parses scientific notation", () => {
    const r = float().parse("1e10");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(1e10);
  });
});

describe("quotedString", () => {
  it("parses simple strings", () => {
    expect(quotedString().parse('"hello"')).toEqual({
      ok: true,
      value: "hello",
      pos: 7,
    });
  });

  it("handles escape sequences", () => {
    expect(quotedString().parse('"a\\nb"')).toEqual({
      ok: true,
      value: "a\nb",
      pos: 6,
    });
  });

  it("handles escaped quotes", () => {
    expect(quotedString().parse('"say \\"hi\\""')).toEqual({
      ok: true,
      value: 'say "hi"',
      pos: 12,
    });
  });

  it("fails on unclosed string", () => {
    expect(quotedString().parse('"hello').ok).toBe(false);
  });

  it("fails on non-string", () => {
    expect(quotedString().parse("hello").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Composition: simple expression parser from combinators
// ---------------------------------------------------------------------------

describe("expression parser (composed)", () => {
  // A simple calculator: number ((+|-) number)*
  const num = token(integer());
  const addOp = token(alt(char("+"), char("-")));
  const expr = map(seq(num, many(seq(addOp, num))), ([first, rest]) =>
    rest.reduce((acc, [op, n]) => (op === "+" ? acc + n : acc - n), first)
  );

  it("parses a single number", () => {
    expect(expr.parseAll("42")).toBe(42);
  });

  it("parses addition", () => {
    expect(expr.parseAll("1 + 2 + 3")).toBe(6);
  });

  it("parses subtraction", () => {
    expect(expr.parseAll("10 - 3 - 2")).toBe(5);
  });

  it("parses mixed operations", () => {
    expect(expr.parseAll("5 + 3 - 1")).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe("parseAll error handling", () => {
  it("throws ParseError on failure", () => {
    const p = literal("hello");
    expect(() => p.parseAll("world")).toThrow(ParseError);
  });

  it("throws ParseError on partial consumption", () => {
    const p = literal("hello");
    expect(() => p.parseAll("hello world")).toThrow(ParseError);
  });

  it("error includes position info", () => {
    const p = literal("hello");
    try {
      p.parseAll("world");
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).pos).toBe(0);
    }
  });
});

describe("empty input", () => {
  it("eof succeeds on empty", () => {
    expect(eof().parseAll("")).toBe(null);
  });

  it("literal fails on empty", () => {
    expect(literal("x").parse("").ok).toBe(false);
  });

  it("many succeeds on empty with zero matches", () => {
    expect(many(char("x")).parseAll("")).toEqual([]);
  });
});
