import { describe, it, expect } from "vitest";
import { createBuilder, NamedArgsError } from "../index.js";
import type { ParamMeta } from "../index.js";

function makeUser(name: string, age: number, email: string): {
  name: string;
  age: number;
  email: string;
} {
  return { name, age, email };
}

const userParams: ParamMeta[] = [
  { name: "name", type: "string", required: true, position: 0 },
  { name: "age", type: "number", required: true, position: 1 },
  { name: "email", type: "string", required: true, position: 2 },
];

function greet(name: string, greeting: string = "Hello"): string {
  return `${greeting}, ${name}!`;
}

const greetParams: ParamMeta[] = [
  { name: "name", type: "string", required: true, position: 0 },
  {
    name: "greeting",
    type: "string",
    required: false,
    defaultValue: "Hello",
    position: 1,
  },
];

describe("Builder", () => {
  describe("sequential building", () => {
    it("sets params one at a time and builds", () => {
      const result = createBuilder(makeUser, userParams)
        .set("name", "Alice")
        .set("age", 30)
        .set("email", "alice@example.com")
        .build();

      expect(result).toEqual({
        name: "Alice",
        age: 30,
        email: "alice@example.com",
      });
    });
  });

  describe("out of order", () => {
    it("sets params in any order", () => {
      const result = createBuilder(makeUser, userParams)
        .set("email", "bob@example.com")
        .set("name", "Bob")
        .set("age", 25)
        .build();

      expect(result).toEqual({
        name: "Bob",
        age: 25,
        email: "bob@example.com",
      });
    });
  });

  describe("required checking", () => {
    it("throws when building without required params", () => {
      const builder = createBuilder(makeUser, userParams).set("name", "Alice");

      expect(() => builder.build()).toThrow(NamedArgsError);
      expect(() => builder.build()).toThrow(/Missing required parameter 'age'/);
    });

    it("throws for the first missing required param in position order", () => {
      const builder = createBuilder(makeUser, userParams);

      try {
        builder.build();
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(NamedArgsError);
        expect((err as NamedArgsError).paramName).toBe("name");
      }
    });
  });

  describe("fluent API", () => {
    it("supports method chaining", () => {
      const result = createBuilder(makeUser, userParams)
        .set("name", "Carol")
        .set("age", 28)
        .set("email", "carol@example.com")
        .build();

      expect(result.name).toBe("Carol");
    });
  });

  describe("immutability / reuse", () => {
    it("each .set() returns a new builder, original unchanged", () => {
      const b0 = createBuilder(makeUser, userParams);
      const b1 = b0.set("name", "Alice");
      const b2 = b1.set("age", 30);

      expect(b0.values()).toEqual({});
      expect(b1.values()).toEqual({ name: "Alice" });
      expect(b2.values()).toEqual({ name: "Alice", age: 30 });
    });

    it("allows branching from the same partial builder", () => {
      const base = createBuilder(makeUser, userParams)
        .set("name", "Dana")
        .set("age", 35);

      const result1 = base.set("email", "dana@work.com").build();
      const result2 = base.set("email", "dana@personal.com").build();

      expect(result1.email).toBe("dana@work.com");
      expect(result2.email).toBe("dana@personal.com");
      expect(result1.name).toBe("Dana");
      expect(result2.name).toBe("Dana");
    });
  });

  describe("defaults", () => {
    it("fills defaults for optional params when not set", () => {
      const result = createBuilder(greet, greetParams)
        .set("name", "World")
        .build();

      expect(result).toBe("Hello, World!");
    });

    it("overrides defaults when set", () => {
      const result = createBuilder(greet, greetParams)
        .set("name", "World")
        .set("greeting", "Hey")
        .build();

      expect(result).toBe("Hey, World!");
    });
  });

  describe("unknown params", () => {
    it("throws for unknown param names", () => {
      expect(() =>
        createBuilder(makeUser, userParams).set("unknown", "val"),
      ).toThrow(NamedArgsError);
      expect(() =>
        createBuilder(makeUser, userParams).set("unknown", "val"),
      ).toThrow(/Unknown parameter 'unknown'/);
    });
  });

  describe("values()", () => {
    it("returns a snapshot of accumulated values", () => {
      const builder = createBuilder(makeUser, userParams)
        .set("name", "Eve")
        .set("age", 22);

      const vals = builder.values();
      expect(vals).toEqual({ name: "Eve", age: 22 });
    });

    it("returns an independent copy", () => {
      const builder = createBuilder(makeUser, userParams).set("name", "Frank");
      const vals = builder.values();
      (vals as any).name = "mutated";
      expect(builder.values().name).toBe("Frank");
    });
  });
});
