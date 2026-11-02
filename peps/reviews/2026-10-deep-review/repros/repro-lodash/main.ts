import { get, map } from "fake-lodash";
const m = new Map<string, number>([["a", 1]]);
export const v = m.get("a");
export const xs = [1, 2, 3].map((x) => x * 2);
export const cfg = get({ a: 1 }, "a");
