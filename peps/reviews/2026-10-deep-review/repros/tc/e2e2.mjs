const { transformCode } = await import("/Users/deapovey/src/personal/typesugar/packages/transformer-core/dist/index.js");
function t(label, code) {
  const r = transformCode(code, { fileName: "input.ts" });
  console.log("=== " + label + "\n" + r.code.trim());
  for (const d of r.diagnostics ?? []) console.log("  diag:", d.severity, d.message);
}
t("generic brand", `
interface Eq<A> { equals(a: A, b: A): boolean }
interface Pair<A, B> { a: A; b: B }
/** @impl Eq<Pair<number, string>> */
export const eqPair: Eq<Pair<number, string>> = { equals: (l, r) => l.a === r.a && l.b === r.b };
`);
t("array brand", `
interface Show<A> { show(a: A): string }
/** @impl Show<number[]> */
export const showArr: Show<number[]> = { show: (xs) => xs.join(",") };
`);
t("imported class", `
import { Point } from "./point";
interface Eq<A> { equals(a: A, b: A): boolean }
/** @impl Eq<Point> */
export const eqPoint: Eq<Point> = { equals: (l, r) => l.x === r.x };
export const p = new Point();
`);
