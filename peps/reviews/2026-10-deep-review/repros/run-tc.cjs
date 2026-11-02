const repo = "/Users/deapovey/src/personal/typesugar";
require(repo + "/node_modules/@typesugar/macros/dist/index.cjs");
const { transformCode } = require(repo + "/packages/transformer-core/dist/index.cjs");
const code = `interface Eq<A> { equals(a: A, b: A): boolean; }
interface Point { x: number; y: number; }
const eqPoint: Eq<Point> = { equals: (a: Point, b: Point) => a.x === b.x };
const p1: Point = { x: 1, y: 2 };
export const same = eqPoint.equals(p1, p1);
`;
const r = transformCode(code, { fileName: "/x/input.ts" });
console.log("changed:", r.changed, "sourceMap:", !!r.sourceMap);
console.log(r.code);
