/**
 * Do-notation finds a FlatMap instance by the bind's TYPE, not its printed
 * name (PEP-062 "match by type, not by name"; neverthrow case study F7).
 *
 * neverthrow's `Result<T, E>` is a union of two classes, `Ok<T, E> | Err<T, E>`,
 * and `ok(1)` is typed `Ok<number, never>`, not `Result`. With the instance
 * declared `@impl FlatMap<Result>`, a first bind typed `Ok<…>`, `Err<…>` or an
 * alias of `Result` printed as `Ok`, `Err` or the alias's name, and the
 * comprehension failed with TS9225 "No FlatMap instance for 'Ok'".
 */
import { describe, it, expect } from "vitest";

import "@typesugar/macros";
import "@typesugar/std/macros";

import { transformCode } from "@typesugar/transformer";

const RESULT = `
import "@typesugar/std/syntax/do";

declare class Ok<T, E> {
  readonly value: T;
  andThen<U, F>(f: (t: T) => Result<U, F>): Result<U, E | F>;
  map<U>(f: (t: T) => U): Result<U, E>;
}
declare class Err<T, E> {
  readonly error: E;
  andThen<U, F>(f: (t: T) => Result<U, F>): Result<U, E | F>;
  map<U>(f: (t: T) => U): Result<U, E>;
}
type Result<T, E> = Ok<T, E> | Err<T, E>;
declare function ok<T>(t: T): Ok<T, never>;
declare function err<E>(e: E): Err<never, E>;

/**
 * @impl FlatMap<Result>
 * @do-methods bind=andThen map=map
 */
declare const flatMapResult: unknown;
`;

function expand(body: string, fileName: string) {
  const result = transformCode(RESULT + body, { fileName });
  return {
    errors: result.diagnostics.filter((d) => d.severity === "error").map((d) => d.message),
    code: result.code,
  };
}

describe("do-notation resolves a FlatMap instance by the bind's type", () => {
  it("a bind typed as the instance's own type (control)", () => {
    const { errors, code } = expand(
      `declare const r: Result<number, string>;
const a = let: { x << r; } yield: x + 1;`,
      "do-by-type-control.ts"
    );
    expect(errors).toEqual([]);
    expect(code).toContain("r.map(");
  });

  it("a bind typed as one member of the union (Ok<…>)", () => {
    const { errors, code } = expand(
      `const a = let: { x << ok(1); y << ok(x + 1); } yield: x + y;`,
      "do-by-type-ok.ts"
    );
    expect(errors).toEqual([]);
    expect(code).toContain("ok(1).andThen(");
  });

  it("a bind typed as the other member (Err<…>)", () => {
    const { errors, code } = expand(
      `const b = let: { x << err("no"); } yield: x;`,
      "do-by-type-err.ts"
    );
    expect(errors).toEqual([]);
    expect(code).toContain('err("no").map(');
  });

  it("a bind typed through an alias of the instance's type", () => {
    const { errors, code } = expand(
      `type R<T> = Result<T, string>;
declare const r: R<number>;
const d = let: { x << r; } yield: x * 2;`,
      "do-by-type-alias.ts"
    );
    expect(errors).toEqual([]);
    expect(code).toContain("r.map(");
  });

  it("a same-named type that is NOT the instance's type still has no instance", () => {
    const { errors } = expand(
      `declare class Other<T> { andThen(f: (t: T) => Other<T>): Other<T>; map<U>(f: (t: T) => U): Other<U>; }
declare const o: Other<number>;
const e = let: { x << o; } yield: x;`,
      "do-by-type-unrelated.ts"
    );
    expect(errors.join("\n")).toContain("No FlatMap instance for 'Other'");
  });
});
