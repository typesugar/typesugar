import { match } from "@typesugar/std";
type S = { kind: "circle"; r: number } | { kind: "sq"; s: number };
declare const sh: S;
const m1 = match(sh, { circle(c) { return c.r; }, sq: (q) => q.s });
declare const anyv: any;
const m2 = match(anyv, { a: () => 1, _: () => 0 });
