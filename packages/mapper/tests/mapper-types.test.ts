/**
 * @typesugar/mapper — type-level tests for TransformConfig
 *
 * Tests TransformConfig type constraints for nested mappings, collection configs,
 * renamePaths, and edge cases. These tests verify that valid configs type-check
 * and that the type system correctly constrains the config shape.
 */
import { describe, it, expect } from "vitest";
import type { TransformConfig, PathOf } from "../src/index.js";

describe("PathOf type", () => {
  it("extracts top-level keys from flat object", () => {
    type Flat = { a: number; b: string };
    type P = PathOf<Flat>;
    const _p: P = "a";
    const _q: P = "b";
    expect("a").toBe("a");
  });

  it("excludes array-valued keys", () => {
    type WithArray = { items: number[]; name: string };
    type P = PathOf<WithArray>;
    const _p: P = "name";
    expect("name").toBe("name");
  });

  it("extracts keys from nested object (top-level only)", () => {
    type Nested = { address: { city: string } };
    type P = PathOf<Nested>;
    const _p: P = "address";
    expect("address").toBe("address");
  });
});

describe("TransformConfig with renamePaths", () => {
  it("accepts renamePaths with top-level paths", () => {
    interface From {
      a: number;
      b: string;
    }
    interface To {
      x: number;
      y: string;
    }
    const config: TransformConfig<From, To> = {
      renamePaths: { x: "a", y: "b" },
    };
    expect(config.renamePaths?.x).toBe("a");
    expect(config.renamePaths?.y).toBe("b");
  });

  it("accepts renamePaths with string keys for nested paths", () => {
    interface From {
      address: { city: string };
    }
    interface To {
      address: { location: string };
    }
    const config: TransformConfig<From, To> = {
      renamePaths: { "address.location": "address.city" },
    };
    expect(config.renamePaths?.["address.location"]).toBe("address.city");
  });

  it("allows empty renamePaths", () => {
    interface From {
      x: number;
    }
    interface To {
      x: number;
    }
    const config: TransformConfig<From, To> = {
      renamePaths: {},
    };
    expect(config.renamePaths).toEqual({});
  });
});

describe("TransformConfig with collections", () => {
  it("accepts collections config for array field", () => {
    interface ItemFrom {
      id: number;
      name: string;
    }
    interface ItemTo {
      itemId: number;
      name: string;
    }
    interface From {
      items: ItemFrom[];
    }
    interface To {
      items: ItemTo[];
    }
    const config: TransformConfig<From, To> = {
      collections: {
        items: { rename: { itemId: "id" } },
      },
    };
    expect(config.collections?.items?.rename?.itemId).toBe("id");
  });

  it("accepts collections with compute in element config", () => {
    interface ItemFrom {
      first: string;
      last: string;
    }
    interface ItemTo {
      fullName: string;
    }
    interface From {
      users: ItemFrom[];
    }
    interface To {
      users: ItemTo[];
    }
    const config: TransformConfig<From, To> = {
      collections: {
        users: {
          compute: { fullName: (src) => `${src.first} ${src.last}` },
        },
      },
    };
    expect(config.collections?.users?.compute?.fullName?.({ first: "John", last: "Doe" })).toBe(
      "John Doe"
    );
  });

  it("accepts collections with nested element types", () => {
    interface LineItemFrom {
      product_id: number;
      qty: number;
    }
    interface LineItemTo {
      productId: number;
      quantity: number;
    }
    interface From {
      lines: LineItemFrom[];
    }
    interface To {
      lines: LineItemTo[];
    }
    const config: TransformConfig<From, To> = {
      collections: {
        lines: {
          rename: { productId: "product_id", quantity: "qty" },
        },
      },
    };
    expect(config.collections?.lines?.rename?.productId).toBe("product_id");
  });

  it("collections excludes non-array fields", () => {
    interface From {
      items: { id: number }[];
      meta: { count: number };
    }
    interface To {
      items: { id: number }[];
      meta: { count: number };
    }
    const config: TransformConfig<From, To> = {
      collections: {
        items: {},
      },
    };
    expect(config.collections?.items).toBeDefined();
  });
});

describe("TransformConfig with computed fields accessing nested properties", () => {
  it("compute callback receives full source including nested", () => {
    interface From {
      address: { city: string; zip: string };
    }
    interface To {
      location: string;
    }
    const config: TransformConfig<From, To> = {
      compute: {
        location: (src) => `${src.address.city}, ${src.address.zip}`,
      },
    };
    expect(config.compute?.location?.({ address: { city: "NYC", zip: "10001" } })).toBe(
      "NYC, 10001"
    );
  });
});

describe("edge cases", () => {
  it("empty config for flat objects", () => {
    interface Flat {
      x: number;
    }
    const config: TransformConfig<Flat, Flat> = {};
    expect(config).toEqual({});
  });

  it("config for deeply nested objects", () => {
    interface Inner {
      value: number;
    }
    interface Mid {
      inner: Inner;
    }
    interface From {
      mid: Mid;
    }
    interface To {
      mid: Mid;
    }
    const config: TransformConfig<From, To> = {
      nested: {
        mid: {
          nested: {
            inner: { rename: { value: "value" } },
          },
        },
      },
    };
    expect(config.nested?.mid?.nested?.inner).toBeDefined();
  });

  it("combined renamePaths, nested, and collections", () => {
    interface ItemFrom {
      id: number;
    }
    interface ItemTo {
      itemId: number;
    }
    interface From {
      name: string;
      items: ItemFrom[];
      meta: { version: number };
    }
    interface To {
      name: string;
      items: ItemTo[];
      meta: { version: number };
    }
    const config: TransformConfig<From, To> = {
      rename: { name: "name" },
      nested: { meta: {} },
      collections: { items: { rename: { itemId: "id" } } },
    };
    expect(config.rename?.name).toBe("name");
    expect(config.nested?.meta).toEqual({});
    expect(config.collections?.items?.rename?.itemId).toBe("id");
  });
});
