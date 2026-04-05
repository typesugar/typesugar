// Integration test fixture: macro expansion features
//
// Test positions:
//   Line 6: CodeLens above comptime — "$(zap) comptime(...)"
//   Line 6: Inlay hint after comptime ��� "= 42"
//   Line 9: CodeLens above @derive — "$(zap) @derive — 2 derives"
//   Line 14: staticAssert macro error pointing to this line

import { comptime, staticAssert } from "typesugar";

const answer = comptime(() => 6 * 7);

/** @derive(Eq, Show) */
interface Metric {
  name: string;
  value: number;
}

staticAssert(false, "macro error test");

// Code after all expansions — positions must not drift
const trailing = "end";
