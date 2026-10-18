import { Effect } from "effect";
import { fusePipeline } from "@typesugar/effect";
declare const e: Effect.Effect<{ name: string }>;
declare const tbl: Record<string, number>;
declare function expensive(s: string): string;

export const a = fusePipeline(Effect.map(Effect.map(e, (u) => u.name), (name) => ({ name })));
export const b = fusePipeline(Effect.map(Effect.map(e, (u) => expensive(u.name)), (n) => [n, n, tbl.n]));
export const c = fusePipeline(Effect.map(Effect.map(e, (u) => u.name), (n) => [1].map((n) => n + 1)));
