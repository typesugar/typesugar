import { describe, it, expect } from "vitest";
import { expandCode } from "@typesugar/testing";

describe("@derive(Validation) macro", () => {
  it("expands to validation methods", async () => {
    await import("../src/macros/index.js");

    const source = `
      import { derive } from "@typesugar/derive";
      import { Validation } from "my-typesugar-macros";

      @derive(Validation)
      class User {
        name: string;
        age: number;
      }
    `;

    const result = await expandCode(source);

    // Should generate validate method
    expect(result).toContain("validate");
    expect(result).toContain("isValid");
    expect(result).toContain("errors");
  });

  it("runtime validation works correctly", () => {
    // Simulated generated code
    class User {
      name: string;
      age: number;

      constructor(name: string, age: number) {
        this.name = name;
        this.age = age;
      }

      validate(): string[] {
        const errors: string[] = [];
        if (typeof this.name !== "string") {
          errors.push("name must be a string");
        }
        if (typeof this.age !== "number" || isNaN(this.age)) {
          errors.push("age must be a valid number");
        }
        return errors;
      }

      isValid(): boolean {
        return this.validate().length === 0;
      }
    }

    const validUser = new User("Alice", 30);
    expect(validUser.isValid()).toBe(true);
    expect(validUser.validate()).toEqual([]);

    const invalidUser = new User("Bob", NaN);
    expect(invalidUser.isValid()).toBe(false);
    expect(invalidUser.validate()).toContain("age must be a valid number");
  });
});
