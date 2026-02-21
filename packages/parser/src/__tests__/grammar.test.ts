import { describe, it, expect } from "vitest";
import { parseGrammarDef, buildParser } from "../grammar.js";
import { grammar } from "../grammar-macro.js";
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
});
