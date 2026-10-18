const { transformCode } = await import("/Users/deapovey/src/personal/typesugar/packages/transformer-core/dist/index.js");
function t(label, code) {
  const r = transformCode(code, { fileName: "input.ts" });
  console.log("=== " + label + "\n" + r.code.trim());
  for (const d of r.diagnostics ?? []) console.log("  diag:", d.severity, d.message);
}
t("propname", `
interface Eq<A> { equals(a: A, b: A): boolean }
interface Point { x: number; y: number }
/** @impl Eq<Point> */
const eqPoint: Eq<Point> = { equals: (x, y) => x.x === y.x && x.y === y.y };
declare const p1: Point, p2: Point;
export const r = eqPoint.equals(p1, p2);
`);
t("this", `
interface Eq<A> { equals(a: A, b: A): boolean; notEquals(a: A, b: A): boolean }
/** @impl Eq<number> */
const eqN: Eq<number> = {
  equals(a, b) { return a === b; },
  notEquals(a, b) { return !this.equals(a, b); },
};
export const r = eqN.notEquals(1, 2);
`);
t("dup", `
interface Eq<A> { equals(a: A, b: A): boolean }
interface Point { x: number; y: number }
/** @impl Eq<Point> */
const eqPoint: Eq<Point> = { equals: (a, b) => a.x === b.x && a.y === b.y };
declare function next(): Point;
declare const p2: Point;
export const r = eqPoint.equals(next(), p2);
`);
t("guard", `
interface Show<A> { show(a: A): string }
/** @impl Show<string | null> */
const showS: Show<string | null> = {
  show(a) { if (a == null) return "none"; const n = a.length; return "len " + n; },
};
export const r = showS.show(null);
`);
