import { multi } from "./mf.mjs";
const tc = `export interface Show<A> { show(a: A): string }
export interface Point { x: number }`;
multi({
  "/p/tc.ts": tc,
  "/p/inst.ts": `import type { Show, Point } from "./tc";
/** @impl Show<Point> */
export const showPoint: Show<Point> = { show: (p) => "P" + p.x };
export const unrelated = 1;`,
  "/p/main.ts": `import { summon } from "@typesugar/typeclass";
import type { Show, Point } from "./tc";
import { unrelated } from "./inst";
export const s = summon<Show<Point>>();
export const u = unrelated;`,
}, "/p/main.ts", "summon module-scan (not imported by name)");
multi({
  "/p/tc.ts": tc,
  "/p/inst.ts": `import type { Show, Point } from "./tc";
/** @impl Show<Point> */
export const showPoint: Show<Point> = { show: (p) => "P" + p.x };`,
  "/p/main.ts": `import { summon } from "@typesugar/typeclass";
import type { Show, Point } from "./tc";
import { showPoint as sp } from "./inst";
export const s = summon<Show<Point>>();
export const keep = sp;`,
}, "/p/main.ts", "summon aliased import");
multi({
  "/p/tc.ts": tc,
  "/p/main.ts": `import { summon } from "@typesugar/typeclass";
import type { Show, Point } from "./tc";
/** @impl Show<Point> */
const showA: Show<Point> = { show: (p) => "A" };
/** @impl Show<Point> */
const showB: Show<Point> = { show: (p) => "B" };
export const s = summon<Show<Point>>();`,
}, "/p/main.ts", "summon ambiguous");
