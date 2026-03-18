/**
 * PEP-019 Wave 1: @opaque type annotation erasure tests.
 *
 * When an @opaque constructor is erased (e.g., `Some(x)` → `x`), the type
 * annotation on the containing variable declaration becomes invalid TypeScript.
 * The transformer must also strip or rewrite the annotation.
 *
 * `const discount: Option<Money> = Some(m)` → `const discount = m`
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import { transformCode } from "../src/pipeline.js";
import { registerTypeRewrite, clearTypeRewrites } from "@typesugar/core";

beforeEach(() => {
  clearTypeRewrites();
});

afterEach(() => {
  clearTypeRewrites();
});

function registerOptionType(): void {
  registerTypeRewrite({
    typeName: "Option",
    sourceModule: "@typesugar/fp/data/option",
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

function registerEitherType(): void {
  registerTypeRewrite({
    typeName: "Either",
    sourceModule: "@typesugar/fp/data/either",
    underlyingTypeText: "{ _tag: 'Left', left: E } | { _tag: 'Right', right: A }",
    constructors: new Map([
      ["Right", { kind: "identity" }],
      ["Left", { kind: "identity" }],
    ]),
    transparent: true,
  });
}

const optionDeclarations = `
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
interface Either<E, A> {
  readonly _tag: string;
}
declare function Right<A>(a: A): Either<never, A>;
declare function Left<E>(e: E): Either<E, never>;
`.trim();

// ---------------------------------------------------------------------------
// Variable declarations with identity constructors
// ---------------------------------------------------------------------------

describe("PEP-019 Wave 1: variable declaration annotation erasure", () => {
  it("strips Option<T> annotation when identity constructor is erased", () => {
    registerOptionType();

    const code = `${optionDeclarations}
class Money { constructor(public amount: number, public currency: string) {} }
const discount: Option<Money> = Some(new Money(500, "USD"));
`;

    const result = transformCode(code, { fileName: "annotation-identity.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("const discount = new Money(500");
    expect(result.code).not.toContain("Option<Money>");
    expect(result.code).not.toContain("Some(");
  });

  it("strips annotation with simple type argument", () => {
    registerOptionType();

    const code = `${optionDeclarations}
const value: Option<number> = Some(42);
`;

    const result = transformCode(code, { fileName: "annotation-simple.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("const value = 42");
    expect(result.code).not.toContain("Option<number>");
    expect(result.code).not.toContain("Some(");
  });

  it("strips annotation with expression argument", () => {
    registerOptionType();

    const code = `${optionDeclarations}
declare const x: number;
const result: Option<number> = Some(x + 1);
`;

    const result = transformCode(code, { fileName: "annotation-expr.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("x + 1");
    expect(result.code).not.toContain("Option<number>");
    expect(result.code).not.toContain("Some(");
  });

  it("strips annotation with let declaration", () => {
    registerOptionType();

    const code = `${optionDeclarations}
let result: Option<string> = Some("hello");
`;

    const result = transformCode(code, { fileName: "annotation-let.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toMatch(/let result = "hello"/);
    expect(result.code).not.toContain("Option<string>");
  });
});

// ---------------------------------------------------------------------------
// Variable declarations with constant constructors
// ---------------------------------------------------------------------------

describe("PEP-019 Wave 1: constant constructor annotation erasure", () => {
  it("strips Option<T> annotation when None is erased to null", () => {
    registerOptionType();

    const code = `${optionDeclarations}
const empty: Option<number> = None;
`;

    const result = transformCode(code, { fileName: "annotation-constant.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("const empty = null");
    expect(result.code).not.toContain("Option<number>");
  });
});

// ---------------------------------------------------------------------------
// Multiple opaque types
// ---------------------------------------------------------------------------

describe("PEP-019 Wave 1: multiple opaque types", () => {
  it("strips Either<E, A> annotation when Right is erased", () => {
    registerEitherType();

    const code = `${eitherDeclarations}
const result: Either<string, number> = Right(42);
`;

    const result = transformCode(code, { fileName: "annotation-either.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("const result = 42");
    expect(result.code).not.toContain("Either<string, number>");
  });

  it("handles both Option and Either in the same file", () => {
    registerOptionType();
    registerEitherType();

    const code = `${optionDeclarations}
${eitherDeclarations}
const opt: Option<number> = Some(1);
const eith: Either<string, number> = Right(2);
`;

    const result = transformCode(code, { fileName: "annotation-multi-type.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("const opt = 1");
    expect(result.code).toContain("const eith = 2");
    expect(result.code).not.toContain("Option<number>");
    expect(result.code).not.toContain("Either<string, number>");
  });
});

// ---------------------------------------------------------------------------
// Negative cases: annotation should NOT be stripped
// ---------------------------------------------------------------------------

describe("PEP-019 Wave 1: annotation preservation (negative cases)", () => {
  it("preserves annotation when initializer is not an opaque constructor", () => {
    registerOptionType();

    const code = `${optionDeclarations}
declare function getOption(): Option<number>;
const result: Option<number> = getOption();
`;

    const result = transformCode(code, { fileName: "annotation-preserve-noctor.ts" });
    expect(result.code).toContain("Option<number>");
  });

  it("preserves annotation when type is not opaque", () => {
    registerOptionType();

    const code = `
interface MyType<T> { value: T; }
declare function create<T>(x: T): MyType<T>;
const result: MyType<number> = create(5);
`;

    const result = transformCode(code, { fileName: "annotation-preserve-nonopaque.ts" });
    expect(result.code).toContain("MyType<number>");
  });

  it("preserves annotation when no initializer", () => {
    registerOptionType();

    const code = `${optionDeclarations}
declare const result: Option<number>;
`;

    const result = transformCode(code, { fileName: "annotation-preserve-noinit.ts" });
    expect(result.code).toContain("Option<number>");
  });

  it("preserves annotation inside transparent scope (defining file)", () => {
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

// ---------------------------------------------------------------------------
// Function parameter annotation erasure
// ---------------------------------------------------------------------------

describe("PEP-019 Wave 1: parameter default annotation erasure", () => {
  it("strips annotation from parameter with opaque default value", () => {
    registerOptionType();

    const code = `${optionDeclarations}
function process(opt: Option<number> = Some(0)) {
  return opt;
}
`;

    const result = transformCode(code, { fileName: "annotation-param-default.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).not.toContain("Option<number>");
    expect(result.code).not.toContain("Some(");
    expect(result.code).toMatch(/opt\s*=\s*0/);
  });

  it("strips annotation from parameter with None default", () => {
    registerOptionType();

    const code = `${optionDeclarations}
function process(opt: Option<number> = None) {
  return opt;
}
`;

    const result = transformCode(code, { fileName: "annotation-param-none.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).not.toContain("Option<number>");
    expect(result.code).toMatch(/opt\s*=\s*null/);
  });

  it("preserves annotation on parameter without default", () => {
    registerOptionType();

    const code = `${optionDeclarations}
function process(opt: Option<number>) {
  return opt;
}
`;

    const result = transformCode(code, { fileName: "annotation-param-nodefault.ts" });
    expect(result.code).toContain("Option<number>");
  });
});

// ---------------------------------------------------------------------------
// Gate criteria test
// ---------------------------------------------------------------------------

describe("PEP-019 Wave 1: gate criteria", () => {
  it("const discount: Option<Money> = Some(x) → const discount = x", () => {
    registerOptionType();

    const code = `${optionDeclarations}
class Money { constructor(public amount: number, public currency: string) {} }
const discount: Option<Money> = Some(new Money(500, "USD"));
console.log(discount);
`;

    const result = transformCode(code, { fileName: "gate-criteria.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);

    expect(result.code).toContain("const discount = new Money(500");
    expect(result.code).not.toContain("Option<Money>");
    expect(result.code).not.toContain("Some(");

    expect(result.code).toContain("console.log(discount)");
  });
});
