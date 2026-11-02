import { multi } from "./mf.mjs";
const files = {
  "/p/a.ts": `import { summon } from "@typesugar/typeclass";
interface Eq<A> { equals(a: A, b: A): boolean }
interface Show<A> { show(a: A): string }
interface Point { x: number; y: number }
export const e = summon<Eq<Point>>();
export const s = summon<Show<Point>>();`,
  "/p/b.ts": `import { summon } from "@typesugar/typeclass";
interface Eq<A> { equals(a: A, b: A): boolean }
interface Show<A> { show(a: A): string }
interface Point { lat: string; lng: string; label: string }
export const e = summon<Eq<Point>>();
export const s = summon<Show<Point>>();`,
};
multi(files, "/p/a.ts", "a");
multi(files, "/p/b.ts", "b (same process)");
