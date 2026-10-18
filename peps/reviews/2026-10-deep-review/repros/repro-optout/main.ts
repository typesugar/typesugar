import { pipe } from "typesugar";
export const a = pipe(1, (x: number) => x + 1);
export function raw() {
  "use no typesugar";
  return pipe(1, (x: number) => x * 2);
}
export const b = pipe(2, (x: number) => x + 1); // @ts-no-typesugar
