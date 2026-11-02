import { comptime } from "typesugar";
export const x = comptime(() => { throw new Error("boom"); });
