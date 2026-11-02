import { match } from "@typesugar/std";
type E = { kind: "a"; inner: { x: number } } | { kind: "b" };
declare const e: E;
const r = match(e).case({ kind: "a", inner: { x: 1 } }).then("a1").case({ kind: "a" }).then("a-other").case({ kind: "b" }).then("b");
