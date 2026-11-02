import { pipe } from "typesugar";
interface Eq<A> { equals(a: A, b: A): boolean; }
interface Point { x: number; y: number; }
const eqPoint: Eq<Point> = { equals: (a: Point, b: Point) => a.x === b.x };
const p1: Point = { x: 1, y: 2 };
export const same = eqPoint.equals(pipe(p1, (p: Point) => p), p1);
export const other = pipe(1, (x: number) => x);
