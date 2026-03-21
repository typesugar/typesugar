import { describe, it, expect, beforeEach } from "vitest";
import { parseGrammarDef, buildParser } from "../grammar.js";
import { generateParserCode, resetVarCounter } from "../codegen.js";
import type { Grammar } from "../types.js";

// ---------------------------------------------------------------------------
// Helper: compile a grammar string into a working parser via codegen
// ---------------------------------------------------------------------------

function compileGrammar(source: string): Grammar<unknown> {
  const rules = parseGrammarDef(source);
  resetVarCounter();
  const code = generateParserCode(rules);
  // Evaluate the generated code to get a parser object
  const parser = new Function(`return ${code}`)();
  return parser;
}

beforeEach(() => {
  resetVarCounter();
});

// ---------------------------------------------------------------------------
// Basic literals
// ---------------------------------------------------------------------------

describe("codegen: literals", () => {
  it("parses a single literal", () => {
    const p = compileGrammar(`rule = "hello"`);
    const r = p.parse("hello");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("hello");
  });

  it("fails on non-matching input", () => {
    const p = compileGrammar(`rule = "hello"`);
    const r = p.parse("world");
    expect(r.ok).toBe(false);
  });

  it("handles empty literal", () => {
    const p = compileGrammar(`rule = ""`);
    const r = p.parse("anything");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe("");
      expect(r.pos).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Character ranges
// ---------------------------------------------------------------------------

describe("codegen: character ranges", () => {
  it("matches character in range", () => {
    const p = compileGrammar(`digit = '0'..'9'`);
    expect(p.parse("5").ok).toBe(true);
    expect(p.parse("a").ok).toBe(false);
  });

  it("matches letter range", () => {
    const p = compileGrammar(`lower = 'a'..'z'`);
    expect(p.parse("m").ok).toBe(true);
    expect(p.parse("M").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Any character
// ---------------------------------------------------------------------------

describe("codegen: any character", () => {
  it("matches any character with dot", () => {
    const p = compileGrammar(`rule = .`);
    expect(p.parse("x").ok).toBe(true);
    expect(p.parse("").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------

describe("codegen: sequences", () => {
  it("parses a sequence of literals", () => {
    const p = compileGrammar(`rule = "a" "b" "c"`);
    const r = p.parse("abc");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(["a", "b", "c"]);
  });

  it("fails if any element is missing", () => {
    const p = compileGrammar(`rule = "a" "b" "c"`);
    expect(p.parse("ab").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Alternation
// ---------------------------------------------------------------------------

describe("codegen: alternation", () => {
  it("picks the first matching alternative", () => {
    const p = compileGrammar(`rule = "yes" | "no"`);
    expect(p.parse("yes").ok).toBe(true);
    expect(p.parse("no").ok).toBe(true);
    expect(p.parse("maybe").ok).toBe(false);
  });

  it("alternation is ordered (PEG)", () => {
    const p = compileGrammar(`rule = "ab" | "abc"`);
    const r = p.parse("ab");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("ab");
  });

  it("sequence with alternation", () => {
    const p = compileGrammar(`rule = "a" "b" | "c" "d"`);
    expect(p.parse("ab").ok).toBe(true);
    expect(p.parse("cd").ok).toBe(true);
    expect(p.parse("ac").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Repetition
// ---------------------------------------------------------------------------

describe("codegen: repetition", () => {
  it("zero-or-more matches empty", () => {
    const p = compileGrammar(`rule = "a"*`);
    const r = p.parse("");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([]);
  });

  it("zero-or-more matches multiple", () => {
    const p = compileGrammar(`rule = "a"*`);
    const r = p.parse("aaa");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(["a", "a", "a"]);
  });

  it("one-or-more fails on empty", () => {
    const p = compileGrammar(`rule = "a"+`);
    expect(p.parse("").ok).toBe(false);
  });

  it("one-or-more matches multiple", () => {
    const p = compileGrammar(`rule = "a"+`);
    const r = p.parse("aa");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(["a", "a"]);
  });
});

// ---------------------------------------------------------------------------
// Optional
// ---------------------------------------------------------------------------

describe("codegen: optional", () => {
  it("returns value when present", () => {
    const p = compileGrammar(`rule = "a"?`);
    const r = p.parse("a");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("a");
  });

  it("returns null when absent", () => {
    const p = compileGrammar(`rule = "a"?`);
    const r = p.parse("");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Negation (lookahead)
// ---------------------------------------------------------------------------

describe("codegen: negation", () => {
  it("succeeds when inner fails", () => {
    const p = compileGrammar(`rule = !"a" .`);
    const r = p.parse("b");
    expect(r.ok).toBe(true);
  });

  it("fails when inner succeeds", () => {
    const p = compileGrammar(`rule = !"a" .`);
    expect(p.parse("a").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

describe("codegen: grouping", () => {
  it("groups with parentheses", () => {
    const p = compileGrammar(`rule = ("a" | "b") "c"`);
    expect(p.parse("ac").ok).toBe(true);
    expect(p.parse("bc").ok).toBe(true);
    expect(p.parse("cc").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multi-rule grammars (references)
// ---------------------------------------------------------------------------

describe("codegen: rule references", () => {
  it("resolves rule references", () => {
    const p = compileGrammar(`
      start = greeting
      greeting = "hi"
    `);
    const r = p.parse("hi");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("hi");
  });

  it("uses first rule as start rule", () => {
    const p = compileGrammar(`
      first = "a"
      second = "b"
    `);
    expect(p.startRule).toBe("first");
    expect(p.parse("a").ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Full grammar: identifiers
// ---------------------------------------------------------------------------

describe("codegen: identifier grammar", () => {
  const idGrammar = `
    ident  = letter (letter | digit)*
    letter = 'a'..'z' | 'A'..'Z' | '_'
    digit  = '0'..'9'
  `;

  it("parses a simple identifier", () => {
    const p = compileGrammar(idGrammar);
    const r = p.parse("hello");
    expect(r.ok).toBe(true);
  });

  it("parses identifier with digits", () => {
    const p = compileGrammar(idGrammar);
    const r = p.parse("x42");
    expect(r.ok).toBe(true);
  });

  it("fails on leading digit", () => {
    const p = compileGrammar(idGrammar);
    expect(p.parse("42x").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Full grammar: arithmetic expressions
// ---------------------------------------------------------------------------

describe("codegen: arithmetic grammar", () => {
  const arithGrammar = `
    expr   = term (("+" | "-") term)*
    term   = factor (("*" | "/") factor)*
    factor = "(" expr ")" | number
    number = '0'..'9'+
  `;

  it("parses a number", () => {
    const p = compileGrammar(arithGrammar);
    expect(p.parse("42").ok).toBe(true);
  });

  it("parses an addition", () => {
    const p = compileGrammar(arithGrammar);
    expect(p.parse("1+2").ok).toBe(true);
  });

  it("parses parenthesized expression", () => {
    const p = compileGrammar(arithGrammar);
    expect(p.parse("(1+2)*3").ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Full grammar: CSV
// ---------------------------------------------------------------------------

describe("codegen: CSV grammar", () => {
  const csvGrammar = `
    csv  = row*
    row  = cell ("," cell)* "\\n"?
    cell = '0'..'9'+
  `;

  it("parses a CSV row", () => {
    const p = compileGrammar(csvGrammar);
    const r = p.parse("1,2,3\n");
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Full grammar: JSON-like string with negation
// ---------------------------------------------------------------------------

describe("codegen: string with negation", () => {
  const strGrammar = `
    str = '"' (!'"' .)* '"'
  `;

  it("parses a quoted string", () => {
    const p = compileGrammar(strGrammar);
    const r = p.parse('"hello"');
    expect(r.ok).toBe(true);
  });

  it("fails on unterminated string", () => {
    const p = compileGrammar(strGrammar);
    expect(p.parse('"hello').ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseAll
// ---------------------------------------------------------------------------

describe("codegen: parseAll", () => {
  it("succeeds when all input consumed", () => {
    const p = compileGrammar(`rule = "abc"`);
    expect(p.parseAll("abc")).toBe("abc");
  });

  it("throws on partial match", () => {
    const p = compileGrammar(`rule = "ab"`);
    expect(() => p.parseAll("abc")).toThrow(/end of input/i);
  });

  it("throws on no match with line/col info", () => {
    const p = compileGrammar(`rule = "abc"`);
    expect(() => p.parseAll("xyz")).toThrow(/line 1/);
  });
});

// ---------------------------------------------------------------------------
// Grammar interface properties
// ---------------------------------------------------------------------------

describe("codegen: Grammar interface", () => {
  it("exposes rules Map", () => {
    const p = compileGrammar(`
      start = "x"
    `);
    expect(p.rules).toBeInstanceOf(Map);
    expect(p.rules.size).toBe(1);
  });

  it("exposes startRule", () => {
    const p = compileGrammar(`
      start = "x"
    `);
    expect(p.startRule).toBe("start");
  });
});

// ---------------------------------------------------------------------------
// Generated code structure
// ---------------------------------------------------------------------------

describe("codegen: output structure", () => {
  it("generates a self-contained IIFE string", () => {
    const rules = parseGrammarDef(`rule = "x"`);
    resetVarCounter();
    const code = generateParserCode(rules);
    expect(code).toContain("(function()");
    expect(code).toContain("use strict");
    expect(code).toContain("$rule");
    expect(code).toContain("})()");
  });

  it("generates no references to external runtime", () => {
    const rules = parseGrammarDef(`
      ident  = letter (letter | digit)*
      letter = 'a'..'z' | 'A'..'Z'
      digit  = '0'..'9'
    `);
    resetVarCounter();
    const code = generateParserCode(rules);
    // Should NOT reference parseGrammarDef, buildParser, or any imports
    expect(code).not.toContain("parseGrammarDef");
    expect(code).not.toContain("buildParser");
    expect(code).not.toContain("import");
    expect(code).not.toContain("require");
  });
});

// ---------------------------------------------------------------------------
// PEG '/' ordered choice operator
// ---------------------------------------------------------------------------

describe("codegen: '/' ordered choice", () => {
  it("supports '/' as alternation operator", () => {
    const p = compileGrammar(`rule = "yes" / "no"`);
    expect(p.parse("yes").ok).toBe(true);
    expect(p.parse("no").ok).toBe(true);
    expect(p.parse("maybe").ok).toBe(false);
  });

  it("handles '/' with sequences", () => {
    const p = compileGrammar(`rule = "a" "b" / "c" "d"`);
    expect(p.parse("ab").ok).toBe(true);
    expect(p.parse("cd").ok).toBe(true);
    expect(p.parse("ac").ok).toBe(false);
  });

  it("mixes '|' and '/' operators", () => {
    const p = compileGrammar(`rule = "a" | "b" / "c"`);
    expect(p.parse("a").ok).toBe(true);
    expect(p.parse("b").ok).toBe(true);
    expect(p.parse("c").ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Positive lookahead (&)
// ---------------------------------------------------------------------------

describe("codegen: positive lookahead", () => {
  it("succeeds when inner matches (consumes nothing)", () => {
    const p = compileGrammar(`rule = &"a" .`);
    const r = p.parse("a");
    expect(r.ok).toBe(true);
  });

  it("fails when inner does not match", () => {
    const p = compileGrammar(`rule = &"a" .`);
    expect(p.parse("b").ok).toBe(false);
  });

  it("does not consume input", () => {
    const p = compileGrammar(`rule = &"ab" "ab"`);
    const r = p.parse("ab");
    expect(r.ok).toBe(true);
    if (r.ok) {
      // &"ab" produces "" (consumed nothing), then "ab" produces "ab"
      expect(r.value).toEqual(["", "ab"]);
    }
  });

  it("works in multi-rule grammar", () => {
    // Only parse a digit if followed by another digit
    const p = compileGrammar(`
      start = (&digit digit)+
      digit = '0'..'9'
    `);
    const r = p.parse("42");
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Codegen parity with runtime builder
// ---------------------------------------------------------------------------

describe("codegen: parity with runtime", () => {
  it("codegen and runtime produce same results for complex grammar", () => {
    const grammarSrc = `
      expr   = term (("+" / "-") term)*
      term   = factor (("*" / "/") factor)*
      factor = "(" expr ")" / number
      number = '0'..'9'+
    `;

    // Codegen parser
    const cg = compileGrammar(grammarSrc);
    // Runtime parser
    const rules = parseGrammarDef(grammarSrc);
    const rt = buildParser(rules);

    const inputs = ["1", "1+2", "(1+2)*3", "99"];
    for (const input of inputs) {
      const cgResult = cg.parse(input);
      const rtResult = rt.parse(input);
      expect(cgResult.ok).toBe(rtResult.ok);
      if (cgResult.ok && rtResult.ok) {
        expect(cgResult.pos).toBe(rtResult.pos);
      }
    }
  });
});
