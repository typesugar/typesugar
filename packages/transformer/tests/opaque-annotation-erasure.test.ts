/**
 * `@opaque` annotations in expanded code.
 *
 * Expansion erases `Some(x)` to `x`, so an `Option<number>` in expanded code
 * holds a `number | null`. PEP-019 Wave 1 stripped the annotation, but only
 * on a variable or a parameter default initialized by an erased constructor,
 * and only for same-project types: `function fo(o: Option<number>)` called
 * as `fo(Some(2))` became `fo(2)` against an `Option<number>` parameter, and
 * `const a: Option<number> = Some(3)` with a library type became `= 3`,
 * both errors under strictOutput. Stripping also changed the declarations
 * emitted from the expanded program (`x: Money` for `x: Option<Money>`).
 *
 * Now every annotation is kept as written, and expanded code is checked
 * against the runtime view of `@opaque` types (`opaqueTypesAsUnderlying`),
 * which is what it is written against.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import { transformCode } from "../src/pipeline.js";
import { transformWithDecls, DECLS_FILE } from "./opaque-fixture.js";
import { registerTypeRewrite, clearTypeRewrites } from "@typesugar/core";

beforeEach(() => {
  clearTypeRewrites();
});

afterEach(() => {
  clearTypeRewrites();
});

function registerOptionType(declarationFile: string = DECLS_FILE): void {
  registerTypeRewrite({
    typeName: "Option",
    sourceModule: "@typesugar/fp/data/option",
    declarationFile,
    underlyingTypeText: "T | null",
    methods: new Map([
      ["map", "map"],
      ["flatMap", "flatMap"],
      ["getOrElse", "getOrElse"],
      ["filter", "filter"],
    ]),
    constructors: new Map([
      ["Some", { kind: "identity" }],
      ["None", { kind: "constant", value: "null" }],
    ]),
    accessors: new Map([["value", { kind: "identity" }]]),
    transparent: true,
  });
}

function registerEitherType(declarationFile: string = DECLS_FILE): void {
  registerTypeRewrite({
    typeName: "Either",
    sourceModule: "@typesugar/fp/data/either",
    declarationFile,
    underlyingTypeText: "{ _tag: 'Left', left: E } | { _tag: 'Right', right: A }",
    constructors: new Map([
      ["Right", { kind: "identity" }],
      ["Left", { kind: "identity" }],
    ]),
    transparent: true,
  });
}

const optionDeclarations = `
/** @opaque A | null */
interface Option<A> {
  readonly value: A;
  map<B>(f: (a: A) => B): Option<B>;
  flatMap<B>(f: (a: A) => Option<B>): Option<B>;
  getOrElse(defaultValue: () => A): A;
  filter(pred: (a: A) => boolean): Option<A>;
}
declare function Some<A>(a: A): Option<A>;
declare const None: Option<never>;
declare function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B>;
declare function flatMap<A, B>(o: Option<A>, f: (a: A) => Option<B>): Option<B>;
declare function getOrElse<A>(o: Option<A>, d: () => A): A;
declare function filter<A>(o: Option<A>, pred: (a: A) => boolean): Option<A>;
`.trim();

const eitherDeclarations = `
/** @opaque { _tag: 'Left', left: E } | { _tag: 'Right', right: A } */
interface Either<E, A> {
  readonly _tag: string;
}
declare function Right<A>(a: A): Either<never, A>;
declare function Left<E>(e: E): Either<E, never>;
`.trim();

function expandStrict(code: string, fileName: string) {
  const result = transformWithDecls(code, fileName, { strictOutput: true });
  return {
    code: result.code,
    errors: result.diagnostics.filter((d) => d.severity === "error").map((d) => d.message),
    strict: result.diagnostics
      .filter((d) => d.message.startsWith("[strictOutput]"))
      .map((d) => d.message),
  };
}

describe("@opaque annotations: kept in every position, and the expanded code type-checks", () => {
  it("variables: an erased constructor, an erased constant, a raw value", () => {
    registerOptionType();
    const r = expandStrict(
      `${optionDeclarations}
class Money { constructor(public amount: number, public currency: string) {} }
const discount: Option<Money> = Some(new Money(500, "USD"));
let greeting: Option<string> = Some("hello");
const empty: Option<number> = None;
const raw: Option<number> = 3;
console.log(discount, greeting, empty, raw);
`,
      "annotation-variables.ts"
    );
    expect(r.errors).toEqual([]);
    expect(r.strict).toEqual([]);
    expect(r.code).toContain('const discount: Option<Money> = new Money(500, "USD");');
    expect(r.code).toContain('let greeting: Option<string> = "hello";');
    expect(r.code).toContain("const empty: Option<number> = null;");
    expect(r.code).toContain("const raw: Option<number> = 3;");
    expect(r.code).not.toContain("Some(");
  });

  it("parameters: an erased argument, an erased default, a method call on the parameter", () => {
    registerOptionType();
    const r = expandStrict(
      `${optionDeclarations}
function fo(o: Option<number>): number {
  return o.getOrElse(() => 0);
}
function withDefault(opt: Option<number> = Some(0)) {
  return opt;
}
function withNone(opt: Option<number> = None) {
  return opt;
}
console.log(fo(Some(2)), withDefault(), withNone());
`,
      "annotation-parameters.ts"
    );
    expect(r.errors).toEqual([]);
    expect(r.strict).toEqual([]);
    expect(r.code).toContain("function fo(o: Option<number>): number");
    expect(r.code).toMatch(/getOrElse\w*\(o, \(\) => 0\)/);
    expect(r.code).toContain("function withDefault(opt: Option<number> = 0)");
    expect(r.code).toContain("function withNone(opt: Option<number> = null)");
    expect(r.code).toContain("fo(2)");
  });

  it("returns, properties, arrays and type arguments", () => {
    registerOptionType();
    const r = expandStrict(
      `${optionDeclarations}
function find(n: number): Option<number> {
  return n > 0 ? Some(n) : None;
}
const half = (n: number): Option<number> => Some(n / 2);
interface Holder { value: Option<number> }
const holder: Holder = { value: Some(1) };
class Box {
  field: Option<string> = Some("x");
}
const list: Option<number>[] = [Some(1), None];
const table: Map<string, Option<number>> = new Map([["a", Some(1)]]);
function id<T>(x: T): T { return x; }
const viaGeneric = id<Option<number>>(Some(4));
console.log(find(1), half(2), holder, new Box(), list, table, viaGeneric);
`,
      "annotation-positions.ts"
    );
    expect(r.errors).toEqual([]);
    expect(r.strict).toEqual([]);
    expect(r.code).toContain("function find(n: number): Option<number>");
    expect(r.code).toContain("return n > 0 ? n : null;");
    expect(r.code).toContain("const half = (n: number): Option<number> => n / 2;");
    expect(r.code).toContain("value: Option<number>;");
    expect(r.code).toContain('field: Option<string> = "x";');
    expect(r.code).toContain("const list: Option<number>[] = [1, null];");
    expect(r.code).toContain("const viaGeneric = id<Option<number>>(4);");
    expect(r.code).not.toContain("Some(");
  });

  it("Either", () => {
    registerEitherType();
    const r = expandStrict(
      `${eitherDeclarations}
const result: Either<string, number> = Right(42);
function f(e: Either<string, number>) { return e; }
console.log(result, f(Left("no")));
`,
      "annotation-either.ts"
    );
    expect(r.errors).toEqual([]);
    expect(r.strict).toEqual([]);
    expect(r.code).toContain("const result: Either<string, number> = 42;");
  });

  it("inside the defining module (transparent), nothing is rewritten", () => {
    const definingFile = path.resolve("option.ts");
    registerTypeRewrite({
      typeName: "Option",
      sourceModule: definingFile,
      underlyingTypeText: "T | null",
      constructors: new Map([
        ["Some", { kind: "identity" }],
        ["None", { kind: "constant", value: "null" }],
      ]),
      transparent: true,
    });

    const code = `${optionDeclarations}
const result: Option<number> = Some(42);
`;

    const result = transformCode(code, { fileName: definingFile });
    expect(result.code).toContain("Option<number>");
    expect(result.code).toContain("Some(42)");
  });
});

describe("@opaque annotations with @typesugar/fp's real Option (its .d.ts)", () => {
  it("function fo(o: Option<number>) called as fo(Some(2)), and the other positions: no strictOutput error", () => {
    const fileName = path.resolve(__dirname, "__opaque_fp_strict__.ts");
    const r = transformCode(
      `import { Some, None, type Option } from "@typesugar/fp";
function fo(o: Option<number>): number {
  return o.getOrElse(() => 0);
}
const a: Option<number> = Some(3);
const b: Option<number> = None;
const list: Option<number>[] = [Some(1), None];
const inc = (x: Option<number>): Option<number> => x.map((n) => n + 1);
class Holder { value: Option<number> = Some(1); }
function id<T>(x: T): T { return x; }
const viaGeneric = id<Option<number>>(Some(4));
console.log(fo(Some(2)), a, b, list, inc(a), new Holder(), viaGeneric);
`,
      { fileName, strictOutput: true, transformerConfig: { cacheDir: false } }
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(r.code).toContain("function fo(o: Option<number>): number");
    expect(r.code).toContain("const a: Option<number> = 3;");
    expect(r.code).toContain("fo(2)");
    expect(r.code).toContain("const viaGeneric = id<Option<number>>(4);");
  });
});
