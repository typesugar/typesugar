/**
 * The `grammar` macro emits its parser as AST (codegen-ast.ts); the public
 * `generateParserCode` emits the same parser as text (codegen.ts). Run both,
 * plus the runtime `buildParser`, over a battery of grammars and inputs and
 * check they agree, so the two emitters can't drift apart silently.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { parseGrammarDef, buildParser } from "../grammar.js";
import { generateParserCode } from "../codegen.js";
import { generateParserAst } from "../codegen-ast.js";
import { ParseError } from "../combinators.js";
import type { Grammar } from "../types.js";

function fromAst(src: string, withParseError = false): Grammar<unknown> {
  const expr = generateParserAst(
    ts.factory,
    parseGrammarDef(src),
    undefined,
    withParseError ? () => ts.factory.createIdentifier("ParseError") : undefined
  );
  const text = ts
    .createPrinter()
    .printNode(
      ts.EmitHint.Expression,
      expr,
      ts.createSourceFile("o.ts", "", ts.ScriptTarget.Latest)
    );
  return new Function("ParseError", `return ${text}`)(ParseError);
}

function fromText(src: string): Grammar<unknown> {
  return new Function(`return ${generateParserCode(parseGrammarDef(src))}`)();
}

function outcome(g: Grammar<unknown>, input: string) {
  const r = g.parse(input);
  let all: unknown;
  try {
    all = { value: g.parseAll(input) };
  } catch (e) {
    // First line only: ParseError (runtime, and the macro's AST) appends a
    // context snippet on a second line that the plain-Error emitters omit.
    all = { error: (e as Error).message.split("\n")[0] };
  }
  return { parse: r.ok ? { ok: true, value: r.value, pos: r.pos } : r, all };
}

const CASES: Array<[string, string[]]> = [
  [`a = "hello"`, ["hello", "help", "", "hello!"]],
  [`a = ""`, ["", "x"]],
  [`d = '0'..'9'`, ["5", "a", ""]],
  [`a = . .`, ["xy", "x"]],
  [`s = "a" "b" "c"`, ["abc", "abX", "ab"]],
  [`s = "a" | "b" | "cd"`, ["a", "b", "cd", "cx", "z"]],
  [`s = "x"* "y"`, ["y", "xxxy", "xxz"]],
  [`s = "x"+`, ["", "x", "xxx"]],
  [`s = "x"? "y"`, ["y", "xy", "xx"]],
  [`s = !"a" .`, ["b", "a"]],
  [`s = &"a" .`, ["a", "b"]],
  [
    `ident = letter (letter | digit)*\nletter = 'a'..'z' | 'A'..'Z' | '_'\ndigit = '0'..'9'`,
    ["abc1", "1abc", "a_b"],
  ],
  [`list = item* ";"\nitem = "a" "b"`, ["abab;", "aaX;", ";"]],
  [`str = '"' (!'"' .)* '"'`, ['"hi"', '"unterminated', '""']],
  [`e = t (("+" | "-") t)*\nt = '0'..'9'+`, ["1+23-4", "1+", "+1"]],
  [`a = "q\\n\\u0041"`, ["q\nA", "qA"]],
];

describe("AST codegen, text codegen and runtime agree", () => {
  for (const [src, inputs] of CASES) {
    it(JSON.stringify(src), () => {
      const ast = fromAst(src);
      const text = fromText(src);
      const rt = buildParser(parseGrammarDef(src));
      expect(ast.startRule).toBe(rt.startRule);
      expect([...ast.rules]).toEqual([...rt.rules]);
      for (const input of inputs) {
        const a = outcome(ast, input);
        expect(a).toEqual(outcome(text, input));
        // Runtime results omit `expected` on success and wrap single-element
        // sequences differently, so compare only the parseAll error messages.
        const r = outcome(rt, input);
        if ("error" in (r.all as object) || "error" in (a.all as object)) {
          expect(a.all).toEqual(r.all);
        }
        // With a ParseError reference (what the macro passes), the AST parser
        // throws exactly what the runtime does: same class, fields, message.
        const thrown = (g: Grammar<unknown>): unknown => {
          try {
            g.parseAll(input);
            return undefined;
          } catch (e) {
            return e;
          }
        };
        const eAst = thrown(fromAst(src, true)) as ParseError | undefined;
        const eRt = thrown(rt) as ParseError | undefined;
        if (eRt || eAst) {
          expect(eAst).toBeInstanceOf(ParseError);
          expect(eRt).toBeInstanceOf(ParseError);
          expect([eAst!.message, eAst!.pos, eAst!.expected, eAst!.line, eAst!.col]).toEqual([
            eRt!.message,
            eRt!.pos,
            eRt!.expected,
            eRt!.line,
            eRt!.col,
          ]);
        }
      }
    });
  }
});
