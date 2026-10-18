import { pipe } from "typesugar";
/** @derive(Eq) */
export class P {
  x = 1;
  f() { return pipe(1, (a: number) => a + 1); }
}
@derive(Eq)
export class Q {
  x = 1;
  f() { return pipe(1, (a: number) => a + 1); }
}
