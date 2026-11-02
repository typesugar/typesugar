import { multi } from "./mf.mjs";
multi({
  "/p/main.ts": `import { summon } from "@typesugar/typeclass";
export interface Show<A> { show(a: A): string }
export interface Point { x: number }
/** @impl Show<Point> */
const showA: Show<Point> = { show: (p) => "A" };
export const s = summon<Show<Point>>();`,
}, "/p/main.ts", "summon local single");
multi({
  "/p/main.ts": `import { summon } from "@typesugar/typeclass";
export interface Show<A> { show(a: A): string }
export interface Point { x: number }
/** @impl Show<Point> */
const showA: Show<Point> = { show: (p) => "A" };
/** @impl Show<Point> */
const showB: Show<Point> = { show: (p) => "B" };
export const s = summon<Show<Point>>();`,
}, "/p/main.ts", "summon local ambiguous");
