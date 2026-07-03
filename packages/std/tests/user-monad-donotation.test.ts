/**
 * Regression test for PEP-052 Phase B: a user-defined monad registered via the
 * `@impl`/`@instance` attribute macro must be visible to the `let:`/`yield:` and
 * `par:`/`yield:` do-notation macros.
 *
 * Do-notation FlatMap/ParCombine detection resolves via the focused
 * `doNotationRegistry`, populated by `mirrorDoNotationInstance` at every instance
 * registration site (`registerInstanceWithMeta` AND the `@instance`/`@impl` attribute
 * macro). If the macro's mirror call is dropped, a user-defined `@impl FlatMap<T>`
 * monad silently stops resolving in do-notation (the std built-ins keep working, so
 * the suite would otherwise stay green).
 */
import { describe, it, expect } from "vitest";

import "@typesugar/macros";
import "@typesugar/std/macros";

import { transformCode } from "@typesugar/transformer";

const USER_FLATMAP_SOURCE = `
import "@typesugar/std/syntax/do";

/** @typeclass */
interface FlatMap<F> { map(fa: F, f: any): F; }

class Box<A> {
  constructor(public value: A) {}
  flatMap<B>(f: (a: A) => Box<B>): Box<B> { return f(this.value); }
  map<B>(f: (a: A) => B): Box<B> { return new Box(f(this.value)); }
}
function box<A>(a: A): Box<A> { return new Box(a); }

/** @impl FlatMap<Box> */
const flatMapBox: FlatMap<Box<unknown>> = { map: (fa: any, f: any) => fa.map(f) };

const result =
let: {
  x << box(1);
  y << box(2);
}
yield: { x + y }
`;

describe("user-defined @impl monad in do-notation (PEP-052 Phase B)", () => {
  it("resolves a user-defined @impl FlatMap instance in let:/yield:", () => {
    const result = transformCode(USER_FLATMAP_SOURCE, { fileName: "user-monad.ts" });

    const errors = (result.diagnostics ?? []).filter((d) => d.severity === "error");
    expect(errors, `Unexpected errors: ${JSON.stringify(errors)}`).toEqual([]);

    // The comprehension must be lowered to the receiver's flatMap/map chain — not
    // left untransformed with a "No FlatMap instance registered for 'Box'" error.
    expect(result.code).toContain("box(1).flatMap(");
    expect(result.code).not.toContain("let: {");
    expect(result.code).not.toContain("yield: {");
  });
});
