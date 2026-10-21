/**
 * Instance resolution between types with the SAME structure
 * (`examples/dry-runs/effect-service`'s `UserId` and `Email`, both
 * `class X { constructor(public value: string) {} }`).
 *
 * The resolver matches an instance to a type by mutual assignability, and two
 * classes with one `value: string` each are assignable both ways. So
 * `UserId.Eq` and `Email.Eq` both matched a `UserId`, and `===` on two user
 * ids failed with "Ambiguous Eq instance for type 'UserId'". An instance
 * declared for the type ITSELF (the same symbol) is the one meant; a
 * structural match only decides when no such instance is in scope.
 */
import { describe, it, expect } from "vitest";
import { transformAll, transformErrors, run } from "./external-types-harness.js";

const IDS = `import { derive, summon, Eq } from "typesugar";
import "@typesugar/std/syntax/eq/ops";

@derive(Eq)
class UserId {
  constructor(public value: string) {}
}

@derive(Eq)
class Email {
  constructor(public value: string) {}
}

export const same = new UserId("u-001") === new UserId("u-001");
export const diff = new UserId("u-001") === new UserId("u-002");
export const emailSame = new Email("a@b") === new Email("a@b");
export const viaSummon = summon<Eq<UserId>>().equals(new UserId("x"), new UserId("x"));
`;

describe("instance resolution for structurally identical types", () => {
  it("=== on two derived classes of the same shape uses each class's own Eq", () => {
    const t = transformAll({ "ids.ts": IDS });
    expect(transformErrors(t)).toEqual({});
    expect(t.code["ids.ts"]).toContain("UserId.Eq.equals(");
    expect(t.code["ids.ts"]).toContain("Email.Eq.equals(");
    const m = run(t.code, "ids.ts");
    expect(m.same).toBe(true);
    expect(m.diff).toBe(false);
    expect(m.emailSame).toBe(true);
    expect(m.viaSummon).toBe(true);
  });

  it("a structural match still resolves when the type has no instance of its own", () => {
    const t = transformAll({
      "alias.ts": `import { derive, summon, Eq } from "typesugar";

@derive(Eq)
class UserId {
  constructor(public value: string) {}
}

interface IdLike {
  value: string;
}

const a: IdLike = { value: "x" };
export const r = summon<Eq<IdLike>>().equals(a, { value: "x" });
`,
    });
    expect(transformErrors(t)).toEqual({});
    expect(run(t.code, "alias.ts").r).toBe(true);
  });
});
