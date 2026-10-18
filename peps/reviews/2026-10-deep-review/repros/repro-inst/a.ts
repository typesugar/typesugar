export interface Eq<A> { equals(a: A, b: A): boolean; }
export interface Point { x: number; y: number; }
/** @impl Eq<Point> */
export const eqPoint: Eq<Point> = { equals: (a: Point, b: Point) => a.x === b.x };
