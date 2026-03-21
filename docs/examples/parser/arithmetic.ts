//! PEG Parser
//! grammar macro validates at compile time + combinator comparison

import { grammar, literal, digit, many1, map, seq, alt, between, lazy, token } from "@typesugar/parser";
import { comptime } from "typesugar";

// grammar`...` validates PEG rules at compile time, then builds a parser
// 👀 Check JS Output: the tagged template becomes a runtime builder call
const calc = grammar`
  expr   = term (('+' | '-') term)*
  term   = factor (('*' | '/') factor)*
  factor = number | '(' expr ')'
  number = '-'? '0'..'9'+
`;

const builtAt = comptime(() => new Date().toISOString().slice(0, 10));

// Parse arithmetic expressions
const expressions = ["2 + 3", "2 + 3 * 4", "(2 + 3) * 4", "100 / 5 - 3"];
for (const input of expressions) {
  try {
    const result = calc.parse(input.trim(), 0);
    console.log(`${input} → parsed`);
  } catch (e: any) {
    console.log(`${input} → ${e.message}`);
  }
}

// Compare: the same parser built from combinators (no macro)
const number = map(many1(digit), ds => parseInt(ds.join(""), 10));
const lparen = token(literal("("));
const rparen = token(literal(")"));
const factor = lazy(() => alt(between(lparen, expr, rparen), token(number)));
const term = map(
  seq(factor, lazy(() => many1(seq(token(alt(literal("*"), literal("/"))), factor)))),
  ([first, rest]: [number, [string, number][]]) =>
    rest.reduce((acc, [op, v]) => op === "*" ? acc * v : acc / v, first)
);
const expr: any = map(
  seq(term, lazy(() => many1(seq(token(alt(literal("+"), literal("-"))), term)))),
  ([first, rest]: [number, [string, number][]]) =>
    rest.reduce((acc, [op, v]) => op === "+" ? acc + v : acc - v, first)
);

console.log("\nCombinator: 2 + 3 * 4 =", expr.parseAll("2 + 3 * 4"));
console.log("Built:", builtAt);

// Try: add a syntax error to the grammar and see the compile-time error
