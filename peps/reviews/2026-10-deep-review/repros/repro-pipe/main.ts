import { pipe } from "typesugar";
import { Observable, map } from "fake-rx";
declare const obs: Observable<number>;
export const a = pipe(1, (x: number) => x + 1);
export const b = obs.pipe(map((x: number) => x * 2), map((y: number) => y + 1));
