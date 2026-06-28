/**
 * Dry-run scenario: a small parser/compiler built with @typesugar/parser.
 *
 * Builds a recursive-descent arithmetic evaluator from composable PEG
 * combinators (with operator precedence and parentheses), plus a couple of
 * smaller parsers (CSV, key:value config). Demonstrates that the parser
 * combinator library is usable end-to-end from a fresh project.
 *
 * Run:   typesugar run src/main.ts
 * Check: typesugar check
 */

import {
  char,
  integer,
  token,
  seq,
  many,
  alt,
  between,
  map,
  sepBy,
  lazy,
  type Parser,
} from "@typesugar/parser";

// --- Arithmetic expression evaluator ----------------------------------------
// Grammar (precedence-respecting, left-associative):
//   expr   = term  (("+" | "-") term)*
//   term   = factor (("*" | "/") factor)*
//   factor = integer | "(" expr ")"

// `lazy` defers construction so the grammar can refer to itself recursively
// (factor → expr → addExpr → term → factor).
const expr: Parser<number> = lazy(() => addExpr);

const factor: Parser<number> = lazy(() =>
  alt(token(integer()), between(token(char("(")), expr, token(char(")"))))
);

const term: Parser<number> = map(
  seq(factor, many(seq(token(alt(char("*"), char("/"))), factor))),
  ([first, rest]) =>
    rest.reduce((acc, [op, n]) => (op === "*" ? acc * n : acc / n), first)
);

const addExpr: Parser<number> = map(
  seq(term, many(seq(token(alt(char("+"), char("-"))), term))),
  ([first, rest]) =>
    rest.reduce((acc, [op, n]) => (op === "+" ? acc + n : acc - n), first)
);

function evalExpr(src: string): number {
  return expr.parseAll(src);
}

for (const src of ["1 + 2 * 3", "(1 + 2) * 3", "10 - 4 - 3", "2 * (3 + 4) - 5"]) {
  console.log(`${src.padEnd(16)} = ${evalExpr(src)}`);
}

// --- CSV row of integers ----------------------------------------------------

const csvRow = sepBy(token(integer()), token(char(",")));
const row = csvRow.parseAll("1, 22, 333, 4");
console.log(`CSV row -> [${row.join(", ")}], sum = ${row.reduce((a, b) => a + b, 0)}`);

// --- Error reporting --------------------------------------------------------

try {
  evalExpr("1 + * 2");
} catch (e) {
  console.log(`Parse error reported as expected: ${(e as Error).message.split("\n")[0]}`);
}

console.log("\n✅ parser-compiler scenario completed");
