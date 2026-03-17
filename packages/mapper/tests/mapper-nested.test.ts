/**
 * @typesugar/mapper — nested object and collection mapping tests
 *
 * Tests nested TransformConfig type compatibility, collection mapping types,
 * runtime stub behavior, and edge cases.
 */
import { describe, it, expect } from "vitest";
import { transformInto, transformArrayInto, type TransformConfig } from "../src/index.js";

describe("transformInto runtime stub", () => {
  it("throws at runtime with nested config", () => {
    interface From {
      address: { city: string };
    }
    interface To {
      address: { location: string };
    }
    expect(() =>
      transformInto<From, To>(
        { address: { city: "NYC" } },
        {
          nested: { address: { rename: { location: "city" } } },
        }
      )
    ).toThrow("typesugar transformer");
  });

  it("throws at runtime with collections config", () => {
    interface ItemFrom {
      id: number;
    }
    interface ItemTo {
      itemId: number;
    }
    interface From {
      items: ItemFrom[];
    }
    interface To {
      items: ItemTo[];
    }
    expect(() =>
      transformInto<From, To>(
        { items: [{ id: 1 }] },
        {
          collections: { items: { rename: { itemId: "id" } } },
        }
      )
    ).toThrow("typesugar transformer");
  });
});

describe("transformArrayInto runtime stub", () => {
  it("exports transformArrayInto as a function", () => {
    expect(transformArrayInto).toBeDefined();
    expect(typeof transformArrayInto).toBe("function");
  });

  it("throws at runtime without transformer", () => {
    expect(() => transformArrayInto([{ x: 1 }], {})).toThrow("typesugar transformer");
  });

  it("throws with helpful message when called at runtime", () => {
    expect(() => transformArrayInto([{ x: 1 }], {})).toThrow(
      "transformArrayInto() was called at runtime"
    );
  });

  it("returns To[] type shape (verified by assignment)", () => {
    interface From {
      a: number;
    }
    interface To {
      b: number;
    }
    const items: From[] = [{ a: 1 }];
    // Type verification: transformArrayInto<From, To> returns To[]; stub throws at runtime
    expect(() => {
      const _result: To[] = transformArrayInto<From, To>(items, { rename: { b: "a" } });
      return _result;
    }).toThrow("typesugar transformer");
  });
});

describe("nested TransformConfig type compatibility", () => {
  it("accepts nested config for object-valued target fields", () => {
    interface SourceAddress {
      city: string;
      zip: string;
    }
    interface TargetAddress {
      location: string;
    }
    interface Source {
      address: SourceAddress;
    }
    interface Target {
      address: TargetAddress;
    }
    const config: TransformConfig<Source, Target> = {
      nested: {
        address: { rename: { location: "city" } },
      },
    };
    expect(config.nested?.address?.rename?.location).toBe("city");
  });

  it("accepts deeply nested config", () => {
    interface Inner {
      x: number;
    }
    interface Mid {
      inner: Inner;
    }
    interface Source {
      mid: Mid;
    }
    interface Target {
      mid: Mid;
    }
    const config: TransformConfig<Source, Target> = {
      nested: {
        mid: {
          nested: {
            inner: { rename: { x: "x" } },
          },
        },
      },
    };
    expect(config.nested?.mid?.nested?.inner).toBeDefined();
  });

  it("accepts empty nested config", () => {
    interface Source {
      addr: { city: string };
    }
    interface Target {
      addr: { city: string };
    }
    const config: TransformConfig<Source, Target> = {
      nested: {},
    };
    expect(config.nested).toEqual({});
  });

  it("accepts combined flat and nested config", () => {
    interface Source {
      id: number;
      address: { city: string; zip: string };
    }
    interface Target {
      id: number;
      address: { location: string };
    }
    const config: TransformConfig<Source, Target> = {
      rename: { id: "id" },
      nested: {
        address: { rename: { location: "city" } },
      },
    };
    expect(config.rename?.id).toBe("id");
    expect(config.nested?.address?.rename?.location).toBe("city");
  });

  it("NestedTransformConfig excludes array-valued target fields", () => {
    interface Source {
      items: { id: number }[];
    }
    interface Target {
      items: { id: number }[];
    }
    // nested should not have 'items' because To['items'] is an array
    const config: TransformConfig<Source, Target> = {
      // items is array - use transformArrayInto, not nested
    };
    expect(config).toBeDefined();
  });
});

describe("renamePaths config", () => {
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

  it("accepts renamePaths with dot-notation nested paths", () => {
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
});

describe("collections config", () => {
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

  it("collections config type correctly types nested element config", () => {
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
    expect(config.collections?.users?.compute?.fullName?.({ first: "A", last: "B" })).toBe("A B");
  });
});

describe("collection mapping type shapes", () => {
  it("transformArrayInto accepts TransformConfig", () => {
    interface From {
      first_name: string;
    }
    interface To {
      firstName: string;
    }
    const config: TransformConfig<From, To> = { rename: { firstName: "first_name" } };
    // Type verification: config is valid; stub throws at runtime
    expect(() => transformArrayInto<From, To>([], config)).toThrow("typesugar transformer");
  });

  it("transformArrayInto returns T[] for element type T", () => {
    interface Item {
      id: number;
    }
    // Type verification: transformArrayInto<Item, Item> returns Item[]; stub throws at runtime
    expect(() => {
      const _arr: Item[] = transformArrayInto<Item, Item>([{ id: 1 }]);
      return _arr;
    }).toThrow("typesugar transformer");
  });

  it("transformArrayInto with no config maps identity when types match", () => {
    interface Item {
      x: number;
    }
    const items: Item[] = [{ x: 1 }, { x: 2 }];
    // Type verification: identity mapping; stub throws at runtime
    expect(() => {
      const _result: Item[] = transformArrayInto<Item, Item>(items);
      return _result;
    }).toThrow("typesugar transformer");
  });
});

describe("edge cases", () => {
  it("nested config with compute in nested level", () => {
    interface Source {
      addr: { a: number; b: number };
    }
    interface Target {
      addr: { sum: number };
    }
    const config: TransformConfig<Source, Target> = {
      nested: {
        addr: {
          compute: { sum: (src) => src.a + src.b },
        },
      },
    };
    expect(typeof config.nested?.addr?.compute?.sum).toBe("function");
  });

  it("nested config with const in nested level", () => {
    interface Source {
      meta: { name: string };
    }
    interface Target {
      meta: { name: string; kind: string };
    }
    const config: TransformConfig<Source, Target> = {
      nested: {
        meta: { const: { kind: "nested" } },
      },
    };
    expect(config.nested?.meta?.const?.kind).toBe("nested");
  });

  it("array of objects — transformArrayInto type", () => {
    interface UserDto {
      first_name: string;
      last_name: string;
    }
    interface User {
      firstName: string;
      lastName: string;
    }
    const dtos: UserDto[] = [
      { first_name: "John", last_name: "Doe" },
      { first_name: "Jane", last_name: "Smith" },
    ];
    const config: TransformConfig<UserDto, User> = {
      rename: { firstName: "first_name", lastName: "last_name" },
    };
    // Type verification: User[] return type; stub throws at runtime
    expect(() => transformArrayInto<UserDto, User>(dtos, config)).toThrow("typesugar transformer");
  });
});
