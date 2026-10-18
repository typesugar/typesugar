interface Eq<A> { equals(a: A, b: A): boolean; }
interface Point { x: number; y: number; }
export const eqPoint: Eq<Point> = { equals: (a: Point, b: Point) => a.x === b.x && a.y === b.y }, VERSION = 3;
const p1: Point = { x: 1, y: 2 };
export const same = eqPoint.equals(p1, p1);
