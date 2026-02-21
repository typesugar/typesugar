/**
 * Red Team Tests for @typesugar/parser
 *
 * Attack surfaces:
 * - Empty input and degenerate grammars
 * - Very long input (performance/stack overflow)
 * - Unicode in grammar rules and input
 * - Left recursion detection
 * - Ambiguous grammars and PEG ordering
 * - Regex edge cases in terminals
 * - Error reporting quality
 * - Malformed grammar definitions
 * - Zero-width match handling (infinite loops)
 * - Deeply nested structures
 */
import { describe, it, expect } from "vitest";
import {
  ParseError,
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
} from "../packages/parser/src/combinators.js";
import { parseGrammarDef, buildParser } from "../packages/parser/src/grammar.js";
import { grammar } from "../packages/parser/src/grammar-macro.js";

describe("Parser Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Empty and Degenerate Inputs
  // ==========================================================================
  describe("Empty and degenerate inputs", () => {
    it("handles empty input with eof()", () => {
      const parser = eof();
      const result = parser.parse("");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(null);
        expect(result.pos).toBe(0);
      }
    });

    it("fails on empty input when expecting content", () => {
      const parser = literal("hello");
      const result = parser.parse("");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.pos).toBe(0);
      }
    });

    it("handles empty grammar definition", () => {
      expect(() => parseGrammarDef("")).toThrow("Grammar is empty");
    });

    it("handles whitespace-only grammar definition", () => {
      expect(() => parseGrammarDef("   \n\t  ")).toThrow("Grammar is empty");
    });

    it("handles comment-only grammar definition", () => {
      expect(() => parseGrammarDef("// just a comment")).toThrow("Grammar is empty");
    });

    it("many() succeeds with zero matches on empty input", () => {
      const parser = many(letter());
      const result = parser.parse("");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it("many1() fails on empty input", () => {
      const parser = many1(letter());
      const result = parser.parse("");
      expect(result.ok).toBe(false);
    });

    it("optional() succeeds with null on empty input", () => {
      const parser = optional(literal("foo"));
      const result = parser.parse("");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(null);
      }
    });
  });

  // ==========================================================================
  // Attack 2: Very Long Input (Performance/Stack Safety)
  // ==========================================================================
  describe("Very long input handling", () => {
    it("handles long repetitions without stack overflow", () => {
      const longInput = "a".repeat(10000);
      const parser = many(char("a"));
      const result = parser.parse(longInput);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(10000);
      }
    });

    it("handles deeply nested parentheses", () => {
      const depth = 500;
      const nested = "(".repeat(depth) + "x" + ")".repeat(depth);
      const rules = parseGrammarDef(`
        expr = '(' expr ')' | 'x'
      `);
      const parser = buildParser(rules);
      const result = parser.parse(nested);
      expect(result.ok).toBe(true);
    });

    it("handles long alternation chains efficiently", () => {
      const parser = alt(
        alt(
          alt(literal("aaa"), literal("bbb")),
          alt(literal("ccc"), literal("ddd"))
        ),
        alt(
          alt(literal("eee"), literal("fff")),
          literal("ggg")
        )
      );
      const result = parser.parse("ggg");
      expect(result.ok).toBe(true);
    });

    it("handles long sequence of separators", () => {
      const items = Array(1000).fill("1").join(",");
      const parser = sepBy(integer(), char(","));
      const result = parser.parse(items);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(1000);
      }
    });

    it("handles very long literal match", () => {
      const longString = "x".repeat(5000);
      const parser = literal(longString);
      const result = parser.parse(longString);
      expect(result.ok).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 3: Unicode in Grammar Rules and Input
  // ==========================================================================
  describe("Unicode handling", () => {
    it("matches Unicode literals correctly", () => {
      const parser = literal("こんにちは");
      const result = parser.parse("こんにちは");
      expect(result.ok).toBe(true);
    });

    it("handles emoji in literals", () => {
      const parser = literal("🎉🎊");
      const result = parser.parse("🎉🎊");
      expect(result.ok).toBe(true);
    });

    it("handles surrogate pairs correctly", () => {
      const emoji = "😀";
      expect(emoji.length).toBe(2);
      const parser = literal(emoji);
      const result = parser.parse(emoji);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.pos).toBe(2);
      }
    });

    it("anyChar() returns surrogate half on emoji", () => {
      const emoji = "😀";
      const parser = anyChar();
      const result = parser.parse(emoji);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.pos).toBe(1);
      }
    });

    it("handles Unicode in grammar DSL", () => {
      const rules = parseGrammarDef(`
        greeting = "こんにちは" | "hello"
      `);
      const parser = buildParser(rules);
      expect(parser.parse("こんにちは").ok).toBe(true);
      expect(parser.parse("hello").ok).toBe(true);
    });

    it("charRange handles non-ASCII ranges", () => {
      const parser = charRange("а", "я");
      expect(parser.parse("б").ok).toBe(true);
      expect(parser.parse("a").ok).toBe(false);
    });

    it("regex with Unicode flag - FINDING: flags not preserved", () => {
      // FINDING: regex() creates a sticky regex with only 'y' flag,
      // dropping the original flags. This means /\p{L}+/u becomes /\p{L}+/y
      // which fails because \p{} requires the 'u' flag.
      // See FINDINGS.md for tracking.
      const parser = regex(/\p{L}+/u);
      const result = parser.parse("日本語");
      // This currently fails because the 'u' flag is lost
      expect(result.ok).toBe(false);
    });
  });

  // ==========================================================================
  // Attack 4: Left Recursion Detection
  // ==========================================================================
  describe("Left recursion detection", () => {
    it("detects direct left recursion", () => {
      expect(() => parseGrammarDef(`
        expr = expr '+' term
        term = '1'
      `)).toThrow(/[Ll]eft recursion/);
    });

    it("detects indirect left recursion", () => {
      expect(() => parseGrammarDef(`
        a = b 'x'
        b = a 'y'
      `)).toThrow(/[Ll]eft recursion/);
    });

    it("detects left recursion through alternation", () => {
      expect(() => parseGrammarDef(`
        expr = expr '+' term | term
        term = '1'
      `)).toThrow(/[Ll]eft recursion/);
    });

    it("allows right recursion", () => {
      const rules = parseGrammarDef(`
        list = item list | item
        item = 'x'
      `);
      const parser = buildParser(rules);
      expect(parser.parse("xxx").ok).toBe(true);
    });

    it("allows indirect reference that isn't left-recursive", () => {
      const rules = parseGrammarDef(`
        expr = term ('+' expr)?
        term = factor ('*' term)?
        factor = '(' expr ')' | '1'
      `);
      expect(() => buildParser(rules)).not.toThrow();
    });
  });

  // ==========================================================================
  // Attack 5: Ambiguous Grammars and PEG Ordering
  // ==========================================================================
  describe("Ambiguous grammars and PEG ordering", () => {
    it("PEG prefers first alternative (greedy)", () => {
      const parser = alt(literal("ab"), literal("abc"));
      const result = parser.parse("abc");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("ab");
        expect(result.pos).toBe(2);
      }
    });

    it("longer match requires correct ordering", () => {
      const parser = alt(literal("abc"), literal("ab"));
      const result = parser.parse("abc");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("abc");
      }
    });

    it("keyword vs identifier ambiguity", () => {
      const keyword = literal("if");
      const identifier = map(many1(letter()), (cs) => cs.join(""));
      const parser = alt(keyword, identifier);
      expect(parser.parse("if").ok).toBe(true);
      const ifVar = parser.parse("iffy");
      expect(ifVar.ok).toBe(true);
      if (ifVar.ok) {
        expect(ifVar.value).toBe("if");
        expect(ifVar.pos).toBe(2);
      }
    });

    it("greedy many() captures all", () => {
      const parser = seq(many(char("a")), char("a"));
      const result = parser.parse("aaa");
      expect(result.ok).toBe(false);
    });

    it("non-greedy pattern requires explicit structure", () => {
      const parser = seq(many(seq(not(char("b")), anyChar())), char("b"));
      const result = parser.parse("aaab");
      expect(result.ok).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 6: Regex Edge Cases in Terminals
  // ==========================================================================
  describe("Regex edge cases", () => {
    it("handles regex with special characters", () => {
      const parser = regex(/\[.*?\]/);
      const result = parser.parse("[content]");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("[content]");
      }
    });

    it("anchors regex at current position (no skipping)", () => {
      const parser = regex(/foo/);
      const result = parser.parse("xxxfoo", 0);
      expect(result.ok).toBe(false);
    });

    it("regex respects position parameter", () => {
      const parser = regex(/foo/);
      const result = parser.parse("xxxfoo", 3);
      expect(result.ok).toBe(true);
    });

    it("handles regex with zero-width assertions", () => {
      const parser = regex(/(?=foo)foo/);
      const result = parser.parse("foo");
      expect(result.ok).toBe(true);
    });

    it("handles regex with groups", () => {
      const parser = regex(/(\d+)-(\d+)/);
      const result = parser.parse("123-456");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("123-456");
      }
    });

    it("regex flags are NOT preserved - FINDING: flags lost", () => {
      // FINDING: regex() converts to sticky regex with only 'y' flag,
      // losing the 'i' (case-insensitive) flag.
      // /ABC/i becomes /ABC/y which doesn't match "abc".
      // FIX: Should use `new RegExp(pattern.source, pattern.flags.replace('g', '') + 'y')`
      // See FINDINGS.md for tracking.
      const parser = regex(/ABC/i);
      const result = parser.parse("abc");
      // This currently fails because the 'i' flag is lost
      expect(result.ok).toBe(false);
    });

    it("handles catastrophic backtracking regex gracefully", () => {
      const evilRegex = regex(/(a+)+b/);
      const result = evilRegex.parse("aaaaaaaaaaaaaaaaaac");
      expect(result.ok).toBe(false);
    });
  });

  // ==========================================================================
  // Attack 7: Error Reporting Quality
  // ==========================================================================
  describe("Error reporting", () => {
    it("ParseError includes position information", () => {
      const parser = seq(literal("hello"), literal("world"));
      expect(() => parser.parseAll("helloxworld")).toThrow(ParseError);
      try {
        parser.parseAll("helloxworld");
      } catch (e) {
        expect(e).toBeInstanceOf(ParseError);
        if (e instanceof ParseError) {
          expect(e.pos).toBe(5);
          expect(e.expected).toContain("world");
        }
      }
    });

    it("reports line and column in error message", () => {
      const parser = literal("x");
      try {
        parser.parseAll("a\nb\nc");
      } catch (e) {
        expect(e).toBeInstanceOf(ParseError);
        if (e instanceof ParseError) {
          expect(e.message).toMatch(/line 1/);
          expect(e.message).toMatch(/col 1/);
        }
      }
    });

    it("grammar errors include rule context", () => {
      expect(() => parseGrammarDef(`
        foo = bar
      `)).toThrow(/bar/);
    });

    it("combines expected from alternation", () => {
      const parser = alt(literal("foo"), literal("bar"));
      const result = parser.parse("baz");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.expected).toContain("foo");
        expect(result.expected).toContain("bar");
      }
    });

    it("parseAll reports unconsumed input", () => {
      const parser = literal("hello");
      expect(() => parser.parseAll("helloworld")).toThrow(/end of input/);
    });
  });

  // ==========================================================================
  // Attack 8: Malformed Grammar Definitions
  // ==========================================================================
  describe("Malformed grammar definitions", () => {
    it("rejects rule without definition", () => {
      expect(() => parseGrammarDef(`foo`)).toThrow(/expected '='/);
    });

    it("rejects rule with empty definition", () => {
      expect(() => parseGrammarDef(`foo = `)).toThrow();
    });

    it("rejects unclosed string literal", () => {
      expect(() => parseGrammarDef(`foo = "unclosed`)).toThrow();
    });

    it("rejects unclosed parenthesis", () => {
      expect(() => parseGrammarDef(`foo = ('a' | 'b'`)).toThrow();
    });

    it("rejects undefined rule reference", () => {
      expect(() => parseGrammarDef(`
        foo = bar baz
        bar = 'x'
      `)).toThrow(/[Uu]ndefined.*baz/);
    });

    it("rejects invalid characters in rule names", () => {
      expect(() => parseGrammarDef(`123rule = 'x'`)).toThrow();
    });

    it("handles escaped characters in grammar strings", () => {
      const rules = parseGrammarDef(`
        escaped = "\\n\\t\\r"
      `);
      const parser = buildParser(rules);
      expect(parser.parse("\n\t\r").ok).toBe(true);
    });

    it("rejects multiple '=' signs", () => {
      expect(() => parseGrammarDef(`foo = bar = baz`)).toThrow();
    });
  });

  // ==========================================================================
  // Attack 9: Zero-Width Match Handling (Infinite Loop Prevention)
  // ==========================================================================
  describe("Zero-width match handling", () => {
    it("many() prevents infinite loop on zero-width match", () => {
      const parser = many(optional(char("a")));
      const result = parser.parse("bbb");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(0);
      }
    });

    it("many1() prevents infinite loop on zero-width match", () => {
      const parser = many1(optional(char("a")));
      const result = parser.parse("bbb");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(1);
        expect(result.value[0]).toBe(null);
      }
    });

    it("not() consumes no input", () => {
      const parser = seq(not(char("x")), char("y"));
      const result = parser.parse("y");
      expect(result.ok).toBe(true);
    });

    it("eof() at end matches without consuming", () => {
      const parser = seq(literal("end"), eof());
      const result = parser.parse("end");
      expect(result.ok).toBe(true);
    });

    it("grammar with epsilon production", () => {
      const rules = parseGrammarDef(`
        opt = 'a'?
      `);
      const parser = buildParser(rules);
      expect(parser.parse("a").ok).toBe(true);
      expect(parser.parse("").ok).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 10: Mutual Recursion and Complex Grammars
  // ==========================================================================
  describe("Mutual recursion and complex grammars", () => {
    it("handles mutually recursive rules", () => {
      const rules = parseGrammarDef(`
        a = 'x' b | 'x'
        b = 'y' a | 'y'
      `);
      const parser = buildParser(rules);
      expect(parser.parse("xyxyxyxy").ok).toBe(true);
    });

    it("handles arithmetic expression grammar", () => {
      const rules = parseGrammarDef(`
        expr   = term ('+' term)*
        term   = factor ('*' factor)*
        factor = '(' expr ')' | number
        number = '0'..'9'+
      `);
      const parser = buildParser(rules);
      expect(parser.parse("1+2*3").ok).toBe(true);
      expect(parser.parse("(1+2)*3").ok).toBe(true);
    });

    it("handles JSON-like grammar", () => {
      const rules = parseGrammarDef(`
        value  = object | array | string | number | "true" | "false" | "null"
        object = '{' (pair (',' pair)*)? '}'
        pair   = string ':' value
        array  = '[' (value (',' value)*)? ']'
        string = '"' (!'"' .)* '"'
        number = '-'? '0'..'9'+ ('.' '0'..'9'+)?
      `);
      const parser = buildParser(rules);
      expect(parser.parse('{"a":1}').ok).toBe(true);
      expect(parser.parse('[1,2,3]').ok).toBe(true);
      expect(parser.parse('null').ok).toBe(true);
    });

    it("grammar tagged template works at runtime", () => {
      const parser = grammar`
        greeting = "hello" | "hi"
      `;
      expect(parser.parse("hello").ok).toBe(true);
      expect(parser.parse("hi").ok).toBe(true);
      expect(parser.parse("bye").ok).toBe(false);
    });

    it("lazy() enables recursive combinator parsers", () => {
      type Expr = string | Expr[];
      const expr: ReturnType<typeof lazy<Expr>> = lazy(() =>
        alt(
          map(
            seq3(char("("), many(expr), char(")")),
            ([, inner]) => inner
          ),
          map(letter(), (c) => c)
        )
      );
      const result = expr.parse("((a)(b))");
      expect(result.ok).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 11: Numeric Parser Edge Cases
  // ==========================================================================
  describe("Numeric parser edge cases", () => {
    it("integer handles negative numbers", () => {
      const result = integer().parse("-42");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(-42);
      }
    });

    it("integer handles leading zeros", () => {
      const result = integer().parse("007");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(7);
      }
    });

    it("float handles scientific notation", () => {
      const result = float().parse("1.5e10");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(1.5e10);
      }
    });

    it("float handles negative exponent", () => {
      const result = float().parse("1e-5");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(1e-5);
      }
    });

    it("integer does not consume decimal part", () => {
      const result = integer().parse("42.5");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
        expect(result.pos).toBe(2);
      }
    });
  });

  // ==========================================================================
  // Attack 12: Quoted String Edge Cases
  // ==========================================================================
  describe("Quoted string edge cases", () => {
    it("handles escaped quotes", () => {
      const result = quotedString().parse('"hello \\"world\\""');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('hello "world"');
      }
    });

    it("handles escaped backslash", () => {
      const result = quotedString().parse('"path\\\\to\\\\file"');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("path\\to\\file");
      }
    });

    it("handles escape sequences", () => {
      const result = quotedString().parse('"line1\\nline2\\ttab"');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("line1\nline2\ttab");
      }
    });

    it("fails on unclosed string", () => {
      const result = quotedString().parse('"unclosed');
      expect(result.ok).toBe(false);
    });

    it("fails on trailing escape", () => {
      const result = quotedString().parse('"trailing\\');
      expect(result.ok).toBe(false);
    });

    it("handles empty string", () => {
      const result = quotedString().parse('""');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("");
      }
    });
  });

  // ==========================================================================
  // Attack 13: Combinator Composition Edge Cases
  // ==========================================================================
  describe("Combinator composition edge cases", () => {
    it("between() with mismatched delimiters fails", () => {
      const parser = between(char("("), integer(), char(")"));
      expect(parser.parse("(42]").ok).toBe(false);
    });

    it("sepBy() handles trailing separator", () => {
      const parser = sepBy(integer(), char(","));
      const result = parser.parse("1,2,3,");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([1, 2, 3]);
        expect(result.pos).toBe(5);
      }
    });

    it("sepBy1() requires at least one item", () => {
      const parser = sepBy1(integer(), char(","));
      expect(parser.parse("").ok).toBe(false);
    });

    it("token() handles leading and trailing whitespace", () => {
      const parser = token(integer());
      const result = parser.parse("  42  ");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
        expect(result.pos).toBe(6);
      }
    });

    it("seq3() propagates failure correctly", () => {
      const parser = seq3(literal("a"), literal("b"), literal("c"));
      expect(parser.parse("abc").ok).toBe(true);
      expect(parser.parse("abx").ok).toBe(false);
      expect(parser.parse("axc").ok).toBe(false);
    });
  });
});
