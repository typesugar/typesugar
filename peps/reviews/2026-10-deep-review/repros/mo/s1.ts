import { comptime } from "typesugar";
const a = sq(1 + 2);
const b = pick(1, 2);
const c = twice(comptime(() => 21));
let i = 0;
const d = sq(i++);
