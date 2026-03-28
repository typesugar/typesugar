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

// Compare: a simple combinator-based parser (no macro)
const number = map(many1(digit()), ds => parseInt(ds.join(""), 10));
const parsed = token(number).parse("42", 0);
console.log("\nCombinator parsed:", parsed?.ok ? parsed.value : "error");
console.log("Built:", builtAt);

// Try: add a syntax error to the grammar and see the compile-time error
