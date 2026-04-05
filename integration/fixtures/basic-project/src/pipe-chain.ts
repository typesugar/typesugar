// Integration test fixture: pipe() expansion with errors
//
// Expected diagnostics:
//   Line 11: TS2322 — Type 'string' is not assignable to type 'number' (after pipe expansion)
//
// Test positions:
//   Line 3-8: pipe() call → source map maps positions back through expansion
//   Line 11: type error after pipe must not drift

import { pipe } from "typesugar";

const result = pipe(
  42,
  (n: number) => n.toString(),
  (s: string) => s.length,
  (n: number) => n * 2,
);

// ERROR: type error after multi-line pipe expansion
const bad: number = "wrong";

const ok = result + 1;
