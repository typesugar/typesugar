// Integration test fixture: macro expansion features
//
// Test positions:
//   Line 8: CodeLens above comptime — "$(zap) comptime(...)"
//   Line 8: Inlay hint after comptime — "= 42"
//   Line 11: CodeLens above @derive — "$(zap) @derive — 1 derive"
//   Line 18: staticAssert macro error pointing to this line

import { comptime, staticAssert } from "typesugar";

const answer = comptime(() => 6 * 7);

/** @derive(Eq) */
interface Metric {
  name: string;
  value: number;
}

staticAssert(false, "macro error test");

// Code after all expansions — positions must not drift
const trailing = "end";
