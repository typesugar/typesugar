import { erased } from "@typesugar/erased";
import { eqNumber, hashNumber } from "@typesugar/std";
declare const n: number;
const e = erased<[Eq, Hash]>(n);
const e2 = erased<[Eq]>(42);
