/**
 * Derived instances for types whose fields are BRANDED primitives
 * (`number & { readonly __brand: "ProductId" }`, typesugar's own
 * `Newtype<number, "UserId">`), the shape `examples/dry-runs/fp-domain`
 * uses for its ids.
 *
 * A branded primitive's values are primitives: the brand is a phantom type,
 * so `===` is value equality, a copy is the value itself, and so on. Derived
 * Eq rejected such a field ("ProductId lacks Eq", TS9106) because its field
 * check only counted a type as primitive when ALL of it was, and a brand
 * intersects the primitive with an object type.
 */
import { describe, it, expect } from "vitest";
import { transformAll, transformErrors, run } from "./external-types-harness.js";

const PRODUCT = `import { derive, summon, Eq, Clone, Debug } from "typesugar";

type Newtype<T, Brand extends string> = T & { readonly __brand: Brand };
type ProductId = Newtype<number, "ProductId">;
const ProductId = (n: number): ProductId => n as ProductId;

@derive(Eq, Clone, Debug)
class Money {
  constructor(
    public readonly cents: number,
    public readonly currency: string
  ) {}
}

@derive(Eq, Clone, Debug)
class Product {
  constructor(
    public readonly id: ProductId,
    public readonly name: string,
    public readonly price: Money,
    public readonly stock: number
  ) {}
}

const p1 = new Product(ProductId(1), "Widget", new Money(999, "USD"), 3);
const p2 = summon<Clone<Product>>().clone(p1);
const p3 = new Product(ProductId(2), "Widget", new Money(999, "USD"), 3);
export const equalToClone = summon<Eq<Product>>().equals(p1, p2);
export const equalToOther = summon<Eq<Product>>().equals(p1, p3);
export const cloneId = p2.id;
export const debug = summon<Debug<Product>>().debug(p1);
`;

describe("derive on a type with branded-primitive fields", () => {
  it("Eq, Clone and Debug derive for a class with a branded id (fp-domain's Product)", () => {
    const t = transformAll({ "product.ts": PRODUCT });
    expect(transformErrors(t)).toEqual({});
    const m = run(t.code, "product.ts");
    expect(m.equalToClone).toBe(true);
    expect(m.equalToOther).toBe(false);
    expect(m.cloneId).toBe(1);
    expect(m.debug).toContain("Widget");
  });

  it("compares the branded field with ===", () => {
    const t = transformAll({ "product.ts": PRODUCT });
    expect(t.code["product.ts"]).toContain("a.id === b.id");
  });
});
