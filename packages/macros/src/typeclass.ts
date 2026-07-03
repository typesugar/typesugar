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
import { defineAttributeMacro, defineExpressionMacro, globalRegistry } from "@typesugar/core";
import {
  MacroContext,
  DeriveTypeInfo,
  DeriveFieldInfo,
  DeriveVariantInfo,
  parseTypeInstantiation,
} from "@typesugar/core";
import {
  findStandaloneExtension as findStandaloneExtensionForExtend,
  buildStandaloneExtensionCall,
} from "./extension.js";
import { registerInstanceMethodsFromAST, extractMethodsFromObjectLiteral } from "./specialize.js";
import {
  formatResolutionTrace,
  generateHelpFromTrace,
  type ResolutionAttempt,
  type ResolutionTrace,
} from "@typesugar/core";
import type { DerivationResult } from "./auto-derive.js";
import { globalResolutionScope } from "@typesugar/core";
import { TS9001, TS9005, TS9008, TS9101, TS9203, TS9305 } from "@typesugar/core";
import { getSuggestionsForTypeclass } from "@typesugar/core";
import { resolveTypeConstructorViaTypeChecker, parseTypeConstructor } from "./hkt.js";
import { resolveInstance, hasInstanceInScopeByName } from "./instance-resolver.js";
// Circular by design (typeclass-index seeds from this module's STANDARD_TYPECLASS_DEFS);
// only referenced inside macro `expand` bodies, so the binding is resolved at call time.
import {
  getTypeclassesDeclaringMethod,
  getTypeclassDef,
  isHktTypeclass as isHktTypeclassDeclared,
} from "./typeclass-index.js";

// ============================================================================
// Ambient Derivation Context
// ============================================================================
//
// Set before invoking derivation code so that `companionAccess` can use the
// instance resolver without every derivation having to thread `ctx` through
// its interface.  Callers use `withDerivationContext(ctx, fn)` which
// guarantees cleanup even if `fn` throws.
// ============================================================================

let _currentDerivationCtx: MacroContext | undefined;

/**
 * Run `fn` with the given MacroContext available to `companionAccess`.
 * The context is automatically restored (to its previous value) on exit.
 */
export function withDerivationContext<T>(ctx: MacroContext, fn: () => T): T {
  const prev = _currentDerivationCtx;
  _currentDerivationCtx = ctx;
  try {
    return fn();
  } finally {
    _currentDerivationCtx = prev;
  }
}

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
 * Check if a type already has an instance for a typeclass — a primitive (built-in
 * companion instance) or an `@impl`/`@instance` value visible in the file's scope.
 * Registry-free (PEP-052 Phase C): scope-based, so it can't see instances registered
 * by an unrelated file's compilation.
 */
function hasPrimitiveOrInstance(
  ctx: MacroContext,
  typeName: string,
  typeclassName: string
): boolean {
  // Hardcoded primitives — always have built-in/companion instances.
  const primitives = ["number", "string", "boolean", "bigint", "null", "undefined"];
  if (primitives.includes(typeName.toLowerCase())) {
    return true;
  }
  // A user instance for this typeclass + type visible in scope (local or imported).
  return hasInstanceInScopeByName(ctx, typeclassName, typeName);
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

  /**
   * Well-known discriminant field names used to auto-detect tagged unions.
   *
   * These cover the most common conventions:
   * - `kind`        — TypeScript handbook pattern
   * - `_tag`        — Effect / fp-ts convention
   * - `type`        — Redux actions, general-purpose
   * - `tag`         — common short alternative
   * - `__typename`  — GraphQL introspection field
   *
   * If your union uses a different discriminant, you can specify it
   * explicitly via `@derive` options (e.g., `@derive Eq({ discriminant: "status" })`)
   * or define typeclass instances manually instead of using `@derive`.
   */
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
    if (hasPrimitiveOrInstance(ctx, typeName, typeclassName)) {
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
  // Types generated in this pass — the scanner can't see instances we emit as new
  // AST until a re-scan, so track them locally to avoid double-generating a type
  // that appears more than once in the plan (registry-free dedup, PEP-052 Phase C).
  const generated = new Set<string>();

  for (const typeInfo of plan.types) {
    if (
      generated.has(typeInfo.typeName) ||
      hasPrimitiveOrInstance(ctx, typeInfo.typeName, typeclassName)
    ) {
      continue;
    }

    const expansion = tryExpandGenericDerive(ctx, typeclassName, typeInfo.typeName, typeInfo.node);
    if (expansion) {
      statements.push(...expansion.statements);
      generated.add(typeInfo.typeName);
    }

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
  /**
   * All type parameter names of the interface (the first is `typeParam`).
   * Used for positional substitution when flattening inherited members.
   */
  typeParams?: string[];
  /**
   * Named member signatures (member name + raw source text), used by the
   * op-index to flatten inherited members across `extends` clauses.
   */
  memberEntries?: Array<{ name: string; text: string }>;
  /**
   * `extends` heritage references: parent typeclass name + type argument texts.
   * Resolved by the op-index (declaration-name lookup) to inherit members and
   * HKT-ness from parent typeclasses.
   */
  heritage?: Array<{ name: string; typeArgs: string[] }>;
  /**
   * Whether a member signature applies the interface's own type parameter as a
   * type constructor (`Kind<F, ...>`). Direct members only; the op-index
   * computes the transitive (heritage-aware) HKT flag from this.
   */
  usesKind?: boolean;
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
  /** Companion property path, e.g. "Point.Eq" or "Eq.number" */
  companionPath?: string;
  /** Whether this was auto-derived */
  derived: boolean;
  /**
   * Module specifier where the instance variable is exported.
   * Used by the transformer to inject imports when operator rewriting
   * references an instance from another module.
   */
  sourceModule?: string;
}

// ============================================================================
// Operator Syntax Lookup — operator → typeclass method mappings
// ============================================================================

interface SyntaxEntry {
  typeclass: string;
  method: string;
}

/**
 * Get all typeclasses that declare a method with the given name.
 *
 * This is the method-name analogue of operator lookup: it powers
 * the instance-method sugar (`x.method(args)` → `Companion.method(x, args)`) by
 * mapping a called method name back to the typeclass(es) that define it.
 * Multiple typeclasses may declare the same method name — ambiguity is resolved
 * at the call site by checking which one has an instance for the receiver type.
 */
function getTypeclassesForMethod(methodName: string): SyntaxEntry[] | undefined {
  // Registry-free (PEP-052): the SFINAE diagnostic filter that calls this runs at
  // check-time (`noEmit`), where no transformer has populated user typeclasses — so
  // the static standard definitions are the authoritative method→typeclass source.
  const entries: SyntaxEntry[] = [];

  for (const def of STANDARD_TYPECLASS_DEFS) {
    if (def.methods.some((m) => m.name === methodName)) {
      entries.push({ typeclass: def.name, method: methodName });
    }
  }

  return entries.length > 0 ? entries : undefined;
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

/**
 * Static op/method metadata for the standard typeclasses, derived from the
 * built-in definitions. This is plain immutable data (NOT the mutable
 * `typeclassRegistry`); the typeclass index consumes it as a built-in fallback so
 * standard typeclass operators/methods resolve even when the typeclass interface
 * isn't present in the program's source (e.g. code/tests that don't import std).
 */
export function getStandardTypeclassOpInfos(): Array<{
  name: string;
  opToMethod: Map<string, string>;
  methodNames: Set<string>;
  def: TypeclassInfo;
}> {
  return STANDARD_TYPECLASS_DEFS.map((def) => ({
    name: def.name,
    opToMethod: new Map(def.syntax),
    methodNames: new Set(def.methods.map((m) => m.name)),
    // Full definition for the op-index's definition store (HKT expansion, public API).
    // Std defs carry no fullSignatureText — HKT expansion uses the template fallback.
    def: {
      name: def.name,
      typeParam: def.typeParam,
      methods: def.methods,
      canDeriveProduct: def.canDeriveProduct,
      canDeriveSum: def.canDeriveSum,
      syntax: def.syntax,
    },
  }));
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
 * Generate the internal variable name for a typeclass instance.
 *
 * INTENTIONALLY UNHYGIENIC: Instance names like `showPoint`, `eqNumber` are still
 * generated for internal use (specialization, inlining, registry tracking), but are
 * no longer the primary public API. Users access instances via companion objects:
 *   - Data type companion: Point.Eq, Point.Show (for user-defined types)
 *   - Typeclass companion: Eq.number, Show.string (for primitives)
 * See PEP-032 for the companion object pattern.
 */
function instanceVarName(tcName: string, typeName: string): string {
  return `${uncapitalize(tcName)}${capitalize(typeName)}`;
}

/** Types where the companion lives on the typeclass, not on the type itself. */
const PRIMITIVE_TYPES = [
  "number",
  "string",
  "boolean",
  "bigint",
  "Date",
  "symbol",
  "undefined",
  "null",
  "void",
  "never",
  "unknown",
  "any",
  "object",
];

/**
 * Generate the companion property path for a typeclass instance.
 * E.g., companionPath("Eq", "Point") -> "Point.Eq"
 *       companionPath("Eq", "number") -> "Eq.number"  (primitive on typeclass companion)
 */
function companionPath(tcName: string, typeName: string): string {
  if (PRIMITIVE_TYPES.includes(typeName)) {
    return `${tcName}.${typeName}`;
  }
  return `${typeName}.${tcName}`;
}

/**
 * Generate a companion property access expression for use in generated code.
 * Uses namespace merging for type-safe access (e.g., Point.Eq, Eq.number).
 *
 * When a derivation context is active (via `withDerivationContext`) and a
 * `fieldType` is provided, attempts resolver-based instance lookup first
 * (Scala 3-style). Falls back to the hardcoded companion path when the
 * resolver finds nothing or when no context is active.
 */
function companionAccess(tcName: string, typeName: string, fieldType?: ts.Type): string {
  // When an ambient derivation context is active, delegate to the public API
  // which tries the resolver.  Otherwise fall back to the companion convention
  // (no resolver available without a MacroContext).
  if (_currentDerivationCtx) {
    return resolveFieldInstance(_currentDerivationCtx, tcName, typeName, fieldType);
  }
  return companionPathFallback(tcName, typeName);
}

/** Companion-path convention without resolver (shared by companionAccess and resolveFieldInstance). */
function companionPathFallback(tcName: string, typeName: string): string {
  if (PRIMITIVE_TYPES.includes(typeName)) {
    return `${tcName}.${typeName}`;
  }
  return `${typeName}.${tcName}`;
}

/**
 * Resolve the code-gen reference for a typeclass instance on a field type.
 *
 * This is the public API that any derivation — builtin or external — should
 * use to look up field-level instances.  It queries the instance resolver
 * (Scala 3-style scope search) and falls back to the companion-path
 * convention (`TC.prim` for primitives, `TypeName.TC` for user types).
 *
 * @param ctx       - The macro context (provides program, typeChecker, sourceFile)
 * @param tcName    - Typeclass name (e.g., "Ord", "Pretty")
 * @param typeName  - String name of the field type (e.g., "number", "Point")
 * @param fieldType - Optional ts.Type for type-based matching (preferred when available)
 * @returns A code expression string referencing the resolved instance
 */
export function resolveFieldInstance(
  ctx: MacroContext,
  tcName: string,
  typeName: string,
  fieldType?: ts.Type
): string {
  if (fieldType) {
    const resolved = resolveInstance(ctx, tcName, fieldType);
    if (resolved && resolved.kind === "resolved") {
      return resolved.exportName;
    }
  }

  return companionPathFallback(tcName, typeName);
}

/**
 * Generate a companion const declaration for a data type.
 *
 * For interfaces and type aliases, uses declaration merging:
 *   interface Foo { ... }
 *   const Foo: Record<string, any> = {};
 *
 * For classes (which are already values), returns null since properties can be
 * assigned directly to the class.
 */
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

/**
 * Extract a {@link TypeclassInfo} from a `@typeclass` interface declaration.
 *
 * Pure (no macro context): shared by the `@typeclass` attribute macro and the
 * per-program op-index (`typeclass-index.ts`), which re-derives definitions directly
 * from the interface AST rather than a process-global registry (PEP-052 Phase C).
 * Returns `undefined` when the interface has no type parameter.
 */
export function buildTypeclassInfoFromInterface(
  iface: ts.InterfaceDeclaration
): TypeclassInfo | undefined {
  const typeParams = iface.typeParameters;
  if (!typeParams || typeParams.length === 0) return undefined;
  const typeParam = typeParams[0].name.text;
  const typeParamNames = typeParams.map((p) => p.name.text);

  // Extract methods from the interface (handles both MethodSignature and PropertySignature).
  const methods: TypeclassMethod[] = [];
  const memberTexts: string[] = [];
  const memberEntries: Array<{ name: string; text: string }> = [];

  for (const member of iface.members) {
    // Capture raw source text of each member for HKT expansion.
    const sourceFile = member.getSourceFile();
    if (sourceFile) {
      const text = member.getText(sourceFile);
      memberTexts.push(text);
      if (member.name && ts.isIdentifier(member.name)) {
        // Strip a trailing separator so joined texts stay parseable.
        memberEntries.push({ name: member.name.text, text: text.replace(/[;,]\s*$/, "") });
      }
    }

    if (ts.isMethodSignature(member) && member.name) {
      const methodName = ts.isIdentifier(member.name) ? member.name.text : member.name.getText();

      const params: Array<{ name: string; typeString: string }> = [];
      let isSelfMethod = false;

      for (let i = 0; i < member.parameters.length; i++) {
        const param = member.parameters[i];
        const paramName = ts.isIdentifier(param.name) ? param.name.text : param.name.getText();
        const paramType = param.type ? param.type.getText() : "unknown";

        // Check if this parameter uses the typeclass's type param.
        if (i === 0 && paramType === typeParam) {
          isSelfMethod = true;
        }

        params.push({ name: paramName, typeString: paramType });
      }

      const operatorSymbol = extractOpFromJSDoc(member);
      const returnType = member.type ? member.type.getText() : "void";

      methods.push({ name: methodName, params, returnType, isSelfMethod, operatorSymbol });
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

  // Full interface body text for HKT expansion.
  const fullSignatureText = memberTexts.length > 0 ? `{ ${memberTexts.join("; ")} }` : undefined;

  // Syntax map from @op JSDoc tags on methods.
  const syntax = new Map<string, string>();
  for (const method of methods) {
    if (method.operatorSymbol) {
      syntax.set(method.operatorSymbol, method.name);
    }
  }

  const isExported = iface.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;

  // Heritage clauses (`extends Parent<F>`): recorded by name so the op-index can
  // flatten inherited members and propagate HKT-ness (declaration-derived, PEP-052).
  const heritage: Array<{ name: string; typeArgs: string[] }> = [];
  for (const clause of iface.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const t of clause.types) {
      if (!ts.isIdentifier(t.expression)) continue;
      heritage.push({
        name: t.expression.text,
        typeArgs: (t.typeArguments ?? []).map((a) => a.getText()),
      });
    }
  }

  // HKT detection: the typeclass is higher-kinded iff a member signature applies
  // the interface's own type parameter as a type constructor — `Kind<F, ...>`.
  const kindPattern = new RegExp(`\\bKind\\s*<\\s*${escapeRegExp(typeParam)}\\s*[,>]`);
  const usesKind = memberTexts.some((t) => kindPattern.test(t));

  return {
    name: iface.name.text,
    typeParam,
    methods,
    canDeriveProduct: true,
    canDeriveSum: true,
    fullSignatureText,
    syntax: syntax.size > 0 ? syntax : undefined,
    isExported,
    typeParams: typeParamNames,
    memberEntries,
    heritage: heritage.length > 0 ? heritage : undefined,
    usesKind,
  };
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

    const tcInfo = buildTypeclassInfoFromInterface(target);
    if (!tcInfo) {
      ctx.reportError(
        target,
        "@typeclass interface must have at least one type parameter (e.g., interface Show<A>)"
      );
      return target;
    }

    const tcName = tcInfo.name;
    const isExported = tcInfo.isExported ?? false;
    // No registry write (PEP-052): the op-index re-derives this definition from the
    // interface AST per program. We only mark the typeclass as in-scope for this file.
    globalResolutionScope.registerDefinedTypeclass(ctx.sourceFile.fileName, tcName);

    const statements: ts.Statement[] = [];

    // Only generate runtime registry infrastructure for exported typeclasses.
    // Internal typeclasses use compile-time resolution only (zero-cost).
    if (isExported) {
      const companionCode = generateCompanionConst(ctx, tcInfo, isExported);
      statements.push(...ctx.parseStatements(companionCode));
    }

    return [target, ...statements];
  },
});

/**
 * Generate a companion const for a typeclass.
 *
 * Uses TypeScript declaration merging: interface + const with the same name.
 * The interface is the type, the const is the value (companion object).
 *
 * Scala 3 equivalent:
 *   object Show {
 *     def summon[A](using tc: Show[A]): Show[A] = tc
 *     def derived[A](using Mirror.ProductOf[A]): Show[A] = ...
 *   }
 */
function generateCompanionConst(ctx: MacroContext, tc: TypeclassInfo, isExported: boolean): string {
  const { name } = tc;
  const exportModifier = isExported ? "export " : "";

  return `
${exportModifier}const ${name} = {};
((globalThis as any).__typesugar_companions = (globalThis as any).__typesugar_companions || {})["${name}"] = ${name};
`;
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
        isHKTInstance = isHKTTypeclass(ctx.program, tcName);
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

      isHKTInstance = isHKTTypeclass(ctx.program, tcName);
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
        let resolution = resolveTypeConstructorViaTypeChecker(ctx, typeName);
        if (resolution) {
          // Auto-register the base type as an HKT expansion
          registerHKTExpansion(resolution.baseType, resolution.baseType);
        } else if (resolvedBase.length > 1 && resolvedBase.endsWith("F")) {
          // `*F` convention (replaces the old hardcoded seed table): `OptionF`
          // names the TypeFunction encoding of `Option`. The encoding interface
          // itself is not generic, so resolve the stripped base name instead and
          // register the `*F` spelling as an expansion to it.
          const strippedBase = resolvedBase.slice(0, -1);
          resolution = resolveTypeConstructorViaTypeChecker(ctx, strippedBase);
          if (resolution) {
            registerHKTExpansion(resolvedBase, resolution.baseType);
          }
        }
        if (!resolution) {
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

    const statements: ts.Node[] = [updatedTarget];

    // Emit companion property assignment for non-primitive types.
    // Primitives are handled by registerInstanceWithMeta + __typesugar_companions.
    const primitives = [
      "number",
      "string",
      "boolean",
      "bigint",
      "Date",
      "symbol",
      "undefined",
      "null",
      "void",
      "never",
      "unknown",
      "any",
      "object",
    ];
    if (!primitives.includes(typeName)) {
      const assignCode = `namespace ${typeName} { export const ${tcName} = ${varName} as ${tcName}<${typeName}>; }`;
      statements.push(...ctx.parseStatements(assignCode));
    }

    return statements;
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
 * Registry mapping HKT type constructor names to their concrete expansions.
 * E.g., "OptionF" → "Option", "ArrayF" → "Array".
 *
 * Populated by the `@impl` macro's tier-1 TypeChecker auto-registration (and
 * `registerHKTExpansion` for explicit registrations) — there are no hardcoded
 * seed entries (PEP-052 Wave 4): the `*F` → base-name convention is resolved
 * against the program's declarations instead.
 */
export const hktExpansionRegistry = new Map<string, string>();

/**
 * Check if a typeclass uses HKT.
 *
 * Declaration-derived (PEP-052 Wave 4): a typeclass is higher-kinded iff its
 * `@typeclass` interface declaration (or an inherited one) applies its type
 * parameter as a type constructor — i.e. some member signature references
 * `Kind<F, ...>` where `F` is the interface's type parameter. Read from the
 * per-program op-index; no hardcoded name table.
 */
function isHKTTypeclass(program: ts.Program, name: string): boolean {
  return isHktTypeclassDeclared(program, name);
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
 * Uses dynamic textual substitution of the typeclass declaration's own signature
 * text (`fullSignatureText` from the op-index, with inherited members flattened
 * across `extends` clauses). Returns undefined — no annotation is emitted — when
 * the typeclass declaration is not visible in the program.
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

  const tcInfo = getTypeclassDef(ctx.program, typeclassName);
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
//   namespace Point {
//     export const Show: Show<Point> = {
//       show: (a) => `Point(x = ${showNumber.show(a.x)}, y = ${showNumber.show(a.y)})`,
//     };
//     export const Eq: Eq<Point> = {
//       eq: (a, b) => eqNumber.eq(a.x, b.x) && eqNumber.eq(a.y, b.y),
//     };
//   }
// ============================================================================

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

  // Fall back to companion access for field instance references
  return companionAccess(tcName, getBaseType(field), field.type);
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

  /** Well-known discriminant field names — see JSDoc at the other call site above. */
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

    // 1. Resolve an explicit instance from scope (PEP-052): an imported/local
    //    `@impl`/`@instance` value for this typeclass + concrete type. Registry-free
    //    — the file brings the instance into scope by importing (or defining) it.
    try {
      const forType = ctx.typeChecker.getTypeFromTypeNode(innerType);
      const scopeResult = resolveInstance(ctx, tcName, forType);
      if (scopeResult && scopeResult.kind === "resolved") {
        return ctx.parseExpression(scopeResult.exportName);
      }
    } catch {
      // checker may throw on unusual type nodes — fall through to auto-derivation
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

    // Find which typeclass provides this method (op-index, scope-based; PEP-052).
    for (const candidate of getTypeclassesDeclaringMethod(ctx.program, methodName)) {
      const tcName = candidate.typeclass;
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
  const parsed = parseTypeInstantiation(text);
  if (!parsed || !parsed.args) return null;
  return { typeclassName: parsed.base, forType: parsed.args };
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

    // Notify coverage system
    notifyPrimitiveRegistered(forType, typeclassName);

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

    // Validate + mark in-scope. No registry write (PEP-052): the op-index re-derives
    // the definition from the interface AST per program.
    if (!buildTypeclassInfoFromInterface(targetInterface)) {
      ctx.reportError(
        targetInterface,
        `Interface ${tcName} must have at least one type parameter (e.g., interface ${tcName}<A>)`
      );
      return ctx.factory.createVoidZero();
    }
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
  equals(a: A, b: A): boolean;
  /** @op !== */
  notEquals(a: A, b: A): boolean;
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
  equals: (a, b) => a === b,
  notEquals: (a, b) => a !== b,
};

const eqString: Eq<string> = /*#__PURE__*/ {
  equals: (a, b) => a === b,
  notEquals: (a, b) => a !== b,
};

const eqBoolean: Eq<boolean> = /*#__PURE__*/ {
  equals: (a, b) => a === b,
  notEquals: (a, b) => a !== b,
};

// Show instances for primitives
const showNumber: Show<number> = /*#__PURE__*/ {
  show: (a) => String(a),
};

const showString: Show<string> = /*#__PURE__*/ {
  show: (a) => JSON.stringify(a),
};

const showBoolean: Show<boolean> = /*#__PURE__*/ {
  show: (a) => String(a),
};

// Ord instances for primitives
const ordNumber: Ord<number> = /*#__PURE__*/ {
  compare: (a, b) => a < b ? -1 : a > b ? 1 : 0,
};

const ordString: Ord<string> = /*#__PURE__*/ {
  compare: (a, b) => a < b ? -1 : a > b ? 1 : 0,
};

// Hash instances for primitives
const hashNumber: Hash<number> = /*#__PURE__*/ {
  hash: (a) => a | 0,
};

const hashString: Hash<string> = /*#__PURE__*/ {
  hash: (a) => {
    let h = 5381;
    for (let i = 0; i < a.length; i++) {
      h = ((h << 5) + h) + a.charCodeAt(i);
    }
    return h >>> 0;
  },
};

const hashBoolean: Hash<boolean> = /*#__PURE__*/ {
  hash: (a) => a ? 1 : 0,
};

// Semigroup instances for primitives
const semigroupNumber: Semigroup<number> = /*#__PURE__*/ {
  combine: (a, b) => a + b,
};

const semigroupString: Semigroup<string> = /*#__PURE__*/ {
  combine: (a, b) => a + b,
};

// Monoid instances for primitives
const monoidNumber: Monoid<number> = /*#__PURE__*/ {
  empty: () => 0,
  combine: (a, b) => a + b,
};

const monoidString: Monoid<string> = /*#__PURE__*/ {
  empty: () => "",
  combine: (a, b) => a + b,
};
`;
}

// ============================================================================
// Instance Registration (companion attachment)
// ============================================================================

/**
 * Register a typeclass instance with optional metadata.
 * Used by std/@derive code paths to attach instance values to their
 * typeclass companion objects (e.g. `Show.number`).
 *
 * @param info The instance information including optional metadata
 */
export function registerInstanceWithMeta(info: InstanceInfo, instanceValue?: any): void {
  // Auto-compute companionPath when instanceValue is provided (indicating the caller
  // wants companion population). This covers std primitives and @derive instances.
  // Manual @impl instances without instanceValue keep flat variable names.
  if (!info.companionPath && instanceValue !== undefined) {
    info.companionPath = companionPath(info.typeclassName, info.forType);
  }

  // PEP-052: general instance resolution is scope-based (no registry). This call
  // survives only to attach the value to its typeclass companion, below.

  // Attach to typeclass companion if available (populated by @typeclass macro)
  if (instanceValue !== undefined) {
    const companions = (globalThis as any).__typesugar_companions;
    if (companions && companions[info.typeclassName]) {
      companions[info.typeclassName][info.forType] = instanceValue;
    }
  }
}

// FlatMap/ParCombine are not registered as typeclass definitions: the do-notation
// macros resolve their INSTANCES via scope-based lookup (resolveDoNotationInstance
// in instance-resolver), and neither needs op-index operator/method metadata
// (PEP-052 Phase C).

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
  globalRegistry.register(summonMacro);
  globalRegistry.register(extendMacro);
}

registerTypeclassMacros();

// ============================================================================
// GenericDerivation expansion for @derive (shared by both transformers)
// ============================================================================

/**
 * Result of expanding a GenericDerivation for @derive.
 * Contains parsed AST statements (including companion namespace) and registry entry,
 * or null if derivation wasn't possible.
 */
export interface GenericDeriveExpansion {
  /** Statements to insert (may include companion const + namespace). */
  statements: ts.Statement[];
  registryEntry: InstanceInfo;
}

/**
 * Try to expand a GenericDerivation strategy for use in @derive.
 *
 * This is the shared logic that both transformers call when @derive(Foo) isn't
 * handled by a registered derive macro.  It calls the
 * GenericDerivation strategy to get a code string, wraps it in a const
 * declaration, converts to a companion namespace (same as builtins), and
 * returns parsed statements.
 *
 * Returns null if no GenericDerivation is registered for `deriveName`, or if
 * the strategy returns null (e.g., unsupported field types).
 */
export function tryExpandGenericDerive(
  ctx: MacroContext,
  deriveName: string,
  typeName: string,
  node?: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration
): GenericDeriveExpansion | null {
  // Lazy import to avoid circular dependency at module load time
  const { hasGenericDerivation: hasGD, tryDeriveViaGeneric: tryGD } =
    require("./auto-derive.js") as typeof import("./auto-derive.js");

  if (!hasGD(deriveName)) return null;

  const result = tryGD(ctx, deriveName, typeName, node);
  if (!result.expression) return null;

  const uncap = deriveName.charAt(0).toLowerCase() + deriveName.slice(1);
  const varName = instanceVarName(uncap, typeName);

  // Build companion namespace directly as AST:
  //   namespace TypeName { export const TCName = <expression>; }
  let expr = result.expression;
  while (ts.isParenthesizedExpression(expr)) expr = expr.expression;

  // Check if the expression references primitive companions of the same typeclass
  // (e.g. Eq.number inside a derived Eq). If so, putting the expression inside
  // `namespace Point { export const Eq = ... }` would shadow the imported `Eq`,
  // breaking the reference. Fix: hoist the impl to module scope and re-export.
  const hasPrimitiveSelfRef = (function checkPrimRef(n: ts.Node): boolean {
    if (
      ts.isPropertyAccessExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === deriveName &&
      PRIMITIVE_TYPES.includes(n.name.text)
    ) {
      return true;
    }
    return ts.forEachChild(n, checkPrimRef) || false;
  })(expr);

  // Don't emit a type annotation (e.g. `Eq<Point>`) — the typeclass name may
  // be a value (frozen object) rather than a generic type. TypeScript infers
  // the structural type from the initializer, which is sufficient.
  const typeAnnotation = undefined;

  const statements: ts.Statement[] = [];
  const isExported =
    node?.modifiers?.some((m: ts.ModifierLike) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  const nsModifiers = isExported
    ? [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)]
    : undefined;

  // NOTE: We deliberately do NOT emit a companion `const TypeName = {}` here.
  // A `namespace TypeName { export const Eq = ... }` already produces a runtime
  // value for `TypeName` and declaration-merges legally with an interface (type
  // space), a type alias, or a class. A companion `const` instead *conflicts*
  // with the namespace ("Cannot redeclare block-scoped variable" / TS2451) at the
  // type level, and was only ever made to work in the emitted JS by a `const`→`var`
  // rewrite in the transpile path (see fixCompanionConsts in pipeline.ts) — which
  // never ran for type-checking or `typesugar expand`. Dropping it makes the
  // companion form (`TypeName.Eq.equals`) type-check for all three node kinds.

  if (hasPrimitiveSelfRef) {
    // If the source file doesn't already import the typeclass name (e.g. Eq),
    // inject an import so the hoisted code can reference Eq.number at runtime.
    const alreadyImported = ctx.sourceFile.statements.some(
      (s) =>
        ts.isImportDeclaration(s) &&
        s.importClause?.namedBindings &&
        ts.isNamedImports(s.importClause.namedBindings) &&
        s.importClause.namedBindings.elements.some((e) => e.name.text === deriveName)
    );
    if (!alreadyImported) {
      const importDecl = ts.factory.createImportDeclaration(
        undefined,
        ts.factory.createImportClause(
          false,
          undefined,
          ts.factory.createNamedImports([
            ts.factory.createImportSpecifier(
              false,
              undefined,
              ts.factory.createIdentifier(deriveName)
            ),
          ])
        ),
        ts.factory.createStringLiteral("@typesugar/macros")
      );
      statements.push(importDecl as unknown as ts.Statement);
    }

    // Hoist: const _PointEq = { ... Eq.number ... };
    //        namespace Point { export const Eq = _PointEq; }
    const hoistedName = `_${typeName}${deriveName}`;

    const hoistedDecl = ts.factory.createVariableStatement(
      undefined,
      ts.factory.createVariableDeclarationList(
        [ts.factory.createVariableDeclaration(hoistedName, undefined, typeAnnotation, expr)],
        ts.NodeFlags.Const
      )
    );

    const reExport = ts.factory.createVariableStatement(
      [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      ts.factory.createVariableDeclarationList(
        [
          ts.factory.createVariableDeclaration(
            deriveName,
            undefined,
            typeAnnotation,
            ts.factory.createIdentifier(hoistedName)
          ),
        ],
        ts.NodeFlags.Const
      )
    );

    const namespaceDecl = ts.factory.createModuleDeclaration(
      nsModifiers,
      ts.factory.createIdentifier(typeName),
      ts.factory.createModuleBlock([reExport]),
      ts.NodeFlags.Namespace
    );

    statements.push(hoistedDecl);
    statements.push(namespaceDecl);
  } else {
    // Standard path: wrap in namespace directly (no shadowing risk).
    const companionProperty = ts.factory.createVariableStatement(
      [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      ts.factory.createVariableDeclarationList(
        [ts.factory.createVariableDeclaration(deriveName, undefined, typeAnnotation, expr)],
        ts.NodeFlags.Const
      )
    );

    const namespaceDecl = ts.factory.createModuleDeclaration(
      nsModifiers,
      ts.factory.createIdentifier(typeName),
      ts.factory.createModuleBlock([companionProperty]),
      ts.NodeFlags.Namespace
    );

    statements.push(namespaceDecl);
  }

  return {
    statements,
    registryEntry: {
      typeclassName: deriveName,
      forType: typeName,
      instanceName: varName,
      companionPath: companionPath(deriveName, typeName),
      derived: true,
    },
  };
}

// ============================================================================
// Exports
// ============================================================================

export type { TypeclassInfo, TypeclassMethod, InstanceInfo, SyntaxEntry };

export { instanceVarName, companionPath, getTypeclassesForMethod };
