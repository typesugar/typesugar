import { comptime } from "typesugar";
const a = comptime(async () => 1);
const b = comptime(() => new Date(0));
const c = comptime(() => ({ m: new Map([[1,2]]) }));
const d = comptime(() => [1, , 3]);
const e = comptime(() => -0);
const f = comptime(() => ({ "a-b": 1, __proto__: null }));
const g = comptime(() => /x/g);
const h = comptime(() => { while(true){} });
