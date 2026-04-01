/**
 * Red Team Tests for Type Safety
 *
 * PEP-005 Wave 6: Adversarial testing of typesugar's type safety guarantees.
 *
 * Attack surfaces:
 * - Silent wrong code generation (macros produce compiling but incorrect code)
 * - Typecheck bypass (code that should error but doesn't)
 * - Confusing/misleading error messages
 * - Edge case crashes (unusual but valid patterns)
 *
 * Each finding is triaged as: Fix, Diagnose, Accept, or Defer.
 * See sandbox/red-team/FINDINGS.md for the full triage table.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext, globalRegistry } from "@typesugar/core";
import {
  builtinDerivations,
  typeclassRegistry,
  instanceRegistry,
  clearRegistries,
  getTypeclasses,
  getInstances,
  findInstance,
  makePrimitiveChecker,
  getGenericDerivation,
  hasGenericDerivation,
} from "@typesugar/macros";
import type { GenericMeta } from "@typesugar/macros";
import { summon, extend, implicit, deriving, instance } from "@typesugar/macros";

// ============================================================================
// Helpers
// ============================================================================

function createCtxForSource(sourceText: string): MacroContextImpl {
  const sourceFile = ts.createSourceFile(
    "test.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    strict: true,
    noImplicitAny: true,
  };

  const host = ts.createCompilerHost(options);
  const program = ts.createProgram(["test.ts"], options, {
    ...host,
    getSourceFile: (name) =>
      name === "test.ts" ? sourceFile : host.getSourceFile(name, ts.ScriptTarget.Latest),
  });

  const transformContext: ts.TransformationContext = {
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
    onSubstituteNode: (_hint, node) => node,
    onEmitNode: (_hint, node, emitCallback) => emitCallback(_hint, node),
    addDiagnostic: () => {},
  };

  return createMacroContext(program, sourceFile, transformContext);
}

/**
 * Simulates the output of the Generic Eq derivation: `a.field === b.field` for all fields.
 * This is what `auto-derive.ts` Eq deriveProduct generates.
 */
function simulateDerivedEq<T extends Record<string, unknown>>(
  a: T,
  b: T,
  fieldNames: string[]
): boolean {
  return fieldNames.every((name) => (a as any)[name] === (b as any)[name]);
}

/**
 * Simulates the Generic Ord derivation: lexicographic `<` / `>` comparison.
 */
function simulateDerivedOrd<T extends Record<string, unknown>>(
  a: T,
  b: T,
  fieldNames: string[]
): number {
  for (const name of fieldNames) {
    const av = (a as any)[name];
    const bv = (b as any)[name];
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

/**
 * Simulates the Generic Hash derivation: djb2-style `(h << 5) + h ^ fieldHash`.
 */
function simulateDerivedHash(value: Record<string, unknown>, fieldNames: string[]): number {
  let h = 0;
  for (const name of fieldNames) {
    const v = value[name];
    let fieldHash: number;
    if (typeof v === "number") {
      fieldHash = v | 0;
    } else if (typeof v === "string") {
      fieldHash = 0;
      for (let i = 0; i < v.length; i++) {
        fieldHash = ((fieldHash << 5) + fieldHash) ^ v.charCodeAt(i);
      }
    } else if (typeof v === "boolean") {
      fieldHash = v ? 1 : 0;
    } else {
      fieldHash = 0;
    }
    h = ((h << 5) + h) ^ fieldHash;
  }
  return h >>> 0;
}

describe("Red Team: Type Safety", () => {
  // ==========================================================================
  // Round 1: Silent Wrong Code
  // ==========================================================================
  describe("Round 1: Silent Wrong Code", () => {
    // Finding TS-1: Derive Eq uses === which is unsound for any-typed object fields
    it("@derive(Eq) on type with any-typed field — === is reference equality for objects", () => {
      const a = { x: 1, data: { nested: true } as any };
      const b = { x: 1, data: { nested: true } as any };

      const result = simulateDerivedEq(a, b, ["x", "data"]);
      expect(result).toBe(false); // Different references → false
    });

    // Finding TS-2: isTypeReliable correctly flags `any`
    it("type confidence check flags any as unreliable", () => {
      const ctx = createCtxForSource("const x: any = 42;");
      const anyType = { flags: ts.TypeFlags.Any } as ts.Type;
      expect(ctx.isTypeReliable(anyType)).toBe(false);
    });

    // Finding TS-3: NaN breaks derived Eq
    it("@derive(Eq) on type with NaN field — NaN !== NaN", () => {
      const a = { value: NaN, label: "test" };
      const b = { value: NaN, label: "test" };

      const result = simulateDerivedEq(a, b, ["value", "label"]);
      expect(result).toBe(false); // Semantically equal objects compare unequal
    });

    // Finding TS-4: NaN breaks derived Ord
    it("@derive(Ord) on type with NaN field — NaN is not comparable", () => {
      const a = { score: NaN };
      const b = { score: 5 };

      const result = simulateDerivedOrd(a, b, ["score"]);
      expect(result).toBe(0); // NaN appears "equal" to 5
    });

    // Finding TS-5: Hash collisions for NaN/Infinity/0
    it("@derive(Hash) with NaN/Infinity/0 — all hash to same value", () => {
      const nanHash = simulateDerivedHash({ x: NaN }, ["x"]);
      const infHash = simulateDerivedHash({ x: Infinity }, ["x"]);
      const zeroHash = simulateDerivedHash({ x: 0 }, ["x"]);

      // (NaN | 0) === (Infinity | 0) === (0 | 0) === 0
      expect(nanHash).toBe(zeroHash);
      expect(infHash).toBe(zeroHash);
    });

    // Finding TS-6: Operator overload on union including any
    it("type confidence flags any in operator context", () => {
      const anyType = { flags: ts.TypeFlags.Any } as ts.Type;
      const ctx = createCtxForSource("const x: any = 42;");
      expect(ctx.isTypeReliable(anyType)).toBe(false);
    });

    // Finding TS-7: Extension method on intersection with any
    it("any & T collapses to any — type confidence catches it", () => {
      const ctx = createCtxForSource("const x: any & { name: string } = {} as any;");
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[0] as ts.VariableStatement).declarationList
        .declarations[0];
      const type = ctx.typeChecker.getTypeAtLocation(varDecl);

      if (type.flags & ts.TypeFlags.Any) {
        expect(ctx.isTypeReliable(type)).toBe(false);
      } else {
        expect(ctx.isTypeReliable(type)).toBe(true);
      }
    });

    // Finding TS-8: summon with unconstrained type parameter
    it("summon<Eq<T>>() runtime stub throws clear error", () => {
      expect(() => summon()).toThrow("must be processed by the typesugar transformer");
    });

    // Finding TS-9: Derive for type with error-typed field
    it("type with missing import — field resolves to error/any", () => {
      const ctx = createCtxForSource("interface Broken { x: number; y: MissingType; }");
      const sourceFile = ctx.sourceFile;
      const interfaceDecl = sourceFile.statements[0] as ts.InterfaceDeclaration;
      const yProp = interfaceDecl.members[1] as ts.PropertySignature;
      const yType = ctx.typeChecker.getTypeAtLocation(yProp);

      if (yType.flags & ts.TypeFlags.Any) {
        expect(ctx.isTypeReliable(yType)).toBe(false);
      }
      expect(ctx.typeChecker.typeToString(yType)).toBeDefined();
    });

    // Finding TS-10: Eq on nested objects uses reference equality
    it("@derive(Eq) for nested objects — === is reference equality", () => {
      const a = { x: 1, nested: { a: 1 } };
      const b = { x: 1, nested: { a: 1 } };

      const result = simulateDerivedEq(a, b, ["x", "nested"]);
      expect(result).toBe(false); // Different references
    });
  });

  // ==========================================================================
  // Round 2: Typecheck Bypass
  // ==========================================================================
  describe("Round 2: Typecheck Bypass", () => {
    // Finding TS-11: instance() with wrong signatures passes through
    it("@impl with wrong method signatures — runtime passes through unchanged", () => {
      const wrongImpl = { eq: (a: number) => true };
      const result = instance("Eq<number>", wrongImpl);
      expect(result).toBe(wrongImpl);
    });

    // Finding TS-12: Derive on class with private fields
    it("@derive(Eq) on class with private fields — only public fields compared", () => {
      class Secret {
        constructor(
          public name: string,
          private _token: string
        ) {}
      }

      const a = new Secret("alice", "secret1");
      const b = new Secret("alice", "secret2");

      const result = simulateDerivedEq(a, b, ["name"]);
      expect(result).toBe(true); // Private fields invisible
    });

    // Finding TS-13: implicit() runtime stub throws
    it("implicit() without transformer throws clear error", () => {
      expect(() => implicit()).toThrow("requires the typesugar transformer");
    });

    // Finding TS-14: summon() with no type args
    it("summon<>() runtime stub throws", () => {
      expect(() => summon()).toThrow("must be processed by the typesugar transformer");
    });

    // Finding TS-15: Registry allows duplicate typeclass entries
    it("registry allows overwriting typeclass entries without warning", () => {
      clearRegistries();

      const tc1 = { name: "TestTC", methods: [] };
      const tc2 = {
        name: "TestTC",
        methods: [{ name: "run", typeParams: [], params: [], returnType: "void" }],
      };

      typeclassRegistry.set("TestTC", tc1 as any);
      typeclassRegistry.set("TestTC", tc2 as any);

      expect(typeclassRegistry.get("TestTC")).toBe(tc2);
    });

    // Finding TS-16: Instance registry (array) accepts any entry without validation
    it("instance registry accepts entries without key format validation", () => {
      clearRegistries();

      // instanceRegistry is an array — push accepts any shape
      instanceRegistry.push({
        typeclassName: "X",
        forType: "Y",
        instanceName: "not_a_real_instance",
      } as any);
      expect(instanceRegistry.length).toBeGreaterThan(0);

      // Empty strings are also accepted
      instanceRegistry.push({
        typeclassName: "",
        forType: "",
        instanceName: "",
      } as any);
      expect(instanceRegistry.some((i) => i.typeclassName === "")).toBe(true);
    });

    // Finding TS-17: @deriving decorator is no-op at runtime
    it("@deriving decorator returns passthrough at runtime", () => {
      const decorator = deriving("Eq", "Ord", "Hash");
      expect(typeof decorator).toBe("function");

      class TestClass {}
      const result = decorator(TestClass);
      expect(result === TestClass || result === undefined).toBe(true);
    });

    // Finding TS-18: extend() without transformer
    it("extend() without transformer throws", () => {
      expect(() => extend(42)).toThrow("must be processed by the typesugar transformer");
    });
  });

  // ==========================================================================
  // Round 3: Confusing Errors
  // ==========================================================================
  describe("Round 3: Confusing Errors", () => {
    // Finding TS-19: Typo in typeclass name
    it("@derive(Eqq) with typo — getDerive returns undefined", () => {
      const result = globalRegistry.getDerive("Eqq");
      expect(result).toBeUndefined();
      // PEP-032: TC derive macros removed. @derive is handled by the transformer
      // directly via builtinDerivations, not through the macro registry.
      // Neither "Eq" nor "EqTC" should be in the derive registry.
      expect(globalRegistry.getDerive("Eq")).toBeUndefined();
      expect(globalRegistry.getDerive("EqTC")).toBeUndefined();
    });

    // Finding TS-20: summon() without transformer gives generic error
    it("summon<Eq<Point>>() without importing Eq — runtime error is generic", () => {
      expect(() => summon()).toThrow("must be processed by the typesugar transformer");
    });

    // Finding TS-21: Circular derivation types
    it("circular types — derivation fails gracefully (no infinite recursion)", () => {
      const ctx = createCtxForSource(`
        interface A { b: B; x: number; }
        interface B { a: A; y: string; }
      `);

      const eqDerivation = getGenericDerivation("Eq");
      expect(eqDerivation).toBeDefined();

      // "A" and "B" are not primitives, so hasFieldInstance returns false
      expect(eqDerivation!.hasFieldInstance("A")).toBe(false);
      expect(eqDerivation!.hasFieldInstance("B")).toBe(false);
    });

    // Finding TS-22: @derive(Eq) on empty interface
    it("@derive(Eq) on empty interface — vacuous equality (always true)", () => {
      const result = simulateDerivedEq({}, {}, []);
      expect(result).toBe(true);
    });

    // Finding TS-23: Deeply nested generics in summon
    it("deeply nested generics — Functor has code-gen derivation", () => {
      // Functor uses the builtin code-gen derivation system.
      // Deeply nested type args like Array<Option<number>> are valid TypeScript
      // but challenging for macro resolution — the macro must parse the full type string.
      expect(builtinDerivations["Functor"]).toBeDefined();
      expect(typeof builtinDerivations["Functor"].deriveProduct).toBe("function");
    });

    // Finding TS-24: Wrong casing in builtinDerivations
    it("builtinDerivations lookup is case-sensitive", () => {
      expect(builtinDerivations["NonExistent"]).toBeUndefined();
      expect(builtinDerivations["eQ"]).toBeUndefined();
      expect(builtinDerivations["EQ"]).toBeUndefined();
    });

    // Finding TS-25: assertTypeReliable on never gives clear diagnostic
    it("assertTypeReliable on never type includes purpose in message", () => {
      const ctx = createCtxForSource("const x: never = undefined as never;");
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[0] as ts.VariableStatement).declarationList
        .declarations[0];

      const type = ctx.assertTypeReliable(varDecl, "derive Eq");
      expect(type).toBeNull();

      const warnings = ctx.getDiagnostics().filter((d) => d.severity === "warning");
      expect(warnings.length).toBe(1);
      expect(warnings[0].message).toContain("derive Eq");
      expect(warnings[0].message).toContain("could not be resolved");
    });

    // Finding TS-26: getDerive for empty/whitespace names
    it("globalRegistry.getDerive for empty or whitespace names returns undefined", () => {
      expect(globalRegistry.getDerive("")).toBeUndefined();
      expect(globalRegistry.getDerive("  ")).toBeUndefined();
      expect(globalRegistry.getDerive("Serialize")).toBeUndefined();
    });
  });

  // ==========================================================================
  // Round 4: Edge Cases
  // ==========================================================================
  describe("Round 4: Edge Cases", () => {
    // Finding TS-27: Conditional types
    it("conditional type — TypeChecker resolves it correctly", () => {
      const ctx = createCtxForSource(`
        type IsString<T> = T extends string ? true : false;
        declare const x: IsString<"hello">;
      `);
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[1] as ts.VariableStatement).declarationList
        .declarations[0];
      const type = ctx.typeChecker.getTypeAtLocation(varDecl);
      const typeStr = ctx.typeChecker.typeToString(type);

      expect(typeStr).toBe("true");
      expect(ctx.isTypeReliable(type)).toBe(true);
    });

    // Finding TS-28: Mapped types
    it("mapped type — properties are inspectable", () => {
      const ctx = createCtxForSource(`
        type MyReadonly<T> = { readonly [K in keyof T]: T[K] };
        interface Point { x: number; y: number; }
        declare const p: MyReadonly<Point>;
      `);
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[2] as ts.VariableStatement).declarationList
        .declarations[0];
      const type = ctx.typeChecker.getTypeAtLocation(varDecl);

      const props = type.getProperties();
      expect(props.length).toBeGreaterThanOrEqual(2);
      const propNames = props.map((p) => p.name).sort();
      expect(propNames).toContain("x");
      expect(propNames).toContain("y");
    });

    // Finding TS-29: Template literal types
    it("template literal type field — reliable and inspectable", () => {
      const ctx = createCtxForSource(`
        interface Config {
          endpoint: \`https://\${string}\`;
          version: number;
        }
      `);
      const sourceFile = ctx.sourceFile;
      const interfaceDecl = sourceFile.statements[0] as ts.InterfaceDeclaration;
      const endpointProp = interfaceDecl.members[0] as ts.PropertySignature;
      const type = ctx.typeChecker.getTypeAtLocation(endpointProp);

      expect(ctx.isTypeReliable(type)).toBe(true);
    });

    // Finding TS-30: Intersection types with overlapping fields
    it("intersection type — all fields accessible", () => {
      const ctx = createCtxForSource(`
        type A = { x: number; shared: string };
        type B = { y: number; shared: string };
        declare const ab: A & B;
      `);
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[2] as ts.VariableStatement).declarationList
        .declarations[0];
      const type = ctx.typeChecker.getTypeAtLocation(varDecl);

      const propNames = type
        .getProperties()
        .map((p) => p.name)
        .sort();
      expect(propNames).toContain("x");
      expect(propNames).toContain("y");
      expect(propNames).toContain("shared");
      expect(ctx.isTypeReliable(type)).toBe(true);
    });

    // Finding TS-31: Re-exported type
    it("type from local declaration — TypeChecker inspects it", () => {
      const ctx = createCtxForSource(`
        interface ImportedPoint { x: number; y: number; }
        declare const p: ImportedPoint;
      `);
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[1] as ts.VariableStatement).declarationList
        .declarations[0];
      const type = ctx.typeChecker.getTypeAtLocation(varDecl);

      expect(type.getProperties().length).toBe(2);
      expect(ctx.isTypeReliable(type)).toBe(true);
    });

    // Finding TS-32: Built-in types from .d.ts
    it("built-in types (Array, Map) from .d.ts — reliable", () => {
      const ctx = createCtxForSource("declare const arr: Array<number>;");
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[0] as ts.VariableStatement).declarationList
        .declarations[0];
      const type = ctx.typeChecker.getTypeAtLocation(varDecl);

      expect(ctx.isTypeReliable(type)).toBe(true);
    });

    // Finding TS-33: Recursive types
    it("recursive type — TypeChecker handles without crash", () => {
      const ctx = createCtxForSource(`
        interface TreeNode {
          value: number;
          children: TreeNode[];
        }
        declare const tree: TreeNode;
      `);
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[1] as ts.VariableStatement).declarationList
        .declarations[0];
      const type = ctx.typeChecker.getTypeAtLocation(varDecl);

      const propNames = type.getProperties().map((p) => p.name);
      expect(propNames).toContain("value");
      expect(propNames).toContain("children");
      expect(ctx.isTypeReliable(type)).toBe(true);
    });

    // Finding TS-34: Index signature types
    it("index signature type — named properties still accessible", () => {
      const ctx = createCtxForSource(`
        interface StringMap {
          [key: string]: number;
          length: number;
        }
        declare const m: StringMap;
      `);
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[1] as ts.VariableStatement).declarationList
        .declarations[0];
      const type = ctx.typeChecker.getTypeAtLocation(varDecl);

      expect(ctx.isTypeReliable(type)).toBe(true);
      const propNames = type.getProperties().map((p) => p.name);
      expect(propNames).toContain("length");
    });

    // Finding TS-35: Enum types
    it("enum type — type is reliable", () => {
      const ctx = createCtxForSource(`
        enum Color { Red, Green, Blue }
        declare const c: Color;
      `);
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[1] as ts.VariableStatement).declarationList
        .declarations[0];
      const type = ctx.typeChecker.getTypeAtLocation(varDecl);

      expect(ctx.isTypeReliable(type)).toBe(true);
    });
  });

  // ==========================================================================
  // Round 5: Generic Derivation Strategy Edge Cases
  // ==========================================================================
  describe("Round 5: Generic Derivation Strategy Edge Cases", () => {
    // Finding TS-36: makePrimitiveChecker strips null/undefined
    it("makePrimitiveChecker strips null/undefined from union types", () => {
      const checker = makePrimitiveChecker(new Set(["number", "string"]));

      expect(checker("number")).toBe(true);
      expect(checker("number | null")).toBe(true);
      expect(checker("null | number")).toBe(true);
      expect(checker("number | undefined")).toBe(true);
      expect(checker("string | null | undefined")).toBe(true);
    });

    // Finding TS-37: makePrimitiveChecker handles arrays
    it("makePrimitiveChecker handles array types recursively", () => {
      const checker = makePrimitiveChecker(new Set(["number", "string"]));

      expect(checker("number[]")).toBe(true);
      expect(checker("string[]")).toBe(true);
      expect(checker("Array<number>")).toBe(true);
      expect(checker("boolean[]")).toBe(false);
    });

    // Finding TS-38: makePrimitiveChecker rejects complex types
    it("makePrimitiveChecker rejects complex non-primitive types", () => {
      const checker = makePrimitiveChecker(new Set(["number", "string"]));

      expect(checker("{ x: number }")).toBe(false);
      expect(checker("Record<string, number>")).toBe(false);
      expect(checker("any")).toBe(false);
      expect(checker("unknown")).toBe(false);
      expect(checker("never")).toBe(false);
    });

    // Finding TS-39: Generic Eq derivation with empty fields
    it("Generic Eq deriveProduct with empty fields generates vacuous equality", () => {
      const eqDerivation = getGenericDerivation("Eq");
      expect(eqDerivation).toBeDefined();

      const meta: GenericMeta = {
        kind: "product",
        fieldNames: [],
        fieldTypes: [],
      };

      const ctx = createCtxForSource("interface Empty {}");
      const result = eqDerivation!.deriveProduct(ctx as any, "Empty", meta);

      if (result) {
        expect(result).toContain("true");
      }
    });

    // Finding TS-40: Show derivation produces valid code
    it("Generic Show deriveProduct generates valid expression", () => {
      const showDerivation = getGenericDerivation("Show");
      expect(showDerivation).toBeDefined();

      const meta: GenericMeta = {
        kind: "product",
        fieldNames: ["x"],
        fieldTypes: ["number"],
      };

      const ctx = createCtxForSource("interface TestType { x: number; }");
      const result = showDerivation!.deriveProduct(ctx as any, "TestType", meta);
      expect(result).toBeDefined();
      expect(result).toContain("TestType");
    });

    // Finding TS-41: Ord derivation generates comparison chain
    it("Generic Ord deriveProduct generates lexicographic comparison", () => {
      const ordDerivation = getGenericDerivation("Ord");
      expect(ordDerivation).toBeDefined();

      const meta: GenericMeta = {
        kind: "product",
        fieldNames: ["x", "y", "z"],
        fieldTypes: ["number", "number", "number"],
      };

      const ctx = createCtxForSource("interface Vec3 { x: number; y: number; z: number; }");
      const result = ordDerivation!.deriveProduct(ctx as any, "Vec3", meta);

      expect(result).toBeDefined();
      expect(result).toContain("a.x");
      expect(result).toContain("b.x");
    });

    // Finding TS-42: Hash derivation uses unsigned shift
    it("Generic Hash deriveProduct uses >>> 0 for unsigned", () => {
      const hashDerivation = getGenericDerivation("Hash");
      expect(hashDerivation).toBeDefined();

      const meta: GenericMeta = {
        kind: "product",
        fieldNames: ["name"],
        fieldTypes: ["string"],
      };

      const ctx = createCtxForSource("interface Named { name: string; }");
      const result = hashDerivation!.deriveProduct(ctx as any, "Named", meta);

      expect(result).toBeDefined();
      expect(result).toContain(">>> 0");
    });

    // Finding TS-43: Clone derivation uses structuredClone
    it("Generic Clone deriveProduct uses structuredClone", () => {
      const cloneDerivation = getGenericDerivation("Clone");
      expect(cloneDerivation).toBeDefined();

      const meta: GenericMeta = {
        kind: "product",
        fieldNames: ["data", "count"],
        fieldTypes: ["object", "number"],
      };

      const ctx = createCtxForSource("interface State { data: object; count: number; }");
      const result = cloneDerivation!.deriveProduct(ctx as any, "State", meta);

      expect(result).toBeDefined();
      expect(result).toContain("structuredClone");
    });
  });

  // ==========================================================================
  // Round 6: Type Confidence Integration
  // ==========================================================================
  describe("Round 6: Type Confidence Integration", () => {
    // Finding TS-44: isTypeReliable detects unreliable types
    it("isTypeReliable returns false for any and never", () => {
      const ctx = createCtxForSource("const x = 1;");

      expect(ctx.isTypeReliable({ flags: ts.TypeFlags.Any } as ts.Type)).toBe(false);
      expect(ctx.isTypeReliable({ flags: ts.TypeFlags.Never } as ts.Type)).toBe(false);
    });

    // Finding TS-45: isTypeReliable returns true for standard types
    it("isTypeReliable returns true for Number, String, Boolean, Object, Unknown", () => {
      const ctx = createCtxForSource("const x = 1;");

      expect(ctx.isTypeReliable({ flags: ts.TypeFlags.Number } as ts.Type)).toBe(true);
      expect(ctx.isTypeReliable({ flags: ts.TypeFlags.String } as ts.Type)).toBe(true);
      expect(ctx.isTypeReliable({ flags: ts.TypeFlags.Boolean } as ts.Type)).toBe(true);
      expect(ctx.isTypeReliable({ flags: ts.TypeFlags.Object } as ts.Type)).toBe(true);
      expect(ctx.isTypeReliable({ flags: ts.TypeFlags.Unknown } as ts.Type)).toBe(true);
    });

    // Finding TS-46: assertTypeReliable includes operation name
    it("assertTypeReliable diagnostic includes the operation name", () => {
      const ctx = createCtxForSource("const x: any = 42;");
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[0] as ts.VariableStatement).declarationList
        .declarations[0];

      ctx.assertTypeReliable(varDecl, "operator ===");

      const warnings = ctx.getDiagnostics().filter((d) => d.severity === "warning");
      expect(warnings.length).toBe(1);
      expect(warnings[0].message).toContain("operator ===");
    });

    // Finding TS-47: Multiple unreliable type warnings accumulate
    it("multiple assertTypeReliable calls accumulate diagnostics", () => {
      const ctx = createCtxForSource("const x: any = 1; const y: any = 2;");
      const sourceFile = ctx.sourceFile;

      const varDecl1 = (sourceFile.statements[0] as ts.VariableStatement).declarationList
        .declarations[0];
      const varDecl2 = (sourceFile.statements[1] as ts.VariableStatement).declarationList
        .declarations[0];

      ctx.assertTypeReliable(varDecl1, "first op");
      ctx.assertTypeReliable(varDecl2, "second op");

      const warnings = ctx.getDiagnostics().filter((d) => d.severity === "warning");
      expect(warnings.length).toBe(2);
      expect(warnings[0].message).toContain("first op");
      expect(warnings[1].message).toContain("second op");
    });
  });

  // ==========================================================================
  // Round 7: Degenerate GenericMeta
  // ==========================================================================
  describe("Round 7: Degenerate GenericMeta", () => {
    // Finding TS-48: null fieldNames
    it("Eq deriveProduct with undefined fieldNames returns null", () => {
      const eqDerivation = getGenericDerivation("Eq");
      const meta: GenericMeta = {
        kind: "product",
        fieldNames: undefined as any,
        fieldTypes: undefined as any,
      };

      const ctx = createCtxForSource("interface X {}");
      const result = eqDerivation!.deriveProduct(ctx as any, "X", meta);
      expect(result).toBeNull();
    });

    // Finding TS-49: Mismatched fieldNames/fieldTypes lengths — FIXED
    // Previously crashed with "Cannot read properties of undefined (reading 'replace')"
    // Fixed: primitiveShowExpr now handles undefined fieldType gracefully
    it("Show deriveProduct with mismatched array lengths returns null (no crash)", () => {
      const showDerivation = getGenericDerivation("Show");
      const meta: GenericMeta = {
        kind: "product",
        fieldNames: ["a", "b", "c"],
        fieldTypes: ["number"],
      };

      const ctx = createCtxForSource("interface X { a: number; b: number; c: number; }");
      const result = showDerivation!.deriveProduct(ctx as any, "X", meta);

      // fieldTypes[1] and fieldTypes[2] are undefined → primitiveShowExpr returns null
      // → parts contains null → deriveProduct returns null
      expect(result).toBeNull();
    });

    // Finding TS-50: Sum type derivation without discriminant
    it("Show deriveSum without discriminant returns null", () => {
      const showDerivation = getGenericDerivation("Show");
      const meta: GenericMeta = {
        kind: "sum",
        discriminant: undefined as any,
        variants: [{ tag: "A", typeName: "A" }],
      };

      const ctx = createCtxForSource("type X = { kind: 'A' }");
      const result = showDerivation!.deriveSum?.(ctx as any, "X", meta);
      expect(result).toBeNull();
    });

    // Finding TS-51: Generic derivation registry has all expected strategies
    it("Generic derivation registry has Eq, Ord, Show, Hash, Clone", () => {
      expect(hasGenericDerivation("Eq")).toBe(true);
      expect(hasGenericDerivation("Ord")).toBe(true);
      expect(hasGenericDerivation("Show")).toBe(true);
      expect(hasGenericDerivation("Hash")).toBe(true);
      expect(hasGenericDerivation("Clone")).toBe(true);
    });
  });
});
