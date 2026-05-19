/**
 * Tests for generic.ts — Generic typeclass for structural representations
 *
 * Covers:
 * - registerGeneric / getGeneric: register, lookup, missing key, overwrite
 * - registerGenericMeta / getGenericMeta: same dimensions
 * - showProduct / showSum: empty, single field, multiple fields, nested
 * - eqProduct / eqSum: equal, unequal in one field, unequal tag, empty product
 * - ordProduct: lexicographic comparison
 * - hashProduct: deterministic combination of field hashes
 * - deriveShowViaGeneric / deriveEqViaGeneric: end-to-end
 * - genericDerive attribute macro: metadata and AST emission
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  registerGeneric,
  getGeneric,
  registerGenericMeta,
  getGenericMeta,
  showProduct,
  showSum,
  eqProduct,
  eqSum,
  ordProduct,
  hashProduct,
  deriveShowViaGeneric,
  deriveEqViaGeneric,
  genericDerive,
  type Field,
  type Product,
  type Variant,
  type Sum,
} from "./generic.js";
import { createMacroContext } from "@typesugar/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProduct<Fields extends readonly Field<string, unknown>[]>(
  names: { [K in keyof Fields]: Fields[K][0] },
  values: { [K in keyof Fields]: Fields[K][1] }
): Product<Fields> {
  return {
    _tag: "Product",
    names,
    fields: values,
  } as unknown as Product<Fields>;
}

function makeSum<Variants extends readonly Variant<string, unknown>[]>(
  discriminant: string,
  value: Variants[number]
): Sum<Variants> {
  return {
    _tag: "Sum",
    discriminant,
    value,
  } as Sum<Variants>;
}

// Primitive show/eq/ord/hash instances used in tests
const showNumber = { show: (n: number) => String(n) };
const showString = { show: (s: string) => `"${s}"` };
const showBoolean = { show: (b: boolean) => String(b) };

const eqNumber = { eq: (a: number, b: number) => a === b };
const eqString = { eq: (a: string, b: string) => a === b };

const ordNumber = { compare: (a: number, b: number) => a - b };
const ordString = { compare: (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0) };

const hashNumber = { hash: (n: number) => n | 0 };
const hashString = {
  hash: (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return h >>> 0;
  },
};

// ---------------------------------------------------------------------------
// registerGeneric / getGeneric
// ---------------------------------------------------------------------------

describe("registerGeneric / getGeneric", () => {
  it("registers and retrieves a Generic instance", () => {
    type Foo = { a: number };
    const inst = { to: (v: Foo) => v, from: (v: Foo) => v };
    registerGeneric<Foo, Foo>("TestFoo_register", inst);
    const got = getGeneric<Foo, Foo>("TestFoo_register");
    expect(got).toBe(inst);
  });

  it("returns undefined for unknown type name", () => {
    expect(getGeneric("NoSuchType_xxxx_unique")).toBeUndefined();
  });

  it("overwrites an existing registration", () => {
    const inst1 = { to: (v: number) => v, from: (v: number) => v };
    const inst2 = { to: (v: number) => v + 0, from: (v: number) => v + 0 };
    registerGeneric("TestOverwrite", inst1);
    registerGeneric("TestOverwrite", inst2);
    expect(getGeneric("TestOverwrite")).toBe(inst2);
  });

  it("pre-registers primitive identity instances", () => {
    // From generic.ts module init: number/string/boolean are registered.
    const gNum = getGeneric<number, number>("number");
    const gStr = getGeneric<string, string>("string");
    const gBool = getGeneric<boolean, boolean>("boolean");
    expect(gNum).toBeDefined();
    expect(gStr).toBeDefined();
    expect(gBool).toBeDefined();
    expect(gNum!.to(42)).toBe(42);
    expect(gStr!.from("hi")).toBe("hi");
    expect(gBool!.to(true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// registerGenericMeta / getGenericMeta
// ---------------------------------------------------------------------------

describe("registerGenericMeta / getGenericMeta", () => {
  it("registers and retrieves product meta", () => {
    registerGenericMeta("MetaProduct", {
      kind: "product",
      fieldNames: ["x", "y"],
      fieldTypes: ["number", "number"],
    });
    const meta = getGenericMeta("MetaProduct");
    expect(meta).toBeDefined();
    expect(meta!.kind).toBe("product");
    expect(meta!.fieldNames).toEqual(["x", "y"]);
    expect(meta!.fieldTypes).toEqual(["number", "number"]);
  });

  it("registers and retrieves sum meta", () => {
    registerGenericMeta("MetaSum", {
      kind: "sum",
      discriminant: "kind",
      variants: [
        { tag: "a", typeName: "VA" },
        { tag: "b", typeName: "VB" },
      ],
    });
    const meta = getGenericMeta("MetaSum");
    expect(meta!.kind).toBe("sum");
    expect(meta!.discriminant).toBe("kind");
    expect(meta!.variants).toHaveLength(2);
    expect(meta!.variants![0].tag).toBe("a");
  });

  it("returns undefined for unknown type", () => {
    expect(getGenericMeta("NoMeta_xxxx_unique")).toBeUndefined();
  });

  it("overwrites existing meta", () => {
    registerGenericMeta("MetaOverwrite", {
      kind: "product",
      fieldNames: ["a"],
      fieldTypes: ["number"],
    });
    registerGenericMeta("MetaOverwrite", { kind: "primitive" });
    expect(getGenericMeta("MetaOverwrite")!.kind).toBe("primitive");
  });
});

// ---------------------------------------------------------------------------
// showProduct
// ---------------------------------------------------------------------------

describe("showProduct", () => {
  it("renders an empty product", () => {
    const sp = showProduct<readonly []>([], [] as unknown as { [K in keyof (readonly [])]: never });
    const p = makeProduct<readonly []>([] as never, [] as never);
    expect(sp.show(p)).toBe("()");
  });

  it("renders a single-field product", () => {
    const sp = showProduct<readonly [Field<"x", number>]>([showNumber], ["x"]);
    const p = makeProduct<readonly [Field<"x", number>]>(["x"], [42]);
    expect(sp.show(p)).toBe("(x = 42)");
  });

  it("renders a multi-field product", () => {
    const sp = showProduct<readonly [Field<"x", number>, Field<"name", string>]>(
      [showNumber, showString],
      ["x", "name"]
    );
    const p = makeProduct<readonly [Field<"x", number>, Field<"name", string>]>(
      ["x", "name"],
      [1, "hi"]
    );
    expect(sp.show(p)).toBe('(x = 1, name = "hi")');
  });

  it("supports nested products via per-field Show instances", () => {
    type Inner = readonly [Field<"v", number>];
    type Outer = readonly [Field<"inner", Product<Inner>>];

    const showInner = showProduct<Inner>([showNumber], ["v"]);
    const showOuter = showProduct<Outer>([showInner], ["inner"]);

    const inner = makeProduct<Inner>(["v"], [7]);
    const outer = makeProduct<Outer>(["inner"], [inner]);
    expect(showOuter.show(outer)).toBe("(inner = (v = 7))");
  });
});

// ---------------------------------------------------------------------------
// showSum
// ---------------------------------------------------------------------------

describe("showSum", () => {
  type V = readonly [Variant<"some", number>, Variant<"none", null>];

  it("renders a matched variant", () => {
    const ss = showSum<V>([showNumber, { show: (_: null) => "null" }], ["some", "none"]);
    const s = makeSum<V>("kind", ["some", 5] as V[number]);
    expect(ss.show(s)).toBe("some(5)");
  });

  it("renders 'none' variant payload", () => {
    const ss = showSum<V>([showNumber, { show: (_: null) => "null" }], ["some", "none"]);
    const s = makeSum<V>("kind", ["none", null] as V[number]);
    expect(ss.show(s)).toBe("none(null)");
  });

  it("falls back to Unknown(tag) when tag not in tagList", () => {
    const ss = showSum<V>([showNumber, { show: (_: null) => "null" }], ["some", "none"]);
    // Force an unknown tag to exercise the fallback branch.
    const s = makeSum<V>("kind", [
      "other" as unknown as "some",
      0 as unknown as number,
    ] as V[number]);
    expect(ss.show(s)).toBe("Unknown(other)");
  });
});

// ---------------------------------------------------------------------------
// eqProduct
// ---------------------------------------------------------------------------

describe("eqProduct", () => {
  type F = readonly [Field<"x", number>, Field<"y", string>];

  it("returns true for equal products", () => {
    const ep = eqProduct<F>([eqNumber, eqString]);
    const a = makeProduct<F>(["x", "y"], [1, "a"]);
    const b = makeProduct<F>(["x", "y"], [1, "a"]);
    expect(ep.eq(a, b)).toBe(true);
  });

  it("returns false when one field differs", () => {
    const ep = eqProduct<F>([eqNumber, eqString]);
    const a = makeProduct<F>(["x", "y"], [1, "a"]);
    const b = makeProduct<F>(["x", "y"], [1, "b"]);
    expect(ep.eq(a, b)).toBe(false);
  });

  it("returns true for two empty products", () => {
    const ep = eqProduct<readonly []>([] as never);
    const a = makeProduct<readonly []>([] as never, [] as never);
    const b = makeProduct<readonly []>([] as never, [] as never);
    expect(ep.eq(a, b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// eqSum
// ---------------------------------------------------------------------------

describe("eqSum", () => {
  type V = readonly [Variant<"a", number>, Variant<"b", string>];

  it("returns true for same tag and equal payload", () => {
    const es = eqSum<V>([eqNumber, eqString], ["a", "b"]);
    const x = makeSum<V>("kind", ["a", 1] as V[number]);
    const y = makeSum<V>("kind", ["a", 1] as V[number]);
    expect(es.eq(x, y)).toBe(true);
  });

  it("returns false for different tags", () => {
    const es = eqSum<V>([eqNumber, eqString], ["a", "b"]);
    const x = makeSum<V>("kind", ["a", 1] as V[number]);
    const y = makeSum<V>("kind", ["b", "1"] as V[number]);
    expect(es.eq(x, y)).toBe(false);
  });

  it("returns false for same tag but unequal payload", () => {
    const es = eqSum<V>([eqNumber, eqString], ["a", "b"]);
    const x = makeSum<V>("kind", ["a", 1] as V[number]);
    const y = makeSum<V>("kind", ["a", 2] as V[number]);
    expect(es.eq(x, y)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ordProduct
// ---------------------------------------------------------------------------

describe("ordProduct", () => {
  type F = readonly [Field<"x", number>, Field<"y", string>];

  it("compares equal products as 0", () => {
    const op = ordProduct<F>([ordNumber, ordString]);
    const a = makeProduct<F>(["x", "y"], [1, "a"]);
    const b = makeProduct<F>(["x", "y"], [1, "a"]);
    expect(op.compare(a, b)).toBe(0);
  });

  it("uses first-field comparison when it differs", () => {
    const op = ordProduct<F>([ordNumber, ordString]);
    const a = makeProduct<F>(["x", "y"], [1, "z"]);
    const b = makeProduct<F>(["x", "y"], [2, "a"]);
    expect(op.compare(a, b)).toBeLessThan(0);
  });

  it("falls through to second field when first is equal (lex)", () => {
    const op = ordProduct<F>([ordNumber, ordString]);
    const a = makeProduct<F>(["x", "y"], [1, "a"]);
    const b = makeProduct<F>(["x", "y"], [1, "b"]);
    expect(op.compare(a, b)).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// hashProduct
// ---------------------------------------------------------------------------

describe("hashProduct", () => {
  type F = readonly [Field<"x", number>, Field<"y", string>];

  it("equal inputs produce equal hashes", () => {
    const hp = hashProduct<F>([hashNumber, hashString]);
    const a = makeProduct<F>(["x", "y"], [1, "hi"]);
    const b = makeProduct<F>(["x", "y"], [1, "hi"]);
    expect(hp.hash(a)).toBe(hp.hash(b));
  });

  it("differing inputs typically produce different hashes", () => {
    const hp = hashProduct<F>([hashNumber, hashString]);
    const a = makeProduct<F>(["x", "y"], [1, "hi"]);
    const b = makeProduct<F>(["x", "y"], [2, "hi"]);
    expect(hp.hash(a)).not.toBe(hp.hash(b));
  });

  it("returns a non-negative 32-bit integer", () => {
    const hp = hashProduct<F>([hashNumber, hashString]);
    const h = hp.hash(makeProduct<F>(["x", "y"], [42, "z"]));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deriveShowViaGeneric / deriveEqViaGeneric
// ---------------------------------------------------------------------------

describe("deriveShowViaGeneric / deriveEqViaGeneric", () => {
  type Pt = { fields: readonly [number, string]; _tag: "Product"; names: readonly ["x", "n"] };

  it("deriveShowViaGeneric renders typeName(field = value, ...)", () => {
    const inst: { to: (v: Pt) => Pt; from: (r: Pt) => Pt } = {
      to: (v) => v,
      from: (r) => r,
    };
    registerGeneric<Pt, Pt>("DerivePoint", inst);

    const show = deriveShowViaGeneric<Pt>(
      "DerivePoint",
      [{ show: (a: unknown) => String(a) }, { show: (a: unknown) => `"${String(a)}"` }],
      ["x", "n"]
    );

    const val: Pt = { _tag: "Product", names: ["x", "n"], fields: [1, "a"] };
    expect(show.show(val)).toBe('DerivePoint(x = 1, n = "a")');
  });

  it("deriveShowViaGeneric throws when no Generic instance is registered", () => {
    expect(() => deriveShowViaGeneric("NoSuchDeriveType_xxx", [], [])).toThrow(
      /No Generic instance for NoSuchDeriveType_xxx/
    );
  });

  it("deriveEqViaGeneric returns true for equal values", () => {
    const inst = { to: (v: Pt) => v, from: (r: Pt) => r };
    registerGeneric<Pt, Pt>("DeriveEqPoint", inst);

    const eq = deriveEqViaGeneric<Pt>("DeriveEqPoint", [
      { eq: (a: unknown, b: unknown) => a === b },
      { eq: (a: unknown, b: unknown) => a === b },
    ]);

    const a: Pt = { _tag: "Product", names: ["x", "n"], fields: [1, "a"] };
    const b: Pt = { _tag: "Product", names: ["x", "n"], fields: [1, "a"] };
    expect(eq.eq(a, b)).toBe(true);
  });

  it("deriveEqViaGeneric returns false when a field differs", () => {
    const inst = { to: (v: Pt) => v, from: (r: Pt) => r };
    registerGeneric<Pt, Pt>("DeriveEqPoint2", inst);

    const eq = deriveEqViaGeneric<Pt>("DeriveEqPoint2", [
      { eq: (a: unknown, b: unknown) => a === b },
      { eq: (a: unknown, b: unknown) => a === b },
    ]);

    const a: Pt = { _tag: "Product", names: ["x", "n"], fields: [1, "a"] };
    const b: Pt = { _tag: "Product", names: ["x", "n"], fields: [2, "a"] };
    expect(eq.eq(a, b)).toBe(false);
  });

  it("deriveEqViaGeneric throws when no Generic instance is registered", () => {
    expect(() => deriveEqViaGeneric("NoSuchEqType_xxx", [])).toThrow(
      /No Generic instance for NoSuchEqType_xxx/
    );
  });
});

// ---------------------------------------------------------------------------
// genericDerive attribute macro
// ---------------------------------------------------------------------------

describe("genericDerive attribute macro", () => {
  it("declares expected macro metadata", () => {
    expect(genericDerive.name).toBe("Generic");
    expect(genericDerive.module).toBe("typesugar");
    expect(genericDerive.kind).toBe("attribute");
    expect(genericDerive.validTargets).toContain("interface");
    expect(genericDerive.validTargets).toContain("class");
    expect(genericDerive.validTargets).toContain("type");
  });

  function makeProgramFromSource(source: string): {
    program: ts.Program;
    sourceFile: ts.SourceFile;
    cleanup: () => void;
  } {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "generic-test-"));
    const filePath = path.join(tmpDir, "test.ts");
    fs.writeFileSync(filePath, source);

    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    };

    const host = ts.createCompilerHost(options);
    const origGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
      const sf = origGetSourceFile(fileName, languageVersion, onError, shouldCreate);
      if (sf && fileName === filePath) {
        return ts.createSourceFile(fileName, sf.text, languageVersion, true);
      }
      return sf;
    };

    const program = ts.createProgram([filePath], options, host);
    const sourceFile = program.getSourceFile(filePath)!;
    return {
      program,
      sourceFile,
      cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
    };
  }

  function runOn(
    source: string,
    pickTarget: (sf: ts.SourceFile) => ts.Declaration
  ): { generated: string[]; nodes: ts.Node[] } {
    const { program, sourceFile, cleanup } = makeProgramFromSource(source);
    const nodes: ts.Node[] = [];
    const generated: string[] = [];

    try {
      const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
        const ctx = createMacroContext(program, sourceFile, transformContext);
        const target = pickTarget(sourceFile);
        const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("Generic"));
        const out = genericDerive.expand(ctx, decorator, target, []);
        const list = Array.isArray(out) ? out : [out];
        for (const n of list) nodes.push(n);
        const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
        for (const n of list) {
          generated.push(printer.printNode(ts.EmitHint.Unspecified, n, sourceFile));
        }
        return (sf) => sf;
      };

      ts.transform(sourceFile, [transformerFactory]);
      return { generated, nodes };
    } finally {
      cleanup();
    }
  }

  it("expands interface to: original target + registerGenericMeta + const + registerGeneric", () => {
    const { generated, nodes } = runOn(
      `interface Point { x: number; y: number; }`,
      (sf) => sf.statements.find(ts.isInterfaceDeclaration)!
    );

    // 4 statements: original interface, const decl, registerGenericMeta, registerGeneric
    expect(nodes).toHaveLength(4);
    expect(ts.isInterfaceDeclaration(nodes[0])).toBe(true);

    const joined = generated.join("\n");
    expect(joined).toContain("const genericPoint");
    expect(joined).toContain('registerGenericMeta("Point"');
    expect(joined).toContain('"product"');
    expect(joined).toContain('"x"');
    expect(joined).toContain('"y"');
    expect(joined).toContain('registerGeneric("Point"');
  });

  it("registers product meta at compile time during expansion", () => {
    runOn(
      `interface CompTimePoint { a: string; b: boolean; }`,
      (sf) => sf.statements.find(ts.isInterfaceDeclaration)!
    );
    const meta = getGenericMeta("CompTimePoint");
    expect(meta).toBeDefined();
    expect(meta!.kind).toBe("product");
    expect(meta!.fieldNames).toEqual(["a", "b"]);
  });

  it("expands a discriminated-union type alias as a sum type", () => {
    const source = `
interface Circle { kind: "circle"; radius: number; }
interface Square { kind: "square"; side: number; }
type Shape = Circle | Square;
`;
    const { generated } = runOn(source, (sf) => {
      const aliases = sf.statements.filter(ts.isTypeAliasDeclaration);
      return aliases.find((a) => a.name.text === "Shape")!;
    });

    const joined = generated.join("\n");
    expect(joined).toContain('registerGenericMeta("Shape"');
    expect(joined).toContain('"sum"');
    expect(joined).toContain('"kind"'); // discriminant
    expect(joined).toContain('"circle"');
    expect(joined).toContain('"square"');
    expect(joined).toContain("const genericShape");
    expect(joined).toContain('registerGeneric("Shape"');

    const meta = getGenericMeta("Shape");
    expect(meta).toBeDefined();
    expect(meta!.kind).toBe("sum");
    expect(meta!.discriminant).toBe("kind");
    expect(meta!.variants?.map((v) => v.tag).sort()).toEqual(["circle", "square"]);
  });

  it("expands a class declaration as a product", () => {
    const source = `class Pair { constructor(public left: number, public right: string) {} }`;
    const { generated } = runOn(source, (sf) => sf.statements.find(ts.isClassDeclaration)!);
    const joined = generated.join("\n");
    expect(joined).toContain('registerGenericMeta("Pair"');
    expect(joined).toContain('registerGeneric("Pair"');
    expect(joined).toContain("const genericPair");
  });

  it("emits an identity to/from arrow expression in the const declaration", () => {
    // Verifies the Wave-2 AST-construction path: arrow functions are built
    // via ts.factory.createArrowFunction, not parsed from a string.
    const { nodes } = runOn(
      `interface IdCheck { v: number; }`,
      (sf) => sf.statements.find(ts.isInterfaceDeclaration)!
    );
    const constStmt = nodes[1] as ts.VariableStatement;
    expect(ts.isVariableStatement(constStmt)).toBe(true);
    const decl = constStmt.declarationList.declarations[0];
    const obj = decl.initializer as ts.ObjectLiteralExpression;
    expect(ts.isObjectLiteralExpression(obj)).toBe(true);

    const props = obj.properties.filter(ts.isPropertyAssignment);
    const propNames = props.map((p) =>
      ts.isIdentifier(p.name) ? p.name.text : (p.name as ts.StringLiteral).text
    );
    expect(propNames).toContain("to");
    expect(propNames).toContain("from");

    for (const p of props) {
      expect(ts.isArrowFunction(p.initializer)).toBe(true);
    }
  });
});
