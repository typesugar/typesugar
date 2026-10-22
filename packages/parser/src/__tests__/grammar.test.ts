import { describe, it, expect } from "vitest";
import { parseGrammarDef, buildParser } from "../grammar.js";
import { grammar } from "../grammar-macro.js";
import { ParseError } from "../combinators.js";
import type { GrammarRule, Grammar } from "../types.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function parse(source: string, input: string, startRule?: string) {
  const rules = parseGrammarDef(source);
  const g = buildParser(rules, startRule);
  return g.parse(input);
}

function parseAll(source: string, input: string, startRule?: string) {
  const rules = parseGrammarDef(source);
  const g = buildParser(rules, startRule);
  return g.parseAll(input);
}

// ---------------------------------------------------------------------------
// Simple rules
// ---------------------------------------------------------------------------

describe("simple rules", () => {
  it("parses a single literal rule", () => {
    const r = parse(`greeting = "hello"`, "hello");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("hello");
  });

  it("parses a rule reference", () => {
    const r = parse(
      `
        start = greeting
        greeting = "hi"
      `,
      "hi"
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("hi");
  });

  it("uses first rule as start rule by default", () => {
    const rules = parseGrammarDef(`
      first = "a"
      second = "b"
    `);
    const g = buildParser(rules);
    expect(g.startRule).toBe("first");
  });

  it("allows overriding start rule", () => {
    const rules = parseGrammarDef(`
      first = "a"
      second = "b"
    `);
    const g = buildParser(rules, "second");
    expect(g.parseAll("b")).toBe("b");
  });
});

// ---------------------------------------------------------------------------
// Sequences and alternation
// ---------------------------------------------------------------------------

describe("sequences and alternation", () => {
  it("parses a sequence", () => {
    const r = parse(`rule = "a" "b" "c"`, "abc");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(["a", "b", "c"]);
  });

  it("parses alternation", () => {
    const src = `rule = "yes" | "no"`;
    expect(parse(src, "yes").ok).toBe(true);
    expect(parse(src, "no").ok).toBe(true);
    expect(parse(src, "maybe").ok).toBe(false);
  });

  it("alternation is ordered (PEG)", () => {
    const r = parse(`rule = "ab" | "abc"`, "ab");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("ab");
  });

  it("parses sequence with alternation", () => {
    const src = `rule = "a" "b" | "c" "d"`;
    expect(parse(src, "ab").ok).toBe(true);
    expect(parse(src, "cd").ok).toBe(true);
    expect(parse(src, "ac").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Repetition
// ---------------------------------------------------------------------------

describe("repetition", () => {
  it("parses zero-or-more", () => {
    const src = `rule = "a"*`;
    expect(parse(src, "").ok).toBe(true);
    const r = parse(src, "aaa");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(["a", "a", "a"]);
  });

  it("parses one-or-more", () => {
    const src = `rule = "a"+`;
    expect(parse(src, "").ok).toBe(false);
    const r = parse(src, "aa");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(["a", "a"]);
  });

  it("parses optional", () => {
    const src = `rule = "a"?`;
    const r1 = parse(src, "a");
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.value).toBe("a");

    const r2 = parse(src, "");
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Character ranges
// ---------------------------------------------------------------------------

describe("character ranges", () => {
  it("parses a digit range", () => {
    const src = `digit = '0'..'9'`;
    expect(parse(src, "5").ok).toBe(true);
    expect(parse(src, "a").ok).toBe(false);
  });

  it("parses a letter range", () => {
    const src = `lower = 'a'..'z'`;
    expect(parse(src, "m").ok).toBe(true);
    expect(parse(src, "M").ok).toBe(false);
  });

  it("combines range with repetition", () => {
    const src = `number = '0'..'9'+`;
    const r = parse(src, "42");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(["4", "2"]);
  });
});

// ---------------------------------------------------------------------------
// Grouping and negation
// ---------------------------------------------------------------------------

describe("grouping", () => {
  it("groups with parentheses", () => {
    const src = `rule = ("a" | "b") "c"`;
    expect(parse(src, "ac").ok).toBe(true);
    expect(parse(src, "bc").ok).toBe(true);
    expect(parse(src, "cc").ok).toBe(false);
  });
});

describe("positive lookahead", () => {
  it("succeeds when inner matches (consumes nothing)", () => {
    const src = `rule = &"a" .`;
    const r = parse(src, "a");
    expect(r.ok).toBe(true);
  });

  it("fails when inner does not match", () => {
    const src = `rule = &"a" .`;
    expect(parse(src, "b").ok).toBe(false);
  });

  it("does not consume input", () => {
    const src = `rule = &"ab" "ab"`;
    const r = parse(src, "ab");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual(["", "ab"]);
    }
  });
});

describe("'/' ordered choice", () => {
  it("supports '/' as alternation operator", () => {
    const src = `rule = "yes" / "no"`;
    expect(parse(src, "yes").ok).toBe(true);
    expect(parse(src, "no").ok).toBe(true);
    expect(parse(src, "maybe").ok).toBe(false);
  });

  it("handles '/' with sequences", () => {
    const src = `rule = "a" "b" / "c" "d"`;
    expect(parse(src, "ab").ok).toBe(true);
    expect(parse(src, "cd").ok).toBe(true);
    expect(parse(src, "ac").ok).toBe(false);
  });
});

describe("negation", () => {
  it("negation succeeds when inner fails", () => {
    const src = `rule = !"a" .`;
    const r = parse(src, "b");
    expect(r.ok).toBe(true);
  });

  it("negation fails when inner succeeds", () => {
    const src = `rule = !"a" .`;
    expect(parse(src, "a").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Any character
// ---------------------------------------------------------------------------

describe("any character", () => {
  it("matches any character with dot", () => {
    const src = `rule = .`;
    expect(parse(src, "x").ok).toBe(true);
    expect(parse(src, "").ok).toBe(false);
  });

  it("dot in sequence", () => {
    const src = `rule = "a" . "c"`;
    const r = parse(src, "abc");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(["a", "b", "c"]);
  });
});

// ---------------------------------------------------------------------------
// Full grammars
// ---------------------------------------------------------------------------

describe("CSV parser", () => {
  const csvGrammar = `
    csv    = row*
    row    = cell ("," cell)* "\\n"?
    cell   = '0'..'9'+
  `;

  it("parses a single row", () => {
    const rules = parseGrammarDef(csvGrammar);
    const g = buildParser(rules);
    const r = g.parse("1,2,3\n");
    expect(r.ok).toBe(true);
  });
});

describe("arithmetic expression grammar", () => {
  const arithGrammar = `
    expr   = term (("+" | "-") term)*
    term   = factor (("*" | "/") factor)*
    factor = "(" expr ")" | number
    number = '0'..'9'+
  `;

  it("parses a number", () => {
    const rules = parseGrammarDef(arithGrammar);
    const g = buildParser(rules);
    const r = g.parse("42");
    expect(r.ok).toBe(true);
  });

  it("parses an addition", () => {
    const rules = parseGrammarDef(arithGrammar);
    const g = buildParser(rules);
    const r = g.parse("1+2");
    expect(r.ok).toBe(true);
  });

  it("parses parenthesized expression", () => {
    const rules = parseGrammarDef(arithGrammar);
    const g = buildParser(rules);
    const r = g.parse("(1+2)*3");
    expect(r.ok).toBe(true);
  });
});

describe("simple identifier grammar", () => {
  const idGrammar = `
    ident  = letter (letter | digit)*
    letter = 'a'..'z' | 'A'..'Z' | '_'
    digit  = '0'..'9'
  `;

  it("parses a simple identifier", () => {
    const rules = parseGrammarDef(idGrammar);
    const g = buildParser(rules);
    const r = g.parse("hello");
    expect(r.ok).toBe(true);
  });

  it("parses identifier with digits", () => {
    const rules = parseGrammarDef(idGrammar);
    const g = buildParser(rules);
    const r = g.parse("x42");
    expect(r.ok).toBe(true);
  });

  it("fails on leading digit", () => {
    const rules = parseGrammarDef(idGrammar);
    const g = buildParser(rules);
    const r = g.parse("42x");
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Left recursion detection
// ---------------------------------------------------------------------------

describe("left recursion detection", () => {
  it("detects direct left recursion", () => {
    expect(() =>
      parseGrammarDef(`
        expr = expr "+" term
        term = "x"
      `)
    ).toThrow(/left recursion/i);
  });

  it("detects indirect left recursion", () => {
    expect(() =>
      parseGrammarDef(`
        a = b "x"
        b = a "y"
      `)
    ).toThrow(/left recursion/i);
  });

  it("allows right recursion", () => {
    expect(() =>
      parseGrammarDef(`
        list = "(" list ")" | "x"
      `)
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("throws on empty grammar", () => {
    expect(() => parseGrammarDef("")).toThrow(/empty/i);
    expect(() => parseGrammarDef("  \n  ")).toThrow(/empty/i);
  });

  it("throws on undefined rule reference", () => {
    expect(() => parseGrammarDef(`start = missing`)).toThrow(/undefined rule.*missing/i);
  });

  it("throws on missing start rule in buildParser", () => {
    const rules = parseGrammarDef(`rule = "x"`);
    expect(() => buildParser(rules, "nonexistent")).toThrow(/not found/i);
  });

  it("handles single-character literal with range syntax", () => {
    const src = `rule = 'a'..'z'`;
    expect(parse(src, "m").ok).toBe(true);
  });

  it("handles comments in grammar", () => {
    const rules = parseGrammarDef(`
      // This is a comment
      start = "hello"
      // Another comment
    `);
    expect(rules.has("start")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Grammar IR structure
// ---------------------------------------------------------------------------

describe("grammar IR", () => {
  it("produces literal rules", () => {
    const rules = parseGrammarDef(`rule = "hello"`);
    const rule = rules.get("rule")!;
    expect(rule.type).toBe("literal");
    if (rule.type === "literal") expect(rule.value).toBe("hello");
  });

  it("produces sequence rules", () => {
    const rules = parseGrammarDef(`rule = "a" "b"`);
    const rule = rules.get("rule")!;
    expect(rule.type).toBe("sequence");
  });

  it("produces alternation rules", () => {
    const rules = parseGrammarDef(`rule = "a" | "b"`);
    const rule = rules.get("rule")!;
    expect(rule.type).toBe("alternation");
  });

  it("produces repetition rules", () => {
    const rules = parseGrammarDef(`rule = "a"*`);
    const rule = rules.get("rule")!;
    expect(rule.type).toBe("repetition");
    if (rule.type === "repetition") {
      expect(rule.min).toBe(0);
      expect(rule.max).toBe(null);
    }
  });

  it("produces charRange rules", () => {
    const rules = parseGrammarDef(`rule = 'a'..'z'`);
    const rule = rules.get("rule")!;
    expect(rule.type).toBe("charRange");
    if (rule.type === "charRange") {
      expect(rule.from).toBe("a");
      expect(rule.to).toBe("z");
    }
  });
});

// ---------------------------------------------------------------------------
// Runtime tagged template
// ---------------------------------------------------------------------------

describe("grammar tagged template (runtime)", () => {
  it("creates a working parser from template", () => {
    const p = grammar`
      greeting = "hello" | "hi"
    `;
    expect(p.parseAll("hello")).toBe("hello");
    expect(p.parseAll("hi")).toBe("hi");
  });

  it("handles multi-rule grammars", () => {
    const p = grammar`
      start  = "(" digit+ ")"
      digit  = '0'..'9'
    `;
    const r = p.parse("(42)");
    expect(r.ok).toBe(true);
  });

  it("exposes rules and startRule", () => {
    const p = grammar`
      start = "x"
    `;
    expect(p.rules.size).toBe(1);
    expect(p.startRule).toBe("start");
  });
});

// ---------------------------------------------------------------------------
// parseAll error reporting
// ---------------------------------------------------------------------------

describe("parseAll error reporting", () => {
  it("includes line/col in error", () => {
    const p = grammar`rule = "abc"`;
    expect(() => p.parseAll("xyz")).toThrow(/line 1/);
  });

  it("reports unconsumed input", () => {
    const p = grammar`rule = "ab"`;
    expect(() => p.parseAll("abc")).toThrow(/end of input/i);
  });

  it("throws ParseError with pos/expected/line/col (docs B#21)", () => {
    const p = grammar`rule = "a" "\\n"? "b"`;
    let err: any;
    try {
      p.parseAll("a\nx");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ParseError);
    expect(err.pos).toBe(2);
    expect(err.expected).toBe('"b"');
    expect([err.line, err.col]).toEqual([2, 1]);
    expect(() => grammar`rule = "ab"`.parseAll("abc")).toThrow(ParseError);
  });
});

// ---------------------------------------------------------------------------
// Deep-review regressions
// ---------------------------------------------------------------------------

describe("left recursion through nullable prefixes (TSP-4)", () => {
  const cases: Array<[string, string]> = [
    ["optional prefix", `a = "x"? a "y" | "z"`],
    ["negation prefix", `a = !"q" a | "z"`],
    ["lookahead prefix", `a = &"z" a | "z"`],
    ["star prefix", `a = "x"* a | "z"`],
    ["nullable rule prefix", `a = b a "y" | "z"\nb = "x"*`],
    ["indirect via nullable rule", `a = b c | "z"\nb = "x"?\nc = a "y"`],
    ["empty literal prefix", `a = "" a | "z"`],
  ];
  for (const [label, src] of cases) {
    it(`rejects ${label}`, () => {
      expect(() => parseGrammarDef(src)).toThrow(/Left recursion/);
    });
  }

  it("still accepts non-left-recursive grammars with nullable elements", () => {
    const rules = parseGrammarDef(`a = "x"? "y" a | "z"\nb = "q"* "r"`);
    expect(buildParser(rules).parse("xyyz").ok).toBe(true);
  });

  it("accepts a non-nullable element before the recursion", () => {
    expect(() => parseGrammarDef(`a = "x"? "w" a | "z"`)).not.toThrow();
  });
});

describe("string escapes and multi-line groups (TSP-16)", () => {
  it("supports \\u and \\x escapes", () => {
    expect(parseGrammarDef(`a = "\\u0041"`).get("a")).toEqual({ type: "literal", value: "A" });
    expect(parseGrammarDef(`a = "\\x41"`).get("a")).toEqual({ type: "literal", value: "A" });
    expect(parseGrammarDef(`a = "\\u{1F600}"`).get("a")).toEqual({
      type: "literal",
      value: "\u{1F600}",
    });
  });

  it("keeps the escapes it already supported", () => {
    expect(parseGrammarDef(`a = "\\n\\t\\\\\\"'"`).get("a")).toEqual({
      type: "literal",
      value: "\n\t\\\"'",
    });
  });

  it("rejects malformed and unknown escapes", () => {
    expect(() => parseGrammarDef(`a = "\\u00G1"`)).toThrow();
    expect(() => parseGrammarDef(`a = "\\q"`)).toThrow();
  });

  it("allows a parenthesized group to span lines", () => {
    const rules = parseGrammarDef(`a = ( "a"\n  "b" )\nb = "c"`);
    expect(rules.get("a")).toEqual({
      type: "sequence",
      rules: [
        { type: "literal", value: "a" },
        { type: "literal", value: "b" },
      ],
    });
    expect([...rules.keys()]).toEqual(["a", "b"]);
    expect(buildParser(rules).parse("ab").ok).toBe(true);
  });
});

describe("runtime grammar interpolation (TSP-9)", () => {
  it("throws instead of silently dropping interpolated values", () => {
    const y = `"y"`;
    // The runtime function's behaviour: the macro reports this at compile
    // time instead (grammar-macro.test.ts), so the line opts out of it.
    expect(() => grammar`a = "x" ${y}`).toThrow(/interpolation/i); // @ts-no-typesugar
  });
});
