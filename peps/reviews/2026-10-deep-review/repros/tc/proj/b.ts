import { summon } from "@typesugar/typeclass";
export interface Show<A> { show(a: A): string }
export interface Point { y: string }
/** @impl Show<Point> */
export const showBeta: Show<Point> = { show: (p) => "beta" };
export const s = summon<Show<Point>>();
