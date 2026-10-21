/**
 * The emitted code of every built-in extractor (Some/None, Left/Right,
 * Cons/Nil over fp's untagged representations and over `_tag` unions;
 * Ok/Err), in the fluent form and in the `match:` switch, pinned exactly.
 *
 * These were special cases in match.ts; they are now `Destructure` instances
 * owned by the packages that own the types (@typesugar/fp ships fp's), and
 * the fixtures below declare the same instances. The output was pinned
 * before that change and is identical after it: the descriptors inline to
 * the same tests and field reads.
 */
import { describe, it, expect } from "vitest";
import { transformAndRun } from "./match-exec-helpers.js";

/** A `Destructure` instance that only carries a descriptor, as a library ships them. */
const inst = (ctor: string, input: string, descriptor: string) => `
/**
 * @impl Destructure<typeof ${ctor}, ${input}, unknown>
 * @destructure ${descriptor}
 */
const destructure${ctor} = { extract: (v: ${input}): unknown => v };`;

/** fp's untagged representations, with the instances @typesugar/fp ships. */
const FP = `import { match } from "@typesugar/std";
type Option<A> = A | null;
declare function Some<A>(value: A): Option<A>;
declare const None: Option<never>;
interface Left<E> { readonly left: E; readonly right?: undefined }
interface Right<A> { readonly left?: undefined; readonly right: A }
type Either<E, A> = Left<E> | Right<A>;
declare function Left<E>(left: E): Either<E, never>;
declare function Right<A>(right: A): Either<never, A>;
interface Cons<A> { readonly head: A; readonly tail: List<A> }
type List<A> = Cons<A> | null;
declare function Cons<A>(head: A, tail: List<A>): List<A>;
declare const Nil: List<never>;
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
declare function Ok<T>(v: T): Result<T, never>;
declare function Err<E>(e: E): Result<never, E>;
${inst("Some", "Option<unknown>", "not-null -> self")}
${inst("None", "Option<unknown>", "null")}
${inst("Left", "Either<unknown, unknown>", "has left -> left")}
${inst("Right", "Either<unknown, unknown>", "has right -> right")}
${inst("Cons", "List<unknown>", "not-null -> head, tail")}
${inst("Nil", "List<unknown>", "null")}
${inst("Ok", "Result<unknown, unknown>", "ok = true -> value")}
${inst("Err", "Result<unknown, unknown>", "ok = false -> error")}
`;

/** \`_tag\` unions (Effect-style), each with its own instances. */
const TAGGED = `import { match } from "@typesugar/std";
type TOption<A> = { _tag: "Some"; value: A } | { _tag: "None" };
type TEither<E, A> = { _tag: "Left"; value: E } | { _tag: "Right"; value: A };
type TList<A> = { _tag: "Cons"; head: A; tail: TList<A> } | { _tag: "Nil" };
declare function Some<A>(value: A): TOption<A>;
declare const None: TOption<never>;
declare function Left<E>(value: E): TEither<E, never>;
declare function Right<A>(value: A): TEither<never, A>;
declare function Cons<A>(head: A, tail: TList<A>): TList<A>;
declare const Nil: TList<never>;
${inst("Some", "TOption<unknown>", '_tag = "Some" -> value')}
${inst("None", "TOption<unknown>", '_tag = "None"')}
${inst("Left", "TEither<unknown, unknown>", '_tag = "Left" -> value')}
${inst("Right", "TEither<unknown, unknown>", '_tag = "Right" -> value')}
${inst("Cons", "TList<unknown>", '_tag = "Cons" -> head, tail')}
${inst("Nil", "TList<unknown>", '_tag = "Nil"')}
`;

const fixture = (name: string) => (name.startsWith("tagged") ? TAGGED : FP);

const SW = (t: string, a: string, b: string) =>
  `export function g(x: ${t}): unknown {\n  match: switch (x) {\n    case ${a}:\n      return 1;\n    case ${b}:\n      return 2;\n  }\n}`;
const SWITCHES = {
  fpOption: SW("Option<number>", "Some(v)", "None"),
  fpEither: SW("Either<string, number>", "Left(l)", "Right(r)"),
  fpList: SW("List<number>", "Cons(h, t)", "Nil"),
  result: SW("Result<number, string>", "Ok(v)", "Err(e)"),
  taggedOption: SW("TOption<number>", "Some(v)", "None"),
  taggedEither: SW("TEither<string, number>", "Left(l)", "Right(r)"),
  taggedList: SW("TList<number>", "Cons(h, t)", "Nil"),
};
const CASES = {
  fpOption: `export const f = (o: Option<number>) => match(o).case(Some(v)).then(v + 1).case(None).then(0);`,
  fpEither: `export const f = (e: Either<string, number>) => match(e).case(Left(l)).then(l.length).case(Right(r)).then(r);`,
  fpList: `export const f = (xs: List<number>) => match(xs).case(Cons(h, t)).then(h).case(Nil).then(0);`,
  result: `export const f = (r: Result<number, string>) => match(r).case(Ok(v)).then(v).case(Err(e)).then(e.length);`,
  taggedOption: `export const f = (o: TOption<number>) => match(o).case(Some(v)).then(v + 1).case(None).then(0);`,
  taggedEither: `export const f = (e: TEither<string, number>) => match(e).case(Left(l)).then(l.length).case(Right(r)).then(r);`,
  taggedList: `export const f = (xs: TList<number>) => match(xs).case(Cons(h, t)).then(h).case(Nil).then(0);`,
};

const FLUENT_OUTPUT: Record<string, string> = {
  fpOption:
    "export const f = (o: Option<number>) => (() => {\n    const _o = o;\n    if (_o != null) {\n        const v = _o;\n        return v + 1;\n    }\n    if (_o == null) {\n        return 0;\n    }\n    throw new MatchError(_o);\n})();",
  fpEither:
    'export const f = (e: Either<string, number>) => (() => {\n    const _e = e;\n    if ("left" in _e) {\n        const l = _e.left;\n        return l.length;\n    }\n    if ("right" in _e) {\n        const r = _e.right;\n        return r;\n    }\n    throw new MatchError(_e);\n})();',
  fpList:
    "export const f = (xs: List<number>) => (() => {\n    const _xs = xs;\n    if (_xs != null) {\n        const h = _xs.head;\n        const t = _xs.tail;\n        return h;\n    }\n    if (_xs == null) {\n        return 0;\n    }\n    throw new MatchError(_xs);\n})();",
  result:
    "export const f = (r: Result<number, string>) => (() => {\n    const _r = r;\n    if (_r.ok === true) {\n        const v = _r.value;\n        return v;\n    }\n    if (_r.ok === false) {\n        const e = _r.error;\n        return e.length;\n    }\n    throw new MatchError(_r);\n})();",
  taggedOption:
    'export const f = (o: TOption<number>) => (() => {\n    const _o = o;\n    if (_o._tag === "Some") {\n        const v = _o.value;\n        return v + 1;\n    }\n    if (_o._tag === "None") {\n        return 0;\n    }\n    throw new MatchError(_o);\n})();',
  taggedEither:
    'export const f = (e: TEither<string, number>) => (() => {\n    const _e = e;\n    if (_e._tag === "Left") {\n        const l = _e.value;\n        return l.length;\n    }\n    if (_e._tag === "Right") {\n        const r = _e.value;\n        return r;\n    }\n    throw new MatchError(_e);\n})();',
  taggedList:
    'export const f = (xs: TList<number>) => (() => {\n    const _xs = xs;\n    if (_xs._tag === "Cons") {\n        const h = _xs.head;\n        const t = _xs.tail;\n        return h;\n    }\n    if (_xs._tag === "Nil") {\n        return 0;\n    }\n    throw new MatchError(_xs);\n})();',
};

const SWITCH_OUTPUT: Record<string, string> = {
  fpOption:
    "export function g(x: Option<number>): unknown {\n    switch (true) {\n        case x != null: {\n            const v = x;\n            return 1;\n        }\n        case x == null: return 2;\n    }\n}",
  fpEither:
    'export function g(x: Either<string, number>): unknown {\n    switch (true) {\n        case "left" in x: {\n            const l = x.left;\n            return 1;\n        }\n        case "right" in x: {\n            const r = x.right;\n            return 2;\n        }\n    }\n}',
  fpList:
    "export function g(x: List<number>): unknown {\n    switch (true) {\n        case x != null: {\n            const h = x.head;\n            const t = x.tail;\n            return 1;\n        }\n        case x == null: return 2;\n    }\n}",
  result:
    "export function g(x: Result<number, string>): unknown {\n    switch (x.ok) {\n        case true: {\n            const v = x.value;\n            return 1;\n        }\n        case false: {\n            const e = x.error;\n            return 2;\n        }\n    }\n}",
  taggedOption:
    'export function g(x: TOption<number>): unknown {\n    switch (x._tag) {\n        case "Some": {\n            const v = x.value;\n            return 1;\n        }\n        case "None": return 2;\n    }\n}',
  taggedEither:
    'export function g(x: TEither<string, number>): unknown {\n    switch (x._tag) {\n        case "Left": {\n            const l = x.value;\n            return 1;\n        }\n        case "Right": {\n            const r = x.value;\n            return 2;\n        }\n    }\n}',
  taggedList:
    'export function g(x: TList<number>): unknown {\n    switch (x._tag) {\n        case "Cons": {\n            const h = x.head;\n            const t = x.tail;\n            return 1;\n        }\n        case "Nil": return 2;\n    }\n}',
};

function emitted(code: string, from: string): string {
  const r = transformAndRun(code);
  expect(r.errors).toEqual([]);
  expect(r.warnings).toEqual([]);
  return r.code.slice(r.code.indexOf(from)).trimEnd();
}

describe("built-in extractor output, fluent match()", () => {
  for (const [name, code] of Object.entries(CASES)) {
    it(name, () => {
      expect(emitted(fixture(name) + code, "export const f")).toBe(FLUENT_OUTPUT[name]);
    });
  }
});

describe("built-in extractor output, match: switch", () => {
  for (const [name, code] of Object.entries(SWITCHES)) {
    it(name, () => {
      expect(
        emitted(
          'import "@typesugar/std/syntax/match";\n' + fixture(name) + code,
          "export function g"
        )
      ).toBe(SWITCH_OUTPUT[name]);
    });
  }
});
