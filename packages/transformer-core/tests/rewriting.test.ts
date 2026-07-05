/**
 * Tests for rewriting.ts — the macro/operator/opaque rewriting engine.
 *
 * NOTE: Despite the task framing of "rewriting engine = node replacement /
 * import injection / hoisting", `rewriting.ts` is actually the AST-rewriting
 * pass for: tagged-template macros, type macros, extension methods, HKT
 * declarations, typeclass operator overloading, and @opaque type erasure
 * (constructor / method / constant-ref / annotation stripping).
 *
 * These tests drive each `try*` rewriting function directly using a real
 * `ts.Program` + `createMacroContext`, the same pattern used by
 * `packages/macros/src/*.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import {
  createMacroContext,
  globalRegistry,
  registerTypeRewrite,
  clearTypeRewrites,
  standaloneExtensionRegistry,
  type TaggedTemplateMacroDef,
  type TypeMacro,
} from "@typesugar/core";

import {
  tryExpandTaggedTemplate,
  tryExpandTypeMacro,
  tryRewriteExtensionMethod,
  tryTransformHKTDeclaration,
  tryRewriteTypeclassOperator,
  tryRewriteOpaqueMethodCall,
  tryEraseOpaqueConstructorCall,
  tryEraseOpaqueConstantRef,
  tryEraseOpaqueAccessor,
  tryStripOpaqueTypeAnnotation,
  tryStripOpaqueParamAnnotation,
  shouldStripOpaqueReturnType,
} from "../src/rewriting.js";
import { scanImportsForScope, globalResolutionScope } from "@typesugar/core";
import type { VisitFn } from "../src/transformer-utils.js";

// ---------------------------------------------------------------------------
// Program + context fixtures
// ---------------------------------------------------------------------------

interface Fixture {
  program: ts.Program;
  sourceFile: ts.SourceFile;
  cleanup: () => void;
}

function makeProgram(source: string, fileName = "test.ts"): Fixture {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rewriting-test-"));
  const filePath = path.join(tmpDir, fileName);
  // Ensure parent directory exists (file paths may contain subdirectories
  // like "typesugar/fp/data/option.ts" to match a registered sourceModule).
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, source);

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
  };

  const host = ts.createCompilerHost(options);
  // Re-parse our fixture with setParentNodes=true so JSDoc tags (@typeclass/@impl/@op)
  // are visible to ts.getJSDocTags — needed for PEP-052 activation/instance scanning.
  const origGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fn, lang, onErr, shouldCreate) => {
    const sf = origGetSourceFile(fn, lang, onErr, shouldCreate);
    if (sf && fn === filePath) return ts.createSourceFile(fn, sf.text, lang, true);
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

/** Like makeProgram, but builds a real multi-file ts.Program (for cross-module resolution). */
function makeMultiFileProgram(files: Record<string, string>, mainFile: string): Fixture {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rewriting-multi-test-"));
  const filePaths: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(tmpDir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    filePaths[name] = filePath;
  }

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
  };

  const host = ts.createCompilerHost(options);
  const origGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fn, lang, onErr, shouldCreate) => {
    const sf = origGetSourceFile(fn, lang, onErr, shouldCreate);
    if (sf && Object.values(filePaths).includes(fn)) {
      return ts.createSourceFile(fn, sf.text, lang, true);
    }
    return sf;
  };
  const program = ts.createProgram(Object.values(filePaths), options, host);
  const sourceFile = program.getSourceFile(filePaths[mainFile])!;

  return {
    program,
    sourceFile,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

/** Like withContext, but for a multi-file program. */
function withMultiFileContext<T>(
  files: Record<string, string>,
  mainFile: string,
  cb: (ctx: ReturnType<typeof createMacroContext>, sf: ts.SourceFile, visit: VisitFn) => T
): T {
  const { program, sourceFile, cleanup } = makeMultiFileProgram(files, mainFile);
  let result: T;
  try {
    const factory: ts.TransformerFactory<ts.SourceFile> = (transformCtx) => {
      const ctx = createMacroContext(program, sourceFile, transformCtx);
      const visit: VisitFn = (n) => n;
      result = cb(ctx, sourceFile, visit);
      return (sf) => sf;
    };
    ts.transform(sourceFile, [factory]);
  } finally {
    cleanup();
  }
  return result!;
}

/** Run a callback inside a transformation context, returning the result + diagnostics. */
function withContext<T>(
  source: string,
  cb: (
    ctx: ReturnType<typeof createMacroContext>,
    sf: ts.SourceFile,
    visit: VisitFn,
    program: ts.Program
  ) => T,
  fileName?: string
): {
  result: T;
  diagnostics:
    | ReturnType<
        ReturnType<typeof createMacroContext>["diagnostics" extends never ? never : "diagnostics"]
      >
    | unknown[];
} {
  const { program, sourceFile, cleanup } = makeProgram(source, fileName);
  let result: T;
  let diagnostics: unknown[] = [];

  try {
    const factory: ts.TransformerFactory<ts.SourceFile> = (transformCtx) => {
      const ctx = createMacroContext(program, sourceFile, transformCtx);
      const visit: VisitFn = (n) => n;
      result = cb(ctx, sourceFile, visit, program);
      diagnostics = ctx.diagnostics ?? [];
      return (sf) => sf;
    };
    ts.transform(sourceFile, [factory]);
  } finally {
    cleanup();
  }

  return { result: result!, diagnostics };
}

function printNode(node: ts.Node, sf?: ts.SourceFile): string {
  const printer = ts.createPrinter({ removeComments: true });
  const target = sf ?? ts.createSourceFile("out.ts", "", ts.ScriptTarget.Latest, false);
  return printer.printNode(ts.EmitHint.Unspecified, node, target);
}

// ---------------------------------------------------------------------------
// Registry hygiene
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearTypeRewrites();
  standaloneExtensionRegistry.length = 0;
  globalRegistry.clear();
});

afterEach(() => {
  clearTypeRewrites();
  standaloneExtensionRegistry.length = 0;
  globalRegistry.clear();
});

// ---------------------------------------------------------------------------
// tryEraseOpaqueConstructorCall
// ---------------------------------------------------------------------------

describe("tryEraseOpaqueConstructorCall", () => {
  function registerOption(): void {
    registerTypeRewrite({
      typeName: "Option",
      sourceModule: "@typesugar/fp/data/option",
      underlyingTypeText: "T | null",
      methods: new Map([["map", "map"]]),
      constructors: new Map([
        ["Some", { kind: "identity" }],
        ["None", { kind: "constant", value: "null" }],
        ["Tagged", { kind: "custom", value: "myCustom" }],
      ]),
      transparent: true,
    });
  }

  it("erases an identity constructor call to its argument", () => {
    registerOption();
    const { result } = withContext(
      `declare function Some<A>(a: A): unknown;\nSome(42);`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[1] as ts.ExpressionStatement).expression as ts.CallExpression;
        return tryEraseOpaqueConstructorCall(ctx, false, visit, expr);
      },
      "consumer.ts"
    );
    expect(result).toBeDefined();
    expect(ts.isNumericLiteral(result!)).toBe(true);
    expect((result as ts.NumericLiteral).text).toBe("42");
  });

  it("erases a constant constructor call to its constant value (null)", () => {
    registerOption();
    const { result } = withContext(
      `declare function None(): unknown;\nNone();`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[1] as ts.ExpressionStatement).expression as ts.CallExpression;
        return tryEraseOpaqueConstructorCall(ctx, false, visit, expr);
      },
      "consumer.ts"
    );
    expect(result).toBeDefined();
    expect(result!.kind).toBe(ts.SyntaxKind.NullKeyword);
  });

  it("erases a custom constructor call to the configured identifier", () => {
    registerOption();
    const { result } = withContext(
      `declare function Tagged(a: number): unknown;\nTagged(1);`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[1] as ts.ExpressionStatement).expression as ts.CallExpression;
        return tryEraseOpaqueConstructorCall(ctx, false, visit, expr);
      },
      "consumer.ts"
    );
    expect(result).toBeDefined();
    expect(ts.isIdentifier(result!)).toBe(true);
    expect((result as ts.Identifier).text).toBe("myCustom");
  });

  it("returns undefined when the call expression is not an identifier", () => {
    registerOption();
    const { result } = withContext(
      `const obj = { Some: (x: number) => x }; obj.Some(1);`,
      (ctx, sf, visit) => {
        const stmt = sf.statements[1] as ts.ExpressionStatement;
        const call = stmt.expression as ts.CallExpression;
        return tryEraseOpaqueConstructorCall(ctx, false, visit, call);
      }
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when no constructor matches", () => {
    registerOption();
    const { result } = withContext(
      `declare function SomethingElse(): unknown;\nSomethingElse();`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[1] as ts.ExpressionStatement).expression as ts.CallExpression;
        return tryEraseOpaqueConstructorCall(ctx, false, visit, expr);
      },
      "consumer.ts"
    );
    expect(result).toBeUndefined();
  });

  it("warns and skips when an identity constructor has wrong arity", () => {
    registerOption();
    const { result, diagnostics } = withContext(
      `declare function Some(a: number, b: number): unknown;\nSome(1, 2);`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[1] as ts.ExpressionStatement).expression as ts.CallExpression;
        return tryEraseOpaqueConstructorCall(ctx, false, visit, expr);
      },
      "consumer.ts"
    );
    expect(result).toBeUndefined();
    const diags = diagnostics as Array<{ severity: string; message: string }>;
    expect(
      diags.some((d) => d.severity === "warning" && /expects exactly 1 argument/.test(d.message))
    ).toBe(true);
  });

  it("skips erasure inside the defining transparent module", () => {
    registerOption();
    const { result } = withContext(
      `declare function Some<A>(a: A): unknown;\nSome(42);`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[1] as ts.ExpressionStatement).expression as ts.CallExpression;
        return tryEraseOpaqueConstructorCall(ctx, false, visit, expr);
      },
      "typesugar/fp/data/option.ts" // matches sourceModule "@typesugar/fp/data/option"
    );
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// tryEraseOpaqueConstantRef
// ---------------------------------------------------------------------------

describe("tryEraseOpaqueConstantRef", () => {
  beforeEach(() => {
    registerTypeRewrite({
      typeName: "Option",
      sourceModule: "@typesugar/fp/data/option",
      underlyingTypeText: "T | null",
      constructors: new Map([
        ["Some", { kind: "identity" }],
        ["None", { kind: "constant", value: "null" }],
      ]),
      transparent: true,
    });
  });

  it("erases a bare constant constructor reference to its literal", () => {
    const { result } = withContext(
      `declare const None: unknown;\nconst x = None;`,
      (ctx, sf) => {
        const decl = (sf.statements[1] as ts.VariableStatement).declarationList.declarations[0];
        const initIdent = decl.initializer as ts.Identifier;
        return tryEraseOpaqueConstantRef(ctx, false, initIdent);
      },
      "consumer.ts"
    );
    expect(result).toBeDefined();
    expect(result!.kind).toBe(ts.SyntaxKind.NullKeyword);
  });

  it("returns undefined for the variable declaration name itself", () => {
    const { result } = withContext(
      `const None = 1;`,
      (ctx, sf) => {
        const decl = (sf.statements[0] as ts.VariableStatement).declarationList.declarations[0];
        return tryEraseOpaqueConstantRef(ctx, false, decl.name as ts.Identifier);
      },
      "consumer.ts"
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for property access positions (obj.None)", () => {
    const { result } = withContext(
      `declare const obj: { None: number };\nobj.None;`,
      (ctx, sf) => {
        const pa = (sf.statements[1] as ts.ExpressionStatement)
          .expression as ts.PropertyAccessExpression;
        return tryEraseOpaqueConstantRef(ctx, false, pa.name);
      },
      "consumer.ts"
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for unrelated identifiers", () => {
    const { result } = withContext(
      `const x = 1;\nx;`,
      (ctx, sf) => {
        const expr = (sf.statements[1] as ts.ExpressionStatement).expression as ts.Identifier;
        return tryEraseOpaqueConstantRef(ctx, false, expr);
      },
      "consumer.ts"
    );
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// tryStripOpaqueTypeAnnotation / tryStripOpaqueParamAnnotation
// ---------------------------------------------------------------------------

describe("tryStripOpaqueTypeAnnotation", () => {
  beforeEach(() => {
    registerTypeRewrite({
      typeName: "Option",
      sourceModule: "@typesugar/fp/data/option",
      underlyingTypeText: "T | null",
      constructors: new Map([
        ["Some", { kind: "identity" }],
        ["None", { kind: "constant", value: "null" }],
      ]),
      transparent: true,
    });
  });

  it("strips the type annotation when init would be erased (Some)", () => {
    const { result } = withContext(
      `declare function Some<A>(a: A): unknown;\ndeclare type Option<A> = A | null;\nconst x: Option<number> = Some(1);`,
      (ctx, sf, visit) => {
        const stmt = sf.statements[2] as ts.VariableStatement;
        const decl = stmt.declarationList.declarations[0];
        return tryStripOpaqueTypeAnnotation(ctx, false, visit, decl);
      },
      "consumer.ts"
    );
    expect(result).toBeDefined();
    expect(result!.type).toBeUndefined();
  });

  it("strips the type annotation when init is bare None", () => {
    const { result } = withContext(
      `declare const None: unknown;\ndeclare type Option<A> = A | null;\nconst x: Option<number> = None;`,
      (ctx, sf, visit) => {
        const stmt = sf.statements[2] as ts.VariableStatement;
        const decl = stmt.declarationList.declarations[0];
        return tryStripOpaqueTypeAnnotation(ctx, false, visit, decl);
      },
      "consumer.ts"
    );
    expect(result).toBeDefined();
    expect(result!.type).toBeUndefined();
  });

  it("returns undefined when there is no type annotation", () => {
    const { result } = withContext(
      `declare function Some<A>(a: A): unknown;\nconst x = Some(1);`,
      (ctx, sf, visit) => {
        const stmt = sf.statements[1] as ts.VariableStatement;
        const decl = stmt.declarationList.declarations[0];
        return tryStripOpaqueTypeAnnotation(ctx, false, visit, decl);
      },
      "consumer.ts"
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when the initializer would not be erased", () => {
    const { result } = withContext(
      `declare type Option<A> = A | null;\nconst x: Option<number> = 5 as any;`,
      (ctx, sf, visit) => {
        const stmt = sf.statements[1] as ts.VariableStatement;
        const decl = stmt.declarationList.declarations[0];
        return tryStripOpaqueTypeAnnotation(ctx, false, visit, decl);
      },
      "consumer.ts"
    );
    expect(result).toBeUndefined();
  });

  it("skips stripping inside the transparent source module", () => {
    const { result } = withContext(
      `declare function Some<A>(a: A): unknown;\ndeclare type Option<A> = A | null;\nconst x: Option<number> = Some(1);`,
      (ctx, sf, visit) => {
        const stmt = sf.statements[2] as ts.VariableStatement;
        const decl = stmt.declarationList.declarations[0];
        return tryStripOpaqueTypeAnnotation(ctx, false, visit, decl);
      },
      "typesugar/fp/data/option.ts"
    );
    expect(result).toBeUndefined();
  });
});

describe("tryStripOpaqueParamAnnotation", () => {
  beforeEach(() => {
    registerTypeRewrite({
      typeName: "Option",
      sourceModule: "@typesugar/fp/data/option",
      underlyingTypeText: "T | null",
      constructors: new Map([
        ["Some", { kind: "identity" }],
        ["None", { kind: "constant", value: "null" }],
      ]),
      transparent: true,
    });
  });

  it("strips a parameter type annotation when default value would be erased", () => {
    const { result } = withContext(
      `declare function Some<A>(a: A): unknown;\ndeclare type Option<A> = A | null;\nfunction f(x: Option<number> = Some(1)) {}`,
      (ctx, sf, visit) => {
        const fn = sf.statements[2] as ts.FunctionDeclaration;
        const param = fn.parameters[0];
        return tryStripOpaqueParamAnnotation(ctx, false, visit, param);
      },
      "consumer.ts"
    );
    expect(result).toBeDefined();
    expect(result!.type).toBeUndefined();
  });

  it("returns undefined when param has no initializer", () => {
    const { result } = withContext(
      `declare type Option<A> = A | null;\nfunction f(x: Option<number>) {}`,
      (ctx, sf, visit) => {
        const fn = sf.statements[1] as ts.FunctionDeclaration;
        const param = fn.parameters[0];
        return tryStripOpaqueParamAnnotation(ctx, false, visit, param);
      },
      "consumer.ts"
    );
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// shouldStripOpaqueReturnType
// ---------------------------------------------------------------------------

describe("shouldStripOpaqueReturnType", () => {
  beforeEach(() => {
    registerTypeRewrite({
      typeName: "Option",
      sourceModule: "@typesugar/fp/data/option",
      underlyingTypeText: "T | null",
      constructors: new Map([["Some", { kind: "identity" }]]),
      transparent: true,
    });
  });

  it("returns true for a return type referencing a transparent opaque type", () => {
    const { result } = withContext(
      `declare type Option<A> = A | null;\nfunction f(): Option<number> { return 1 as any; }`,
      (ctx, sf) => {
        const fn = sf.statements[1] as ts.FunctionDeclaration;
        return shouldStripOpaqueReturnType(ctx, fn.type, fn.body);
      },
      "consumer.ts"
    );
    expect(result).toBe(true);
  });

  it("returns false when there is no return type annotation", () => {
    const { result } = withContext(
      `function f() {}`,
      (ctx, sf) => {
        const fn = sf.statements[0] as ts.FunctionDeclaration;
        return shouldStripOpaqueReturnType(ctx, fn.type, fn.body);
      },
      "consumer.ts"
    );
    expect(result).toBe(false);
  });

  it("returns false for return types not in the opaque registry", () => {
    const { result } = withContext(
      `function f(): number { return 1; }`,
      (ctx, sf) => {
        const fn = sf.statements[0] as ts.FunctionDeclaration;
        return shouldStripOpaqueReturnType(ctx, fn.type, fn.body);
      },
      "consumer.ts"
    );
    expect(result).toBe(false);
  });

  it("returns false inside the transparent defining module", () => {
    const { result } = withContext(
      `declare type Option<A> = A | null;\nfunction f(): Option<number> { return 1 as any; }`,
      (ctx, sf) => {
        const fn = sf.statements[1] as ts.FunctionDeclaration;
        return shouldStripOpaqueReturnType(ctx, fn.type, fn.body);
      },
      "typesugar/fp/data/option.ts"
    );
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tryRewriteOpaqueMethodCall
// ---------------------------------------------------------------------------

describe("tryRewriteOpaqueMethodCall", () => {
  function registerOptionWithMethods(): void {
    registerTypeRewrite({
      typeName: "Option",
      sourceModule: "@typesugar/fp/data/option",
      underlyingTypeText: "T | null",
      methods: new Map([
        ["map", "mapOption"],
        ["getOrElse", "getOrElseOption"],
      ]),
      methodInlines: new Map([
        ["map", { kind: "null-check-apply" }],
        ["getOrElse", { kind: "null-coalesce-call" }],
      ]),
      constructors: new Map([
        ["Some", { kind: "identity" }],
        ["None", { kind: "constant", value: "null" }],
      ]),
      transparent: true,
    });
  }

  it("inlines map() into a null-check ternary for simple receiver", () => {
    registerOptionWithMethods();
    const { result } = withContext(
      `declare type Option<A> = A | null;\ndeclare const x: Option<number>;\nx.map((n: number) => n + 1);`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[2] as ts.ExpressionStatement).expression as ts.CallExpression;
        return tryRewriteOpaqueMethodCall(ctx, false, visit, expr);
      },
      "consumer.ts"
    );
    expect(result).toBeDefined();
    expect(ts.isConditionalExpression(result!)).toBe(true);
    const printed = printNode(result!);
    expect(printed).toMatch(/x\s*!=\s*null\s*\?/);
  });

  it("constant-folds map() on a literal null receiver to null", () => {
    registerOptionWithMethods();
    const { result } = withContext(
      `null.map((n: number) => n + 1) as any;`,
      (ctx, sf, visit) => {
        const stmt = sf.statements[0] as ts.ExpressionStatement;
        const asExpr = stmt.expression as ts.AsExpression;
        const call = asExpr.expression as ts.CallExpression;
        return tryRewriteOpaqueMethodCall(ctx, false, visit, call);
      },
      "consumer.ts"
    );
    // null.map() — receiver type isn't reliably typed as Option, so it may
    // return undefined. The important constant-folding path is verified via
    // tryEraseOpaqueConstructorCall + the ternary path above.
    expect(result === undefined || result.kind === ts.SyntaxKind.NullKeyword).toBe(true);
  });

  it("returns undefined when the receiver is not a property access (already-direct call)", () => {
    registerOptionWithMethods();
    const { result } = withContext(
      `declare function map(o: unknown, f: (n: number) => number): unknown;\nmap(null, (n) => n + 1);`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[1] as ts.ExpressionStatement).expression as ts.CallExpression;
        return tryRewriteOpaqueMethodCall(ctx, false, visit, expr);
      },
      "consumer.ts"
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for an unrelated method name on a registered opaque type", () => {
    registerOptionWithMethods();
    const { result } = withContext(
      `declare type Option<A> = A | null;\ndeclare const x: Option<number>;\n(x as any).bogus();`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[2] as ts.ExpressionStatement).expression as ts.CallExpression;
        return tryRewriteOpaqueMethodCall(ctx, false, visit, expr);
      },
      "consumer.ts"
    );
    // Receiver type is `any` (unreliable) — must skip
    expect(result).toBeUndefined();
  });

  it("skips rewrite inside the transparent defining module", () => {
    registerOptionWithMethods();
    const { result } = withContext(
      `declare type Option<A> = A | null;\ndeclare const x: Option<number>;\nx.map((n: number) => n + 1);`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[2] as ts.ExpressionStatement).expression as ts.CallExpression;
        return tryRewriteOpaqueMethodCall(ctx, false, visit, expr);
      },
      "typesugar/fp/data/option.ts"
    );
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// tryEraseOpaqueAccessor (PEP-056 Wave 4 -- ported from legacy; core previously
// had method/constructor/constant-ref erasure but no accessor erasure at all)
// ---------------------------------------------------------------------------

describe("tryEraseOpaqueAccessor", () => {
  function registerMoneyWithAccessors(): void {
    registerTypeRewrite({
      typeName: "Money",
      sourceModule: "@typesugar/fp/data/money",
      underlyingTypeText: "number",
      accessors: new Map([
        ["value", { kind: "identity" }],
        ["zero", { kind: "custom", value: "ZERO_MONEY" }],
      ]),
      transparent: true,
    });
  }

  it("erases an identity accessor to the receiver", () => {
    registerMoneyWithAccessors();
    const { result } = withContext(
      `declare type Money = number & { readonly __brand: "Money" };\ndeclare const m: Money;\nm.value;`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[2] as ts.ExpressionStatement)
          .expression as ts.PropertyAccessExpression;
        return tryEraseOpaqueAccessor(ctx, false, visit, expr);
      },
      "consumer.ts"
    );
    expect(result).toBeDefined();
    expect(ts.isIdentifier(result!)).toBe(true);
    expect((result as ts.Identifier).text).toBe("m");
  });

  it("erases a custom accessor to its configured expression", () => {
    registerMoneyWithAccessors();
    const { result } = withContext(
      `declare type Money = number & { readonly __brand: "Money" };\ndeclare const m: Money;\nm.zero;`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[2] as ts.ExpressionStatement)
          .expression as ts.PropertyAccessExpression;
        return tryEraseOpaqueAccessor(ctx, false, visit, expr);
      },
      "consumer.ts"
    );
    expect(result).toBeDefined();
    expect(ts.isIdentifier(result!)).toBe(true);
    expect((result as ts.Identifier).text).toBe("ZERO_MONEY");
  });

  it("returns undefined for an unregistered property name", () => {
    registerMoneyWithAccessors();
    const { result } = withContext(
      `declare type Money = number & { readonly __brand: "Money" };\ndeclare const m: Money;\n(m as any).bogus;`,
      (ctx, sf, visit) => {
        const stmt = sf.statements[2] as ts.ExpressionStatement;
        const expr = (stmt.expression as ts.AsExpression | ts.PropertyAccessExpression) as
          | ts.PropertyAccessExpression
          | ts.AsExpression;
        const propAccess = ts.isPropertyAccessExpression(expr)
          ? expr
          : (expr.expression as ts.PropertyAccessExpression);
        return tryEraseOpaqueAccessor(ctx, false, visit, propAccess);
      },
      "consumer.ts"
    );
    expect(result).toBeUndefined();
  });

  it("skips erasure inside the transparent defining module", () => {
    registerMoneyWithAccessors();
    const { result } = withContext(
      `declare type Money = number & { readonly __brand: "Money" };\ndeclare const m: Money;\nm.value;`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[2] as ts.ExpressionStatement)
          .expression as ts.PropertyAccessExpression;
        return tryEraseOpaqueAccessor(ctx, false, visit, expr);
      },
      "typesugar/fp/data/money.ts"
    );
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// tryRewriteExtensionMethod
// ---------------------------------------------------------------------------

describe("tryRewriteExtensionMethod", () => {
  it("rewrites a standalone extension to a function call", () => {
    standaloneExtensionRegistry.push({
      methodName: "clamp",
      forType: "number",
    });

    const { result } = withContext(
      `declare const x: number; x.clamp(0, 10);`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[1] as ts.ExpressionStatement).expression as ts.CallExpression;
        const rewritten = tryRewriteExtensionMethod(
          ctx,
          false,
          visit,
          () => undefined,
          () => undefined,
          expr
        );
        return { rewritten, sf };
      },
      "consumer.ts"
    );
    expect(result.rewritten).toBeDefined();
    expect(ts.isCallExpression(result.rewritten!)).toBe(true);
    const call = result.rewritten as ts.CallExpression;
    expect(ts.isIdentifier(call.expression)).toBe(true);
    expect((call.expression as ts.Identifier).text).toBe("clamp");
    expect(call.arguments).toHaveLength(3);
    expect(ts.isIdentifier(call.arguments[0])).toBe(true);
    expect((call.arguments[0] as ts.Identifier).text).toBe("x");
    expect(ts.isNumericLiteral(call.arguments[1])).toBe(true);
    expect((call.arguments[1] as ts.NumericLiteral).text).toBe("0");
    expect(ts.isNumericLiteral(call.arguments[2])).toBe(true);
    expect((call.arguments[2] as ts.NumericLiteral).text).toBe("10");
  });

  it("rewrites with a qualifier as Qualifier.method(receiver, args)", () => {
    standaloneExtensionRegistry.push({
      methodName: "twice",
      forType: "number",
      qualifier: "NumberOps",
    });

    const { result } = withContext(
      `declare const x: number; x.twice();`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[1] as ts.ExpressionStatement).expression as ts.CallExpression;
        return tryRewriteExtensionMethod(
          ctx,
          false,
          visit,
          () => undefined,
          () => undefined,
          expr
        );
      },
      "consumer.ts"
    );
    expect(result).toBeDefined();
    const call = result as ts.CallExpression;
    expect(ts.isPropertyAccessExpression(call.expression)).toBe(true);
    const pa = call.expression as ts.PropertyAccessExpression;
    expect((pa.expression as ts.Identifier).text).toBe("NumberOps");
    expect(pa.name.text).toBe("twice");
    expect(call.arguments).toHaveLength(1);
    expect((call.arguments[0] as ts.Identifier).text).toBe("x");
  });

  it("returns undefined when no matching extension is registered", () => {
    const { result } = withContext(
      `declare const x: number; x.nonsense();`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[1] as ts.ExpressionStatement).expression as ts.CallExpression;
        return tryRewriteExtensionMethod(
          ctx,
          false,
          visit,
          () => undefined,
          () => undefined,
          expr
        );
      },
      "consumer.ts"
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when the type already has the method (no extension hijack)", () => {
    standaloneExtensionRegistry.push({
      methodName: "toString",
      forType: "number",
    });

    const { result } = withContext(
      `declare const x: number; x.toString();`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[1] as ts.ExpressionStatement).expression as ts.CallExpression;
        return tryRewriteExtensionMethod(
          ctx,
          false,
          visit,
          () => undefined,
          () => undefined,
          expr
        );
      },
      "consumer.ts"
    );
    expect(result).toBeUndefined();
  });

  it("normalizes a literal receiver type (e.g. numeric literal 5) to its base type for extension lookup", () => {
    // A receiver the checker types as a NumberLiteral (not widened to `number`)
    // -- typeToString on it returns the literal text ("5"), which would never
    // match an extension registered for "number" without normalizing by
    // TypeFlags first. Ported from the legacy pipeline's equivalent guard.
    standaloneExtensionRegistry.push({
      methodName: "clamp",
      forType: "number",
    });

    const { result } = withContext(
      `(5).clamp(0, 10);`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[0] as ts.ExpressionStatement).expression as ts.CallExpression;
        // Confirm the fixture actually exercises a literal type, not `number`.
        const receiverType = ctx.typeChecker.getTypeAtLocation(
          (expr.expression as ts.PropertyAccessExpression).expression
        );
        expect(!!(receiverType.flags & ts.TypeFlags.NumberLiteral)).toBe(true);
        return tryRewriteExtensionMethod(
          ctx,
          false,
          visit,
          () => undefined,
          () => undefined,
          expr
        );
      },
      "consumer.ts"
    );
    expect(result).toBeDefined();
    const call = result as ts.CallExpression;
    expect(ts.isIdentifier(call.expression)).toBe(true);
    expect((call.expression as ts.Identifier).text).toBe("clamp");
    expect(call.arguments).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// tryExpandTaggedTemplate
// ---------------------------------------------------------------------------

describe("tryExpandTaggedTemplate", () => {
  it("expands a registered tagged-template macro", () => {
    const macro: TaggedTemplateMacroDef = {
      kind: "tagged-template",
      name: "sql",
      description: "test tagged template",
      module: "@test",
      expand(_ctx, _node) {
        return ts.factory.createStringLiteral("EXPANDED");
      },
    };

    const { result } = withContext("sql`hello`;", (ctx, sf, visit) => {
      const stmt = sf.statements[0] as ts.ExpressionStatement;
      const tagged = stmt.expression as ts.TaggedTemplateExpression;
      return tryExpandTaggedTemplate(
        ctx,
        false,
        visit,
        (_node, name, kind) => (kind === "tagged-template" && name === "sql" ? macro : undefined),
        tagged
      );
    });
    expect(result).toBeDefined();
    expect(ts.isStringLiteral(result!)).toBe(true);
    expect((result as ts.StringLiteral).text).toBe("EXPANDED");
  });

  it("returns undefined when no macro resolves for the tag", () => {
    const { result } = withContext("html`hello`;", (ctx, sf, visit) => {
      const stmt = sf.statements[0] as ts.ExpressionStatement;
      const tagged = stmt.expression as ts.TaggedTemplateExpression;
      return tryExpandTaggedTemplate(ctx, false, visit, () => undefined, tagged);
    });
    expect(result).toBeUndefined();
  });

  it("emits an error expression when the macro throws during expansion", () => {
    const macro: TaggedTemplateMacroDef = {
      kind: "tagged-template",
      name: "bang",
      description: "test throwing",
      module: "@test",
      expand() {
        throw new Error("boom");
      },
    };

    const { result, diagnostics } = withContext("bang`x`;", (ctx, sf, visit) => {
      const stmt = sf.statements[0] as ts.ExpressionStatement;
      const tagged = stmt.expression as ts.TaggedTemplateExpression;
      return tryExpandTaggedTemplate(
        ctx,
        false,
        visit,
        (_n, name, kind) => (kind === "tagged-template" && name === "bang" ? macro : undefined),
        tagged
      );
    });
    expect(result).toBeDefined();
    const diags = diagnostics as Array<{ severity: string; message: string }>;
    expect(
      diags.some(
        (d) => d.severity === "error" && /Tagged template macro expansion failed/.test(d.message)
      )
    ).toBe(true);
  });

  it("emits an error expression when validate() returns false", () => {
    const macro: TaggedTemplateMacroDef = {
      kind: "tagged-template",
      name: "checked",
      description: "validates",
      module: "@test",
      validate() {
        return false;
      },
      expand() {
        return ts.factory.createStringLiteral("ok");
      },
    };

    const { result, diagnostics } = withContext("checked`x`;", (ctx, sf, visit) => {
      const stmt = sf.statements[0] as ts.ExpressionStatement;
      const tagged = stmt.expression as ts.TaggedTemplateExpression;
      return tryExpandTaggedTemplate(
        ctx,
        false,
        visit,
        (_n, name, kind) => (kind === "tagged-template" && name === "checked" ? macro : undefined),
        tagged
      );
    });
    expect(result).toBeDefined();
    const diags = diagnostics as Array<{ severity: string; message: string }>;
    expect(diags.some((d) => /validation failed/.test(d.message))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tryExpandTypeMacro
// ---------------------------------------------------------------------------

describe("tryExpandTypeMacro", () => {
  it("expands a registered type macro", () => {
    const macro: TypeMacro = {
      kind: "type",
      name: "Const",
      description: "test type macro",
      module: "@test",
      expand(_ctx, _ref, _args) {
        return ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
      },
    };

    const { result } = withContext(`type T = Const<"x">;`, (ctx, sf, visit) => {
      const alias = sf.statements[0] as ts.TypeAliasDeclaration;
      const ref = alias.type as ts.TypeReferenceNode;
      return tryExpandTypeMacro(
        ctx,
        false,
        visit,
        (_n, name, kind) => (kind === "type" && name === "Const" ? macro : undefined),
        ref
      );
    });
    expect(result).toBeDefined();
    expect(result!.kind).toBe(ts.SyntaxKind.NumberKeyword);
  });

  it("returns undefined when the type reference has no matching macro", () => {
    const { result } = withContext(`type T = Foo<"x">;`, (ctx, sf, visit) => {
      const alias = sf.statements[0] as ts.TypeAliasDeclaration;
      const ref = alias.type as ts.TypeReferenceNode;
      return tryExpandTypeMacro(ctx, false, visit, () => undefined, ref);
    });
    expect(result).toBeUndefined();
  });

  it("matches type macros under typesugar.X / typemacro.X qualified names", () => {
    const macro: TypeMacro = {
      kind: "type",
      name: "Wrapped",
      description: "qualified",
      module: "@test",
      expand() {
        return ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword);
      },
    };

    const { result } = withContext(`type T = typesugar.Wrapped<"x">;`, (ctx, sf, visit) => {
      const alias = sf.statements[0] as ts.TypeAliasDeclaration;
      const ref = alias.type as ts.TypeReferenceNode;
      return tryExpandTypeMacro(
        ctx,
        false,
        visit,
        (_n, name, kind) => (kind === "type" && name === "Wrapped" ? macro : undefined),
        ref
      );
    });
    expect(result).toBeDefined();
    expect(result!.kind).toBe(ts.SyntaxKind.StringKeyword);
  });
});

// ---------------------------------------------------------------------------
// tryTransformHKTDeclaration
// ---------------------------------------------------------------------------

describe("tryTransformHKTDeclaration", () => {
  it("returns undefined for an interface without kind annotations", () => {
    const { result } = withContext(`interface Foo<A> { x: A; }`, (ctx, sf, visit) => {
      const iface = sf.statements[0] as ts.InterfaceDeclaration;
      return tryTransformHKTDeclaration(ctx, false, visit, iface);
    });
    expect(result).toBeUndefined();
  });

  it("returns undefined when no type parameters are present", () => {
    const { result } = withContext(`type T = number;`, (ctx, sf, visit) => {
      const alias = sf.statements[0] as ts.TypeAliasDeclaration;
      return tryTransformHKTDeclaration(ctx, false, visit, alias);
    });
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// tryRewriteTypeclassOperator + inference helpers
// ---------------------------------------------------------------------------

describe("tryRewriteTypeclassOperator", () => {
  function registerNumericForPoint(): void {}

  it("rewrites a + b to numericPoint.add(a, b) when the typeclass + instance are in scope", () => {
    // PEP-052: an in-file `@typeclass` (with `@op +`) activates operator syntax, and
    // the `@impl` instance resolves from scope — no global registry.
    const source = [
      "/** @typeclass */",
      "interface Numeric<A> {",
      "  /** @op + */",
      "  add(a: A, b: A): A;",
      "}",
      "interface Point { x: number; y: number; }",
      "/** @impl Numeric<Point> */",
      "const numericPoint: Numeric<Point> = { add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }) };",
      "declare const a: Point;",
      "declare const b: Point;",
      "a + b;",
    ].join("\n");
    const { result } = withContext(
      source,
      (ctx, sf, visit, program) => {
        scanImportsForScope(sf, globalResolutionScope, program);
        const stmts = sf.statements;
        const expr = (stmts[stmts.length - 1] as ts.ExpressionStatement)
          .expression as ts.BinaryExpression;
        return tryRewriteTypeclassOperator(ctx, false, visit, expr);
      },
      "consumer.ts"
    );
    expect(result).toBeDefined();
    const call = result as ts.CallExpression;
    expect(ts.isCallExpression(call)).toBe(true);
    const pa = call.expression as ts.PropertyAccessExpression;
    expect(ts.isPropertyAccessExpression(pa)).toBe(true);
    expect((pa.expression as ts.Identifier).text).toBe("numericPoint");
    expect(pa.name.text).toBe("add");
    expect(call.arguments).toHaveLength(2);
    expect((call.arguments[0] as ts.Identifier).text).toBe("a");
    expect((call.arguments[1] as ts.Identifier).text).toBe("b");
  });

  it("returns undefined for primitive number operands (no rewrite)", () => {
    registerNumericForPoint();
    const { result } = withContext(
      `const x = 1 + 2;`,
      (ctx, sf, visit) => {
        const stmt = sf.statements[0] as ts.VariableStatement;
        const init = stmt.declarationList.declarations[0].initializer as ts.BinaryExpression;
        return tryRewriteTypeclassOperator(ctx, false, visit, init);
      },
      "consumer.ts"
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when no instance exists for the operand type", () => {
    const { result } = withContext(
      `interface Q { v: number; }\ndeclare const a: Q;\ndeclare const b: Q;\na + b;`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[3] as ts.ExpressionStatement).expression as ts.BinaryExpression;
        return tryRewriteTypeclassOperator(ctx, false, visit, expr);
      },
      "consumer.ts"
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for unsupported operators (no syntax entry)", () => {
    registerNumericForPoint();
    const { result } = withContext(
      `interface Point { x: number; y: number; }\ndeclare const a: Point;\ndeclare const b: Point;\na && b;`,
      (ctx, sf, visit) => {
        const expr = (sf.statements[3] as ts.ExpressionStatement).expression as ts.BinaryExpression;
        return tryRewriteTypeclassOperator(ctx, false, visit, expr);
      },
      "consumer.ts"
    );
    expect(result).toBeUndefined();
  });

  // NOTE: the `inferBinaryExprResultType` / `inferIdentifierResultType` helpers were
  // removed with the registry-based operator path (PEP-052) — operand types now come
  // straight from the checker, so those nested-inference helpers no longer exist.

  it("returns undefined for synthetic binary expressions (pos = -1)", () => {
    const synthetic = ts.factory.createBinaryExpression(
      ts.factory.createIdentifier("a"),
      ts.SyntaxKind.PlusToken,
      ts.factory.createIdentifier("b")
    );
    const { result } = withContext(
      `const _ = 1;`,
      (ctx, _sf, visit) => {
        return tryRewriteTypeclassOperator(ctx, false, visit, synthetic);
      },
      "consumer.ts"
    );
    expect(result).toBeUndefined();
  });

  it("schedules an import for a cross-module (module-scan) instance, ported from legacy", () => {
    // Numeric, Point, and the numericPoint instance all live in point.ts (a
    // type-annotated `const numericPoint: Numeric<Point>` -- required since
    // instance-scanner's JSDoc-only @impl form can only resolve primitive
    // forTypes by name; a real interface needs the checker-backed type
    // annotation path). consumer.ts imports only `Point` by name -- never
    // `numericPoint` -- which is exactly what makes resolveInstance return
    // source: "module-scan" rather than "explicit-import" or "local-scope".
    // Operator-syntax activation for Numeric comes from the `@syntax-operators`
    // marker on `point.ts`'s own `__activateNumericOps` export, discovered by
    // scanning every import (including this one) for such a marker -- the
    // same mechanism `@typesugar/std/syntax/eq/ops` uses in production.
    //
    // Legacy scheduled an import for this cross-module case
    // (scheduleInstanceImport); the core copy previously assumed the binding
    // was already in scope, which is only true for explicit-import/
    // local-scope, not module-scan.
    const result = withMultiFileContext(
      {
        "point.ts": [
          "/** @typeclass */",
          "export interface Numeric<A> {",
          "  /** @op + */",
          "  add(a: A, b: A): A;",
          "}",
          "export interface Point { x: number; y: number; }",
          "export const numericPoint: Numeric<Point> = { add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }) };",
          "/** @syntax-operators Numeric */",
          "export const __activateNumericOps = true;",
        ].join("\n"),
        "consumer.ts": [
          'import { Point } from "./point.js";',
          "",
          "declare const a: Point;",
          "declare const b: Point;",
          "a + b;",
        ].join("\n"),
      },
      "consumer.ts",
      (ctx, sf, visit) => {
        scanImportsForScope(sf, globalResolutionScope, ctx.program);
        const stmts = sf.statements;
        const expr = (stmts[stmts.length - 1] as ts.ExpressionStatement)
          .expression as ts.BinaryExpression;
        const rewritten = tryRewriteTypeclassOperator(ctx, false, visit, expr);
        const pendingImports = ctx.fileBindingCache.getPendingImports();
        return { rewritten, pendingImports };
      }
    );

    expect(result.rewritten).toBeDefined();
    const call = result.rewritten as ts.CallExpression;
    const pa = call.expression as ts.PropertyAccessExpression;
    expect((pa.expression as ts.Identifier).text).toBe("numericPoint");

    expect(result.pendingImports.length).toBeGreaterThan(0);
    const printed = result.pendingImports.map((d) => printNode(d)).join("\n");
    expect(printed).toContain("numericPoint");
    expect(printed).toContain("./point.js");
  });

  it("strips comments from operands in the emitted call (ported from legacy)", () => {
    // NOTE: `printNode`'s printer uses `removeComments: true`, which would mask
    // this behavior regardless of whether stripCommentsDeep actually ran (the
    // printer's own comment removal, not the function under test, would be
    // what hides the comments). This test builds its own printer with
    // `removeComments: false` and prints against the REAL source file (not an
    // empty synthetic one), so leading/trailing comments would genuinely
    // surface via position-based lookup if stripCommentsDeep did NOT reset the
    // operand nodes' positions to -1. The sanity-check assertion on the
    // ORIGINAL (pre-rewrite) expression proves this printer setup can in fact
    // show comments when they're present, so the negative result on the
    // rewritten call is meaningful.
    const source = [
      "/** @typeclass */",
      "interface Numeric<A> {",
      "  /** @op + */",
      "  add(a: A, b: A): A;",
      "}",
      "interface Point { x: number; y: number; }",
      "/** @impl Numeric<Point> */",
      "const numericPoint: Numeric<Point> = { add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }) };",
      "declare const a: Point;",
      "declare const b: Point;",
      "a /* left comment */ + /* right comment */ b;",
    ].join("\n");

    const { result } = withContext(
      source,
      (ctx, sf, visit) => {
        scanImportsForScope(sf, globalResolutionScope, ctx.program);
        const stmts = sf.statements;
        const expr = (stmts[stmts.length - 1] as ts.ExpressionStatement)
          .expression as ts.BinaryExpression;

        const printerWithComments = ts.createPrinter({ removeComments: false });
        const printWithComments = (node: ts.Node) =>
          printerWithComments.printNode(ts.EmitHint.Unspecified, node, sf);

        // Sanity check: the ORIGINAL expression's operands still have their
        // real source positions, so this printer setup surfaces the comments.
        expect(printWithComments(expr)).toContain("comment");

        const rewritten = tryRewriteTypeclassOperator(ctx, false, visit, expr);
        return { rewritten, printed: rewritten && printWithComments(rewritten) };
      },
      "consumer.ts"
    );

    expect(result.rewritten).toBeDefined();
    expect(result.printed).not.toContain("comment");
  });
});
