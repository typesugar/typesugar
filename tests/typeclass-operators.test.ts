/**
 * Tests for typeclass-based operator overloading via @op JSDoc annotations.
 *
 * Tests:
 * 1. getOperatorString — SyntaxKind to string mapping
 * 2. Syntax registry population
 * 3. Operator → method resolution
 * 4. TypeclassMethod.operatorSymbol field
 * 5. TypeclassInfo.syntax field
 * 6. Several @op tags on one method (equivalent spellings: `===` and `==`)
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import {
  type TypeclassInfo,
  type TypeclassMethod,
  getOperatorString,
  extractOpFromJSDoc,
  extractOpsFromJSDoc,
  getOpMapForTypeclass,
  getOperatorCandidates,
} from "@typesugar/macros";

// ============================================================================
// getOperatorString — SyntaxKind to string
// ============================================================================

describe("getOperatorString", () => {
  it("should map PlusToken to '+'", () => {
    expect(getOperatorString(ts.SyntaxKind.PlusToken)).toBe("+");
  });

  it("should map AsteriskAsteriskToken to '**'", () => {
    expect(getOperatorString(ts.SyntaxKind.AsteriskAsteriskToken)).toBe("**");
  });

  it("should map EqualsEqualsEqualsToken to '==='", () => {
    expect(getOperatorString(ts.SyntaxKind.EqualsEqualsEqualsToken)).toBe("===");
  });

  it("should return undefined for non-overloadable tokens", () => {
    expect(getOperatorString(ts.SyntaxKind.EqualsToken)).toBeUndefined();
    expect(getOperatorString(ts.SyntaxKind.PlusEqualsToken)).toBeUndefined();
  });

  it("should cover all overloadable operator symbols", () => {
    const expectedOperators = [
      "+",
      "-",
      "*",
      "/",
      "%",
      "**",
      "<",
      "<=",
      ">",
      ">=",
      "==",
      "===",
      "!=",
      "!==",
      "&",
      "|",
      "^",
      "<<",
      ">>",
    ];

    const syntaxKinds: ts.SyntaxKind[] = [
      ts.SyntaxKind.PlusToken,
      ts.SyntaxKind.MinusToken,
      ts.SyntaxKind.AsteriskToken,
      ts.SyntaxKind.SlashToken,
      ts.SyntaxKind.PercentToken,
      ts.SyntaxKind.AsteriskAsteriskToken,
      ts.SyntaxKind.LessThanToken,
      ts.SyntaxKind.LessThanEqualsToken,
      ts.SyntaxKind.GreaterThanToken,
      ts.SyntaxKind.GreaterThanEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.AmpersandToken,
      ts.SyntaxKind.BarToken,
      ts.SyntaxKind.CaretToken,
      ts.SyntaxKind.LessThanLessThanToken,
      ts.SyntaxKind.GreaterThanGreaterThanToken,
    ];

    const mapped = syntaxKinds.map(getOperatorString).filter((s): s is string => s !== undefined);

    expect(mapped).toHaveLength(expectedOperators.length);
    for (const sym of expectedOperators) {
      expect(mapped).toContain(sym);
    }
  });
});

// Operator→typeclass syntax resolution is now scope-based via the op-index
// (getOperatorCandidates / getOpMapForTypeclass), not the global typeclassRegistry;
// the old getSyntaxForOperator mechanism was deleted (PEP-052). The op-index path is
// covered by the operator-rewrite integration tests.

// ============================================================================
// TypeclassMethod.operatorSymbol field
// ============================================================================

describe("TypeclassMethod.operatorSymbol", () => {
  it("should be optional and default to undefined", () => {
    const method: TypeclassMethod = {
      name: "show",
      params: [{ name: "a", typeString: "A" }],
      returnType: "string",
      isSelfMethod: true,
    };
    expect(method.operatorSymbol).toBeUndefined();
  });

  it("should store an operator symbol when set", () => {
    const method: TypeclassMethod = {
      name: "concat",
      params: [
        { name: "a", typeString: "A" },
        { name: "b", typeString: "A" },
      ],
      returnType: "A",
      isSelfMethod: true,
      operatorSymbol: "+",
    };
    expect(method.operatorSymbol).toBe("+");
  });
});

// ============================================================================
// TypeclassInfo.syntax field
// ============================================================================

describe("TypeclassInfo.syntax", () => {
  it("should be optional", () => {
    const tc: TypeclassInfo = {
      name: "Show",
      typeParam: "A",
      methods: [],
      canDeriveProduct: true,
      canDeriveSum: true,
    };
    expect(tc.syntax).toBeUndefined();
  });

  it("should store operator->method mappings", () => {
    const syntax = new Map<string, string>([
      ["+", "concat"],
      ["===", "eq"],
    ]);

    const tc: TypeclassInfo = {
      name: "Semigroup",
      typeParam: "A",
      methods: [
        {
          name: "concat",
          params: [
            { name: "a", typeString: "A" },
            { name: "b", typeString: "A" },
          ],
          returnType: "A",
          isSelfMethod: true,
          operatorSymbol: "+",
        },
      ],
      canDeriveProduct: true,
      canDeriveSum: true,
      syntax,
    };

    expect(tc.syntax!.get("+")).toBe("concat");
    expect(tc.syntax!.get("===")).toBe("eq");
  });
});

// extractOpFromReturnType — Op<> was removed; operator dispatch now uses @op JSDoc only.
// Tests for Op<> parsing have been removed.
// The syntax registry and @op JSDoc extraction are tested elsewhere.

// ============================================================================
// Several @op tags on one method
// ============================================================================

describe("multiple @op tags per method", () => {
  const SOURCE = [
    `/** @typeclass */`,
    `export interface Same<A> {`,
    `  /**`,
    `   * @op ===`,
    `   * @op ==`,
    `   */`,
    `  same(a: A, b: A): boolean;`,
    `  /**`,
    `   * Not the same.`,
    `   * @op !==`,
    `   * @op !=`,
    `   * @op !==`,
    `   */`,
    `  differ(a: A, b: A): boolean;`,
    `  /** @op - */`,
    `  flip(a: A): A;`,
    `  untagged(a: A): A;`,
    `}`,
  ].join("\n");

  function program(): { program: ts.Program; members: Map<string, ts.TypeElement> } {
    const fileName = "/virtual/same.ts";
    const sf = ts.createSourceFile(fileName, SOURCE, ts.ScriptTarget.ES2020, true);
    const host = ts.createCompilerHost({});
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, ...rest) => (name === fileName ? sf : getSourceFile(name, ...rest));
    host.fileExists = (name) => name === fileName || ts.sys.fileExists(name);
    const prog = ts.createProgram([fileName], { noEmit: true, noLib: true }, host);
    const iface = sf.statements.find(ts.isInterfaceDeclaration)!;
    const members = new Map(iface.members.map((m) => [(m.name as ts.Identifier).text, m]));
    return { program: prog, members };
  }

  it("extractOpsFromJSDoc returns every tag in source order, deduplicated", () => {
    const { members } = program();
    expect(extractOpsFromJSDoc(members.get("same")!)).toEqual(["===", "=="]);
    expect(extractOpsFromJSDoc(members.get("differ")!)).toEqual(["!==", "!="]);
    expect(extractOpsFromJSDoc(members.get("flip")!)).toEqual(["-"]);
    expect(extractOpsFromJSDoc(members.get("untagged")!)).toEqual([]);
    // The single-op helper keeps returning the first tag.
    expect(extractOpFromJSDoc(members.get("same")!)).toBe("===");
    expect(extractOpFromJSDoc(members.get("untagged")!)).toBeUndefined();
  });

  it("the typeclass index maps every tag to its method", () => {
    const { program: prog } = program();
    const info = getOpMapForTypeclass(prog, "Same")!;
    expect(Object.fromEntries(info.opToMethod)).toEqual({
      "===": "same",
      "==": "same",
      "!==": "differ",
      "!=": "differ",
    });
    expect(Object.fromEntries(info.unaryOpToMethod ?? [])).toEqual({ "-": "flip" });
    expect(info.def!.syntax!.get("==")).toBe("same");
    expect(info.def!.syntax!.get("!=")).toBe("differ");
    const same = info.def!.methods.find((m) => m.name === "same")!;
    expect(same.operatorSymbol).toBe("===");
    expect(same.operatorSymbols).toEqual(["===", "=="]);
  });

  it("operator candidates resolve both spellings to the same method", () => {
    const { program: prog } = program();
    const active = new Set(["Same"]);
    expect(getOperatorCandidates(prog, active, "==").map((c) => c.method)).toEqual(["same"]);
    expect(getOperatorCandidates(prog, active, "===").map((c) => c.method)).toEqual(["same"]);
    expect(getOperatorCandidates(prog, active, "!=").map((c) => c.method)).toEqual(["differ"]);
  });

  it("the built-in Eq seed maps == and != too", () => {
    // A program with no Eq declaration falls back to the built-in seed.
    const { program: prog } = program();
    const eq = getOpMapForTypeclass(prog, "Eq")!;
    expect(eq.opToMethod.get("==")).toBe("equals");
    expect(eq.opToMethod.get("===")).toBe("equals");
    expect(eq.opToMethod.get("!=")).toBe("notEquals");
    expect(eq.opToMethod.get("!==")).toBe("notEquals");
  });
});
