import { summon } from "@typesugar/typeclass";
export interface Show<A> { show(a: A): string }
export interface Point { x: number }
/** @impl Show<Point> */
export const showAlpha: Show<Point> = { show: (p) => "alpha" };
export const s = summon<Show<Point>>();
