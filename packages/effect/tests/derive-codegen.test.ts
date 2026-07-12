/**
 * Derive-macro codegen tests for EffectHash / EffectEqual / EffectSchema.
 *
 * These exercise the `.expand()` output of each derive macro directly: we
 * hand-build a `DeriveTypeInfo` (product and sum variants), run the macro's
 * `expand`, print the resulting statements, and assert on the generated code.
 * This is the layer that PEP-057 migrated from string codegen to
 * `ts.factory.create*`, so the tests pin the emitted shape.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { createMacroContext } from "@typesugar/core";
import type { DeriveTypeInfo, DeriveFieldInfo, MacroContext } from "@typesugar/core";
import { EffectHashDerive } from "../src/derive/hash.js";
import { EffectEqualDerive } from "../src/derive/equal.js";
import { EffectSchemaDerive } from "../src/derive/schema.js";

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

/**
 * Build a real MacroContext (the production `createMacroContext`, not the test
 * helper) so `ctx.parseExpression` strips positions exactly as it does during a
 * real transform — otherwise string literals parsed for schema fields print
 * empty against a foreign source file.
 */
function makeContext(): MacroContext {
  const sourceFile = ts.createSourceFile(
    "test.ts",
    "",
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
  };
  const host = ts.createCompilerHost(options);
  const program = ts.createProgram(["test.ts"], options, {
    ...host,
    getSourceFile: (name) =>
      name === "test.ts" ? sourceFile : host.getSourceFile(name, ts.ScriptTarget.Latest),
  });
  const transformContext = {
    factory: ts.factory,
    getCompilerOptions: () => options,
    startLexicalEnvironment: () => {},
    suspendLexicalEnvironment: () => {},
    resumeLexicalEnvironment: () => {},
    endLexicalEnvironment: () => undefined,
    hoistFunctionDeclaration: () => {},
    hoistVariableDeclaration: () => {},
    requestEmitHelper: () => {},
    readEmitHelpers: () => undefined,
    enableSubstitution: () => {},
    enableEmitNotification: () => {},
    isSubstitutionEnabled: () => false,
    isEmitNotificationEnabled: () => false,
    onSubstituteNode: (_hint: ts.EmitHint, node: ts.Node) => node,
    onEmitNode: (_hint: ts.EmitHint, node: ts.Node, cb: (h: ts.EmitHint, n: ts.Node) => void) =>
      cb(_hint, node),
    addDiagnostic: () => {},
  } as unknown as ts.TransformationContext;
  return createMacroContext(program, sourceFile, transformContext);
}

/** A throwaway target node — the derive macros only read `typeInfo`, not `target`. */
const dummyTarget = ts.factory.createInterfaceDeclaration(
  undefined,
  ts.factory.createIdentifier("Dummy"),
  undefined,
  undefined,
  []
);

function field(name: string, typeString: string, optional = false): DeriveFieldInfo {
  return {
    name,
    typeString,
    // Codegen for these macros never touches the checker `type`; a stub is fine.
    type: {} as ts.Type,
    optional,
    readonly: false,
  };
}

function product(name: string, fields: DeriveFieldInfo[]): DeriveTypeInfo {
  return { name, fields, typeParameters: [], type: {} as ts.Type, kind: "product" };
}

function sum(
  name: string,
  discriminant: string,
  variants: Array<{ tag: string; typeName: string; fields: DeriveFieldInfo[] }>
): DeriveTypeInfo {
  return {
    name,
    fields: [],
    typeParameters: [],
    type: {} as ts.Type,
    kind: "sum",
    discriminant,
    variants,
  };
}

function expand(
  macro: { expand: (ctx: MacroContext, target: any, typeInfo: DeriveTypeInfo) => ts.Statement[] },
  typeInfo: DeriveTypeInfo
): string {
  const ctx = makeContext();
  const statements = macro.expand(ctx, dummyTarget, typeInfo);
  return statements
    .map((s) => printer.printNode(ts.EmitHint.Unspecified, s, ctx.sourceFile))
    .join("\n");
}

/** Strip whitespace so assertions are layout-insensitive. */
function norm(s: string): string {
  return s.replace(/\s+/g, "");
}

describe("EffectHash derive codegen", () => {
  it("product: nested Hash.combine chain over all fields", () => {
    const out = norm(
      expand(
        EffectHashDerive,
        product("User", [field("id", "string"), field("name", "string"), field("age", "number")])
      )
    );
    expect(out).toContain("exportconstUserHash:Hash.Hash<User>=");
    expect(out).toContain("[Hash.symbol](self:User):number");
    expect(out).toContain(
      "returnHash.combine(Hash.hash(self.id),Hash.combine(Hash.hash(self.name),Hash.hash(self.age)))"
    );
  });

  it("product: single field emits a bare Hash.hash (no combine)", () => {
    const out = norm(expand(EffectHashDerive, product("Id", [field("value", "string")])));
    expect(out).toContain("returnHash.hash(self.value)");
    expect(out).not.toContain("Hash.combine");
  });

  it("product: empty field set hashes to 0", () => {
    const out = norm(expand(EffectHashDerive, product("Empty", [])));
    expect(out).toContain("return0");
  });

  it("sum: switch on discriminant, tag-seeded per variant", () => {
    const out = norm(
      expand(
        EffectHashDerive,
        sum("Shape", "kind", [
          { tag: "circle", typeName: "Circle", fields: [field("radius", "number")] },
          { tag: "none", typeName: "None", fields: [] },
        ])
      )
    );
    expect(out).toContain("switch(self.kind)");
    expect(out).toContain(
      'case"circle":returnHash.combine(Hash.hash("circle"),Hash.hash(self.radius))'
    );
    expect(out).toContain('case"none":returnHash.hash("none")');
    expect(out).toContain("default:return0");
  });
});

describe("EffectEqual derive codegen", () => {
  it("product: && chain of Equal.equals per field", () => {
    const out = norm(
      expand(EffectEqualDerive, product("User", [field("id", "string"), field("name", "string")]))
    );
    expect(out).toContain("exportconstUserEqual:Equal.Equal<User>=");
    expect(out).toContain("[Equal.symbol](self:User,that:User):boolean");
    expect(out).toContain("returnEqual.equals(self.id,that.id)&&Equal.equals(self.name,that.name)");
  });

  it("product: empty field set is trivially equal", () => {
    const out = norm(expand(EffectEqualDerive, product("Empty", [])));
    expect(out).toContain("returntrue");
  });

  it("sum: discriminant guard then per-variant switch", () => {
    const out = norm(
      expand(
        EffectEqualDerive,
        sum("Shape", "kind", [
          { tag: "circle", typeName: "Circle", fields: [field("radius", "number")] },
          { tag: "none", typeName: "None", fields: [] },
        ])
      )
    );
    expect(out).toContain("if(self.kind!==that.kind)returnfalse");
    expect(out).toContain("switch(self.kind)");
    expect(out).toContain('case"circle":returnEqual.equals(self.radius,that.radius)');
    expect(out).toContain('case"none":returntrue');
    expect(out).toContain("default:returnfalse");
  });
});

describe("EffectSchema derive codegen", () => {
  it("product: Schema.Struct + Encoded alias, with primitive/literal/optional mapping", () => {
    const out = norm(
      expand(
        EffectSchemaDerive,
        product("User", [
          field("id", "string"),
          field("age", "number"),
          field("role", '"admin" | "user"'),
          field("active", "boolean", true),
        ])
      )
    );
    expect(out).toContain("exportconstUserSchema=Schema.Struct({");
    expect(out).toContain("id:Schema.String");
    expect(out).toContain("age:Schema.Number");
    expect(out).toContain('role:Schema.Literal("admin","user")');
    expect(out).toContain("active:Schema.optional(Schema.Boolean)");
    expect(out).toContain("exporttypeUserEncoded=Schema.Schema.Encoded<typeofUserSchema>");
  });

  it("product: nested container types (Array, Record)", () => {
    const out = norm(
      expand(
        EffectSchemaDerive,
        product("Bag", [field("tags", "string[]"), field("counts", "Record<string, number>")])
      )
    );
    expect(out).toContain("tags:Schema.Array(Schema.String)");
    expect(out).toContain("counts:Schema.Record({key:Schema.String,value:Schema.Number})");
  });

  it("sum: Schema.Union of tagged Schema.Structs", () => {
    const out = norm(
      expand(
        EffectSchemaDerive,
        sum("Shape", "kind", [
          { tag: "circle", typeName: "Circle", fields: [field("radius", "number")] },
          { tag: "square", typeName: "Square", fields: [field("side", "number")] },
        ])
      )
    );
    expect(out).toContain("exportconstShapeSchema=Schema.Union(");
    expect(out).toContain('Schema.Struct({kind:Schema.Literal("circle"),radius:Schema.Number})');
    expect(out).toContain('Schema.Struct({kind:Schema.Literal("square"),side:Schema.Number})');
    expect(out).toContain("exporttypeShapeEncoded=Schema.Schema.Encoded<typeofShapeSchema>");
  });
});
