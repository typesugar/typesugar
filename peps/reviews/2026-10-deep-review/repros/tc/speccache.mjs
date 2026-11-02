const { transformCode } = await import("/Users/deapovey/src/personal/typesugar/packages/transformer-core/dist/index.js");
const r = transformCode(`
interface Show<A> { show(a: A): string }
interface Point { x: number }
/** @impl Show<Point> */
const showShort: Show<Point> = { show: (p) => "P" };
/** @impl Show<Point> */
const showLong: Show<Point> = { show: (p) => "Point(" + p.x + ")" };
const display = <A>(S: Show<A>, a: A): string => S.show(a);
const pair = <A>(S1: Show<A>, S2: Show<A>, a: A): string => S1.show(a) + "|" + S2.show(a);
declare const p: Point;
export const a = display(showShort, p);
export const b = display(showLong, p);
export const c = pair(showShort, showLong, p);
export const d = pair(showLong, showShort, p);
`, { fileName: "input.ts" });
console.log(r.code.split("\n").filter(l => /^(export )?const (__|a |b |c |d )|^export const [abcd] /.test(l) || l.includes("__display") || l.includes("__pair")).join("\n"));
