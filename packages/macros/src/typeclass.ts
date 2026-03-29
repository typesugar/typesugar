/**
 * Typeclass Macros - Scala 3-like typeclasses with auto-derivation
 *
 * Provides a complete typeclass system inspired by Scala 3:
 *
 * 1. @typeclass - Defines a typeclass from an interface
 * 2. @instance - Registers a typeclass instance for a type
 * 3. @derive - Auto-derives typeclass instances for product/sum types
 * 4. summon<TC<A>>() - Compile-time implicit resolution
 * 5. Extension methods - Typeclass methods available directly on types
 *
 * ## Scala 3 Derivation Rules
 *
 * Product types (interfaces/classes with fields):
 *   - If all fields have TC instances, the product type can derive TC
 *   - Derivation combines field instances (e.g., Eq checks all fields equal)
 *
 * Sum types (discriminated unions):
 *   - If all variants have TC instances, the sum type can derive TC
 *   - Derivation dispatches on discriminant
 *
 * ## Example
 *
 * ```typescript
 * // Define a typeclass
 * @typeclass
 * interface Show<A> {
 *   show(a: A): string;
 * }
 *
 * // Provide an instance
 * @instance
 * const showNumber: Show<number> = {
 *   show: (a) => String(a),
 * };
 *
 * // Auto-derive for product types
 * @derive(Show, Eq)
 * interface Point {
 *   x: number;
 *   y: number;
 * }
 *
 * // Implicit extension methods -- just call methods directly!
 * const p: Point = { x: 1, y: 2 };
 * p.show();              // "Point(x = 1, y = 2)"  -- rewritten by transformer
 * p.eq({ x: 1, y: 2 }); // true                   -- rewritten by transformer
 *
 * // The transformer rewrites p.show() to:
 * //   Show.summon<Point>("Point").show(p)
 *
 * // Explicit extend() wrapper still works too:
 * extend(p).show();      // same result
 *
 * // Summon instances explicitly
 * const showPoint = summon<Show<Point>>();
 * showPoint.show(p); // "Point(x = 1, y = 2)"
 * ```
 */

import * as ts from "typescript";
import {
  defineAttributeMacro,
  defineExpressionMacro,
  defineDeriveMacro,
  globalRegistry,
} from "@typesugar/core";
import { MacroContext, DeriveTypeInfo, DeriveFieldInfo, DeriveVariantInfo } from "@typesugar/core";
import {
  findStandaloneExtension as findStandaloneExtensionForExtend,
  buildStandaloneExtensionCall,
} from "./extension.js";
import {
  registerInstanceMethodsFromAST,
  extractMethodsFromObjectLiteral,
  registerInstanceMethods,
} from "./specialize.js";
import { quoteStatements } from "./quote.js";
import {
  formatResolutionTrace,
  generateHelpFromTrace,
  type ResolutionAttempt,
  type ResolutionTrace,
} from "@typesugar/core";
import type { DerivationResult } from "./auto-derive.js";
import { globalResolutionScope } from "@typesugar/core";
import {
  TS9001,
  TS9005,
  TS9008,
  TS9060,
  TS9101,
  TS9102,
  TS9103,
  TS9104,
  TS9203,
  TS9305,
} from "@typesugar/core";
import { getSuggestionsForSymbol, getSuggestionsForTypeclass } from "@typesugar/core";
import { resolveTypeConstructorViaTypeChecker, parseTypeConstructor } from "./hkt.js";

// ============================================================================
// Safe Node Text Extraction
// ============================================================================

/**
 * Get text from a TypeScript node, handling synthetic nodes (nodes created
 * programmatically without source positions) that would throw with `.getText()`.
 *
 * TS < 5.8 throws "Node must have a real position for this operation" on
 * synthetic nodes. This helper falls back to the printer in that case.
 */
const printer = ts.createPrinter({ removeComments: true });
const dummySourceFile = ts.createSourceFile("", "", ts.ScriptTarget.Latest);

function getNodeText(node: ts.Node): string {
  // Check if this is a synthetic node (negative or missing positions)
  if (node.pos < 0 || node.end < 0) {
    return printer.printNode(ts.EmitHint.Unspecified, node, dummySourceFile);
  }

  // Try to get the source file for real nodes
  try {
    const sourceFile = node.getSourceFile();
    if (sourceFile) {
      return node.getText(sourceFile);
    }
  } catch {
    // getSourceFile() can throw for synthetic nodes
  }

  // Fallback to printer
  return printer.printNode(ts.EmitHint.Unspecified, node, dummySourceFile);
}

// ============================================================================
// Primitive Registration Hook
// ============================================================================

// Hook for coverage module to register itself
let onPrimitiveRegistered: ((typeName: string, typeclassName: string) => void) | undefined;
let onCoverageCheck:
  | ((
      ctx: MacroContext,
      node: ts.Node,
      typeclassName: string,
      typeName: string,
      fields: Array<{ name: string; typeName: string }>
    ) => boolean)
  | undefined;

/**
 * Register hooks from coverage module.
 * Called by coverage.ts on load.
 */
export function setCoverageHooks(
  registerPrimitive: (typeName: string, typeclassName: string) => void,
  validateCoverage: (
    ctx: MacroContext,
    node: ts.Node,
    typeclassName: string,
    typeName: string,
    fields: Array<{ name: string; typeName: string }>
  ) => boolean
): void {
  onPrimitiveRegistered = registerPrimitive;
  onCoverageCheck = validateCoverage;

  // Flush any pending primitives
  for (const [typeName, tcName] of pendingPrimitives) {
    registerPrimitive(typeName, tcName);
  }
  pendingPrimitives.length = 0;
}

// Queue primitives registered before coverage module loads
const pendingPrimitives: Array<[string, string]> = [];

/**
 * Register that a type has an instance for a typeclass.
 * Enables coverage checking during derivation.
 */
function notifyPrimitiveRegistered(typeName: string, typeclassName: string): void {
  if (onPrimitiveRegistered) {
    onPrimitiveRegistered(typeName, typeclassName);
  } else {
    pendingPrimitives.push([typeName, typeclassName]);
  }
}

/**
 * Validate coverage before derivation. Returns true if OK.
 */
function checkCoverageForDerive(
  ctx: MacroContext,
  node: ts.Node,
  typeclassName: string,
  typeName: string,
  fields: DeriveFieldInfo[]
): boolean {
  if (!onCoverageCheck) {
    // Coverage module not loaded - allow derivation
    return true;
  }
  return onCoverageCheck(
    ctx,
    node,
    typeclassName,
    typeName,
    fields.map((f) => ({ name: f.name, typeName: f.typeString }))
  );
}

// ============================================================================
// Transitive Derivation
// ============================================================================

interface TransitiveOptions {
  transitive?: boolean;
  maxDepth?: number;
}

interface TransitiveTypeInfo {
  typeName: string;
  fields: DeriveFieldInfo[];
  node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.ClassDeclaration;
}

/**
 * Parse transitive options from decorator arguments.
 */
function parseTransitiveOptions(args: readonly ts.Expression[]): TransitiveOptions {
  const options: TransitiveOptions = { transitive: true, maxDepth: 10 };

  for (const arg of args) {
    if (ts.isObjectLiteralExpression(arg)) {
      for (const prop of arg.properties) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
          if (prop.name.text === "transitive") {
            options.transitive = prop.initializer.kind !== ts.SyntaxKind.FalseKeyword;
          }
          if (prop.name.text === "maxDepth" && ts.isNumericLiteral(prop.initializer)) {
            options.maxDepth = parseInt(prop.initializer.text, 10);
          }
        }
      }
    }
  }

  return options;
}

/**
 * Find a type declaration in the current source file.
 */
function findTypeInSourceFile(
  ctx: MacroContext,
  typeName: string
): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.ClassDeclaration | undefined {
  for (const statement of ctx.sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement) && statement.name.text === typeName) {
      return statement;
    }
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName) {
      return statement;
    }
    if (ts.isClassDeclaration(statement) && statement.name?.text === typeName) {
      return statement;
    }
  }
  return undefined;
}

/**
 * Normalize type name for primitive lookup.
 */
function normalizeTypeNameForLookup(typeName: string): string {
  const base = typeName.replace(/<.*>$/, "").trim();
  const lower = base.toLowerCase();
  if (lower === "string") return "string";
  if (lower === "number") return "number";
  if (lower === "boolean") return "boolean";
  if (lower === "bigint") return "bigint";
  return base;
}

/**
 * Check if a type has a primitive/instance for a typeclass.
 */
function hasPrimitiveOrInstance(typeName: string, typeclassName: string): boolean {
  // Check instance registry
  if (instanceRegistry.some((i) => i.typeclassName === typeclassName && i.forType === typeName)) {
    return true;
  }
  // Check via coverage hook
  if (onPrimitiveRegistered) {
    // Primitives are registered there
  }
  // Hardcoded primitives as fallback
  const primitives = ["number", "string", "boolean", "bigint", "null", "undefined"];
  return primitives.includes(typeName.toLowerCase());
}

/**
 * Extract fields from a TypeLiteralNode (inline object type like `{ x: number; y: string }`).
 */
function extractFieldsFromTypeLiteral(typeLiteral: ts.TypeLiteralNode): DeriveFieldInfo[] {
  const fields: DeriveFieldInfo[] = [];
  for (const member of typeLiteral.members) {
    if (ts.isPropertySignature(member)) {
      if (!member.name || !ts.isIdentifier(member.name)) continue;
      const name = member.name.text;
      const typeString = member.type
        ? member.type.getText().replace(/\s+/g, " ").trim()
        : "unknown";
      fields.push({
        name,
        typeString,
        type: undefined as unknown as ts.Type,
        optional: !!member.questionToken,
        readonly: member.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false,
      });
    }
  }
  return fields;
}

/**
 * Fallback: extract field info from the AST when the TypeChecker is unavailable.
 * Uses type annotation text instead of resolved types.
 */
function extractFieldsFromAST(target: ts.Declaration): DeriveFieldInfo[] {
  const fields: DeriveFieldInfo[] = [];

  // Handle interface and class declarations
  let members: readonly (ts.TypeElement | ts.ClassElement)[] | undefined;
  if (ts.isInterfaceDeclaration(target)) {
    members = target.members;
  } else if (ts.isClassDeclaration(target)) {
    members = target.members;
  }

  if (members) {
    for (const member of members) {
      if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
        if (!member.name || !ts.isIdentifier(member.name)) continue;
        const name = member.name.text;
        const typeString = member.type
          ? member.type.getText().replace(/\s+/g, " ").trim()
          : "unknown";
        fields.push({
          name,
          typeString,
          type: undefined as unknown as ts.Type,
          optional: !!member.questionToken,
          readonly:
            member.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false,
        });
      }
    }
    return fields;
  }

  // Handle type alias with inline object type: type Point = { x: number; y: number }
  if (ts.isTypeAliasDeclaration(target)) {
    if (ts.isTypeLiteralNode(target.type)) {
      return extractFieldsFromTypeLiteral(target.type);
    }
    // For union types, we can't extract fields directly - they need sum type handling
    // Return empty to trigger sum type detection
  }

  return fields;
}

/**
 * AST-based fallback for extracting sum type information when TypeChecker is unavailable.
 * Works with inline union types like:
 *   type X = { kind: "a"; name: string } | { kind: "b"; age: number }
 */
function tryExtractSumTypeFromAST(target: ts.TypeAliasDeclaration):
  | {
      discriminant: string;
      variants: Array<{ tag: string; typeName: string; fields: DeriveFieldInfo[] }>;
    }
  | undefined {
  if (!ts.isUnionTypeNode(target.type)) {
    return undefined;
  }

  const KNOWN_DISCRIMINANTS = ["kind", "_tag", "type", "tag", "__typename"];
  const variants: Array<{ tag: string; typeName: string; fields: DeriveFieldInfo[] }> = [];
  let discriminant: string | undefined;

  for (const member of target.type.types) {
    // Handle inline object types: { kind: "a"; name: string }
    if (ts.isTypeLiteralNode(member)) {
      const fields = extractFieldsFromTypeLiteral(member);

      // Look for discriminant field with literal type
      for (const field of fields) {
        if (KNOWN_DISCRIMINANTS.includes(field.name)) {
          // Check if the type is a string literal (e.g., "a" or 'a')
          const literalMatch = field.typeString.match(/^["'](.+)["']$/);
          if (literalMatch) {
            const tag = literalMatch[1];
            if (!discriminant) {
              discriminant = field.name;
            } else if (discriminant !== field.name) {
              continue; // Different discriminant field, skip
            }
            // Use anonymous variant name based on tag
            variants.push({
              tag,
              typeName: `${target.name.text}_${tag}`,
              fields: fields.filter((f) => f.name !== discriminant),
            });
            break;
          }
        }
      }
    }
    // Handle named type references: Circle | Rectangle
    else if (ts.isTypeReferenceNode(member)) {
      // For named types, we can't extract discriminant without TypeChecker
      // Return undefined to let the caller handle it differently
      return undefined;
    }
  }

  if (discriminant && variants.length === target.type.types.length) {
    return { discriminant, variants };
  }

  return undefined;
}

/**
 * Build a derivation plan for transitive derivation.
 * Returns types to derive in dependency order (leaves first).
 */
function buildTransitiveDerivationPlan(
  ctx: MacroContext,
  rootTypeName: string,
  typeclassName: string,
  options: TransitiveOptions
): { types: TransitiveTypeInfo[]; errors: string[]; cycles: string[][] } {
  const result: {
    types: TransitiveTypeInfo[];
    errors: string[];
    cycles: string[][];
  } = {
    types: [],
    errors: [],
    cycles: [],
  };

  if (!options.transitive) {
    return result;
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const derivationOrder: TransitiveTypeInfo[] = [];

  function analyze(typeName: string, depth: number): boolean {
    if (depth > (options.maxDepth ?? 10)) {
      result.errors.push(`Max derivation depth exceeded for '${typeName}'`);
      return false;
    }

    if (visited.has(typeName)) return true;

    if (visiting.has(typeName)) {
      result.cycles.push([...Array.from(visiting), typeName]);
      return false;
    }

    // Already has instance?
    if (hasPrimitiveOrInstance(typeName, typeclassName)) {
      visited.add(typeName);
      return true;
    }

    // Find type in source file
    const typeNode = findTypeInSourceFile(ctx, typeName);
    if (!typeNode) {
      result.errors.push(
        `Type '${typeName}' not found in current file. ` +
          `Transitive derivation only works for same-file types. ` +
          `Add @derive(${typeclassName}) to '${typeName}' or provide an @instance.`
      );
      return false;
    }

    visiting.add(typeName);

    // Get fields — guard against TypeChecker failures (IDE background processing)
    let type: ts.Type;
    let properties: ts.Symbol[];
    try {
      type = ctx.typeChecker.getTypeAtLocation(typeNode);
      properties = ctx.typeChecker.getPropertiesOfType(type) as ts.Symbol[];
    } catch {
      result.errors.push(`TypeChecker could not resolve type '${typeName}' (IDE background)`);
      visiting.delete(typeName);
      return false;
    }

    const fields: DeriveFieldInfo[] = [];
    let allOk = true;

    for (const prop of properties) {
      if (!prop) continue;
      const decls = prop.getDeclarations();
      if (!decls || decls.length === 0) continue;

      let propType: ts.Type;
      let propTypeString: string;
      try {
        const decl = decls[0];
        propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, decl);
        propTypeString = ctx.typeChecker.typeToString(propType);
      } catch {
        continue;
      }

      const baseTypeName = normalizeTypeNameForLookup(propTypeString);

      if (!analyze(baseTypeName, depth + 1)) {
        allOk = false;
      }

      fields.push({
        name: prop.name,
        typeString: propTypeString,
        type: propType,
        optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
        readonly: false,
      });
    }

    visiting.delete(typeName);

    if (allOk) {
      visited.add(typeName);
      derivationOrder.push({ typeName, fields, node: typeNode });
      return true;
    }

    return false;
  }

  analyze(rootTypeName, 0);
  result.types = derivationOrder;
  return result;
}

/**
 * Execute transitive derivation, generating instances for all types in the plan.
 */
function executeTransitiveDerivation(
  ctx: MacroContext,
  typeclassName: string,
  plan: { types: TransitiveTypeInfo[]; errors: string[]; cycles: string[][] }
): ts.Statement[] {
  const statements: ts.Statement[] = [];
  const derivation = builtinDerivations[typeclassName];

  if (!derivation) return statements;

  for (const typeInfo of plan.types) {
    // Skip if already has instance (explicit override)
    if (
      instanceRegistry.some(
        (i) => i.typeclassName === typeclassName && i.forType === typeInfo.typeName
      )
    ) {
      continue;
    }

    // Generate instance
    let code = derivation.deriveProduct(typeInfo.typeName, typeInfo.fields);

    // Strip runtime registration calls unless the typeclass is locally defined
    // AND exported. Imported typeclasses don't have .registerInstance() in scope.
    const currentFile = ctx.sourceFile.fileName;
    const isLocallyDefined = globalResolutionScope
      .getScope(currentFile)
      .definedTypeclasses.has(typeclassName);
    const tcInfo = typeclassRegistry.get(typeclassName);
    if (!isLocallyDefined || !tcInfo?.isExported) {
      code = stripRuntimeRegistration(code);
    }

    statements.push(...ctx.parseStatements(code));

    // Register in compile-time registry (always needed for summon/implicit resolution)
    const varName = instanceVarName(uncapitalize(typeclassName), typeInfo.typeName);
    instanceRegistry.push({
      typeclassName,
      forType: typeInfo.typeName,
      instanceName: varName,
      derived: true,
    });

    // Bridge to specialization registry for zero-cost inlining at call sites
    const specMethods = getSpecializationMethodsForDerivation(
      typeclassName,
      typeInfo.typeName,
      typeInfo.fields
    );
    if (specMethods && Object.keys(specMethods).length > 0) {
      const methodsMap = new Map<string, { source?: string; params: string[] }>();
      for (const [name, impl] of Object.entries(specMethods)) {
        methodsMap.set(name, { source: impl.source, params: impl.params });
      }
      registerInstanceMethodsFromAST(varName, typeInfo.typeName, methodsMap);
    }

    // Notify coverage system
    notifyPrimitiveRegistered(typeInfo.typeName, typeclassName);
  }

  return statements;
}

// ============================================================================
// Instance Registry - Tracks typeclass instances at compile time
// ============================================================================

interface TypeclassInfo {
  /** Name of the typeclass (e.g., "Show", "Eq") */
  name: string;
  /** Type parameter name (e.g., "A" in Show<A>) */
  typeParam: string;
  /** Methods defined by the typeclass */
  methods: TypeclassMethod[];
  /** Whether this typeclass supports auto-derivation for products */
  canDeriveProduct: boolean;
  /** Whether this typeclass supports auto-derivation for sums */
  canDeriveSum: boolean;
  /**
   * Full interface body text for HKT expansion.
   * Used to dynamically generate concrete types by substituting Kind<F, A> → ConcreteType<A>.
   */
  fullSignatureText?: string;
  /**
   * Operator syntax mappings: operator string -> method name.
   * Built automatically from methods annotated with `@op` JSDoc tags.
   */
  syntax?: Map<string, string>;
  /**
   * Whether the typeclass interface is exported.
   * If true, runtime registry is emitted for external consumers.
   * If false, only compile-time resolution is used (zero-cost).
   */
  isExported?: boolean;
}

interface TypeclassMethod {
  name: string;
  /** Parameters (excluding the typeclass's type param, which is the "self") */
  params: Array<{ name: string; typeString: string }>;
  /** Return type as string */
  returnType: string;
  /** Whether the first parameter is the "self" type (for extension methods) */
  isSelfMethod: boolean;
  /** Operator symbol declared via `@op` JSDoc tag, if any. */
  operatorSymbol?: string;
}

interface InstanceInfo {
  /** Typeclass name */
  typeclassName: string;
  /** Concrete type this instance is for */
  forType: string;
  /** Variable name holding the instance */
  instanceName: string;
  /** Whether this was auto-derived */
  derived: boolean;
  /**
   * Module specifier where the instance variable is exported.
   * Used by the transformer to inject imports when operator rewriting
   * references an instance from another module.
   */
  sourceModule?: string;
  /**
   * Optional metadata for macro-specific use.
   * Used by comprehension macros (let:/yield:, par:/yield:) to store:
   * - methodNames: Override method names (e.g., Promise uses "then" instead of "flatMap")
   * - builder: Zero-cost AST builder function for par:/yield:
   */
  meta?: InstanceMeta;
}

/**
 * Metadata associated with a typeclass instance for macro use.
 * Allows comprehension macros to access type-specific information
 * without maintaining separate registries.
 */
interface InstanceMeta {
  /**
   * Override method names for this instance.
   * E.g., Promise uses { bind: "then", map: "then", orElse: "catch" }
   */
  methodNames?: {
    bind?: string;
    map?: string;
    orElse?: string;
  };
  /**
   * Zero-cost AST builder for par:/yield: macro.
   * If provided, generates optimized code instead of generic .map()/.ap() chains.
   * Stored as a reference to a builder function registered elsewhere.
   */
  builderName?: string;
  /**
   * Arbitrary additional metadata.
   */
  [key: string]: unknown;
}

/** Global compile-time registry of typeclasses and instances.
 * Uses globalThis backing to share across ESM/CJS module instances.
 * Without this, `import` (ESM transformer) and `require` (CJS test/runtime)
 * create separate registries and instances registered via CJS are invisible
 * to the ESM transformer's operator overloading pass. */
const _g = globalThis as any;
if (!_g.__typesugar_typeclassRegistry)
  _g.__typesugar_typeclassRegistry = new Map<string, TypeclassInfo>();
if (!_g.__typesugar_instanceRegistry) _g.__typesugar_instanceRegistry = [];
const typeclassRegistry: Map<string, TypeclassInfo> = _g.__typesugar_typeclassRegistry;
const instanceRegistry: InstanceInfo[] = _g.__typesugar_instanceRegistry;

// ============================================================================
// Operator Syntax Lookup — operator → typeclass method mappings
// ============================================================================

interface SyntaxEntry {
  typeclass: string;
  method: string;
}

/**
 * Get all syntax entries for a given operator.
 *
 * This function queries the typeclassRegistry directly, looking up
 * typeclasses that have the given operator in their syntax map.
 * Multiple typeclasses may map the same operator — ambiguity
 * is resolved at the call site by checking which typeclass has an instance
 * for the operand type.
 */
function getSyntaxForOperator(op: string): SyntaxEntry[] | undefined {
  const entries: SyntaxEntry[] = [];

  for (const [tcName, tcInfo] of typeclassRegistry) {
    if (tcInfo.syntax) {
      const method = tcInfo.syntax.get(op);
      if (method) {
        entries.push({ typeclass: tcName, method });
      }
    }
  }

  return entries.length > 0 ? entries : undefined;
}

/**
 * Clear syntax mappings from all typeclasses.
 * For testing only - clears syntax while keeping typeclass definitions.
 */
function clearSyntaxRegistry(): void {
  for (const tc of typeclassRegistry.values()) {
    if (tc.syntax) {
      tc.syntax.clear();
    }
    for (const method of tc.methods) {
      delete method.operatorSymbol;
    }
  }
}

// ============================================================================
// Standard Typeclass Definitions — Registered at Load Time (Zero-Cost)
// ============================================================================
// These are registered when @typesugar/macros loads (at transform time).
// This ensures standard typeclass operators work without runtime registration.

interface StandardTypeclassDef {
  name: string;
  typeParam: string;
  methods: TypeclassMethod[];
  canDeriveProduct: boolean;
  canDeriveSum: boolean;
  syntax: Map<string, string>;
}

const STANDARD_TYPECLASS_DEFS: StandardTypeclassDef[] = [
  {
    name: "Eq",
    typeParam: "A",
    methods: [
      {
        name: "equals",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "boolean",
        isSelfMethod: false,
        operatorSymbol: "===",
      },
      {
        name: "notEquals",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "boolean",
        isSelfMethod: false,
        operatorSymbol: "!==",
      },
    ],
    canDeriveProduct: true,
    canDeriveSum: true,
    syntax: new Map([
      ["===", "equals"],
      ["!==", "notEquals"],
    ]),
  },
  {
    name: "Ord",
    typeParam: "A",
    methods: [
      {
        name: "compare",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "number",
        isSelfMethod: false,
      },
      {
        name: "lessThan",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "boolean",
        isSelfMethod: false,
        operatorSymbol: "<",
      },
      {
        name: "lessThanOrEqual",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "boolean",
        isSelfMethod: false,
        operatorSymbol: "<=",
      },
      {
        name: "greaterThan",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "boolean",
        isSelfMethod: false,
        operatorSymbol: ">",
      },
      {
        name: "greaterThanOrEqual",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "boolean",
        isSelfMethod: false,
        operatorSymbol: ">=",
      },
    ],
    canDeriveProduct: true,
    canDeriveSum: true,
    syntax: new Map([
      ["<", "lessThan"],
      ["<=", "lessThanOrEqual"],
      [">", "greaterThan"],
      [">=", "greaterThanOrEqual"],
    ]),
  },
  {
    name: "Semigroup",
    typeParam: "A",
    methods: [
      {
        name: "combine",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "A",
        isSelfMethod: false,
        operatorSymbol: "+",
      },
    ],
    canDeriveProduct: true,
    canDeriveSum: false,
    syntax: new Map([["+", "combine"]]),
  },
  {
    name: "Monoid",
    typeParam: "A",
    methods: [
      {
        name: "combine",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "A",
        isSelfMethod: false,
        operatorSymbol: "+",
      },
      { name: "empty", params: [], returnType: "A", isSelfMethod: false },
    ],
    canDeriveProduct: true,
    canDeriveSum: false,
    syntax: new Map([["+", "combine"]]),
  },
  {
    name: "Group",
    typeParam: "A",
    methods: [
      {
        name: "combine",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "A",
        isSelfMethod: false,
        operatorSymbol: "+",
      },
      { name: "empty", params: [], returnType: "A", isSelfMethod: false },
      {
        name: "inverse",
        params: [{ name: "a", typeString: "A" }],
        returnType: "A",
        isSelfMethod: false,
      },
    ],
    canDeriveProduct: false,
    canDeriveSum: false,
    syntax: new Map([["+", "combine"]]),
  },
  {
    name: "Numeric",
    typeParam: "A",
    methods: [
      {
        name: "add",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "A",
        isSelfMethod: false,
        operatorSymbol: "+",
      },
      {
        name: "sub",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "A",
        isSelfMethod: false,
        operatorSymbol: "-",
      },
      {
        name: "mul",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "A",
        isSelfMethod: false,
        operatorSymbol: "*",
      },
      {
        name: "div",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "A",
        isSelfMethod: false,
        operatorSymbol: "/",
      },
      {
        name: "pow",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "A",
        isSelfMethod: false,
        operatorSymbol: "**",
      },
    ],
    canDeriveProduct: false,
    canDeriveSum: false,
    syntax: new Map([
      ["+", "add"],
      ["-", "sub"],
      ["*", "mul"],
      ["/", "div"],
      ["**", "pow"],
    ]),
  },
  {
    name: "Integral",
    typeParam: "A",
    methods: [
      {
        name: "div",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "A",
        isSelfMethod: false,
        operatorSymbol: "/",
      },
      {
        name: "mod",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "A",
        isSelfMethod: false,
        operatorSymbol: "%",
      },
    ],
    canDeriveProduct: false,
    canDeriveSum: false,
    syntax: new Map([
      ["/", "div"],
      ["%", "mod"],
    ]),
  },
  {
    name: "Fractional",
    typeParam: "A",
    methods: [
      {
        name: "div",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "A",
        isSelfMethod: false,
        operatorSymbol: "/",
      },
    ],
    canDeriveProduct: false,
    canDeriveSum: false,
    syntax: new Map([["/", "div"]]),
  },

  // PEP-017 Wave 1: New typeclasses for derive unification

  {
    name: "Clone",
    typeParam: "A",
    methods: [
      {
        name: "clone",
        params: [{ name: "a", typeString: "A" }],
        returnType: "A",
        isSelfMethod: false,
      },
    ],
    canDeriveProduct: true,
    canDeriveSum: true,
    syntax: new Map(),
  },
  {
    name: "Debug",
    typeParam: "A",
    methods: [
      {
        name: "debug",
        params: [{ name: "a", typeString: "A" }],
        returnType: "string",
        isSelfMethod: false,
      },
    ],
    canDeriveProduct: true,
    canDeriveSum: true,
    syntax: new Map(),
  },
  {
    name: "Default",
    typeParam: "A",
    methods: [
      {
        name: "default",
        params: [],
        returnType: "A",
        isSelfMethod: false,
      },
    ],
    canDeriveProduct: true,
    canDeriveSum: false,
    syntax: new Map(),
  },
  {
    name: "Json",
    typeParam: "A",
    methods: [
      {
        name: "toJson",
        params: [{ name: "a", typeString: "A" }],
        returnType: "unknown",
        isSelfMethod: false,
      },
      {
        name: "fromJson",
        params: [{ name: "json", typeString: "unknown" }],
        returnType: "A",
        isSelfMethod: false,
      },
    ],
    canDeriveProduct: true,
    canDeriveSum: true,
    syntax: new Map(),
  },
  {
    name: "TypeGuard",
    typeParam: "A",
    methods: [
      {
        name: "is",
        params: [{ name: "value", typeString: "unknown" }],
        returnType: "boolean",
        isSelfMethod: false,
      },
    ],
    canDeriveProduct: true,
    canDeriveSum: true,
    syntax: new Map(),
  },
];

// Register standard typeclasses on module load (transform time, not runtime)
for (const def of STANDARD_TYPECLASS_DEFS) {
  typeclassRegistry.set(def.name, def);
}

/**
 * Extract an operator symbol from a JSDoc `@op` tag on a method signature.
 *
 * @param member - The method signature node to check
 * @returns The operator symbol if a valid @op tag is found, undefined otherwise
 *
 * @example
 * ```typescript
 * interface Eq<A> {
 *   /** @op === *\/
 *   eq(a: A, b: A): boolean;
 * }
 * ```
 */
export function extractOpFromJSDoc(member: ts.Node): string | undefined {
  const tags = ts.getJSDocTags(member);
  for (const tag of tags) {
    if (tag.tagName.text === "op") {
      const comment =
        typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);

      const trimmed = comment?.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

/**
 * Get a copy of the typeclass registry.
 * Returns a new Map so mutations don't affect the internal registry.
 */
export function getTypeclasses(): Map<string, TypeclassInfo> {
  return new Map(typeclassRegistry);
}

/**
 * Get a copy of the instance registry as a Map keyed by "Typeclass<Type>".
 * Returns a new Map so mutations don't affect the internal registry.
 */
export function getInstances(): Map<string, InstanceInfo> {
  const map = new Map<string, InstanceInfo>();
  for (const inst of instanceRegistry) {
    map.set(`${inst.typeclassName}<${inst.forType}>`, inst);
  }
  return map;
}

/**
 * Re-register standard typeclass definitions.
 * Called to restore standard typeclasses after clearRegistries().
 */
export function registerStandardTypeclasses(): void {
  for (const def of STANDARD_TYPECLASS_DEFS) {
    typeclassRegistry.set(def.name, def);
  }
}

/**
 * Clear all typeclass-related registries.
 * Useful for testing to ensure clean state between tests.
 *
 * Note: This DOES clear standard typeclasses. Call registerStandardTypeclasses()
 * if you need them restored.
 */
export function clearRegistries(): void {
  typeclassRegistry.clear();
  instanceRegistry.length = 0;
}

// ============================================================================
// Helpers
// ============================================================================

function uncapitalize(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Generate the variable name for a typeclass instance.
 *
 * INTENTIONALLY UNHYGIENIC: Instance names like `showPoint`, `eqNumber` are part of
 * the public API. Users import and use these names directly.
 */
function instanceVarName(tcName: string, typeName: string): string {
  return `${uncapitalize(tcName)}${capitalize(typeName)}`;
}

/**
 * Strip runtime registration calls from generated derivation code.
 * Used when the typeclass is not exported (internal = zero-cost, no runtime registry).
 *
 * Matches patterns like:
 *   /\*#__PURE__*\/ Show.registerInstance<Point>("Point", showPoint);
 */
function stripRuntimeRegistration(code: string): string {
  return code.replace(/\/\*#__PURE__\*\/\s*\w+\.registerInstance<[^>]+>\([^)]+\);\s*\n?/g, "");
}

/**
 * Get method implementations for specialization based on derived typeclass.
 * Returns source strings suitable for registration with the specialization system.
 */
export function getSpecializationMethodsForDerivation(
  tcName: string,
  typeName: string,
  fields: DeriveFieldInfo[]
): Record<string, { source: string; params: string[] }> | undefined {
  switch (tcName) {
    case "Functor": {
      // For derived Functor, map applies to all fields that contain the type parameter
      // This is a simplified version; real implementation would need type analysis
      return {
        map: {
          source: `(fa, f) => ({ ...fa })`,
          params: ["fa", "f"],
        },
      };
    }

    case "Eq": {
      const checks = fields.map((f) => `a.${f.name} === b.${f.name}`).join(" && ");
      return {
        equals: {
          source: `(a, b) => ${checks || "true"}`,
          params: ["a", "b"],
        },
        notEquals: {
          source: `(a, b) => !(${checks || "true"})`,
          params: ["a", "b"],
        },
      };
    }

    case "Show": {
      const fieldStrs = fields.map((f) => `\${a.${f.name}}`).join(", ");
      return {
        show: {
          source: `(a) => \`${typeName}(${fieldStrs})\``,
          params: ["a"],
        },
      };
    }

    case "Hash": {
      // Simple hash implementation for specialization
      const hashCode = fields
        .map(
          (f, i) =>
            `((h << 5) - h + (typeof a.${f.name} === 'number' ? a.${f.name} : String(a.${f.name}).length))`
        )
        .join(", ");
      return {
        hash: {
          source: `(a) => { let h = 5381; ${fields.map((f) => `h = ((h << 5) - h) + (typeof a.${f.name} === 'number' ? a.${f.name} : String(a.${f.name}).length)`).join("; ")}; return h >>> 0; }`,
          params: ["a"],
        },
      };
    }

    case "Ord": {
      // Simple comparison: compare fields in order
      const comparisons = fields.map((f, i) => {
        const isLast = i === fields.length - 1;
        return `(a.${f.name} < b.${f.name} ? -1 : a.${f.name} > b.${f.name} ? 1 : ${isLast ? "0" : ""})`;
      });
      const body =
        comparisons.length > 0
          ? comparisons.reduce((acc, c, i) =>
              i === 0 ? c.replace(/ : $/, "") : `(${acc.replace(/ : $/, "")} || ${c})`
            )
          : "0";
      return {
        compare: {
          source: `(a, b) => ${body}`,
          params: ["a", "b"],
        },
      };
    }

    case "Semigroup": {
      // Semigroup combine: combine each field
      const combines = fields.map((f) => `${f.name}: a.${f.name} + b.${f.name}`).join(", ");
      return {
        combine: {
          source: `(a, b) => ({ ${combines} })`,
          params: ["a", "b"],
        },
      };
    }

    case "Monoid": {
      // Monoid needs empty and combine
      const empties = fields
        .map((f) => {
          const baseType = getBaseType(f);
          const emptyVal =
            baseType === "number"
              ? "0"
              : baseType === "string"
                ? '""'
                : baseType === "boolean"
                  ? "false"
                  : "null";
          return `${f.name}: ${emptyVal}`;
        })
        .join(", ");
      const combines = fields.map((f) => `${f.name}: a.${f.name} + b.${f.name}`).join(", ");
      return {
        empty: {
          source: `() => ({ ${empties} })`,
          params: [],
        },
        combine: {
          source: `(a, b) => ({ ${combines} })`,
          params: ["a", "b"],
        },
      };
    }

    case "Clone": {
      const copies = fields.map((f) => `${f.name}: a.${f.name}`).join(", ");
      return {
        clone: {
          source: `(a) => ({ ${copies} })`,
          params: ["a"],
        },
      };
    }

    case "Debug": {
      const fieldStrs = fields.map((f) => `${f.name}: \${JSON.stringify(a.${f.name})}`).join(", ");
      return {
        debug: {
          source: `(a) => \`${typeName} { ${fieldStrs} }\``,
          params: ["a"],
        },
      };
    }

    case "Default": {
      const defaults = fields
        .map((f) => {
          const baseType = getBaseType(f);
          const val =
            baseType === "number"
              ? "0"
              : baseType === "string"
                ? '""'
                : baseType === "boolean"
                  ? "false"
                  : "{}";
          return `${f.name}: ${f.optional ? "undefined" : val}`;
        })
        .join(", ");
      return {
        default: {
          source: `() => ({ ${defaults} })`,
          params: [],
        },
      };
    }

    case "Json": {
      const toJsonFields = fields.map((f) => `${f.name}: a.${f.name}`).join(", ");
      return {
        toJson: {
          source: `(a) => ({ ${toJsonFields} })`,
          params: ["a"],
        },
        fromJson: {
          source: `(json) => json`,
          params: ["json"],
        },
      };
    }

    case "TypeGuard": {
      const checks = fields.map((f) => {
        const baseType = getBaseType(f);
        const check = `typeof (value as any).${f.name} === "${baseType}"`;
        return f.optional ? `((value as any).${f.name} === undefined || ${check})` : check;
      });
      const body =
        checks.length > 0
          ? `typeof value === "object" && value !== null && ${checks.join(" && ")}`
          : `typeof value === "object" && value !== null`;
      return {
        is: {
          source: `(value) => ${body}`,
          params: ["value"],
        },
      };
    }

    default:
      return undefined;
  }
}

function getBaseType(field: DeriveFieldInfo): string {
  const typeStr = field.typeString.trim();
  const lower = typeStr.toLowerCase();

  // Exact primitive matches (case-insensitive)
  if (lower === "number" || lower === "bigint") return "number";
  if (lower === "string") return "string";
  if (lower === "boolean") return "boolean";

  // Array patterns: Array<T>, T[], ReadonlyArray<T>
  if (lower.startsWith("array<") || lower.startsWith("readonlyarray<") || typeStr.endsWith("[]")) {
    return "array";
  }

  // Union types containing primitives (e.g., "string | null", "number | undefined")
  // Only match if it's a simple union with a primitive, not a complex generic
  if (typeStr.includes("|") && !typeStr.includes("<")) {
    const parts = typeStr.split("|").map((p) => p.trim().toLowerCase());
    if (parts.some((p) => p === "number" || p === "bigint")) return "number";
    if (parts.some((p) => p === "string")) return "string";
    if (parts.some((p) => p === "boolean")) return "boolean";
  }

  return "object";
}

/**
 * Find a registered instance for a given typeclass and type.
 *
 * When sourceFileName is provided, the instance is only returned if the
 * typeclass is in scope for that file (import-scoped resolution).
 */
function findInstance(
  tcName: string,
  typeName: string,
  sourceFileName?: string
): InstanceInfo | undefined {
  if (sourceFileName && !globalResolutionScope.isTypeclassInScope(sourceFileName, tcName)) {
    return undefined;
  }
  return instanceRegistry.find((i) => i.typeclassName === tcName && i.forType === typeName);
}

/**
 * Get the typeclass info for a given name.
 */
function getTypeclass(name: string): TypeclassInfo | undefined {
  return typeclassRegistry.get(name);
}

// ============================================================================
// @typeclass - Attribute Macro
// ============================================================================
// Transforms an interface into a typeclass definition.
//
// Input:
//   @typeclass
//   interface Show<A> {
//     show(a: A): string;
//   }
//
// Output:
//   interface Show<A> {
//     show(a: A): string;
//   }
//   namespace Show {
//     export function summon<A>(instances: Record<string, any>): Show<A> { ... }
//   }
//   // + registers typeclass metadata for derivation
// ============================================================================

export const typeclassAttribute = defineAttributeMacro({
  name: "typeclass",
  module: "@typesugar/typeclass",
  cacheable: false,
  description: "Define a typeclass from an interface, enabling derivation and extension methods",
  validTargets: ["interface"],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    _args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    if (!ts.isInterfaceDeclaration(target)) {
      ctx.reportError(target, "@typeclass can only be applied to interfaces");
      return target;
    }

    const tcName = target.name.text;
    const typeParams = target.typeParameters;

    if (!typeParams || typeParams.length === 0) {
      ctx.reportError(
        target,
        "@typeclass interface must have at least one type parameter (e.g., interface Show<A>)"
      );
      return target;
    }

    const typeParam = typeParams[0].name.text;

    // Extract methods from the interface (handles both MethodSignature and PropertySignature)
    const methods: TypeclassMethod[] = [];
    const memberTexts: string[] = [];

    for (const member of target.members) {
      // Capture raw source text of each member for HKT expansion
      const sourceFile = member.getSourceFile();
      if (sourceFile) {
        const memberText = member.getText(sourceFile);
        memberTexts.push(memberText);
      }

      if (ts.isMethodSignature(member) && member.name) {
        const methodName = ts.isIdentifier(member.name) ? member.name.text : member.name.getText();

        const params: Array<{ name: string; typeString: string }> = [];
        let isSelfMethod = false;

        for (let i = 0; i < member.parameters.length; i++) {
          const param = member.parameters[i];
          const paramName = ts.isIdentifier(param.name) ? param.name.text : param.name.getText();
          const paramType = param.type ? param.type.getText() : "unknown";

          // Check if this parameter uses the typeclass's type param
          if (i === 0 && paramType === typeParam) {
            isSelfMethod = true;
          }

          params.push({ name: paramName, typeString: paramType });
        }

        const operatorSymbol = extractOpFromJSDoc(member);
        const returnType = member.type ? member.type.getText() : "void";

        methods.push({
          name: methodName,
          params,
          returnType,
          isSelfMethod,
          operatorSymbol,
        });
      } else if (ts.isPropertySignature(member) && member.name) {
        const methodName = ts.isIdentifier(member.name) ? member.name.text : member.name.getText();

        methods.push({
          name: methodName,
          params: [],
          returnType: member.type ? member.type.getText() : "unknown",
          isSelfMethod: false,
        });
      }
    }

    // Build the full interface body text for HKT expansion
    const fullSignatureText = memberTexts.length > 0 ? `{ ${memberTexts.join("; ")} }` : undefined;

    // Build syntax map from @op JSDoc tags or Op<> annotations on methods
    const syntax = new Map<string, string>();
    for (const method of methods) {
      if (method.operatorSymbol) {
        syntax.set(method.operatorSymbol, method.name);
      }
    }

    const isExported =
      target.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;

    // Register the typeclass
    const tcInfo: TypeclassInfo = {
      name: tcName,
      typeParam,
      methods,
      canDeriveProduct: true,
      canDeriveSum: true,
      fullSignatureText,
      syntax: syntax.size > 0 ? syntax : undefined,
      isExported,
    };
    typeclassRegistry.set(tcName, tcInfo);

    globalResolutionScope.registerDefinedTypeclass(ctx.sourceFile.fileName, tcName);

    const statements: ts.Statement[] = [];

    // Only generate runtime registry infrastructure for exported typeclasses.
    // Internal typeclasses use compile-time resolution only (zero-cost).
    if (isExported) {
      const companionCode = generateCompanionNamespace(ctx, tcInfo, isExported);
      statements.push(...ctx.parseStatements(companionCode));

      // Generate extension method helpers (only needed when runtime registry exists,
      // as they dispatch through the namespace's summon() method)
      const extensionCode = generateExtensionHelpers(tcInfo);
      statements.push(...ctx.parseStatements(extensionCode));
    }

    return [target, ...statements];
  },
});

/**
 * Generate a companion namespace for a typeclass.
 *
 * Scala 3 equivalent:
 *   object Show {
 *     def summon[A](using tc: Show[A]): Show[A] = tc
 *     def derived[A](using Mirror.ProductOf[A]): Show[A] = ...
 *   }
 */
function generateCompanionNamespace(
  ctx: MacroContext,
  tc: TypeclassInfo,
  isExported: boolean
): string {
  const { name } = tc;
  const registryVar = ctx.hygiene.mangleName(`${uncapitalize(name)}Instances`);
  const exportModifier = isExported ? "export " : "";

  return `
// Typeclass instance registry for ${name}
const ${registryVar}: Map<string, ${name}<any>> = /*#__PURE__*/ new Map();

${exportModifier}namespace ${name} {
  /** Register an instance of ${name} for type T */
  export function registerInstance<T>(typeName: string, instance: ${name}<T>): void {
    ${registryVar}.set(typeName, instance);
  }

  /** Summon (resolve) an instance of ${name} for type T */
  export function summon<T>(typeName: string): ${name}<T> {
    const instance = ${registryVar}.get(typeName);
    if (!instance) {
      throw new Error(\`No ${name} instance found for type '\${typeName}'\`);
    }
    return instance as ${name}<T>;
  }

  /** Check if an instance exists for the given type */
  export function hasInstance(typeName: string): boolean {
    return ${registryVar}.has(typeName);
  }

  /** Get all registered type names */
  export function registeredTypes(): string[] {
    return Array.from(${registryVar}.keys());
  }
}
`;
}

/**
 * Generate extension method helpers for a typeclass.
 *
 * Scala 3 equivalent:
 *   extension [A](a: A)(using tc: Show[A])
 *     def show: String = tc.show(a)
 *
 * In TypeScript, we generate functions that look up the instance and call the method:
 *   function show<A>(a: A, typeName: string): string {
 *     return Show.summon<A>(typeName).show(a);
 *   }
 */
function generateExtensionHelpers(tc: TypeclassInfo): string {
  const { name, methods } = tc;
  const extensionFns: string[] = [];

  for (const method of methods) {
    if (method.isSelfMethod) {
      // This is a "self" method - generate an extension function
      const otherParams = method.params.slice(1);
      const otherParamDecls = otherParams.map((p) => `${p.name}: ${p.typeString}`).join(", ");
      const otherParamNames = otherParams.map((p) => p.name).join(", ");
      const allArgs = ["self", ...otherParams.map((p) => p.name)].join(", ");

      const paramList = otherParamDecls
        ? `self: any, ${otherParamDecls}, typeName: string`
        : `self: any, typeName: string`;

      extensionFns.push(`
/** Extension method: ${method.name} via ${name} typeclass */
function ${uncapitalize(name)}${capitalize(method.name)}<A>(${paramList}): ${method.returnType} {
  return ${name}.summon<A>(typeName).${method.name}(${allArgs});
}
`);
    }
  }

  return extensionFns.join("\n");
}

// ============================================================================
// @instance - Attribute Macro
// ============================================================================
// Registers a typeclass instance for a specific type.
//
// Supports multiple syntaxes:
//
// 1. Simple type (original):
//    @instance("number")
//    const showNumber: Show<number> = { show: (a) => String(a) };
//
// 2. Typeclass<Type> string (RECOMMENDED for HKT):
//    @instance("Monad<Option>")
//    const optionMonad = { pure: ..., flatMap: ... };
//
// 3. Two identifiers (Scala-like):
//    @instance(Monad, Option)
//    const optionMonad = { pure: ..., flatMap: ... };
//
//    CAVEAT: The identifier form requires `Monad` and `Option` to be
//    runtime values in scope (e.g., namespace names or string constants).
//    The string form @instance("Monad<Option>") is recommended as it
//    works purely at compile-time without runtime dependencies.
//
// For HKT typeclasses (Functor, Monad, etc.), the macro automatically
// generates the concrete expanded type annotation to avoid TypeScript's
// "Type instantiation is excessively deep" error.
//
// HKT (Higher-Kinded Types) is a feature of the typeclass system that
// enables typeclasses parameterized by type constructors (F[_]) rather
// than simple types. Examples: Functor<F>, Monad<F>, Traverse<F>.
// ============================================================================

/**
 * Attribute macro to register a typeclass instance.
 *
 * Preferred JSDoc syntax (no preprocessor needed):
 *   /** @impl Eq<Point> *\/
 *   export const pointEq: Eq<Point> = { ... };
 *
 * Legacy decorator syntax (requires preprocessor):
 *   @impl("Eq<Point>")
 *   export const pointEq: Eq<Point> = { ... };
 */
export const implAttribute = defineAttributeMacro({
  name: "impl",
  module: "@typesugar/typeclass",
  cacheable: false,
  description: "Register a typeclass instance for a specific type",
  validTargets: ["property", "class"],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    const factory = ctx.factory;

    if (args.length === 0) {
      ctx.reportError(
        target,
        '@impl requires arguments: @impl("Type"), @impl("Typeclass<Type>"), or @impl(Typeclass, Type)'
      );
      return target;
    }

    // Parse the arguments to extract typeclass name and type name
    let tcName: string | undefined;
    let typeName: string | undefined;
    let isHKTInstance = false;

    const firstArg = args[0];

    if (ts.isStringLiteral(firstArg)) {
      const text = firstArg.text;

      // Check for "Typeclass<Type>" format using bracket-aware parser
      const parsed = parseTypeclassInstantiation(text);
      if (parsed) {
        tcName = parsed.typeclassName;
        typeName = parsed.forType;
        isHKTInstance = isHKTTypeclass(tcName);
      } else {
        // Simple type name - typeclass comes from type annotation
        typeName = text;
      }
    } else if (ts.isIdentifier(firstArg)) {
      // @instance(Typeclass, Type) format
      if (args.length < 2) {
        ctx.reportError(
          firstArg,
          "@instance with identifier requires two arguments: @instance(Typeclass, Type)"
        );
        return target;
      }

      tcName = firstArg.text;

      const secondArg = args[1];
      if (ts.isIdentifier(secondArg)) {
        typeName = secondArg.text;
      } else if (ts.isStringLiteral(secondArg)) {
        typeName = secondArg.text;
      } else {
        ctx.reportError(secondArg, "Second argument must be an identifier or string");
        return target;
      }

      isHKTInstance = isHKTTypeclass(tcName);
    } else {
      ctx.reportError(firstArg, "@instance argument must be a string or identifier");
      return target;
    }

    // Get variable name from the declaration
    let varName: string | undefined;
    let decl: ts.VariableDeclaration | undefined;

    if (ts.isVariableStatement(target)) {
      decl = target.declarationList.declarations[0];
      if (decl && ts.isIdentifier(decl.name)) {
        varName = decl.name.text;
      }
    } else if (ts.isVariableDeclaration(target)) {
      decl = target;
      if (ts.isIdentifier(target.name)) {
        varName = target.name.text;
      }
    }

    // If typeclass wasn't in args, try to get from type annotation
    if (!tcName && decl?.type && ts.isTypeReferenceNode(decl.type)) {
      tcName = decl.type.typeName.getText();
    }

    if (!tcName || !typeName || !varName) {
      ctx.reportError(
        target,
        '@instance: could not determine typeclass and type. Use @instance("Typeclass<Type>") or @instance(Typeclass, Type)'
      );
      return target;
    }

    // For HKT typeclasses, try implicit resolution then generate expanded type
    let updatedTarget: ts.Node = target;
    if (isHKTInstance && decl) {
      // Tier 1 implicit resolution: if typeName isn't a known type function,
      // try to resolve it via TypeChecker and auto-register
      const { base: resolvedBase } = parseTypeConstructor(typeName);
      if (!hktExpansionRegistry.has(typeName) && !hktExpansionRegistry.has(resolvedBase)) {
        const resolution = resolveTypeConstructorViaTypeChecker(ctx, typeName);
        if (resolution) {
          // Auto-register the base type as an HKT expansion
          registerHKTExpansion(resolution.baseType, resolution.baseType);
        } else {
          ctx.diagnostic(TS9305).at(target).withArgs({ type: typeName }).emit();
        }
      }

      const expandedType = generateHKTExpandedType(ctx, tcName, typeName);
      if (expandedType) {
        const newDecl = factory.updateVariableDeclaration(
          decl,
          decl.name,
          decl.exclamationToken,
          expandedType,
          decl.initializer
        );

        if (ts.isVariableStatement(target)) {
          const newDeclList = factory.updateVariableDeclarationList(target.declarationList, [
            newDecl,
          ]);
          updatedTarget = factory.updateVariableStatement(target, target.modifiers, newDeclList);
        } else {
          updatedTarget = newDecl;
        }
      }
    }

    // Register in our compile-time registry
    instanceRegistry.push({
      typeclassName: tcName,
      forType: typeName,
      instanceName: varName,
      derived: false,
    });

    // Notify coverage system that this type has an instance
    notifyPrimitiveRegistered(typeName, tcName);

    // Bridge to specialization registry: extract methods from the object literal
    // and register them for zero-cost specialization
    let objLiteral: ts.ObjectLiteralExpression | undefined;
    if (ts.isVariableStatement(updatedTarget)) {
      const d = (updatedTarget as ts.VariableStatement).declarationList.declarations[0];
      if (d?.initializer && ts.isObjectLiteralExpression(d.initializer)) {
        objLiteral = d.initializer;
      }
    } else if (ts.isVariableDeclaration(updatedTarget)) {
      if (
        (updatedTarget as ts.VariableDeclaration).initializer &&
        ts.isObjectLiteralExpression((updatedTarget as ts.VariableDeclaration).initializer!)
      ) {
        objLiteral = (updatedTarget as ts.VariableDeclaration)
          .initializer as ts.ObjectLiteralExpression;
      }
    }

    if (objLiteral) {
      const methods = extractMethodsFromObjectLiteral(objLiteral, ctx.hygiene);
      if (methods.size > 0) {
        registerInstanceMethodsFromAST(varName, typeName, methods);
      }
    }

    // Only emit runtime registration for exported typeclasses.
    // Internal typeclasses use compile-time resolution only (zero-cost).
    const tcInfo = typeclassRegistry.get(tcName);
    if (tcInfo?.isExported) {
      const registrationStatements = quoteStatements(
        ctx
      )`/*#__PURE__*/ ${tcName}.registerInstance<${typeName}>("${typeName}", ${varName});`;
      return [updatedTarget, ...registrationStatements];
    }

    // No runtime registration needed - compile-time registry is sufficient
    return updatedTarget;
  },
});

// ============================================================================
// HKT Support for Typeclass Instances
// ============================================================================
// Higher-Kinded Types (HKT) allow typeclasses to be parameterized by type
// constructors (like Option, Array, Promise) rather than concrete types.
//
// This is essential for typeclasses like Functor, Monad, Traverse that
// abstract over container types.
//
// The challenge: TypeScript's type system can't directly express HKT, so we
// use an encoding (Kind<F, A>) that triggers "Type instantiation is excessively
// deep" errors. The solution is to expand HKT types to concrete forms at
// compile time.
// ============================================================================

/**
 * Set of typeclass names that use Higher-Kinded Types.
 * These require special handling to avoid TypeScript's recursion limits.
 */
export const hktTypeclassNames = new Set<string>([
  "Functor",
  "Apply",
  "Applicative",
  "FlatMap",
  "Monad",
  "MonadError",
  "Foldable",
  "Traverse",
  "SemigroupK",
  "MonoidK",
  "Alternative",
  "Contravariant",
  "Invariant",
  "Bifunctor",
  "Profunctor",
]);

/**
 * Registry mapping HKT type constructor names to their concrete expansions.
 * E.g., "OptionF" → "Option", "ArrayF" → "Array"
 */
export const hktExpansionRegistry = new Map<string, string>([
  // Standard mappings - users can register more
  ["Option", "Option"],
  ["OptionF", "Option"],
  ["Array", "Array"],
  ["ArrayF", "Array"],
  ["Promise", "Promise"],
  ["PromiseF", "Promise"],
  ["List", "List"],
  ["ListF", "List"],
  ["IO", "IO"],
  ["IOF", "IO"],
  ["Id", "Id"],
  ["IdF", "Id"],
]);

/**
 * Check if a typeclass uses HKT.
 */
function isHKTTypeclass(name: string): boolean {
  return hktTypeclassNames.has(name);
}

/**
 * Register a typeclass as using HKT.
 */
export function registerHKTTypeclass(name: string): void {
  hktTypeclassNames.add(name);
}

/**
 * Register an HKT type constructor expansion.
 * @param hktName - The type constructor name (e.g., "OptionF" or "Option")
 * @param concreteName - The concrete type name (e.g., "Option")
 */
export function registerHKTExpansion(hktName: string, concreteName: string): void {
  hktExpansionRegistry.set(hktName, concreteName);
}

/**
 * Get the concrete type for an HKT type constructor.
 */
function getHKTExpansion(hktName: string): string {
  return hktExpansionRegistry.get(hktName) ?? hktName;
}

/**
 * Generate an expanded concrete type for an HKT typeclass instance.
 *
 * For example, Monad<Option> expands to:
 * {
 *   readonly map: <A, B>(fa: Option<A>, f: (a: A) => B) => Option<B>;
 *   readonly flatMap: <A, B>(fa: Option<A>, f: (a: A) => Option<B>) => Option<B>;
 *   readonly pure: <A>(a: A) => Option<A>;
 *   readonly ap: <A, B>(fab: Option<(a: A) => B>, fa: Option<A>) => Option<B>;
 * }
 *
 * Uses dynamic textual substitution if the typeclass was registered via @typeclass
 * (i.e., has fullSignatureText). Falls back to hardcoded templates for typeclasses
 * like cats that are plain interfaces.
 */
function generateHKTExpandedType(
  ctx: MacroContext,
  typeclassName: string,
  hktParam: string
): ts.TypeNode | undefined {
  // Handle partial application: "Either<string>" → base="Either", fixedArgs=["string"]
  const { base, fixedArgs } = parseTypeConstructor(hktParam);

  // Resolve the expansion: try the full param first, then the base type
  let expansion = hktExpansionRegistry.has(hktParam)
    ? getHKTExpansion(hktParam)
    : getHKTExpansion(base);

  // For partial application, the expansion substitution needs to include fixed args.
  // e.g., Kind<F, A> → Either<string, A> instead of Either<A>
  const expansionWithFixedArgs =
    fixedArgs.length > 0 ? `${expansion}<${fixedArgs.join(", ")}, $1>` : `${expansion}<$1>`;

  const tcInfo = typeclassRegistry.get(typeclassName);
  let signature: string | undefined;

  if (tcInfo?.fullSignatureText) {
    if (fixedArgs.length > 0) {
      signature = expandHKTInSignatureWithPartialApp(
        tcInfo.fullSignatureText,
        tcInfo.typeParam,
        expansion,
        fixedArgs
      );
    } else {
      signature = expandHKTInSignature(tcInfo.fullSignatureText, tcInfo.typeParam, expansion);
    }
  } else {
    if (fixedArgs.length > 0) {
      signature = getTypeclassSignatureTemplate(typeclassName, expansion, fixedArgs);
    } else {
      signature = getTypeclassSignatureTemplate(typeclassName, expansion);
    }
  }

  if (!signature) return undefined;

  try {
    // SAFE: __T is only used for parsing, never emitted into generated code.
    const tempSource = `type __T = ${signature};`;
    const tempFile = ts.createSourceFile("__temp.ts", tempSource, ts.ScriptTarget.Latest, true);

    for (const stmt of tempFile.statements) {
      if (ts.isTypeAliasDeclaration(stmt)) {
        return stmt.type;
      }
    }
  } catch {
    // Fall back to no type annotation
  }

  return undefined;
}

/**
 * Expand HKT patterns in a type signature string.
 * Replaces Kind<F, X> with ConcreteType<X> throughout.
 */
function expandHKTInSignature(signatureText: string, typeParam: string, expansion: string): string {
  // Match Kind<TypeParam, ...> and replace with Expansion<...>
  // Handle nested type parameters gracefully
  const pattern = new RegExp(`\\Kind<${typeParam},\\s*([^<>]+(?:<[^>]+>)?)>`, "g");

  let result = signatureText;
  let prevResult = "";

  // Keep replacing until no more changes (handles nested cases)
  while (result !== prevResult) {
    prevResult = result;
    result = result.replace(pattern, `${expansion}<$1>`);
  }

  return result;
}

/**
 * Expand HKT patterns with partial application.
 * For "Either<string>": Kind<F, A> → Either<string, A>
 */
function expandHKTInSignatureWithPartialApp(
  signatureText: string,
  typeParam: string,
  expansion: string,
  fixedArgs: string[]
): string {
  const fixedPrefix = fixedArgs.join(", ");
  const pattern = new RegExp(`\\Kind<${typeParam},\\s*([^<>]+(?:<[^>]+>)?)>`, "g");

  let result = signatureText;
  let prevResult = "";

  while (result !== prevResult) {
    prevResult = result;
    result = result.replace(pattern, `${expansion}<${fixedPrefix}, $1>`);
  }

  return result;
}

/**
 * Get the concrete type signature template for a typeclass.
 * Returns a string representation of the expanded type.
 *
 * When fixedArgs is provided, generates partially applied types:
 * e.g., Functor with expansion="Either", fixedArgs=["string"]
 * produces `Either<string, A>` instead of `Either<A>`.
 */
function getTypeclassSignatureTemplate(
  typeclassName: string,
  concreteType: string,
  fixedArgs?: string[]
): string | undefined {
  // Build the type application helper: T(A) → "ConcreteType<...fixedArgs, A>"
  const t = (inner: string): string => {
    if (fixedArgs && fixedArgs.length > 0) {
      return `${concreteType}<${fixedArgs.join(", ")}, ${inner}>`;
    }
    return `${concreteType}<${inner}>`;
  };

  const templates: Record<string, string> = {
    Functor: `{ readonly map: <A, B>(fa: ${t("A")}, f: (a: A) => B) => ${t("B")} }`,

    Applicative: `{
      readonly map: <A, B>(fa: ${t("A")}, f: (a: A) => B) => ${t("B")};
      readonly pure: <A>(a: A) => ${t("A")};
      readonly ap: <A, B>(fab: ${t("(a: A) => B")}, fa: ${t("A")}) => ${t("B")}
    }`,

    Monad: `{
      readonly map: <A, B>(fa: ${t("A")}, f: (a: A) => B) => ${t("B")};
      readonly flatMap: <A, B>(fa: ${t("A")}, f: (a: A) => ${t("B")}) => ${t("B")};
      readonly pure: <A>(a: A) => ${t("A")};
      readonly ap: <A, B>(fab: ${t("(a: A) => B")}, fa: ${t("A")}) => ${t("B")}
    }`,

    Foldable: `{
      readonly foldLeft: <A, B>(fa: ${t("A")}, b: B, f: (b: B, a: A) => B) => B;
      readonly foldRight: <A, B>(fa: ${t("A")}, b: B, f: (a: A, b: B) => B) => B
    }`,

    Traverse: `{
      readonly map: <A, B>(fa: ${t("A")}, f: (a: A) => B) => ${t("B")};
      readonly foldLeft: <A, B>(fa: ${t("A")}, b: B, f: (b: B, a: A) => B) => B;
      readonly foldRight: <A, B>(fa: ${t("A")}, b: B, f: (a: A, b: B) => B) => B;
      readonly traverse: <G>(G: any) => <A, B>(fa: ${t("A")}, f: (a: A) => any) => any
    }`,

    SemigroupK: `{ readonly combineK: <A>(x: ${t("A")}, y: ${t("A")}) => ${t("A")} }`,

    MonoidK: `{
      readonly combineK: <A>(x: ${t("A")}, y: ${t("A")}) => ${t("A")};
      readonly emptyK: <A>() => ${t("A")}
    }`,

    Alternative: `{
      readonly map: <A, B>(fa: ${t("A")}, f: (a: A) => B) => ${t("B")};
      readonly flatMap: <A, B>(fa: ${t("A")}, f: (a: A) => ${t("B")}) => ${t("B")};
      readonly pure: <A>(a: A) => ${t("A")};
      readonly ap: <A, B>(fab: ${t("(a: A) => B")}, fa: ${t("A")}) => ${t("B")};
      readonly combineK: <A>(x: ${t("A")}, y: ${t("A")}) => ${t("A")};
      readonly emptyK: <A>() => ${t("A")}
    }`,
  };

  return templates[typeclassName];
}

// ============================================================================
// @deriving - Derive Macro for Auto-Derivation
// ============================================================================
// Auto-derives typeclass instances for product types (structs) and sum types
// (discriminated unions) following Scala 3 derivation rules.
//
// Product type derivation:
//   If all fields of a product type have instances of TC, then TC can be
//   derived for the product type by combining field instances.
//
// Sum type derivation:
//   If all variants of a sum type have instances of TC, then TC can be
//   derived for the sum type by dispatching on the discriminant.
//
// Input:
//   @deriving(Show, Eq)
//   interface Point {
//     x: number;
//     y: number;
//   }
//
// Output:
//   interface Point { x: number; y: number; }
//   const showPoint: Show<Point> = {
//     show: (a) => `Point(x = ${showNumber.show(a.x)}, y = ${showNumber.show(a.y)})`,
//   };
//   Show.registerInstance<Point>("Point", showPoint);
//   const eqPoint: Eq<Point> = {
//     eq: (a, b) => eqNumber.eq(a.x, b.x) && eqNumber.eq(a.y, b.y),
//   };
//   Eq.registerInstance<Point>("Point", eqPoint);
// ============================================================================

/**
 * Built-in typeclass definitions with their derivation strategies.
 *
 * These define how to auto-derive instances for product and sum types.
 * Each entry specifies:
 * - methods: The typeclass methods to generate
 * - productDerive: How to combine field instances for product types
 * - sumDerive: How to dispatch on variants for sum types
 *
 * For generic types (with type parameters), we generate factory functions
 * instead of constants:
 * - `getEq<A>(E: Eq<A>): Eq<Option<A>>` instead of `const eqOption: Eq<Option>`
 */
interface BuiltinTypeclassDerivation {
  /** Generate instance code for a product type */
  deriveProduct(typeName: string, fields: DeriveFieldInfo[]): string;
  /** Generate instance code for a sum type */
  deriveSum(
    typeName: string,
    discriminant: string,
    variants: Array<{ tag: string; typeName: string }>
  ): string;
  /**
   * Generate factory function for a generic sum type.
   * Returns undefined if not supported, falling back to non-generic derivation.
   */
  deriveGenericSum?(
    typeName: string,
    discriminant: string,
    variants: DeriveVariantInfo[],
    typeParams: ts.TypeParameterDeclaration[]
  ): string | undefined;
}

// ============================================================================
// Generic Type Derivation Helpers
// ============================================================================

/**
 * Get the instance parameter name for a type parameter.
 * E.g., "E" with typeclass "Eq" becomes "EE" (EqE would be confusing)
 *       "A" with typeclass "Eq" becomes "EA"
 */
function getInstanceParamName(tcName: string, typeParamName: string): string {
  // Use first letter of typeclass + type param name for clarity
  // Eq<E> param = EE, Eq<A> param = EA
  return `${tcName.charAt(0)}${typeParamName}`;
}

/**
 * Build the function signature for a generic instance factory.
 * E.g., for Either<E, A> with Eq:
 *   "getEq<E, A>(EE: Eq<E>, EA: Eq<A>): Eq<Either<E, A>>"
 */
function buildGenericFactorySignature(
  tcName: string,
  typeName: string,
  typeParams: ts.TypeParameterDeclaration[]
): { signature: string; paramMap: Map<string, string> } {
  const paramNames = typeParams.map((tp) => tp.name.text);
  const typeParamsStr = paramNames.join(", ");

  // Build instance parameters: EE: Eq<E>, EA: Eq<A>
  const instanceParams: string[] = [];
  const paramMap = new Map<string, string>();

  for (const paramName of paramNames) {
    const instParam = getInstanceParamName(tcName, paramName);
    instanceParams.push(`${instParam}: ${tcName}<${paramName}>`);
    paramMap.set(paramName, instParam);
  }

  const signature = `get${tcName}<${typeParamsStr}>(${instanceParams.join(", ")}): ${tcName}<${typeName}<${typeParamsStr}>>`;

  return { signature, paramMap };
}

/**
 * Get the instance reference for a field in a generic type.
 * If the field type matches a type parameter, use the corresponding instance param.
 * Otherwise, use the standard instance lookup.
 */
function getFieldInstanceRef(
  tcName: string,
  field: DeriveFieldInfo,
  paramMap: Map<string, string>
): string {
  const fieldType = field.typeString.trim();

  // Check if the field type is a type parameter
  const instanceParam = paramMap.get(fieldType);
  if (instanceParam) {
    return instanceParam;
  }

  // Fall back to standard instance lookup
  return instanceVarName(tcName.toLowerCase(), getBaseType(field));
}

const builtinDerivations: Record<string, BuiltinTypeclassDerivation> = {
  Show: {
    deriveProduct(typeName: string, fields: DeriveFieldInfo[]): string {
      const fieldShows = fields
        .map((f) => {
          const inst = instanceVarName("show", getBaseType(f));
          return `${f.name} = \${${inst}.show(a.${f.name})}`;
        })
        .join(", ");

      const varName = instanceVarName("show", typeName);
      return `
const ${varName}: Show<${typeName}> = /*#__PURE__*/ {
  show: (a: ${typeName}): string => \`${typeName}(${fieldShows})\`,
};
/*#__PURE__*/ Show.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },

    deriveSum(
      typeName: string,
      discriminant: string,
      variants: Array<{ tag: string; typeName: string }>
    ): string {
      const varName = instanceVarName("show", typeName);
      const cases = variants
        .map((v) => {
          const inst = instanceVarName("show", v.typeName);
          return `    case "${v.tag}": return ${inst}.show(a as any);`;
        })
        .join("\n");

      return `
const ${varName}: Show<${typeName}> = /*#__PURE__*/ {
  show: (a: ${typeName}): string => {
    switch ((a as any).${discriminant}) {
${cases}
      default: return String(a);
    }
  },
};
/*#__PURE__*/ Show.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },

    deriveGenericSum(
      typeName: string,
      discriminant: string,
      variants: DeriveVariantInfo[],
      typeParams: ts.TypeParameterDeclaration[]
    ): string | undefined {
      const isGeneric = typeParams.length > 0;
      const paramMap: Map<string, string> = isGeneric
        ? buildGenericFactorySignature("Show", typeName, typeParams).paramMap
        : new Map();

      const cases = variants
        .map((v) => {
          const fields = v.fields.filter((f) => f.name !== discriminant);
          if (fields.length === 0) {
            return `      case "${v.tag}": return "${v.tag}";`;
          }
          if (fields.length === 1) {
            const f = fields[0];
            const inst = getFieldInstanceRef("Show", f, paramMap);
            return `      case "${v.tag}": return \`${v.tag}(\${${inst}.show((a as any).${f.name})})\`;`;
          }
          const fieldShows = fields
            .map((f) => {
              const inst = getFieldInstanceRef("Show", f, paramMap);
              return `${f.name} = \${${inst}.show((a as any).${f.name})}`;
            })
            .join(", ");
          return `      case "${v.tag}": return \`${v.tag}(${fieldShows})\`;`;
        })
        .join("\n");

      if (isGeneric) {
        const { signature } = buildGenericFactorySignature("Show", typeName, typeParams);
        const typeParamsStr = typeParams.map((tp) => tp.name.text).join(", ");
        const fullTypeName = `${typeName}<${typeParamsStr}>`;

        return `
export function ${signature} {
  return {
    show: (a: ${fullTypeName}): string => {
      switch ((a as any).${discriminant}) {
${cases}
        default: return String(a);
      }
    },
  };
}
`;
      }

      const varName = instanceVarName("show", typeName);
      return `
const ${varName}: Show<${typeName}> = /*#__PURE__*/ {
  show: (a: ${typeName}): string => {
    switch ((a as any).${discriminant}) {
${cases}
      default: return String(a);
    }
  },
};
/*#__PURE__*/ Show.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },
  },

  Eq: {
    deriveProduct(typeName: string, fields: DeriveFieldInfo[]): string {
      const fieldEqs = fields.map((f) => {
        const inst = instanceVarName("eq", getBaseType(f));
        return `${inst}.equals(a.${f.name}, b.${f.name})`;
      });
      const body = fieldEqs.length > 0 ? fieldEqs.join(" && ") : "true";

      const varName = instanceVarName("eq", typeName);
      return `
const ${varName}: Eq<${typeName}> = /*#__PURE__*/ {
  equals: (a: ${typeName}, b: ${typeName}): boolean => ${body},
  notEquals: (a: ${typeName}, b: ${typeName}): boolean => !(${body}),
};
/*#__PURE__*/ Eq.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },

    deriveSum(
      typeName: string,
      discriminant: string,
      variants: Array<{ tag: string; typeName: string }>
    ): string {
      const varName = instanceVarName("eq", typeName);
      const cases = variants
        .map((v) => {
          const inst = instanceVarName("eq", v.typeName);
          return `    case "${v.tag}": return (b as any).${discriminant} === "${v.tag}" && ${inst}.equals(a as any, b as any);`;
        })
        .join("\n");

      return `
const ${varName}: Eq<${typeName}> = /*#__PURE__*/ {
  equals: (a: ${typeName}, b: ${typeName}): boolean => {
    if ((a as any).${discriminant} !== (b as any).${discriminant}) return false;
    switch ((a as any).${discriminant}) {
${cases}
      default: return false;
    }
  },
  notEquals: (a: ${typeName}, b: ${typeName}): boolean => !${varName}.equals(a, b),
};
/*#__PURE__*/ Eq.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },

    deriveGenericSum(
      typeName: string,
      discriminant: string,
      variants: DeriveVariantInfo[],
      typeParams: ts.TypeParameterDeclaration[]
    ): string | undefined {
      const isGeneric = typeParams.length > 0;
      const paramMap: Map<string, string> = isGeneric
        ? buildGenericFactorySignature("Eq", typeName, typeParams).paramMap
        : new Map();
      const eqMethod = isGeneric ? "eqv" : "equals";

      const cases = variants
        .map((v) => {
          const fieldEqs = v.fields
            .filter((f) => f.name !== discriminant)
            .map((f) => {
              const inst = getFieldInstanceRef("Eq", f, paramMap);
              return `${inst}.${eqMethod}((x as any).${f.name}, (y as any).${f.name})`;
            });
          const body = fieldEqs.length > 0 ? fieldEqs.join(" && ") : "true";
          return `      case "${v.tag}": return ${body};`;
        })
        .join("\n");

      if (isGeneric) {
        const { signature } = buildGenericFactorySignature("Eq", typeName, typeParams);
        const typeParamsStr = typeParams.map((tp) => tp.name.text).join(", ");
        const fullTypeName = `${typeName}<${typeParamsStr}>`;

        return `
export function ${signature} {
  return {
    eqv: (x: ${fullTypeName}, y: ${fullTypeName}): boolean => {
      if ((x as any).${discriminant} !== (y as any).${discriminant}) return false;
      switch ((x as any).${discriminant}) {
${cases}
        default: return false;
      }
    },
  };
}
`;
      }

      const varName = instanceVarName("eq", typeName);
      return `
const ${varName}: Eq<${typeName}> = /*#__PURE__*/ {
  equals: (x: ${typeName}, y: ${typeName}): boolean => {
    if ((x as any).${discriminant} !== (y as any).${discriminant}) return false;
    switch ((x as any).${discriminant}) {
${cases}
      default: return false;
    }
  },
  notEquals: (x: ${typeName}, y: ${typeName}): boolean => !${varName}.equals(x, y),
};
/*#__PURE__*/ Eq.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },
  },

  Ord: {
    deriveProduct(typeName: string, fields: DeriveFieldInfo[]): string {
      const varName = instanceVarName("ord", typeName);
      const fieldComparisons = fields
        .map((f) => {
          const inst = instanceVarName("ord", getBaseType(f));
          return `  { const c = ${inst}.compare(a.${f.name}, b.${f.name}); if (c !== 0) return c; }`;
        })
        .join("\n");

      return `
const ${varName}: Ord<${typeName}> = /*#__PURE__*/ {
  compare: (a: ${typeName}, b: ${typeName}): -1 | 0 | 1 => {
${fieldComparisons}
    return 0;
  },
};
/*#__PURE__*/ Ord.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },

    deriveSum(
      typeName: string,
      discriminant: string,
      variants: Array<{ tag: string; typeName: string }>
    ): string {
      const varName = instanceVarName("ord", typeName);
      const tagOrder = variants.map((v, i) => `"${v.tag}": ${i}`).join(", ");
      const cases = variants
        .map((v) => {
          const inst = instanceVarName("ord", v.typeName);
          return `    case "${v.tag}": return ${inst}.compare(a as any, b as any);`;
        })
        .join("\n");

      return `
const ${varName}: Ord<${typeName}> = /*#__PURE__*/ {
  compare: (a: ${typeName}, b: ${typeName}): -1 | 0 | 1 => {
    const tagOrder: Record<string, number> = { ${tagOrder} };
    const aTag = (a as any).${discriminant};
    const bTag = (b as any).${discriminant};
    if (aTag !== bTag) return aTag < bTag ? -1 : 1;
    switch (aTag) {
${cases}
      default: return 0;
    }
  },
};
/*#__PURE__*/ Ord.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },

    deriveGenericSum(
      typeName: string,
      discriminant: string,
      variants: DeriveVariantInfo[],
      typeParams: ts.TypeParameterDeclaration[]
    ): string | undefined {
      const isGeneric = typeParams.length > 0;
      const paramMap: Map<string, string> = isGeneric
        ? buildGenericFactorySignature("Ord", typeName, typeParams).paramMap
        : new Map();

      const cases = variants
        .map((v) => {
          const fieldComps = v.fields
            .filter((f) => f.name !== discriminant)
            .map((f) => {
              const inst = getFieldInstanceRef("Ord", f, paramMap);
              return `      { const c = ${inst}.compare((x as any).${f.name}, (y as any).${f.name}); if (c !== 0) return c; }`;
            });
          const body =
            fieldComps.length > 0 ? fieldComps.join("\n") + "\n      return 0;" : "return 0;";
          return `      case "${v.tag}":\n${body}`;
        })
        .join("\n");

      const tagOrder = variants.map((v, i) => `"${v.tag}": ${i}`).join(", ");

      if (isGeneric) {
        const { signature } = buildGenericFactorySignature("Ord", typeName, typeParams);
        const typeParamsStr = typeParams.map((tp) => tp.name.text).join(", ");
        const fullTypeName = `${typeName}<${typeParamsStr}>`;
        const eqParams = typeParams
          .map((tp) => getInstanceParamName("Ord", tp.name.text))
          .join(", ");

        return `
export function ${signature} {
  const tagOrder: Record<string, number> = { ${tagOrder} };
  return {
    eqv: getEq(${eqParams}).eqv,
    compare: (x: ${fullTypeName}, y: ${fullTypeName}): Ordering => {
      const xTag = (x as any).${discriminant};
      const yTag = (y as any).${discriminant};
      if (xTag !== yTag) return (tagOrder[xTag] < tagOrder[yTag] ? -1 : 1) as Ordering;
      switch (xTag) {
${cases}
        default: return 0 as Ordering;
      }
    },
  };
}
`;
      }

      const varName = instanceVarName("ord", typeName);
      return `
const ${varName}: Ord<${typeName}> = /*#__PURE__*/ {
  compare: (a: ${typeName}, b: ${typeName}): -1 | 0 | 1 => {
    const tagOrder: Record<string, number> = { ${tagOrder} };
    const aTag = (a as any).${discriminant};
    const bTag = (b as any).${discriminant};
    if (aTag !== bTag) return aTag < bTag ? -1 : 1;
    switch (aTag) {
${cases}
      default: return 0;
    }
  },
};
/*#__PURE__*/ Ord.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },
  },

  Hash: {
    deriveProduct(typeName: string, fields: DeriveFieldInfo[]): string {
      const varName = instanceVarName("hash", typeName);
      const fieldHashes = fields
        .map((f) => {
          const inst = instanceVarName("hash", getBaseType(f));
          return `  hash = ((hash << 5) + hash) ^ ${inst}.hash(a.${f.name});`;
        })
        .join("\n");

      return `
const ${varName}: Hash<${typeName}> = /*#__PURE__*/ {
  hash: (a: ${typeName}): number => {
    let hash = 5381;
${fieldHashes}
    return hash >>> 0;
  },
};
/*#__PURE__*/ Hash.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },

    deriveSum(
      typeName: string,
      discriminant: string,
      variants: Array<{ tag: string; typeName: string }>
    ): string {
      const varName = instanceVarName("hash", typeName);
      const cases = variants
        .map((v, i) => {
          const inst = instanceVarName("hash", v.typeName);
          return `    case "${v.tag}": return ((${i} << 16) | ${inst}.hash(a as any)) >>> 0;`;
        })
        .join("\n");

      return `
const ${varName}: Hash<${typeName}> = /*#__PURE__*/ {
  hash: (a: ${typeName}): number => {
    switch ((a as any).${discriminant}) {
${cases}
      default: return 0;
    }
  },
};
/*#__PURE__*/ Hash.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },
  },

  Functor: {
    deriveProduct(typeName: string, fields: DeriveFieldInfo[]): string {
      // Functor derivation for product types - maps over the "contained" value
      // This is a simplified version; real Functor derivation would need
      // to know which field is the "contained" type parameter
      const varName = instanceVarName("functor", typeName);
      return `
const ${varName}: Functor<${typeName}> = /*#__PURE__*/ {
  map: <A, B>(fa: ${typeName}, f: (a: A) => B): ${typeName} => {
    return { ...fa } as any;
  },
};
/*#__PURE__*/ Functor.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },

    deriveSum(
      typeName: string,
      discriminant: string,
      variants: Array<{ tag: string; typeName: string }>
    ): string {
      const varName = instanceVarName("functor", typeName);
      const cases = variants
        .map((v) => {
          const inst = instanceVarName("functor", v.typeName);
          return `    case "${v.tag}": return ${inst}.map(fa as any, f) as any;`;
        })
        .join("\n");

      return `
const ${varName}: Functor<${typeName}> = /*#__PURE__*/ {
  map: <A, B>(fa: ${typeName}, f: (a: A) => B): ${typeName} => {
    switch ((fa as any).${discriminant}) {
${cases}
      default: return fa;
    }
  },
};
/*#__PURE__*/ Functor.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },
  },
};

// ============================================================================
// Deriving Derive Macro
// ============================================================================

/**
 * Create a derive macro for a specific typeclass that uses auto-derivation.
 */
function createTypeclassDeriveMacro(tcName: string) {
  return defineDeriveMacro({
    name: `${tcName}TC`,
    cacheable: false,
    description: `Auto-derive ${tcName} typeclass instance`,

    expand(
      ctx: MacroContext,
      target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
      typeInfo: DeriveTypeInfo
    ): ts.Statement[] {
      const derivation = builtinDerivations[tcName];
      if (!derivation) {
        ctx
          .diagnostic(TS9101)
          .at(target)
          .withArgs({ typeclass: tcName, type: typeInfo.name, field: "*", fieldType: "*" })
          .help(
            `Register a custom derivation or provide a manual @impl ${tcName}<${typeInfo.name}>`
          )
          .emit();
        return [];
      }

      const { name: typeName, fields, kind, discriminant, variants, typeParameters } = typeInfo;
      let code: string | undefined;

      // Use typeInfo.kind to determine derivation method (zero-cost: metadata-driven)
      if (kind === "sum" && discriminant && variants) {
        // For generic types with type parameters, try factory function derivation
        if (typeParameters.length > 0 && derivation.deriveGenericSum) {
          code = derivation.deriveGenericSum(typeName, discriminant, variants, typeParameters);
        }

        // Fall back to non-generic derivation if generic not supported
        if (!code) {
          const variantInfos = variants.map((v) => ({
            tag: v.tag,
            typeName: v.typeName,
          }));
          code = derivation.deriveSum(typeName, discriminant, variantInfos);
        }
      } else {
        // Product type derivation (default)
        code = derivation.deriveProduct(typeName, fields);
      }

      // Strip runtime registration calls unless the typeclass is locally defined
      // AND exported. Imported typeclasses don't have .registerInstance() in scope.
      const currentFile = ctx.sourceFile.fileName;
      const isLocallyDefined = globalResolutionScope
        .getScope(currentFile)
        .definedTypeclasses.has(tcName);
      const tcInfo = typeclassRegistry.get(tcName);
      if (!isLocallyDefined || !tcInfo?.isExported) {
        code = stripRuntimeRegistration(code!);
      }

      const stmts = ctx.parseStatements(code!);

      // Only register instance if not a generic factory function
      // (generic factories are called at use site, not registered globally)
      if (typeParameters.length === 0) {
        const varName = instanceVarName(uncapitalize(tcName), typeName);
        instanceRegistry.push({
          typeclassName: tcName,
          forType: typeName,
          instanceName: varName,
          derived: true,
        });

        // Bridge to specialization registry for zero-cost inlining at call sites
        const specMethods = getSpecializationMethodsForDerivation(tcName, typeName, fields);
        if (specMethods && Object.keys(specMethods).length > 0) {
          const methodsMap = new Map<string, { source?: string; params: string[] }>();
          for (const [name, impl] of Object.entries(specMethods)) {
            methodsMap.set(name, { source: impl.source, params: impl.params });
          }
          registerInstanceMethodsFromAST(varName, typeName, methodsMap);
        }
      }

      return stmts;
    },
  });
}

/**
 * Try to extract sum type information from a type alias declaration.
 * Looks for discriminated unions like:
 *   type Shape = Circle | Rectangle
 * where each variant has a common discriminant field (e.g., "kind" or "_tag").
 */
export function tryExtractSumType(
  ctx: MacroContext,
  target: ts.TypeAliasDeclaration
): { discriminant: string; variants: Array<{ tag: string; typeName: string }> } | undefined {
  if (!ts.isUnionTypeNode(target.type)) {
    return undefined;
  }

  const KNOWN_DISCRIMINANTS = ["kind", "_tag", "type", "tag", "__typename"];
  const variants: Array<{ tag: string; typeName: string }> = [];
  let discriminant: string | undefined;

  for (const member of target.type.types) {
    let props: ts.Symbol[];

    if (ts.isTypeReferenceNode(member)) {
      const memberTypeName = member.typeName.getText();
      try {
        const type = ctx.typeChecker.getTypeFromTypeNode(member);
        props = ctx.typeChecker.getPropertiesOfType(type) as ts.Symbol[];
      } catch {
        return undefined;
      }

      for (const prop of props) {
        if (!prop) continue;
        if (!KNOWN_DISCRIMINANTS.includes(prop.name)) continue;
        if (!discriminant) {
          discriminant = prop.name;
        } else if (discriminant !== prop.name) {
          continue;
        }

        const declarations = prop.getDeclarations();
        if (declarations && declarations.length > 0) {
          try {
            const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, declarations[0]);
            if (propType.isStringLiteral()) {
              variants.push({ tag: propType.value, typeName: memberTypeName });
            }
          } catch {
            continue;
          }
        }
      }
    } else if (ts.isTypeLiteralNode(member)) {
      try {
        const type = ctx.typeChecker.getTypeFromTypeNode(member);
        props = ctx.typeChecker.getPropertiesOfType(type) as ts.Symbol[];
      } catch {
        return undefined;
      }

      for (const prop of props) {
        if (!prop) continue;
        if (!KNOWN_DISCRIMINANTS.includes(prop.name)) continue;
        if (!discriminant) {
          discriminant = prop.name;
        } else if (discriminant !== prop.name) {
          continue;
        }

        const declarations = prop.getDeclarations();
        if (declarations && declarations.length > 0) {
          try {
            const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, declarations[0]);
            if (propType.isStringLiteral()) {
              const tag = propType.value;
              variants.push({ tag, typeName: `${target.name.text}_${tag}` });
            }
          } catch {
            continue;
          }
        }
      }
    } else {
      return undefined;
    }
  }

  if (discriminant && variants.length > 0) {
    return { discriminant, variants };
  }

  return undefined;
}

// Register derive macros for built-in typeclasses
const showTCDerive = createTypeclassDeriveMacro("Show");
const eqTCDerive = createTypeclassDeriveMacro("Eq");
const ordTCDerive = createTypeclassDeriveMacro("Ord");
const hashTCDerive = createTypeclassDeriveMacro("Hash");
const functorTCDerive = createTypeclassDeriveMacro("Functor");

// ============================================================================
// @deriving - Attribute Macro (Convenience)
// ============================================================================
// A convenience attribute that combines multiple typeclass derivations.
//
// @deriving(Show, Eq, Ord)
// interface Point { x: number; y: number; }
// ============================================================================

function isPrimitiveTypeFlags(type: ts.Type): boolean {
  const f = type.flags;
  return !!(
    f & ts.TypeFlags.Number ||
    f & ts.TypeFlags.String ||
    f & ts.TypeFlags.Boolean ||
    f & ts.TypeFlags.BigInt ||
    f & ts.TypeFlags.Null ||
    f & ts.TypeFlags.Undefined ||
    f & ts.TypeFlags.Void ||
    f & ts.TypeFlags.Never ||
    f & ts.TypeFlags.NumberLiteral ||
    f & ts.TypeFlags.StringLiteral ||
    f & ts.TypeFlags.BooleanLiteral ||
    f & ts.TypeFlags.BigIntLiteral
  );
}

const BUILTIN_DERIVE_DEPS: Record<string, string[]> = {
  Ord: ["Eq"],
  Monoid: ["Semigroup"],
};

function sortArgsByDependency(args: readonly ts.Expression[]): ts.Expression[] {
  const identArgs = args.filter(ts.isIdentifier);
  if (identArgs.length < 2) return [...args];

  const nameToIndex = new Map<string, number>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (ts.isIdentifier(a)) nameToIndex.set(a.text, i);
  }

  let hasDeps = false;
  const n = args.length;
  const inDegree = new Array<number>(n).fill(0);
  const adj: number[][] = [];
  for (let i = 0; i < n; i++) adj.push([]);

  for (let i = 0; i < n; i++) {
    const a = args[i];
    if (!ts.isIdentifier(a)) continue;
    const name = a.text;
    const deps: string[] = [];

    const deriveMacro = globalRegistry.getDerive(name);
    if (deriveMacro?.expandAfter) deps.push(...deriveMacro.expandAfter);

    const tcMacro = globalRegistry.getDerive(`${name}TC`);
    if (tcMacro?.expandAfter) deps.push(...tcMacro.expandAfter);

    const builtinDeps = BUILTIN_DERIVE_DEPS[name];
    if (builtinDeps) deps.push(...builtinDeps);

    for (const dep of deps) {
      const depIdx = nameToIndex.get(dep);
      if (depIdx !== undefined) {
        adj[depIdx].push(i);
        inDegree[i]++;
        hasDeps = true;
      }
    }
  }

  if (!hasDeps) return [...args];

  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }

  const sorted: ts.Expression[] = [];
  while (queue.length > 0) {
    queue.sort((a, b) => a - b);
    const idx = queue.shift()!;
    sorted.push(args[idx]);
    for (const next of adj[idx]) {
      inDegree[next]--;
      if (inDegree[next] === 0) queue.push(next);
    }
  }

  return sorted.length < n ? [...args] : sorted;
}

function expandDeriving(
  ctx: MacroContext,
  _decorator: ts.Decorator,
  target: ts.Declaration,
  args: readonly ts.Expression[]
): ts.Node | ts.Node[] {
  if (
    !ts.isInterfaceDeclaration(target) &&
    !ts.isClassDeclaration(target) &&
    !ts.isTypeAliasDeclaration(target)
  ) {
    ctx
      .diagnostic(TS9102)
      .at(target)
      .withArgs({ typeclass: "@derive" })
      .help("Apply @derive to an interface, class, or type alias declaration")
      .emit();
    return target;
  }

  const typeName = target.name?.text ?? "Anonymous";

  let type: ts.Type | undefined;
  try {
    type = ctx.typeChecker.getTypeAtLocation(target);
  } catch {
    // TypeChecker not ready — fall through to AST-based extraction
  }

  // -----------------------------------------------------------------------
  // DEGRADED MODE: TypeChecker unavailable (IDE background)
  //
  // When the TypeChecker can't resolve types, we can only do AST-based
  // error detection. We must NOT generate derivation code because it would
  // reference identifiers (eqNumber, ordNumber, etc.) that don't exist
  // in the IDE's type scope, producing cascading spurious TS errors.
  //
  // Real derivation code generation happens during tspc build when the
  // TypeChecker is fully operational.
  // -----------------------------------------------------------------------
  if (!type) {
    const astFields = extractFieldsFromAST(target);

    // TS9103: Union type without discriminant
    if (ts.isTypeAliasDeclaration(target) && ts.isUnionTypeNode(target.type)) {
      const astSum = tryExtractSumTypeFromAST(target);
      if (!astSum) {
        ctx
          .diagnostic(TS9103)
          .at(target)
          .help('Add a discriminant field like `kind: "a"` to each variant')
          .emit();
      }
      // Valid discriminated union or unresolvable — skip code generation
      return target;
    }

    // TS9104: Empty type (no fields)
    if (astFields.length === 0) {
      for (const arg of args) {
        if (ts.isIdentifier(arg)) {
          ctx
            .diagnostic(TS9104)
            .at(target)
            .withArgs({ typeclass: arg.text, type: typeName })
            .help("Add fields to the type, or provide a manual @instance")
            .emit();
        }
      }
      return target;
    }

    // TS9101: Fields contain non-derivable types (functions, unknown, etc.)
    for (const field of astFields) {
      const t = field.typeString;
      if (t.includes("=>") || t === "unknown" || t === "never" || t === "any") {
        for (const arg of args) {
          if (ts.isIdentifier(arg)) {
            ctx
              .diagnostic(TS9101)
              .at(target)
              .withArgs({ typeclass: arg.text, type: typeName, field: field.name, fieldType: t })
              .help(
                `Field \`${field.name}\` has type \`${t}\` which likely can't derive ${arg.text}`
              )
              .emit();
          }
        }
        return target;
      }
    }

    // Type looks valid but we can't generate code without TypeChecker.
    // Return unchanged — derivation will happen during tspc build.
    return target;
  }

  const typeParameters = target.typeParameters ? Array.from(target.typeParameters) : [];

  // Extract fields via TypeChecker (available in this branch)
  let fields: DeriveFieldInfo[] = [];
  let properties: ts.Symbol[];
  try {
    properties = ctx.typeChecker.getPropertiesOfType(type) as ts.Symbol[];
  } catch {
    properties = [];
  }

  let isRecursive = false;
  for (const prop of properties) {
    if (!prop) continue;
    const declarations = prop.getDeclarations();
    if (!declarations || declarations.length === 0) continue;
    const decl = declarations[0];

    let propType: ts.Type;
    let propTypeString: string;
    try {
      propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, decl);
      propTypeString = ctx.typeChecker.typeToString(propType);
    } catch {
      continue;
    }

    if (propTypeString === typeName || propTypeString.includes(`${typeName}<`)) {
      isRecursive = true;
    }

    const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
    const readonly =
      ts.isPropertyDeclaration(decl) || ts.isPropertySignature(decl)
        ? (decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false)
        : false;

    fields.push({
      name: prop.name,
      typeString: propTypeString,
      type: propType,
      optional,
      readonly,
    });
  }

  // AST fallback when TypeChecker returned empty properties
  if (fields.length === 0) {
    fields = extractFieldsFromAST(target);
  }

  // Detect if this is a sum type and populate metadata
  let sumInfo:
    | {
        discriminant: string;
        variants: Array<{ tag: string; typeName: string }>;
      }
    | undefined;
  if (ts.isTypeAliasDeclaration(target)) {
    sumInfo = tryExtractSumType(ctx, target);
  }

  // Extract variant fields for sum types
  const variants: DeriveVariantInfo[] = [];
  if (sumInfo && ts.isTypeAliasDeclaration(target)) {
    for (const variant of sumInfo.variants) {
      const variantFields: DeriveFieldInfo[] = [];
      if (ts.isUnionTypeNode(target.type)) {
        for (const member of target.type.types) {
          let matched = false;
          if (ts.isTypeReferenceNode(member) && member.typeName.getText() === variant.typeName) {
            matched = true;
          } else if (ts.isTypeLiteralNode(member)) {
            // For inline type literals, match by checking the discriminant value
            try {
              const memberType = ctx.typeChecker.getTypeFromTypeNode(member);
              const discProp = ctx.typeChecker
                .getPropertiesOfType(memberType)
                .find((p: ts.Symbol) => p.name === sumInfo!.discriminant);
              if (discProp) {
                const decl = discProp.getDeclarations()?.[0];
                if (decl) {
                  const discType = ctx.typeChecker.getTypeOfSymbolAtLocation(discProp, decl);
                  if (discType.isStringLiteral() && discType.value === variant.tag) {
                    matched = true;
                  }
                }
              }
            } catch {
              // TypeChecker not ready
            }
          }

          if (matched) {
            try {
              const variantType = ctx.typeChecker.getTypeFromTypeNode(member);
              const props = ctx.typeChecker.getPropertiesOfType(variantType);
              for (const prop of props) {
                if (!prop || prop.name === sumInfo.discriminant) continue;
                const decl = prop.getDeclarations()?.[0];
                if (!decl) continue;
                const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, decl);
                variantFields.push({
                  name: prop.name,
                  typeString: ctx.typeChecker.typeToString(propType),
                  type: propType,
                  optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
                  readonly: false,
                });
              }
            } catch {
              // TypeChecker not ready for variant resolution
            }
            break;
          }
        }
      }
      variants.push({
        tag: variant.tag,
        typeName: variant.typeName,
        fields: variantFields,
      });
    }
  }

  // Check for union types without discriminant - emit TS9103
  if (ts.isTypeAliasDeclaration(target) && ts.isUnionTypeNode(target.type) && !sumInfo) {
    ctx
      .diagnostic(TS9103)
      .at(target)
      .help('Add a discriminant field like `kind: "a"` to each variant')
      .emit();
    return target;
  }

  // Primitive type alias detection (e.g., `type UserId = string`)
  const isPrimitive = ts.isTypeAliasDeclaration(target) && !sumInfo && isPrimitiveTypeFlags(type);

  // TS9104: Empty type (no fields) — not a union, has no derivable content
  if (
    fields.length === 0 &&
    !isPrimitive &&
    !(ts.isTypeAliasDeclaration(target) && ts.isUnionTypeNode(target.type))
  ) {
    for (const arg of args) {
      if (ts.isIdentifier(arg)) {
        ctx
          .diagnostic(TS9104)
          .at(target)
          .withArgs({ typeclass: arg.text, type: typeName })
          .help("Add fields to the type, or provide a manual @instance")
          .emit();
      }
    }
    return target;
  }

  // Construct complete DeriveTypeInfo with sum type metadata
  const typeInfo: DeriveTypeInfo = {
    name: typeName,
    fields,
    typeParameters,
    type: type as ts.Type,
    kind: sumInfo ? "sum" : isPrimitive ? "primitive" : "product",
    isRecursive: isRecursive || undefined,
    ...(sumInfo && {
      discriminant: sumInfo.discriminant,
      variants,
    }),
  };

  const allStatements: ts.Statement[] = [];

  // Parse transitive options from args (e.g., { transitive: false })
  const transitiveOptions = parseTransitiveOptions(args);

  // Sort args by dependency order (e.g., Ord after Eq)
  const sortedArgs = sortArgsByDependency(args);

  for (const arg of sortedArgs) {
    // Skip object literals (they're options, not typeclass names)
    if (ts.isObjectLiteralExpression(arg)) {
      continue;
    }

    if (!ts.isIdentifier(arg)) {
      ctx
        .diagnostic(TS9060)
        .at(arg)
        .withArgs({ name: arg.getText() })
        .help("derive arguments must be identifiers, not expressions")
        .emit();
      continue;
    }

    const tcName = arg.text;

    // Priority 1: Custom derive macro registered by name (allows overriding builtins)
    const customDerive = globalRegistry.getDerive(tcName);
    if (customDerive) {
      try {
        const stmts = customDerive.expand(ctx, target, typeInfo);
        allStatements.push(...stmts);
      } catch (err: unknown) {
        ctx
          .diagnostic(TS9101)
          .at(arg)
          .withArgs({ typeclass: tcName, type: typeName, field: "—", fieldType: "—" })
          .note(
            `Derive macro expansion failed for '${tcName}': ${err instanceof Error ? err.message : String(err)}`
          )
          .emit();
      }
      continue;
    }

    // Priority 2: Builtin derivation strategy
    const derivation = builtinDerivations[tcName];

    if (derivation) {
      // === TRANSITIVE DERIVATION ===
      // Skip for sum types — variant decomposition is handled by deriveSum/deriveGenericSum.
      // Transitive derivation on sum types would inspect the union's common properties
      // (e.g., the discriminant field's literal union type), not the actual variant fields.
      if (typeInfo.kind !== "sum") {
        const plan = buildTransitiveDerivationPlan(ctx, typeName, tcName, transitiveOptions);

        for (const err of plan.errors) {
          ctx
            .diagnostic(TS9101)
            .at(target)
            .withArgs({ typeclass: tcName, type: typeName, field: "*", fieldType: "*" })
            .note(err)
            .help(`Ensure all nested types have ${tcName} instances`)
            .emit();
        }
        for (const cycle of plan.cycles) {
          ctx
            .diagnostic(TS9101)
            .at(target)
            .withArgs({ typeclass: tcName, type: typeName, field: "*", fieldType: "*" })
            .note(`Circular reference: ${cycle.join(" → ")}`)
            .help(`Add explicit @derive(${tcName}) to one of the types in the cycle to break it`)
            .emit();
        }

        const nestedTypes = plan.types.filter((t) => t.typeName !== typeName);
        if (nestedTypes.length > 0) {
          const nestedStatements = executeTransitiveDerivation(ctx, tcName, {
            ...plan,
            types: nestedTypes,
          });
          allStatements.push(...nestedStatements);
        }
      }

      // === DERIVE ROOT TYPE ===
      let code: string | undefined;
      const varName = instanceVarName(uncapitalize(tcName), typeName);
      const { typeParameters } = typeInfo;

      // Use typeInfo.kind to determine derivation method
      if (typeInfo.kind === "sum" && typeInfo.discriminant && variants.length > 0) {
        // Prefer deriveGenericSum — it generates inline field comparisons per variant,
        // which works for both named type references AND inline type literals.
        if (derivation.deriveGenericSum) {
          code = derivation.deriveGenericSum(
            typeName,
            typeInfo.discriminant,
            variants,
            typeParameters
          );
        }

        // Fall back to non-generic derivation (requires named variant types with instances)
        if (!code) {
          code = derivation.deriveSum(typeName, typeInfo.discriminant, variants);
        }
      } else {
        code = derivation.deriveProduct(typeName, fields);
      }

      // Strip runtime registration calls unless the typeclass is locally defined
      // AND exported. Imported typeclasses don't have .registerInstance() in scope.
      const currentFile = ctx.sourceFile.fileName;
      const isLocallyDefined = globalResolutionScope
        .getScope(currentFile)
        .definedTypeclasses.has(tcName);
      const tcInfo = typeclassRegistry.get(tcName);
      if (!isLocallyDefined || !tcInfo?.isExported) {
        code = stripRuntimeRegistration(code!);
      }

      allStatements.push(...ctx.parseStatements(code!));

      // Only register instance if not a generic factory function
      // (generic factories are called at use site, not registered globally)
      if (typeParameters.length === 0) {
        instanceRegistry.push({
          typeclassName: tcName,
          forType: typeName,
          instanceName: varName,
          derived: true,
        });

        // Notify coverage system
        notifyPrimitiveRegistered(typeName, tcName);

        // Bridge to specialization registry: register derived instance methods
        // For HKT typeclasses (Functor, Monad, etc.), this enables zero-cost specialization
        const specMethods = getSpecializationMethodsForDerivation(tcName, typeName, fields);
        if (specMethods && Object.keys(specMethods).length > 0) {
          // Convert plain object to Map<string, DictMethod> for registerInstanceMethodsFromAST
          const methodsMap = new Map<string, { source?: string; params: string[] }>();
          for (const [name, impl] of Object.entries(specMethods)) {
            methodsMap.set(name, { source: impl.source, params: impl.params });
          }
          registerInstanceMethodsFromAST(varName, typeName, methodsMap);
        }
      }
    } else {
      // Special case: Builder doesn't fit the typeclass model
      // It's a factory pattern, not a type-parameterized interface
      if (tcName === "Builder") {
        ctx
          .diagnostic(TS9101)
          .at(arg)
          .withArgs({ typeclass: tcName, type: typeName, field: "—", fieldType: "—" })
          .note(
            `Builder is not supported as a typeclass derivation. ` +
              `Unlike Eq<T> or Clone<T>, Builder doesn't have a type parameter for the target type.`
          )
          .help(
            `Use a builder library like '@sinclair/typebox' or write a manual builder:\n` +
              `  static builder() { return new ${typeName}Builder(); }`
          )
          .emit();
        continue;
      }

      // Priority 3: {Name}TC convention
      const tcDerive = globalRegistry.getDerive(`${tcName}TC`);
      if (tcDerive) {
        try {
          const stmts = tcDerive.expand(ctx, target, typeInfo);
          allStatements.push(...stmts);
        } catch (err: unknown) {
          ctx
            .diagnostic(TS9101)
            .at(arg)
            .withArgs({ typeclass: tcName, type: typeName, field: "—", fieldType: "—" })
            .note(
              `Derive macro expansion failed for '${tcName}': ${err instanceof Error ? err.message : String(err)}`
            )
            .emit();
        }
      } else {
        const tcSuggestions = getSuggestionsForSymbol(tcName);
        const builder = ctx
          .diagnostic(TS9101)
          .at(arg)
          .withArgs({ typeclass: tcName, type: typeName, field: "—", fieldType: "—" })
          .note(
            `Unknown derive '${tcName}': no auto-derivation, no ${tcName}TC derive macro found`
          );

        if (tcSuggestions.length > 0) {
          builder.help(`Import ${tcName}: ${tcSuggestions[0].importStatement}`);
        } else {
          builder.help(
            `Define a custom derivation or provide a manual @impl ${tcName}<${typeName}>`
          );
        }

        builder.emit();
      }
    }
  }

  return [target, ...allStatements];
}

export const deriveAttribute = defineAttributeMacro({
  name: "derive",
  module: "@typesugar/typeclass",
  cacheable: false,
  description: "Auto-derive typeclass instances for a type (unified decorator)",
  validTargets: ["interface", "class", "type"],
  expand: expandDeriving,
});

export const derivingAttribute = defineAttributeMacro({
  name: "deriving",
  module: "@typesugar/typeclass",
  cacheable: false,
  description: "@deprecated Use @derive instead",
  validTargets: ["interface", "class", "type"],

  expand(
    ctx: MacroContext,
    decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    ctx.reportWarning(target, "@deriving is renamed to @derive. Please update your code.");
    return expandDeriving(ctx, decorator, target, args);
  },
});

// ============================================================================
// summon<TC<A>>() - Expression Macro
// ============================================================================
// Scala 3-style implicit resolution at compile time.
//
// Resolution order:
// 1. Explicit instance (@instance or @deriving) → inline reference
// 2. Auto-derivation via TypeChecker → inspect A's fields, derive if possible
// 3. Compile error — no silent runtime fallback
// ============================================================================

export const summonMacro = defineExpressionMacro({
  name: "summon",
  module: "@typesugar/typeclass",
  description:
    "Resolve a typeclass instance at compile time with Scala 3-style auto-derivation via Mirror",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    // Get the type argument: summon<Show<Point>>()
    const typeArgs = callExpr.typeArguments;
    if (!typeArgs || typeArgs.length === 0) {
      ctx
        .diagnostic(TS9005)
        .at(callExpr)
        .help("Provide a type argument: summon<Show<Point>>()")
        .emit();
      return callExpr;
    }

    const typeArg = typeArgs[0];
    if (!ts.isTypeReferenceNode(typeArg)) {
      ctx
        .diagnostic(TS9008)
        .at(callExpr)
        .help("Use a typeclass applied to a type: summon<Show<Point>>()")
        .emit();
      return callExpr;
    }

    const tcName = getNodeText(typeArg.typeName);
    const innerTypeArgs = typeArg.typeArguments;

    if (!innerTypeArgs || innerTypeArgs.length === 0) {
      ctx
        .diagnostic(TS9008)
        .at(callExpr)
        .note(`summon<${tcName}<...>>() requires the typeclass to have a type argument`)
        .help(`Provide a type argument: summon<${tcName}<YourType>>()`)
        .emit();
      return callExpr;
    }

    const innerType = innerTypeArgs[0];
    let typeName: string;

    if (ts.isTypeReferenceNode(innerType)) {
      // Use full type text including type arguments for partial application
      // e.g., Either<string> → "Either<string>", not just "Either"
      if (innerType.typeArguments && innerType.typeArguments.length > 0) {
        typeName = getNodeText(innerType);
      } else {
        typeName = getNodeText(innerType.typeName);
      }
    } else if (innerType.kind === ts.SyntaxKind.NumberKeyword) {
      typeName = "number";
    } else if (innerType.kind === ts.SyntaxKind.StringKeyword) {
      typeName = "string";
    } else if (innerType.kind === ts.SyntaxKind.BooleanKeyword) {
      typeName = "boolean";
    } else {
      typeName = getNodeText(innerType);
    }

    // Build resolution trace for detailed error messages
    const attempts: ResolutionAttempt[] = [];

    // 1. Check for explicit instance in the compile-time registry
    const explicitInstance = findInstance(tcName, typeName, ctx.sourceFile.fileName);
    if (explicitInstance) {
      return ctx.parseExpression(instanceVarName(tcName, typeName));
    }
    attempts.push({
      step: "explicit-instance",
      target: `${tcName}<${typeName}>`,
      result: "not-found",
      reason: "no @instance or @deriving registered",
    });

    // 2. Try Scala 3-style derivation via Generic (GenericMeta)
    let derivationResult: DerivationResult;
    try {
      const { tryDeriveViaGeneric } =
        require("./auto-derive.js") as typeof import("./auto-derive.js");
      derivationResult = tryDeriveViaGeneric(ctx, tcName, typeName);
    } catch {
      derivationResult = {
        expression: null,
        trace: [
          {
            step: "auto-derive",
            target: `${tcName}<${typeName}>`,
            result: "rejected",
            reason: "Auto-derive module not available",
          },
        ],
      };
    }

    // Merge derivation trace into our attempts
    if (derivationResult.trace.length > 0) {
      attempts.push({
        step: "auto-derive via Generic",
        target: `${tcName}<${typeName}>`,
        result: derivationResult.expression ? "found" : "rejected",
        reason: derivationResult.expression ? "derivation succeeded" : "see child attempts",
        children: derivationResult.trace,
      });
    }

    if (derivationResult.expression) {
      return derivationResult.expression;
    }

    // 3. No instance found — compile error with resolution trace
    const trace: ResolutionTrace = {
      sought: `${tcName}<${typeName}>`,
      attempts,
      finalResult: "failed",
    };

    const traceNotes = formatResolutionTrace(trace);
    const helpMessage = generateHelpFromTrace(trace, tcName, typeName);

    const builder = ctx
      .diagnostic(TS9001)
      .at(callExpr)
      .withArgs({ typeclass: tcName, type: typeName });

    for (const traceNote of traceNotes) {
      builder.note(traceNote);
    }

    const tcSuggestions = getSuggestionsForTypeclass(tcName);
    if (tcSuggestions.length > 0) {
      builder.help(`${helpMessage}\n    Add: ${tcSuggestions[0].importStatement}`);
    } else {
      builder.help(helpMessage);
    }

    builder.emit();
    return callExpr;
  },
});

// ============================================================================
// extend() - Expression Macro for Extension Methods
// ============================================================================
// Provides Scala 3-like extension method syntax.
//
// extend(point).show()
// // Resolves to: Show.summon<Point>("Point").show(point)
//
// extend(point).eq(otherPoint)
// // Resolves to: Eq.summon<Point>("Point").eq(point, otherPoint)
// ============================================================================

export const extendMacro = defineExpressionMacro({
  name: "extend",
  module: "@typesugar/typeclass",
  description: "Call extension methods on a value via typeclass instances",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length === 0) {
      ctx.reportError(callExpr, "extend() requires a value argument");
      return callExpr;
    }

    // We need to look at the parent to see what method is being called
    // extend(value).method(args...)
    const parent = callExpr.parent;
    if (!parent || !ts.isPropertyAccessExpression(parent)) {
      ctx.reportError(
        callExpr,
        "extend() must be followed by a method call, e.g., extend(value).show()"
      );
      return callExpr;
    }

    const methodName = parent.name.text;
    const value = args[0];

    // Try to determine the type of the value
    const valueType = ctx.typeChecker.getTypeAtLocation(value);
    const typeName = ctx.typeChecker.typeToString(valueType);

    // Find which typeclass provides this method
    for (const [tcName, tcInfo] of typeclassRegistry) {
      const method = tcInfo.methods.find((m) => m.name === methodName);
      if (method) {
        // Found it! Generate the call
        const grandParent = parent.parent;
        if (grandParent && ts.isCallExpression(grandParent)) {
          const extraArgs = Array.from(grandParent.arguments)
            .map((a) => a.getText())
            .join(", ");
          const allArgs = extraArgs ? `${value.getText()}, ${extraArgs}` : value.getText();
          const code = `${tcName}.summon<${typeName}>("${typeName}").${methodName}(${allArgs})`;
          return ctx.parseExpression(code);
        }

        const code = `${tcName}.summon<${typeName}>("${typeName}").${methodName}(${value.getText()})`;
        return ctx.parseExpression(code);
      }
    }

    // Check standalone extensions (Scala 3-style concrete type extensions)
    const standaloneExt = findStandaloneExtensionForExtend(methodName, typeName);
    if (standaloneExt) {
      const grandParent = parent.parent;
      const extraArgs =
        grandParent && ts.isCallExpression(grandParent) ? Array.from(grandParent.arguments) : [];
      return buildStandaloneExtensionCall(ctx.factory, standaloneExt, value, extraArgs);
    }

    // No match in registries — strip the extend() wrapper and emit
    // value.method(args) so the transformer's implicit extension rewriting
    // (which includes import-scoped resolution) can handle it.
    const grandParent = parent.parent;
    if (grandParent && ts.isCallExpression(grandParent)) {
      const methodCall = ctx.factory.createCallExpression(
        ctx.factory.createPropertyAccessExpression(value, methodName),
        undefined,
        Array.from(grandParent.arguments)
      );
      return methodCall;
    }
    const propAccess = ctx.factory.createPropertyAccessExpression(value, methodName);
    return propAccess;
  },
});

// ============================================================================
// instance() - Expression Macro for Preprocessor-Rewritten @instance
// ============================================================================
// Handles calls like:
//   const numericExpr = instance("Numeric<Expression<number>>", { add: ..., mul: ... });
//
// The preprocessor rewrites `@instance("...")` decorators to this form.
// This macro registers the instance and returns the object literal unchanged.
// ============================================================================

/**
 * Parse a typeclass instantiation string like "Numeric<Expression<number>>"
 * into its components: typeclassName and forType.
 *
 * Handles nested generics by matching the outermost angle brackets.
 */
function parseTypeclassInstantiation(
  text: string
): { typeclassName: string; forType: string } | null {
  // Match typeclass name followed by <...>
  const openBracket = text.indexOf("<");
  if (openBracket === -1) {
    return null;
  }

  const typeclassName = text.slice(0, openBracket).trim();
  if (!typeclassName) {
    return null;
  }

  // Find matching closing bracket, handling nested generics
  let depth = 0;
  let closeBracket = -1;
  for (let i = openBracket; i < text.length; i++) {
    if (text[i] === "<") {
      depth++;
    } else if (text[i] === ">") {
      depth--;
      if (depth === 0) {
        closeBracket = i;
        break;
      }
    }
  }

  if (closeBracket === -1) {
    return null;
  }

  const forType = text.slice(openBracket + 1, closeBracket).trim();
  if (!forType) {
    return null;
  }

  return { typeclassName, forType };
}

/**
 * Walk up the AST to find the enclosing VariableDeclaration.
 */
function findEnclosingVariableDeclaration(node: ts.Node): ts.VariableDeclaration | null {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isVariableDeclaration(current)) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Expression macro for registering typeclass instances.
 *
 * This is the internal target for preprocessor-rewritten @impl/@instance decorators.
 * Users should prefer the JSDoc syntax which doesn't require the preprocessor.
 *
 * @internal
 */
export const implMacro = defineExpressionMacro({
  name: "impl",
  module: "@typesugar/typeclass",
  description:
    "Register a typeclass instance from preprocessor-rewritten @impl/@instance decorator",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    // Expect: impl("Typeclass<Type>", { ... })
    if (args.length < 2) {
      ctx.reportError(callExpr, 'impl() requires two arguments: impl("Typeclass<Type>", { ... })');
      return callExpr;
    }

    const descriptionArg = args[0];
    const objectLiteralArg = args[1];

    // Parse the description string
    if (!ts.isStringLiteral(descriptionArg)) {
      ctx.reportError(
        descriptionArg,
        'First argument to instance() must be a string literal like "Numeric<Expression<number>>"'
      );
      return objectLiteralArg;
    }

    const parsed = parseTypeclassInstantiation(descriptionArg.text);
    if (!parsed) {
      ctx.reportError(
        descriptionArg,
        `Invalid typeclass instantiation format: "${descriptionArg.text}". Expected "Typeclass<Type>".`
      );
      return objectLiteralArg;
    }

    const { typeclassName, forType } = parsed;

    // Find the enclosing VariableDeclaration to get the instance name
    const varDecl = findEnclosingVariableDeclaration(callExpr);
    if (!varDecl || !ts.isIdentifier(varDecl.name)) {
      ctx.reportWarning(
        callExpr,
        "instance() called outside a variable declaration; skipping registration"
      );
      return objectLiteralArg;
    }

    const instanceName = varDecl.name.text;

    // Register idempotently using registerInstanceWithMeta
    const existingInstance = findInstance(typeclassName, forType);
    if (!existingInstance) {
      registerInstanceWithMeta({
        typeclassName,
        forType,
        instanceName,
        derived: false,
      });

      // Notify coverage system
      notifyPrimitiveRegistered(forType, typeclassName);
    }

    // Extract and register methods for specialization (if object literal)
    if (ts.isObjectLiteralExpression(objectLiteralArg)) {
      const methods = extractMethodsFromObjectLiteral(objectLiteralArg, ctx.hygiene);
      if (methods.size > 0) {
        registerInstanceMethodsFromAST(instanceName, forType, methods);
      }
    }

    // Return the object literal unchanged — strip the impl() wrapper
    return objectLiteralArg;
  },
});

// ============================================================================
// typeclass("Name") - Expression Macro for Preprocessor-Rewritten Form
// ============================================================================
// Handles the preprocessor-rewritten form:
//   interface Eq<A> { /** @op === */ equals(a: A, b: A): boolean; }
//   typeclass("Eq");
//
// This registers the typeclass metadata and generates companion code.
// ============================================================================

export const typeclassMacro = defineExpressionMacro({
  name: "typeclass",
  module: "@typesugar/typeclass",
  description:
    "Register a typeclass from a preceding interface declaration (preprocessor-rewritten form)",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    // Expect: typeclass("TypeclassName") or typeclass("TypeclassName", { options })
    if (args.length < 1) {
      ctx.reportError(callExpr, 'typeclass() requires at least one argument: typeclass("Name")');
      return ctx.factory.createVoidZero();
    }

    const nameArg = args[0];
    if (!ts.isStringLiteral(nameArg)) {
      ctx.reportError(nameArg, "First argument to typeclass() must be a string literal");
      return ctx.factory.createVoidZero();
    }

    const tcName = nameArg.text;
    const sourceFile = callExpr.getSourceFile();

    // Find the interface declaration with this name in the source file
    let targetInterface: ts.InterfaceDeclaration | undefined;
    for (const statement of sourceFile.statements) {
      if (ts.isInterfaceDeclaration(statement) && statement.name.text === tcName) {
        targetInterface = statement;
        break;
      }
    }

    if (!targetInterface) {
      ctx.reportError(
        callExpr,
        `No interface named "${tcName}" found in this file. ` +
          `typeclass("${tcName}") must follow an interface declaration.`
      );
      return ctx.factory.createVoidZero();
    }

    const typeParams = targetInterface.typeParameters;
    if (!typeParams || typeParams.length === 0) {
      ctx.reportError(
        targetInterface,
        `Interface ${tcName} must have at least one type parameter (e.g., interface ${tcName}<A>)`
      );
      return ctx.factory.createVoidZero();
    }

    const typeParam = typeParams[0].name.text;

    // Extract methods from the interface (same logic as typeclassAttribute)
    const methods: TypeclassMethod[] = [];
    const memberTexts: string[] = [];

    for (const member of targetInterface.members) {
      // Capture raw source text of each member for HKT expansion
      try {
        const memberText = member.getText(sourceFile);
        memberTexts.push(memberText);
      } catch {
        // Node may not have real position (synthetic) - skip
      }

      if (ts.isMethodSignature(member) && member.name) {
        const methodName = ts.isIdentifier(member.name) ? member.name.text : member.name.getText();

        const params: Array<{ name: string; typeString: string }> = [];
        let isSelfMethod = false;

        for (let i = 0; i < member.parameters.length; i++) {
          const param = member.parameters[i];
          const paramName = ts.isIdentifier(param.name) ? param.name.text : param.name.getText();
          const paramType = param.type ? param.type.getText() : "unknown";

          // Check if this parameter uses the typeclass's type param
          if (i === 0 && paramType === typeParam) {
            isSelfMethod = true;
          }

          params.push({ name: paramName, typeString: paramType });
        }

        const operatorSymbol = extractOpFromJSDoc(member);
        const returnType = member.type ? member.type.getText() : "void";

        methods.push({
          name: methodName,
          params,
          returnType,
          isSelfMethod,
          operatorSymbol,
        });
      } else if (ts.isPropertySignature(member) && member.name) {
        const methodName = ts.isIdentifier(member.name) ? member.name.text : member.name.getText();

        methods.push({
          name: methodName,
          params: [],
          returnType: member.type ? member.type.getText() : "unknown",
          isSelfMethod: false,
        });
      }
    }

    // Build the full interface body text for HKT expansion
    const fullSignatureText = memberTexts.length > 0 ? `{ ${memberTexts.join("; ")} }` : undefined;

    // Build syntax map from @op JSDoc tags or Op<> annotations on methods
    const syntax = new Map<string, string>();
    for (const method of methods) {
      if (method.operatorSymbol) {
        syntax.set(method.operatorSymbol, method.name);
      }
    }

    // Register the typeclass
    const tcInfo: TypeclassInfo = {
      name: tcName,
      typeParam,
      methods,
      canDeriveProduct: true,
      canDeriveSum: true,
      fullSignatureText,
      syntax: syntax.size > 0 ? syntax : undefined,
    };
    typeclassRegistry.set(tcName, tcInfo);
    globalResolutionScope.registerDefinedTypeclass(ctx.sourceFile.fileName, tcName);

    return ctx.factory.createVoidZero();
  },
});

// ============================================================================
// Built-in Typeclass Interfaces (for reference/documentation)
// ============================================================================
// These are the standard typeclass interfaces that users should define
// in their code. The macros will work with any interface that follows
// the typeclass pattern.

/**
 * Generate code for standard typeclass interfaces.
 * Users can call this or define their own.
 */
export function generateStandardTypeclasses(): string {
  return `
// ============================================================================
// Standard Typeclasses
// ============================================================================

/** Equality typeclass - Scala 3: trait Eq[A] */

interface Eq<A> {
  /** @op === */
  eq(a: A, b: A): boolean;
  /** @op !== */
  neq(a: A, b: A): boolean;
}
typeclass("Eq");

/** Ordering typeclass - Scala 3: trait Ord[A] extends Eq[A] */

interface Ord<A> {
  /** @op < */
  compare(a: A, b: A): -1 | 0 | 1;
}
typeclass("Ord");

/** Show typeclass - Scala 3: trait Show[A] */

interface Show<A> {
  show(a: A): string;
}
typeclass("Show");

/** Hash typeclass */

interface Hash<A> {
  hash(a: A): number;
}
typeclass("Hash");

/** Semigroup typeclass - Scala 3: trait Semigroup[A] */

interface Semigroup<A> {
  /** @op + */
  combine(a: A, b: A): A;
}
typeclass("Semigroup");

/** Monoid typeclass - Scala 3: trait Monoid[A] extends Semigroup[A] */

interface Monoid<A> {
  empty(): A;
  /** @op + */
  combine(a: A, b: A): A;
}
typeclass("Monoid");

/** Functor typeclass - Scala 3: trait Functor[F[_]] */

interface Functor<F> {
  map<A, B>(fa: F, f: (a: A) => B): F;
}
typeclass("Functor");

// ============================================================================
// Primitive Instances
// ============================================================================

// Eq instances for primitives
const eqNumber: Eq<number> = /*#__PURE__*/ {
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
};
/*#__PURE__*/ Eq.registerInstance<number>("number", eqNumber);

const eqString: Eq<string> = /*#__PURE__*/ {
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
};
/*#__PURE__*/ Eq.registerInstance<string>("string", eqString);

const eqBoolean: Eq<boolean> = /*#__PURE__*/ {
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
};
/*#__PURE__*/ Eq.registerInstance<boolean>("boolean", eqBoolean);

// Show instances for primitives
const showNumber: Show<number> = /*#__PURE__*/ {
  show: (a) => String(a),
};
/*#__PURE__*/ Show.registerInstance<number>("number", showNumber);

const showString: Show<string> = /*#__PURE__*/ {
  show: (a) => JSON.stringify(a),
};
/*#__PURE__*/ Show.registerInstance<string>("string", showString);

const showBoolean: Show<boolean> = /*#__PURE__*/ {
  show: (a) => String(a),
};
/*#__PURE__*/ Show.registerInstance<boolean>("boolean", showBoolean);

// Ord instances for primitives
const ordNumber: Ord<number> = /*#__PURE__*/ {
  compare: (a, b) => a < b ? -1 : a > b ? 1 : 0,
};
/*#__PURE__*/ Ord.registerInstance<number>("number", ordNumber);

const ordString: Ord<string> = /*#__PURE__*/ {
  compare: (a, b) => a < b ? -1 : a > b ? 1 : 0,
};
/*#__PURE__*/ Ord.registerInstance<string>("string", ordString);

// Hash instances for primitives
const hashNumber: Hash<number> = /*#__PURE__*/ {
  hash: (a) => a | 0,
};
/*#__PURE__*/ Hash.registerInstance<number>("number", hashNumber);

const hashString: Hash<string> = /*#__PURE__*/ {
  hash: (a) => {
    let h = 5381;
    for (let i = 0; i < a.length; i++) {
      h = ((h << 5) + h) + a.charCodeAt(i);
    }
    return h >>> 0;
  },
};
/*#__PURE__*/ Hash.registerInstance<string>("string", hashString);

const hashBoolean: Hash<boolean> = /*#__PURE__*/ {
  hash: (a) => a ? 1 : 0,
};
/*#__PURE__*/ Hash.registerInstance<boolean>("boolean", hashBoolean);

// Semigroup instances for primitives
const semigroupNumber: Semigroup<number> = /*#__PURE__*/ {
  combine: (a, b) => a + b,
};
/*#__PURE__*/ Semigroup.registerInstance<number>("number", semigroupNumber);

const semigroupString: Semigroup<string> = /*#__PURE__*/ {
  combine: (a, b) => a + b,
};
/*#__PURE__*/ Semigroup.registerInstance<string>("string", semigroupString);

// Monoid instances for primitives
const monoidNumber: Monoid<number> = /*#__PURE__*/ {
  empty: () => 0,
  combine: (a, b) => a + b,
};
/*#__PURE__*/ Monoid.registerInstance<number>("number", monoidNumber);

const monoidString: Monoid<string> = /*#__PURE__*/ {
  empty: () => "",
  combine: (a, b) => a + b,
};
/*#__PURE__*/ Monoid.registerInstance<string>("string", monoidString);
`;
}

// ============================================================================
// Semigroup/Monoid derivation for products
// ============================================================================

builtinDerivations["Semigroup"] = {
  deriveProduct(typeName: string, fields: DeriveFieldInfo[]): string {
    const varName = instanceVarName("semigroup", typeName);
    const fieldCombines = fields
      .map((f) => {
        const inst = instanceVarName("semigroup", getBaseType(f));
        return `    ${f.name}: ${inst}.combine(a.${f.name}, b.${f.name})`;
      })
      .join(",\n");

    return `
const ${varName}: Semigroup<${typeName}> = /*#__PURE__*/ {
  combine: (a: ${typeName}, b: ${typeName}): ${typeName} => ({
${fieldCombines}
  }),
};
/*#__PURE__*/ Semigroup.registerInstance<${typeName}>("${typeName}", ${varName});
`;
  },

  deriveSum(
    _typeName: string,
    _discriminant: string,
    _variants: Array<{ tag: string; typeName: string }>
  ): string {
    // Semigroup cannot generally be derived for sum types
    return `// Semigroup cannot be auto-derived for sum types`;
  },
};

builtinDerivations["Monoid"] = {
  deriveProduct(typeName: string, fields: DeriveFieldInfo[]): string {
    const varName = instanceVarName("monoid", typeName);
    const fieldEmpties = fields
      .map((f) => {
        const inst = instanceVarName("monoid", getBaseType(f));
        return `    ${f.name}: ${inst}.empty()`;
      })
      .join(",\n");
    const fieldCombines = fields
      .map((f) => {
        const inst = instanceVarName("monoid", getBaseType(f));
        return `    ${f.name}: ${inst}.combine(a.${f.name}, b.${f.name})`;
      })
      .join(",\n");

    return `
const ${varName}: Monoid<${typeName}> = /*#__PURE__*/ {
  empty: (): ${typeName} => ({
${fieldEmpties}
  }),
  combine: (a: ${typeName}, b: ${typeName}): ${typeName} => ({
${fieldCombines}
  }),
};
/*#__PURE__*/ Monoid.registerInstance<${typeName}>("${typeName}", ${varName});
`;
  },

  deriveSum(
    _typeName: string,
    _discriminant: string,
    _variants: Array<{ tag: string; typeName: string }>
  ): string {
    return `// Monoid cannot be auto-derived for sum types`;
  },
};

// ============================================================================
// Clone derivation
// ============================================================================

builtinDerivations["Clone"] = {
  deriveProduct(typeName: string, fields: DeriveFieldInfo[]): string {
    const varName = instanceVarName("clone", typeName);
    const copies = fields.map((f) => `    ${f.name}: a.${f.name}`).join(",\n");

    return `
const ${varName}: Clone<${typeName}> = {
  clone: (a: ${typeName}): ${typeName} => ({
${copies}
  }),
};
/*#__PURE__*/ Clone.registerInstance<${typeName}>("${typeName}", ${varName});
`;
  },

  deriveSum(
    typeName: string,
    discriminant: string,
    variants: Array<{ tag: string; typeName: string }>
  ): string {
    const varName = instanceVarName("clone", typeName);
    const cases = variants
      .map((v) => {
        return `      case "${v.tag}": return { ...a } as ${typeName};`;
      })
      .join("\n");

    return `
const ${varName}: Clone<${typeName}> = {
  clone: (a: ${typeName}): ${typeName} => {
    switch ((a as any).${discriminant}) {
${cases}
      default: return { ...a } as ${typeName};
    }
  },
};
/*#__PURE__*/ Clone.registerInstance<${typeName}>("${typeName}", ${varName});
`;
  },
};

// ============================================================================
// Debug derivation
// ============================================================================

builtinDerivations["Debug"] = {
  deriveProduct(typeName: string, fields: DeriveFieldInfo[]): string {
    const varName = instanceVarName("debug", typeName);
    const pairs = fields.map((f) => `${f.name}: \${JSON.stringify(a.${f.name})}`).join(", ");

    return `
const ${varName}: Debug<${typeName}> = {
  debug: (a: ${typeName}): string => \`${typeName} { ${pairs} }\`,
};
/*#__PURE__*/ Debug.registerInstance<${typeName}>("${typeName}", ${varName});
`;
  },

  deriveSum(
    typeName: string,
    discriminant: string,
    variants: Array<{ tag: string; typeName: string }>
  ): string {
    const varName = instanceVarName("debug", typeName);
    const cases = variants
      .map((v) => {
        return `      case "${v.tag}": return \`${v.typeName}(\${JSON.stringify(a)})\`;`;
      })
      .join("\n");

    return `
const ${varName}: Debug<${typeName}> = {
  debug: (a: ${typeName}): string => {
    switch ((a as any).${discriminant}) {
${cases}
      default: return String(a);
    }
  },
};
/*#__PURE__*/ Debug.registerInstance<${typeName}>("${typeName}", ${varName});
`;
  },
};

// ============================================================================
// Default derivation
// ============================================================================

function getDefaultValueForType(field: DeriveFieldInfo): string {
  if (field.optional) return "undefined";
  const baseType = getBaseType(field);
  switch (baseType) {
    case "number":
      return "0";
    case "string":
      return '""';
    case "boolean":
      return "false";
    case "array":
      return "[]";
    default: {
      // Try to detect known types that need special handling
      const typeStr = field.typeString.trim();
      const lower = typeStr.toLowerCase();
      if (lower === "date") {
        return "new Date(0)";
      }
      if (lower.startsWith("map<") || lower === "map") {
        return "new Map()";
      }
      if (lower.startsWith("set<") || lower === "set") {
        return "new Set()";
      }
      if (lower === "null") {
        return "null";
      }
      // For unknown object types, summon their Default instance if available
      // This enables transitive derivation - if the nested type also has @derive(Default),
      // its default instance will be used
      if (/^[A-Z]/.test(typeStr) && !typeStr.includes("<") && !typeStr.includes("|")) {
        return `summon<Default<${typeStr}>>().default()`;
      }
      // Fallback: empty object cast (will fail typecheck if wrong)
      return `({} as ${typeStr})`;
    }
  }
}

builtinDerivations["Default"] = {
  deriveProduct(typeName: string, fields: DeriveFieldInfo[]): string {
    const varName = instanceVarName("default", typeName);
    const defaults = fields.map((f) => `    ${f.name}: ${getDefaultValueForType(f)}`).join(",\n");

    return `
const ${varName}: Default<${typeName}> = {
  default: (): ${typeName} => ({
${defaults}
  }),
};
/*#__PURE__*/ Default.registerInstance<${typeName}>("${typeName}", ${varName});
`;
  },

  deriveSum(
    typeName: string,
    _discriminant: string,
    _variants: Array<{ tag: string; typeName: string }>
  ): string {
    return `// Default cannot be auto-derived for sum types`;
  },
};

// ============================================================================
// Json derivation
// ============================================================================

builtinDerivations["Json"] = {
  deriveProduct(typeName: string, fields: DeriveFieldInfo[]): string {
    const varName = instanceVarName("json", typeName);
    const fieldCopies = fields.map((f) => `      ${f.name}: a.${f.name}`).join(",\n");
    const validations = fields
      .map((f) => {
        const baseType = getBaseType(f);
        const lines: string[] = [];
        if (!f.optional) {
          lines.push(
            `    if (obj.${f.name} === undefined) throw new Error("Missing required field: ${f.name}");`
          );
        }
        lines.push(
          `    if (obj.${f.name} !== undefined && typeof obj.${f.name} !== "${baseType}") throw new Error("Field ${f.name} must be ${baseType}");`
        );
        return lines.join("\n");
      })
      .join("\n");

    return `
const ${varName}: Json<${typeName}> = {
  toJson: (a: ${typeName}): unknown => ({
${fieldCopies}
  }),
  fromJson: (json: unknown): ${typeName} => {
    if (typeof json !== "object" || json === null) throw new Error("Expected object for ${typeName}");
    const obj = json as Record<string, unknown>;
${validations}
    return obj as unknown as ${typeName};
  },
};
/*#__PURE__*/ Json.registerInstance<${typeName}>("${typeName}", ${varName});
`;
  },

  deriveSum(
    typeName: string,
    discriminant: string,
    variants: Array<{ tag: string; typeName: string }>
  ): string {
    const varName = instanceVarName("json", typeName);
    const validTags = variants.map((v) => `"${v.tag}"`).join(", ");

    return `
const ${varName}: Json<${typeName}> = {
  toJson: (a: ${typeName}): unknown => ({ ...a }),
  fromJson: (json: unknown): ${typeName} => {
    if (typeof json !== "object" || json === null) throw new Error("Expected object for ${typeName}");
    const obj = json as Record<string, unknown>;
    if (typeof obj.${discriminant} !== "string") throw new Error("Missing discriminant: ${discriminant}");
    const validTags = [${validTags}];
    if (!validTags.includes(obj.${discriminant} as string)) throw new Error(\`Invalid ${discriminant}: \${obj.${discriminant}}\`);
    return obj as unknown as ${typeName};
  },
};
/*#__PURE__*/ Json.registerInstance<${typeName}>("${typeName}", ${varName});
`;
  },
};

// ============================================================================
// TypeGuard derivation
// ============================================================================

builtinDerivations["TypeGuard"] = {
  deriveProduct(typeName: string, fields: DeriveFieldInfo[]): string {
    const varName = instanceVarName("typeGuard", typeName);

    if (fields.length === 0) {
      return `
const ${varName}: TypeGuard<${typeName}> = {
  is: (value: unknown): boolean => typeof value === "object" && value !== null,
};
/*#__PURE__*/ TypeGuard.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    }

    const checks = fields.map((f) => {
      const baseType = getBaseType(f);
      const check = `typeof (value as any).${f.name} === "${baseType}"`;
      if (f.optional) {
        return `((value as any).${f.name} === undefined || ${check})`;
      }
      return check;
    });

    return `
const ${varName}: TypeGuard<${typeName}> = {
  is: (value: unknown): boolean => typeof value === "object" && value !== null && ${checks.join(" && ")},
};
/*#__PURE__*/ TypeGuard.registerInstance<${typeName}>("${typeName}", ${varName});
`;
  },

  deriveSum(
    typeName: string,
    discriminant: string,
    variants: Array<{ tag: string; typeName: string }>
  ): string {
    const varName = instanceVarName("typeGuard", typeName);
    const validTags = variants.map((v) => `"${v.tag}"`).join(", ");

    return `
const ${varName}: TypeGuard<${typeName}> = {
  is: (value: unknown): boolean => {
    if (typeof value !== "object" || value === null) return false;
    if (typeof (value as any).${discriminant} !== "string") return false;
    return [${validTags}].includes((value as any).${discriminant});
  },
};
/*#__PURE__*/ TypeGuard.registerInstance<${typeName}>("${typeName}", ${varName});
`;
  },
};

// ============================================================================
// Comprehension Typeclass Support (FlatMap, ParCombine)
// ============================================================================
// These functions allow the comprehension macros (let:/yield:, par:/yield:)
// to use the unified typeclass registry instead of maintaining separate
// registries for FlatMap and ParCombine instances.

/**
 * Register a typeclass programmatically (without @typeclass decorator).
 * Used to register FlatMap, ParCombine, and similar HKT typeclasses
 * that are defined as plain interfaces.
 */
export function registerTypeclassDef(info: TypeclassInfo): void {
  typeclassRegistry.set(info.name, info);
  // syntax is stored directly in typeclassRegistry as part of TypeclassInfo
}

/**
 * Update or create a minimal typeclass registration with operator syntax.
 * Used by the transformer for pre-scanning typeclass definitions in imports.
 *
 * If the typeclass already exists, only updates the syntax field.
 * If it doesn't exist, creates a minimal placeholder entry.
 *
 * @param tcName - Typeclass name
 * @param syntax - Operator to method name mappings
 */
export function updateTypeclassSyntax(tcName: string, syntax: Map<string, string>): void {
  const existing = typeclassRegistry.get(tcName);
  if (existing) {
    // Merge new syntax into existing
    if (!existing.syntax) {
      existing.syntax = syntax;
    } else {
      for (const [op, method] of syntax) {
        existing.syntax.set(op, method);
      }
    }
  } else {
    // Create minimal placeholder - will be fully registered when @typeclass is processed
    typeclassRegistry.set(tcName, {
      name: tcName,
      typeParam: "A",
      methods: [],
      canDeriveProduct: false,
      canDeriveSum: false,
      syntax,
    });
  }
}

/**
 * Register a typeclass instance with optional metadata.
 * Used by comprehension macros to register FlatMap/ParCombine instances
 * for standard types (Promise, Array, etc.).
 *
 * @param info The instance information including optional metadata
 */
export function registerInstanceWithMeta(info: InstanceInfo): void {
  // Check for existing instance and update if found
  const existingIndex = instanceRegistry.findIndex(
    (i) => i.typeclassName === info.typeclassName && i.forType === info.forType
  );
  if (existingIndex >= 0) {
    instanceRegistry[existingIndex] = info;
  } else {
    instanceRegistry.push(info);
  }
}

/**
 * Get instance metadata for a typeclass+type combination.
 * Returns undefined if no instance is found or if it has no metadata.
 */
export function getInstanceMeta(
  typeclassName: string,
  forType: string,
  sourceFileName?: string
): InstanceMeta | undefined {
  const instance = findInstance(typeclassName, forType, sourceFileName);
  return instance?.meta;
}

/**
 * Get the method names for a FlatMap instance.
 * Falls back to defaults if no custom method names are specified.
 *
 * @param forType The type constructor name (e.g., "Promise", "Array")
 * @returns Method names for bind, map, and orElse operations
 */
export function getFlatMapMethodNames(
  forType: string,
  sourceFileName?: string
): {
  bind: string;
  map: string;
  orElse?: string;
} {
  const instance = findInstance("FlatMap", forType, sourceFileName);
  const meta = instance?.meta;
  const methodNames = meta?.methodNames;

  // Defaults
  const defaults = {
    bind: "flatMap",
    map: "map",
    orElse: "orElse",
  };

  // Special case for Promise (uses .then())
  if (forType === "Promise") {
    return { bind: "then", map: "then", orElse: "catch" };
  }

  // Special case for Effect (static methods)
  if (forType === "Effect") {
    return { bind: "flatMap", map: "map", orElse: "catchAll" };
  }

  if (methodNames) {
    return {
      bind: methodNames.bind ?? defaults.bind,
      map: methodNames.map ?? defaults.map,
      orElse: methodNames.orElse ?? defaults.orElse,
    };
  }

  return defaults;
}

// ============================================================================
// ParCombine Builder Registry
// ============================================================================
// Builders for zero-cost AST generation are stored separately from instances
// because they are function values (can't be stored in InstanceInfo which
// needs to be serializable for caching).

/**
 * Type for a ParCombine builder function.
 * Generates optimized AST for par:/yield: comprehensions.
 */
export type ParCombineBuilder = (
  ctx: MacroContext,
  steps: Array<
    | { kind: "bind"; name: string; effect: ts.Expression; node: ts.Node }
    | { kind: "map"; name: string; expression: ts.Expression; node: ts.Node }
  >,
  returnExpr: ts.Expression
) => ts.Expression;

/** Registry mapping type constructor names to ParCombine builders */
const parCombineBuilderRegistry = new Map<string, ParCombineBuilder>();

/**
 * Register a ParCombine builder for a type constructor.
 * The builder generates optimized AST instead of generic .map()/.ap() chains.
 */
export function registerParCombineBuilder(forType: string, builder: ParCombineBuilder): void {
  parCombineBuilderRegistry.set(forType, builder);
}

/**
 * Get the ParCombine builder for a type constructor.
 */
export function getParCombineBuilderFromRegistry(forType: string): ParCombineBuilder | undefined {
  return parCombineBuilderRegistry.get(forType);
}

/**
 * Check if a FlatMap instance exists for a type.
 * Used by let:/yield: macro to validate type support.
 */
export function hasFlatMapInstance(forType: string, sourceFileName?: string): boolean {
  return findInstance("FlatMap", forType, sourceFileName) !== undefined;
}

/**
 * Check if a ParCombine instance exists for a type.
 * Used by par:/yield: macro to validate type support.
 */
export function hasParCombineInstance(forType: string, sourceFileName?: string): boolean {
  return findInstance("ParCombine", forType, sourceFileName) !== undefined;
}

// ============================================================================
// Register FlatMap and ParCombine typeclasses
// ============================================================================

// Register FlatMap typeclass definition
registerTypeclassDef({
  name: "FlatMap",
  typeParam: "F",
  methods: [
    {
      name: "map",
      params: [
        { name: "fa", typeString: "F" },
        { name: "f", typeString: "(a: A) => B" },
      ],
      returnType: "F",
      isSelfMethod: true,
    },
    {
      name: "flatMap",
      params: [
        { name: "fa", typeString: "F" },
        { name: "f", typeString: "(a: A) => F" },
      ],
      returnType: "F",
      isSelfMethod: true,
    },
  ],
  canDeriveProduct: false,
  canDeriveSum: false,
});

// Register ParCombine typeclass definition
registerTypeclassDef({
  name: "ParCombine",
  typeParam: "F",
  methods: [
    {
      name: "all",
      params: [{ name: "effects", typeString: "readonly F[]" }],
      returnType: "F",
      isSelfMethod: false,
    },
    {
      name: "map",
      params: [
        { name: "combined", typeString: "F" },
        { name: "f", typeString: "(results: unknown[]) => unknown" },
      ],
      returnType: "F",
      isSelfMethod: false,
    },
  ],
  canDeriveProduct: false,
  canDeriveSum: false,
});

// ============================================================================
// Register all macros with the global registry
// ============================================================================

/**
 * Re-register all built-in typeclass macros with the global registry.
 * Useful in tests that call `globalRegistry.clear()` — module-level
 * registrations only happen once at import time, so this function
 * lets you restore them.
 */
export function registerTypeclassMacros(): void {
  globalRegistry.register(typeclassAttribute);
  globalRegistry.register(typeclassMacro);
  globalRegistry.register(implAttribute);
  globalRegistry.register(implMacro);
  globalRegistry.register(
    defineAttributeMacro({
      name: "instance",
      module: "@typesugar/typeclass",
      cacheable: implAttribute.cacheable,
      description: "@deprecated Use @impl instead",
      validTargets: implAttribute.validTargets,
      expand: implAttribute.expand,
    })
  );
  globalRegistry.register(
    defineExpressionMacro({
      name: "instance",
      module: "@typesugar/typeclass",
      description: "@deprecated Use impl() instead",
      expand: implMacro.expand,
    })
  );
  globalRegistry.register(deriveAttribute);
  globalRegistry.register(derivingAttribute);
  globalRegistry.register(summonMacro);
  globalRegistry.register(extendMacro);
  globalRegistry.register(showTCDerive);
  globalRegistry.register(eqTCDerive);
  globalRegistry.register(ordTCDerive);
  globalRegistry.register(hashTCDerive);
  globalRegistry.register(functorTCDerive);
}

registerTypeclassMacros();

// ============================================================================
// Exports
// ============================================================================

export type {
  TypeclassInfo,
  TypeclassMethod,
  InstanceInfo,
  InstanceMeta,
  BuiltinTypeclassDerivation,
  SyntaxEntry,
};

export {
  typeclassRegistry,
  instanceRegistry,
  builtinDerivations,
  findInstance,
  getTypeclass,
  instanceVarName,
  createTypeclassDeriveMacro,
  getSyntaxForOperator,
  clearSyntaxRegistry, // deprecated, no-op
  // Comprehension typeclass support (exported via export function declarations above)
  parCombineBuilderRegistry,
};
