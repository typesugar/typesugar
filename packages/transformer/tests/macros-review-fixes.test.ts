/**
 * Pre-merge review fixes in @typesugar/macros' derived Clone (auto-derive.ts),
 * checked through the real transformer and by running the emitted code.
 *
 * - A `Clone` instance in scope for a built-in object type (`@impl
 *   Clone<Map<K, V>>`) is used, like for any other type: the derive guide's
 *   rule is "a type with a Clone instance in scope: through that instance".
 * - String index-signature values are cloned also when the type declares
 *   properties beside the index signature.
 * - A cloned RegExp keeps its `lastIndex`.
 */
import { describe, it, expect } from "vitest";
import {
  transformAll,
  transformErrors,
  typecheck,
  run,
  type Files,
} from "./external-types-harness.js";

function build(src: string) {
  const files: Files = { "m.ts": src };
  const t = transformAll(files);
  expect(transformErrors(t)).toEqual({});
  expect(typecheck(t.code)).toEqual([]);
  return { code: t.code["m.ts"], mod: () => run(t.code, "m.ts") as Record<string, any> };
}

describe("derived Clone: an instance in scope for a built-in object type wins", () => {
  it("@impl Clone<Map<string, Item>> is used for a Map field", () => {
    const { code, mod } = build(`import type { Clone } from "@typesugar/std";
import { derived } from "typesugar";

export interface Item { n: number }
export let calls = 0;
/** @impl Clone<Map<string, Item>> */
export const cloneItemMap: Clone<Map<string, Item>> = {
  clone: (m) => {
    calls++;
    return new Map(Array.from(m, ([k, v]) => [k, { n: v.n }] as const));
  },
};
export interface Holder { items: Map<string, Item> }
export const cloneHolder = derived<Clone<Holder>>();
`);
    expect(code).toContain("cloneItemMap.clone(");
    const m = mod();
    const a = { items: new Map([["a", { n: 1 }]]) };
    const b = m.cloneHolder.clone(a);
    expect(m.calls).toBe(1);
    expect(b.items).not.toBe(a.items);
    expect(b.items.get("a")).toEqual({ n: 1 });
    expect(b.items.get("a")).not.toBe(a.items.get("a"));
  });
});

describe("derived Clone: index-signature values beside declared properties", () => {
  it("clones nested values of `{ id: string; [k: string]: Nested | string }`", () => {
    const { mod } = build(`import type { Clone } from "@typesugar/std";
import { derived } from "typesugar";

export interface Nested { v: number[] }
export interface Props { id: string; [k: string]: Nested | string }
export const cloneProps = derived<Clone<Props>>();
`);
    const m = mod();
    const a = { id: "x", extra: { v: [1, 2] }, label: "s" };
    const b = m.cloneProps.clone(a);
    expect(b).toEqual(a);
    expect(b.extra).not.toBe(a.extra);
    expect(b.extra.v).not.toBe(a.extra.v);
    expect(b.id).toBe("x");
    expect(b.label).toBe("s");
  });
});

describe("derived Clone: RegExp", () => {
  it("keeps lastIndex", () => {
    const { mod } = build(`import type { Clone } from "@typesugar/std";
import { derived } from "typesugar";

export interface Scanner { re: RegExp }
export const cloneScanner = derived<Clone<Scanner>>();
`);
    const m = mod();
    const re = /a/g;
    re.exec("xa a");
    expect(re.lastIndex).toBe(2);
    const b = m.cloneScanner.clone({ re });
    expect(b.re).not.toBe(re);
    expect(b.re.source).toBe("a");
    expect(b.re.flags).toBe("g");
    expect(b.re.lastIndex).toBe(2);
  });
});
