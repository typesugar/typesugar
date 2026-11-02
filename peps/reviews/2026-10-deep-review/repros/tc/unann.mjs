import { multi } from "./mf.mjs";
multi({ "/p/u.ts": `import { summon } from "@typesugar/typeclass";
export interface Show<A> { show(a: A): string }
export interface Point { x: number }
/** @impl Show<Point> */
const showP = { show: (p: Point) => "custom" };
export const s = summon<Show<Point>>();` }, "/p/u.ts", "unannotated impl");
