/**
 * @typesugar/mapper — runtime API surface tests
 *
 * Tests the TransformConfig type constraints and the runtime stub behavior.
 * Macro expansion is tested separately in mapper.test.ts.
 */
import { describe, it, expect } from "vitest";
import { transformInto, type TransformConfig } from "../src/index.js";

describe("transformInto API surface", () => {
  it("exports transformInto as a function", () => {
    expect(transformInto).toBeDefined();
    expect(typeof transformInto).toBe("function");
  });

  it("throws at runtime without transformer", () => {
    expect(() => transformInto({ x: 1 }, {})).toThrow("typesugar transformer");
  });
});

describe("TransformConfig type constraints", () => {
  it("accepts rename config", () => {
    interface From {
      a: number;
    }
    interface To {
      b: number;
    }
    const config: TransformConfig<From, To> = {
      rename: { b: "a" },
    };
    expect(config.rename?.b).toBe("a");
  });

  it("accepts compute config with typed callback", () => {
    interface From {
      x: number;
      y: number;
    }
    interface To {
      sum: number;
    }
    const config: TransformConfig<From, To> = {
      compute: { sum: (src) => src.x + src.y },
    };
    expect(typeof config.compute?.sum).toBe("function");
    expect(config.compute!.sum!({ x: 3, y: 4 })).toBe(7);
  });

  it("accepts const config with correct value types", () => {
    interface From {
      name: string;
    }
    interface To {
      name: string;
      role: string;
    }
    const config: TransformConfig<From, To> = {
      const: { role: "admin" },
    };
    expect(config.const?.role).toBe("admin");
  });

  it("accepts ignore.source config", () => {
    interface From {
      a: number;
      b: string;
      c: boolean;
    }
    interface To {
      a: number;
    }
    const config: TransformConfig<From, To> = {
      ignore: { source: ["b", "c"] },
    };
    expect(config.ignore?.source).toEqual(["b", "c"]);
  });

  it("accepts ignore.target config", () => {
    interface From {
      a: number;
    }
    interface To {
      a: number;
      optional: string;
    }
    const config: TransformConfig<From, To> = {
      ignore: { target: ["optional"] },
    };
    expect(config.ignore?.target).toEqual(["optional"]);
  });

  it("accepts combined config with all options", () => {
    interface From {
      first_name: string;
      last_name: string;
    }
    interface To {
      name: string;
      greeting: string;
      tag: string;
    }
    const config: TransformConfig<From, To> = {
      rename: { name: "first_name" },
      compute: { greeting: (src) => `Hello ${src.first_name}` },
      const: { tag: "user" },
    };
    expect(config.rename?.name).toBe("first_name");
    expect(typeof config.compute?.greeting).toBe("function");
    expect(config.const?.tag).toBe("user");
  });

  it("allows partial config — all fields are optional", () => {
    interface From {
      x: number;
    }
    interface To {
      x: number;
    }
    const empty: TransformConfig<From, To> = {};
    expect(empty).toEqual({});
  });

  it("allows ignore with both source and target", () => {
    interface From {
      a: number;
      extra: string;
    }
    interface To {
      a: number;
      computed: boolean;
    }
    const config: TransformConfig<From, To> = {
      ignore: { source: ["extra"], target: ["computed"] },
    };
    expect(config.ignore?.source).toEqual(["extra"]);
    expect(config.ignore?.target).toEqual(["computed"]);
  });
});
