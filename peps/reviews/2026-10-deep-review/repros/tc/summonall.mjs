import { multi } from "./mf.mjs";
multi({ "/p/a.ts": `import { summonAll } from "typesugar";
export interface Show<A> { show(a: A): string }
export interface Point { x: number }
/** @impl Show<Point> */
export const showP: Show<Point> = { show: (p) => "P" };
export const [s] = summonAll<[Show<Point>]>();
export const t = summonAll<Show<Point>>();` }, "/p/a.ts", "summonAll");
multi({ "/p/tc.ts": `export interface Show<A> { show(a: A): string }
export interface Point { x: number }`,
 "/p/inst.ts": `import type { Show, Point } from "./tc";
/** @impl Show<Point> */
export const showPoint: Show<Point> = { show: (p) => "P" };
export const other = 1;`,
 "/p/a.ts": `import type { Show, Point } from "./tc";
import { implicit } from "typesugar";
import { other } from "./inst";
function show<A>(a: A, S: Show<A> = implicit()): string { return S.show(a); }
declare const p: Point;
export const r = show(p);
export const o = other;` }, "/p/a.ts", "implicit module-scan");
