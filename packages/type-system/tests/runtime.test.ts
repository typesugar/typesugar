/**
 * Runtime / type-level tests for @typesugar/type-system.
 */
import { describe, it, expect } from "vitest";
import {
  createStateMachine,
  createBuilder,
  Vec,
  isVec,
  opaqueModule,
  MaxLength,
} from "../src/index.js";
import { typeErrors } from "./helpers.js";

describe("TSP-2: createStateMachine tracks the state", () => {
  type Def = {
    closed: { open: "opened" };
    opened: { close: "closed" };
  };
  const make = () =>
    createStateMachine<Def, { n: number }>({
      initial: "closed",
      initialData: { n: 0 },
      states: { closed: { open: "opened" }, opened: { close: "closed" } },
      transitions: {
        open: (d) => ({ n: d.n + 1 }),
        close: (d) => ({ n: d.n + 1 }),
      },
    });

  it("moves to the target state", () => {
    const M = make();
    const b = M.open(M.create());
    expect(b.state).toBe("opened");
    expect(M.is(b, "opened")).toBe(true);
    expect(b.data.n).toBe(1);
    expect(M.close(b).state).toBe("closed");
  });

  it("rejects a transition that is not valid in the current state", () => {
    const M = make();
    const b = M.open(M.create());
    expect(() => M.open(b)).toThrow(/not valid in state "opened"/);
  });

  it("rejects transition names that collide with module methods", () => {
    expect(() =>
      createStateMachine<{ a: { create: "a" } }, {}>({
        initial: "a",
        initialData: {},
        states: { a: { create: "a" } },
        transitions: { create: (d) => d } as any,
      })
    ).toThrow(/reserved/);
  });
});

describe("TSP-6: Vec length invariant", () => {
  it("Vec is immutable", () => {
    const v = Vec.from([1, 2, 3]);
    expect(() => (v as any).push(4)).toThrow(TypeError);
    expect(Vec.length(v)).toBe(3);
    expect(isVec(v)).toBe(true);
  });

  it("Vec.from with an explicit length checks it", () => {
    expect(() => Vec.from([1, 2], 3)).toThrow(/length mismatch/);
    expect(Vec.length(Vec.from([1, 2, 3], 3))).toBe(3);
  });

  it("derived vecs are immutable too", () => {
    const v = Vec.cons(0, Vec.from([1, 2]));
    expect(() => (v as any).pop()).toThrow(TypeError);
  });

  it("a short array is not accepted as a longer Vec at the type level", () => {
    const errs = typeErrors(`import { Vec } from "@typesugar/type-system";
export const v: Vec<number, 3> = Vec.from([1, 2]);
`);
    expect(errs.length).toBeGreaterThan(0);
  });

  it("push is not available on the Vec type", () => {
    const errs = typeErrors(`import { Vec } from "@typesugar/type-system";
const v = Vec.from([1, 2, 3]);
v.push(4);
`);
    expect(errs.join("\n")).toMatch(/push/);
  });

  it("tuple inference gives the exact length", () => {
    const errs = typeErrors(`import { Vec } from "@typesugar/type-system";
export const v: Vec<number, 3> = Vec.from([1, 2, 3]);
export const w: Vec<number, 2> = Vec.from([1, 2], 2);
`);
    expect(errs).toEqual([]);
  });
});

describe("TSP-7: opaqueModule brands are distinct", () => {
  it("values of two opaque modules over the same Repr are not interchangeable", () => {
    const errs = typeErrors(`import { opaqueModule } from "@typesugar/type-system";
const UserId = opaqueModule<number, "UserId">("UserId")({ next: (n: number) => n + 1 });
const OrderId = opaqueModule<number, "OrderId">("OrderId")({ next: (n: number) => n + 1 });
OrderId.next(UserId.create(1));
`);
    expect(errs.join("\n")).toMatch(/not assignable/);
    expect(errs.join("\n")).not.toMatch(/type argument/);
  });

  it("op results are not retyped as validated opaque values", () => {
    const errs = typeErrors(`import { opaqueModule, type Opaque } from "@typesugar/type-system";
const Pos = opaqueModule<number, "Pos">("Pos", (n) => n > 0)({ negate: (n: number) => -n });
const p: Opaque<number, "Pos"> = Pos.negate(Pos.create(5));
`);
    expect(errs.join("\n")).toMatch(/not assignable/);
    expect(errs.join("\n")).not.toMatch(/type argument/);
  });

  it("runtime still works", () => {
    const M = opaqueModule<number, "M">("M", (n) => n > 0)({ dbl: (n: number) => n * 2 });
    expect(M.dbl(M.create(2))).toBe(4);
    expect(() => M.create(-1)).toThrow();
  });
});

describe("TSP-14: createBuilder branches are independent", () => {
  it("set returns a new builder", () => {
    const B = createBuilder<{ a: number }>();
    const b1 = B.set("a", 1);
    const b2 = B.set("a", 2);
    expect(b1.partial()).toEqual({ a: 1 });
    expect(b2.partial()).toEqual({ a: 2 });
    expect(B.partial()).toEqual({});
  });
});

describe("TSP-15: refinement brands and Vec arithmetic", () => {
  it("MaxLength brands carry their bound", () => {
    const errs = typeErrors(`import { MaxLength } from "@typesugar/type-system";
const Max5 = MaxLength<number, 5>(5);
const Max100 = MaxLength<number, 100>(100);
const x = Max100.refine([1, 2]);
export const y: ReturnType<typeof Max5.refine> = x;
`);
    expect(errs.join("\n")).toMatch(/not assignable/);
    expect(errs.join("\n")).not.toMatch(/type argument/);
  });

  it("composeRefinements returns a usable (non-never) brand", () => {
    const errs =
      typeErrors(`import { composeRefinements, Positive, Int, type Refined } from "@typesugar/type-system";
const PosInt = composeRefinements(Positive, Int, "PosInt");
export const v: Refined<number, "PosInt"> = PosInt.refine(3);
export const w: Refined<number, "Other"> = PosInt.refine(3);
`);
    // Exactly one error: the "Other" assignment. A `never` brand would make both succeed.
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/not assignable/);
  });

  it("Min / Vec.take keep a literal length", () => {
    const errs = typeErrors(`import { Vec, type Min } from "@typesugar/type-system";
export const m: Min<3, 7> = 3;
export const m2: Min<7, 3> = 3;
const t = Vec.take(Vec.from([1, 2, 3]), 2);
export const n: 2 = Vec.length(t);
`);
    expect(errs).toEqual([]);
  });

  it("MaxLength runtime check uses the bound", () => {
    const Max2 = MaxLength<number, 2>(2);
    expect(Max2.is([1, 2])).toBe(true);
    expect(Max2.is([1, 2, 3])).toBe(false);
  });
});

describe("docs C#12: Newtype base-type extraction", () => {
  it("wrap / newtypeCtor / unwrap accept and return the base type", () => {
    const errs =
      typeErrors(`import { type Newtype, wrap, unwrap, newtypeCtor, validatedNewtype } from "@typesugar/type-system";
type UserId = Newtype<number, "UserId">;
type Email = Newtype<string, "Email">;
type Meters = Newtype<number, "Meters">;
type Feet = Newtype<number, "Feet">;
export const id = wrap<UserId>(42);
export const raw: number = unwrap(id);
export const mkUserId = newtypeCtor<UserId>();
export const id2: UserId = mkUserId(42);
export const mkEmail = newtypeCtor<Email>();
export const e: Email = mkEmail("a@b");
export const mkE2 = validatedNewtype<Email>((s) => s.includes("@"));
function calculateArea(width: Meters, height: Meters): number {
  return unwrap(width) * unwrap(height);
}
export const area = calculateArea(wrap<Meters>(10), wrap<Meters>(5));
`);
    expect(errs).toEqual([]);
  });

  it("still rejects mixing brands and raw values", () => {
    const errs = typeErrors(`import { type Newtype, wrap } from "@typesugar/type-system";
type UserId = Newtype<number, "UserId">;
type Meters = Newtype<number, "Meters">;
type Feet = Newtype<number, "Feet">;
function getUser(id: UserId): number { return id; }
function calculateArea(width: Meters, height: Meters): number { return width * height; }
getUser(42);
calculateArea(wrap<Meters>(10), wrap<Feet>(5));
export const s = wrap<UserId>("x");
`);
    expect(errs.length).toBe(3);
  });
});
