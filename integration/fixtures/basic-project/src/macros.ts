// Integration test fixture: macro expansion features
//
// - inlay hint after the comptime call: "= 42" (only with comptimeInEditor on)
// - _typesugar.expandMacro on the comptime call: "42"; on staticAssert: "void 0"
// - staticAssert macro error reported on its own line
// - hover on `trailing`, after every expansion, must not drift

import { comptime, staticAssert } from "typesugar";

const answer = comptime(() => 6 * 7);

/** @derive(Eq) */
interface Metric {
  name: string;
  value: number;
}

staticAssert(false, "macro error test");

// Code after all expansions; positions must not drift
const trailing = "end";
