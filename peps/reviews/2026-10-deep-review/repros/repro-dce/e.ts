interface Eq<A> { equals(a: A, b: A): boolean; }
interface Point { x: number; y: number; }
const eqPoint: Eq<Point> = { equals: (a: Point, b: Point) => a.x === b.x && a.y === b.y };
let n = 0;
function next(): Point { n++; return { x: n, y: n }; }
export const same = eqPoint.equals(next(), next());
