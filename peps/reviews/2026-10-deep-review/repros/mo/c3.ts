import { comptime } from "typesugar";
const a = comptime(() => NaN);
const b = comptime(() => 0/0);
const c = comptime(() => -Infinity);
const d = comptime(() => ({ f: () => 1 }));
const e = comptime(() => Symbol("x"));
const g = comptime(() => { const r = /ab+c/i; return r; });
