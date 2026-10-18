interface Num<A> { add(a: A, b: A): A; }
/** @impl Num<number> */
export const numInst: Num<number> = { add: (a: number, b: number) => a + b };
const n = 10;
const addN = (E: Num<number>, x: number): number => E.add(x, n);
export function g() { const n = 99; return addN(numInst, 1); }
