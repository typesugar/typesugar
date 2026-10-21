/**
 * fp's Destructure instances (Some/None, Left/Right, Cons/Nil, Valid/Invalid):
 * `extract` must agree with the `@destructure` descriptor, because the match
 * macro inlines the descriptor and never calls `extract`.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Some, None, destructureSome, destructureNone } from "./option.js";
import { Left, Right, destructureLeft, destructureRight } from "./either.js";
import { Cons, Nil, destructureCons, destructureNil } from "./list.js";
import { Valid, Invalid, destructureValid, destructureInvalid } from "./validated.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("fp Destructure instances", () => {
  it("Option: Some extracts a non-null value, None matches null", () => {
    expect(destructureSome.extract(Some(0))).toBe(0);
    expect(destructureSome.extract(None)).toBeUndefined();
    expect(destructureNone.extract(None)).toEqual([]);
    expect(destructureNone.extract(Some(1))).toBeUndefined();
  });

  it("Either: Left and Right test their key", () => {
    expect(destructureLeft.extract(Left("e"))).toBe("e");
    expect(destructureLeft.extract(Right(1))).toBeUndefined();
    expect(destructureRight.extract(Right(1))).toBe(1);
    expect(destructureRight.extract(Left("e"))).toBeUndefined();
  });

  it("List: Cons extracts head and tail, Nil matches null", () => {
    const l = Cons(1, Cons(2, Nil));
    expect(destructureCons.extract(l)).toEqual([1, Cons(2, Nil)]);
    expect(destructureCons.extract(Nil)).toBeUndefined();
    expect(destructureNil.extract(Nil)).toEqual([]);
    expect(destructureNil.extract(l)).toBeUndefined();
  });

  it("Validated: Valid and Invalid test their key", () => {
    expect(destructureValid.extract(Valid(3))).toBe(3);
    expect(destructureValid.extract(Invalid("x"))).toBeUndefined();
    expect(destructureInvalid.extract(Invalid("x"))).toBe("x");
    expect(destructureInvalid.extract(Valid(3))).toBeUndefined();
  });

  it("each instance declares the descriptor the macro inlines", () => {
    const expected: Record<string, [string, string]> = {
      "option.ts": ["destructureSome", "not-null -> self"],
      "either.ts": ["destructureLeft", "has left -> left"],
      "list.ts": ["destructureCons", "not-null -> head, tail"],
      "validated.ts": ["destructureValid", "has value -> value"],
    };
    for (const [file, [name, descriptor]] of Object.entries(expected)) {
      const text = fs.readFileSync(path.join(here, file), "utf-8");
      const block = text.slice(0, text.indexOf(`export const ${name}`));
      expect(block.slice(block.lastIndexOf("/**"))).toContain(`@destructure ${descriptor}`);
    }
  });
});
