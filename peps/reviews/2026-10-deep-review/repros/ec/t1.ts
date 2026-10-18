import "@typesugar/contracts/syntax";
import { old } from "@typesugar/contracts";

export function divide(a: number, b: number): number {
  requires: {
    (b !== 0, "divisor must not be zero");
  }
  ensures: {
    result * b === a;
  }
  return a / b;
}

export const arrow = (x: number): number => {
  requires: { x > 0; }
  return x;
};

export async function load(x: number): Promise<number> {
  requires: { x > 0; }
  ensures: (r) => { r > 0; }
  const v = await Promise.resolve(x);
  return v;
}

export function* gen(n: number) {
  requires: { n > 0; }
  ensures: (r) => { r === undefined; }
  yield n;
  return;
}

class K {
  constructor(public x: number) {
    requires: { x > 0; }
  }
  get v(): number {
    requires: { this.x > 0; }
    return this.x;
  }
}

export function prop(o: { result: number }): number {
  ensures: (result) => { result === o.result; }
  return o.result;
}
