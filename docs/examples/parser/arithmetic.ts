//! Parser Combinators
//! Build parsers from composable pieces

import { literal, digit, many1, map, seq, alt, between, lazy, token } from "@typesugar/parser";

// Build an arithmetic expression parser from combinators
// Grammar: expr = term (('+' | '-') term)*
//          term = factor (('*' | '/') factor)*
//          factor = number | '(' expr ')'

const number = map(
  many1(digit),
  digits => parseInt(digits.join(""), 10)
);

const lparen = token(literal("("));
const rparen = token(literal(")"));

const factor = lazy(() =>
  alt(
    between(lparen, expr, rparen),
    token(number)
  )
);

const term = map(
  seq(factor, lazy(() => many1(seq(token(alt(literal("*"), literal("/"))), factor)))),
  ([first, rest]: [number, [string, number][]]) =>
    rest.reduce((acc, [op, val]) => op === "*" ? acc * val : acc / val, first)
);

const expr: any = map(
  seq(term, lazy(() => many1(seq(token(alt(literal("+"), literal("-"))), term)))),
  ([first, rest]: [number, [string, number][]]) =>
    rest.reduce((acc, [op, val]) => op === "+" ? acc + val : acc - val, first)
);

// Parse and evaluate expressions
const expressions = ["2 + 3", "2 + 3 * 4", "(2 + 3) * 4", "10 / 2 + 3"];
for (const input of expressions) {
  try {
    const result = expr.parseAll(input.trim());
    console.log(`${input} = ${result}`);
  } catch (e: any) {
    console.log(`${input} → error: ${e.message}`);
  }
}
