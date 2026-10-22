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
 * // The transformer rewrites p.show() to a call on the resolved instance:
 * //   Point.Show.show(p)
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
  isSyntheticNode,
  everyTypeNodeName,
  stripPositions,
} from "@typesugar/core";
import {
  findStandaloneExtension as findStandaloneExtensionForExtend,
  buildStandaloneExtensionCall,
} from "./extension.js";
import {
  registerInstanceMethodsFromAST,
  extractMethodsFromObjectLiteral,
  type DictMethod,
} from "./specialize.js";
// Static: instance-extraction imports only specialize and instance-resolver.
import {
  containsMacroCall,
  inliningFailureReporter,
  methodInlineSymbols,
} from "./instance-extraction.js";
import { derivedCallOf } from "./instance-scanner.js";
import {
  warnDerivedInPlace,
  notOwnedTypeHelp,
  primitiveInstanceHelp,
  suggestedInstanceName,
} from "./derived-in-place.js";
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
  TS9010,
  TS9011,
  TS9101,
  TS9106,
  TS9107,
  TS9203,
  TS9305,
} from "@typesugar/core";
import { getSuggestionsForTypeclass } from "@typesugar/core";
import { resolveTypeConstructorViaTypeChecker, parseTypeConstructor } from "./hkt.js";
import {
  resolveInstance,
  resolveFromTypeclassHome,
  followTypeclassSymbol,
  typeclassKeyName,
  hasInstanceInScopeByName,
  buildInstanceReference,
} from "./instance-resolver.js";
import { setDerivedCallCheck } from "./derived-call-check.js";
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
  // Check if this is a synthetic node
  if (isSyntheticNode(node)) {
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
  memberEntries?: Array<{ name: string; node: ts.TypeElement }>;
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
  /**
   * Operator symbol declared via `@op` JSDoc tag, if any. When the method has
   * several `@op` tags this is the first; see {@link operatorSymbols}.
   */
  operatorSymbol?: string;
  /**
   * Every operator symbol declared via `@op` JSDoc tags, in source order. A
   * method may carry more than one tag to map equivalent spellings of the same
   * operation (`@op ===` and `@op ==` on `Eq.equals`). Set whenever a method is
   * read from a declaration (`operatorSymbols[0] === operatorSymbol`); a
   * hand-built method may set only `operatorSymbol`, which then counts as the
   * single symbol.
   */
  operatorSymbols?: string[];
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
  // Registry-free (PEP-052): the diagnostic suppression filter that calls this runs at
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
        operatorSymbols: ["===", "=="],
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
        operatorSymbols: ["!==", "!="],
      },
    ],
    canDeriveProduct: true,
    canDeriveSum: true,
    syntax: new Map([
      ["===", "equals"],
      ["==", "equals"],
      ["!==", "notEquals"],
      ["!=", "notEquals"],
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
 * Extract every operator symbol from the JSDoc `@op` tags on a method
 * signature, in source order, without duplicates. A method carries one tag per
 * operator it handles, so equivalent spellings map to the same method:
 *
 * @param member - The method signature node to check
 * @returns The operator symbols of all non-empty `@op` tags (empty if none)
 *
 * @example
 * ```typescript
 * interface Eq<A> {
 *   /**
 *    * @op ===
 *    * @op ==
 *    *\/
 *   equals(a: A, b: A): boolean;
 * }
 * ```
 */
export function extractOpsFromJSDoc(member: ts.Node): string[] {
  const ops: string[] = [];
  for (const tag of ts.getJSDocTags(member)) {
    if (tag.tagName.text !== "op") continue;
    const comment =
      typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
    const trimmed = comment?.trim();
    if (trimmed && !ops.includes(trimmed)) ops.push(trimmed);
  }
  return ops;
}

/**
 * Extract the first operator symbol from a method signature's JSDoc `@op`
 * tags. A method may carry several `@op` tags; use
 * {@link extractOpsFromJSDoc} to read all of them.
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
  return extractOpsFromJSDoc(member)[0];
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
    // Resolve from the non-nullable part: an optional `Point | undefined`
    // field is served by the `Point` instance (callers guard the nullish case).
    const resolved = resolveInstance(ctx, tcName, ctx.typeChecker.getNonNullableType(fieldType));
    if (resolved && resolved.kind === "resolved") {
      const ref = buildInstanceReference(ctx, resolved);
      if (ts.isIdentifier(ref)) return ref.text;
      return resolved.localName ?? resolved.exportName;
    }
  }

  return companionPathFallback(tcName, typeName);
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
  const memberEntries: Array<{ name: string; node: ts.TypeElement }> = [];

  for (const member of iface.members) {
    // Capture raw source text of each member for HKT expansion.
    const sourceFile = member.getSourceFile();
    if (sourceFile) {
      const text = member.getText(sourceFile);
      memberTexts.push(text);
      if (member.name && ts.isIdentifier(member.name)) {
        // Keep the AST node — heritage flattening substitutes type params via
        // a scoped visitor and prints once (no string surgery on code text).
        memberEntries.push({ name: member.name.text, node: member });
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

      const operatorSymbols = extractOpsFromJSDoc(member);
      const returnType = member.type ? member.type.getText() : "void";

      methods.push({
        name: methodName,
        params,
        returnType,
        isSelfMethod,
        ...(operatorSymbols.length > 0
          ? { operatorSymbol: operatorSymbols[0], operatorSymbols }
          : {}),
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

  // Full interface body text for HKT expansion.
  const fullSignatureText = memberTexts.length > 0 ? `{ ${memberTexts.join("; ")} }` : undefined;

  // Syntax map from @op JSDoc tags on methods.
  const syntax = new Map<string, string>();
  for (const method of methods) {
    const ops = method.operatorSymbols ?? (method.operatorSymbol ? [method.operatorSymbol] : []);
    for (const op of ops) {
      syntax.set(op, method.name);
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
      statements.push(...generateCompanionConst(ctx.factory, tcInfo, isExported));
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
function generateCompanionConst(
  f: ts.NodeFactory,
  tc: TypeclassInfo,
  isExported: boolean
): ts.Statement[] {
  const { name } = tc;
  // export const Name = {};
  const companion = f.createVariableStatement(
    isExported ? [f.createModifier(ts.SyntaxKind.ExportKeyword)] : undefined,
    f.createVariableDeclarationList(
      [f.createVariableDeclaration(name, undefined, undefined, f.createObjectLiteralExpression())],
      ts.NodeFlags.Const
    )
  );
  // ((globalThis as any).__typesugar_companions =
  //    (globalThis as any).__typesugar_companions || {})["Name"] = Name;
  const registryRef = (): ts.Expression =>
    f.createPropertyAccessExpression(
      f.createParenthesizedExpression(
        f.createAsExpression(
          f.createIdentifier("globalThis"),
          f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)
        )
      ),
      "__typesugar_companions"
    );
  const registry = f.createParenthesizedExpression(
    f.createAssignment(
      registryRef(),
      f.createLogicalOr(registryRef(), f.createObjectLiteralExpression())
    )
  );
  const register = f.createExpressionStatement(
    f.createAssignment(
      f.createElementAccessExpression(registry, f.createStringLiteral(name)),
      f.createIdentifier(name)
    )
  );
  return [companion, register];
}

/**
 * Per-file record of `Type.TC` companions already emitted by `@impl`, so a
 * second `@impl TC<Type>` in the same file is reported instead of silently
 * replacing the first at runtime. Keyed by the MacroContext — one per file per
 * transform pass — so it is live same-pass state (written and read in visit
 * order within one pass) and a re-transform of the same file starts clean.
 */
const implCompanionsEmitted = new WeakMap<MacroContext, Map<string, string>>();

function getOrCreateCompanionSet(ctx: MacroContext): Map<string, string> {
  let m = implCompanionsEmitted.get(ctx);
  if (!m) {
    m = new Map();
    implCompanionsEmitted.set(ctx, m);
  }
  return m;
}

/** Does a type-argument list have more than one argument (`A, B<C, D>`)? */
function hasTopLevelComma(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === "<" || ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ">" || ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) return true;
  }
  return false;
}

/**
 * Decide whether `@impl TC<typeName>` may emit a `namespace typeName { export
 * const TC = ... }` companion. Only a plain identifier naming an interface,
 * type alias or class declared at the top level of THIS file qualifies:
 * anything else either doesn't parse as a namespace name (`Pair<number,
 * string>`, `number[]`, `string | null`) or would create a NEW runtime value
 * that shadows an imported or global binding (`import { Point }` →
 * `var Point = {}` → `new Point()` is no longer a constructor). Returns the
 * declaration, a reason string for a warning (not a plain type name), or
 * `undefined` for no companion and no warning: the type isn't declared here,
 * or it is an enum.
 *
 * Not declared here: it is how every instance for a type you don't own is
 * written (a library's `@impl FlatMap<Effect>`, `@impl Functor<Array>`),
 * nothing at the `@impl` can give the type a companion, and a `Type.TC`
 * written anywhere is TypeScript's own error where it is written. Warning
 * there fired on every library instance (effect, fusion) in every build that
 * transformed them.
 *
 * An enum (any kind) never gets one either. Its runtime object is the user's
 * data: a merged `namespace Op { export const Eq = eqOp }` overwrites the
 * member `Op.Eq`, and a string enum's `Object.values(Status)` lists the
 * instance (review 5, item 2). The companion is not needed for resolution --
 * the `@impl` const is found by its declared type (`resolveInstance`'s
 * enum-first lookup in instance-resolver.ts) -- so leaving it out costs only
 * the `Op.Eq` spelling, and a use of that is TypeScript's own "no property"
 * error.
 */
function findCompanionHost(
  sourceFile: ts.SourceFile,
  typeName: string
): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.ClassDeclaration | string | undefined {
  if (!/^[A-Za-z_$][\w$]*$/.test(typeName)) {
    return `'${typeName}' is not a plain type name`;
  }
  for (const stmt of sourceFile.statements) {
    if (ts.isEnumDeclaration(stmt) && stmt.name.text === typeName) {
      return undefined;
    }
    if (
      (ts.isInterfaceDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isClassDeclaration(stmt)) &&
      stmt.name?.text === typeName
    ) {
      return stmt;
    }
  }
  return undefined;
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
        "@impl requires arguments: the typeclass and type, as /** @impl Typeclass<Type> */ on a const"
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
      const { base: resolvedBase, fixedArgs } = parseTypeConstructor(typeName);
      const expansions = hktExpansionsFor(ctx.program);
      const registered = expansions.has(typeName) || expansions.has(resolvedBase);
      // False when the instance's type argument is valid but has no
      // single-hole expansion: then no expanded type is emitted at all.
      // Decided on every instance (resolution is memoized per program), not
      // only the first that registers the name: `EitherF` after
      // `EitherF<string>` registered `EitherF` → `Either` must not expand to
      // `Either<A>`.
      let expandable = true;
      let resolution = resolveTypeConstructorViaTypeChecker(ctx, typeName);
      // A generic type-level function (`EitherF<E>`) is not the data type to
      // expand into: `EitherF<A>` is not `Either<?, A>` (turf case study,
      // round 2). It is a valid HKT argument; handle it as a `*F` name below.
      const isTypeFunction = resolution?.isTypeFunction === true;
      if (isTypeFunction) resolution = undefined;
      if (resolution) {
        // Auto-register the base type as an HKT expansion
        if (!registered) {
          registerHKTExpansion(ctx.program, resolution.baseType, resolution.baseType);
        }
        // `Either` with nothing fixed has two holes: `Either<A>` would be wrong.
        if (resolution.arity - resolution.fixedArgs.length !== 1) expandable = false;
      } else if (resolvedBase.length > 1 && resolvedBase.endsWith("F")) {
        // `*F` convention (replaces the old hardcoded seed table): `OptionF`
        // names the TypeFunction encoding of `Option`. The encoding interface
        // itself is not generic, so resolve the stripped base name instead and
        // register the `*F` spelling as an expansion to it.
        const strippedBase = resolvedBase.slice(0, -1);
        resolution = resolveTypeConstructorViaTypeChecker(ctx, strippedBase);
        if (resolution && resolution.arity - fixedArgs.length === 1) {
          if (!registered) registerHKTExpansion(ctx.program, resolvedBase, resolution.baseType);
        } else if (resolution) {
          // `EitherF` (no `E` fixed) for `Either<E, A>`: no single hole to
          // substitute, so `Either<A>` would be wrong. Leave the type alone.
          expandable = false;
        }
      }
      if (!resolution && isTypeFunction) expandable = false;
      else if (!resolution && !registered) {
        ctx.diagnostic(TS9305).at(target).withArgs({ type: typeName }).emit();
      }

      const expandedType = expandable ? generateHKTExpandedType(ctx, tcName, typeName) : undefined;
      if (expandedType) {
        // An unannotated instance keeps the type of its own initializer and
        // `satisfies` the expanded type instead of being annotated with it
        // (turf case study, round 2): as an annotation it dropped every member
        // the typeclass doesn't declare (`_tag`, `orElse` on fp's
        // `flatMapOption`) from the instance's type and .d.ts, and the
        // expansion's check reported them as excess properties. `satisfies`
        // still contextually types unannotated method parameters (and `this`
        // in an object-literal method) and checks the instance's members; the
        // target is the expanded type intersected with an index signature, so
        // an extra member is allowed but a missing or misspelled one is an
        // error at the instance, as it was with the annotation (review 8: an
        // all-optional target reported `mapp` for `map` nowhere, and made
        // `this.map(...)` "possibly undefined"). Erased, like the annotation:
        // zero-cost. A user's own annotation is replaced as before.
        const newDecl =
          !decl.type && decl.initializer
            ? factory.updateVariableDeclaration(
                decl,
                decl.name,
                decl.exclamationToken,
                undefined,
                factory.createSatisfiesExpression(
                  parenthesizeForSatisfies(factory, decl.initializer),
                  asOpenSatisfiesTarget(factory, expandedType)
                )
              )
            : factory.updateVariableDeclaration(
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
    } else if (decl && !decl.type && decl.initializer) {
      // An unannotated instance of a typeclass over a plain type (`@impl
      // Show<Date>`) `satisfies` the type its tag names, as an HKT instance
      // satisfies its expansion (above): a missing or misspelled member is an
      // error at the instance (review 9: `shwo` for `show` built clean and
      // `summon<Show<Date>>().show(...)` threw at run time), its methods'
      // parameters are typed by the typeclass's, and it keeps its own type.
      const tagType = implTagTypeNode(ctx, tcName, typeName, decl);
      if (tagType) {
        const newDecl = factory.updateVariableDeclaration(
          decl,
          decl.name,
          decl.exclamationToken,
          undefined,
          factory.createSatisfiesExpression(
            parenthesizeForSatisfies(factory, decl.initializer),
            asOpenSatisfiesTarget(factory, tagType)
          )
        );
        updatedTarget = ts.isVariableStatement(target)
          ? factory.updateVariableStatement(
              target,
              target.modifiers,
              factory.updateVariableDeclarationList(target.declarationList, [newDecl])
            )
          : newDecl;
      }
    }

    // Notify coverage system that this type has an instance
    notifyPrimitiveRegistered(typeName, tcName);

    // Bridge to specialization registry: extract methods from the object literal
    // and register them for zero-cost specialization
    // Read from the declaration as written: the expansion may have wrapped
    // the initializer in `satisfies` (above).
    const objLiteral =
      decl?.initializer && ts.isObjectLiteralExpression(decl.initializer)
        ? decl.initializer
        : undefined;

    if (objLiteral) {
      const methods = inlineableMethods(
        ctx,
        extractMethodsFromObjectLiteral(objLiteral, ctx.hygiene),
        objLiteral
      );
      if (methods.size > 0) {
        registerInstanceMethodsFromAST(varName, typeName, methods, ctx.program, decl);
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
    // A multi-parameter typeclass (`@impl Destructure<typeof Some, Option<A>, A>`)
    // has no single type to hang a companion on; the instance is found by its
    // own resolver (std match-extractors.ts), so there is nothing to warn about.
    if (!primitives.includes(typeName) && !hasTopLevelComma(typeName)) {
      const host = findCompanionHost(ctx.sourceFile, typeName);
      const emitted = getOrCreateCompanionSet(ctx);
      const key = `${typeName}.${tcName}`;
      const hostAfterImpl =
        host !== undefined &&
        typeof host !== "string" &&
        ts.isClassDeclaration(host) &&
        !isSyntheticNode(target) &&
        host.pos > target.pos;
      if (host === undefined) {
        // Not declared in this file, or an enum: no companion, and nothing to
        // warn about (see findCompanionHost).
      } else if (typeof host === "string" || hostAfterImpl) {
        const why =
          typeof host === "string"
            ? host
            : `class '${typeName}' is declared after this instance (a namespace cannot precede the class it merges with)`;
        ctx.reportWarning(
          target,
          `@impl ${tcName}<${typeName}>: no '${key}' companion generated — ${why}. ` +
            `The instance '${varName}' is still resolvable by summon/implicits/operators; ` +
            `reference it directly instead of '${key}'.`
        );
      } else if (emitted.has(key)) {
        ctx.reportWarning(
          target,
          `@impl ${tcName}<${typeName}>: '${key}' is already provided by '${emitted.get(key)}' ` +
            `in this file; no second companion generated for '${varName}'. Two instances of ` +
            `${tcName}<${typeName}> in one scope are ambiguous.`
        );
      } else {
        emitted.set(key, varName);
        // namespace Type { export const TC = varName; }
        // No `as TC<Type>` assertion: the companion takes the instance's own
        // (declared or inferred) type. The assertion added nothing and didn't
        // type-check in general — `TC` is often not a type in scope here (the
        // typeclass is only named in the JSDoc tag) and an HKT instance's
        // `Type` is a bare type constructor (`FlatMap<Box>`: "Box requires 1
        // type argument"). Docs review r3 #1.
        const hostExported =
          (host as ts.InterfaceDeclaration).modifiers?.some(
            (m) => m.kind === ts.SyntaxKind.ExportKeyword
          ) ?? false;
        const member = factory.createVariableStatement(
          [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
          factory.createVariableDeclarationList(
            [
              factory.createVariableDeclaration(
                tcName,
                undefined,
                undefined,
                factory.createIdentifier(varName)
              ),
            ],
            ts.NodeFlags.Const
          )
        );
        statements.push(
          factory.createModuleDeclaration(
            hostExported ? [factory.createModifier(ts.SyntaxKind.ExportKeyword)] : undefined,
            factory.createIdentifier(typeName),
            factory.createModuleBlock([member]),
            ts.NodeFlags.Namespace
          )
        );
      }
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
 * HKT type-constructor expansions ("OptionF" → "Option"), keyed PER PROGRAM
 * (WeakMap — watch/LSP rebuilds invalidate naturally, and one program's
 * resolutions can never leak into another; same pattern as the op-index).
 *
 * Populated by the `@impl` macro's tier-1 TypeChecker auto-registration (and
 * `registerHKTExpansion` for explicit registrations) — there are no hardcoded
 * seed entries (PEP-052 Wave 4): the `*F` → base-name convention is resolved
 * against the program's declarations instead.
 */
const hktExpansionByProgram = new WeakMap<ts.Program, Map<string, string>>();

function hktExpansionsFor(program: ts.Program): Map<string, string> {
  let m = hktExpansionByProgram.get(program);
  if (!m) {
    m = new Map();
    hktExpansionByProgram.set(program, m);
  }
  return m;
}

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
export function registerHKTExpansion(
  program: ts.Program,
  hktName: string,
  concreteName: string
): void {
  hktExpansionsFor(program).set(hktName, concreteName);
}

/**
 * Get the concrete type for an HKT type constructor.
 */
function getHKTExpansion(program: ts.Program, hktName: string): string {
  return hktExpansionsFor(program).get(hktName) ?? hktName;
}

/** Test-only accessor for the per-program HKT expansion lookup. */
export function getHKTExpansionForTest(program: ts.Program, hktName: string): string {
  return getHKTExpansion(program, hktName);
}

/** `e` as the left operand of `satisfies`, parenthesized unless it is a primary expression. */
function parenthesizeForSatisfies(factory: ts.NodeFactory, e: ts.Expression): ts.Expression {
  return ts.isObjectLiteralExpression(e) ||
    ts.isArrayLiteralExpression(e) ||
    ts.isIdentifier(e) ||
    ts.isCallExpression(e) ||
    ts.isPropertyAccessExpression(e) ||
    ts.isParenthesizedExpression(e)
    ? e
    : factory.createParenthesizedExpression(e);
}

/**
 * The `satisfies` target for an unannotated `@impl` instance: the expanded
 * typeclass type `t`, as declared (required members stay required, so a
 * missing or misspelled member is reported at the instance, and `this` in an
 * object-literal method has them), intersected with `{ readonly [member:
 * string]: unknown }`, so a member the typeclass doesn't declare (`_tag`,
 * `orElse`) is not an excess property (see the `@impl` handler).
 */
function asOpenSatisfiesTarget(factory: ts.NodeFactory, t: ts.TypeNode): ts.TypeNode {
  const index = factory.createIndexSignature(
    [factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)],
    [
      factory.createParameterDeclaration(
        undefined,
        undefined,
        "member",
        undefined,
        factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)
      ),
    ],
    factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)
  );
  return factory.createIntersectionTypeNode([t, factory.createTypeLiteralNode([index])]);
}

/**
 * The type an `@impl` tag names (`Show<Date>` for `/** @impl Show<Date> *\/`),
 * as a type node for an unannotated instance declared by `decl` to
 * `satisfies`; undefined when it can't be written there.
 *
 * The tag is a JSDoc comment, which TypeScript keeps as text, so its type is
 * parsed from the text the user wrote (CLAUDE.md lists this). It is written
 * only when every name in it resolves at the instance (`checker.resolveName`
 * from `decl`) and the typeclass's name is a type there (so a tag naming a
 * typeclass the file doesn't import, or a free type parameter, as a
 * multi-parameter tag's `A` in `Destructure<typeof Some, Option<A>, A>`, adds
 * nothing rather than an error the source doesn't have), and the typeclass is
 * named plainly (`Show`, not `geo.Show`). Not for a synthetic declaration,
 * which the checker can't resolve from.
 */
function implTagTypeNode(
  ctx: MacroContext,
  tcName: string,
  typeName: string,
  decl: ts.VariableDeclaration
): ts.TypeNode | undefined {
  if (isSyntheticNode(decl)) return undefined;
  const parsed = ts.createSourceFile(
    "__impl_tag__.ts",
    `type __T = ${tcName}<${typeName}>;`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const diagnostics = (parsed as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics;
  const [alias, ...rest] = parsed.statements;
  if (
    (diagnostics && diagnostics.length > 0) ||
    rest.length > 0 ||
    !alias ||
    !ts.isTypeAliasDeclaration(alias) ||
    !ts.isTypeReferenceNode(alias.type)
  ) {
    return undefined;
  }
  const node = alias.type;
  // A plain typeclass name (a qualified `geo.Show` is left alone).
  const typeclassName = node.typeName;
  if (!ts.isIdentifier(typeclassName)) return undefined;
  const checker = ctx.typeChecker;
  try {
    const resolves = everyTypeNodeName(node, (id, meaning) => {
      const symbol = checker.resolveName(id.text, decl, meaning, false);
      if (!symbol) return false;
      // Whatever the typeclass's name means here must be a type.
      return id !== typeclassName || followTypeclassSymbol(checker, symbol) !== undefined;
    });
    return resolves ? stripPositions(node) : undefined;
  } catch (e) {
    ctx.reportWarning(
      decl,
      `@impl ${tcName}<${typeName}>: the instance's members are not checked against the ` +
        `typeclass, because resolving the tag's names failed: ${e instanceof Error ? e.message : String(e)}`
    );
    return undefined;
  }
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
  let expansion = hktExpansionsFor(ctx.program).has(hktParam)
    ? getHKTExpansion(ctx.program, hktParam)
    : getHKTExpansion(ctx.program, base);

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
        // Positions stripped: the printer took the temp file's offsets as the
        // real file's and printed the comments it found there (the `@impl`
        // tag inside the expanded type).
        return stripPositions(stmt.type);
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

  // Every union member must contribute exactly one variant with a string-literal
  // discriminant — a member without one (e.g. `kind: string`) would otherwise
  // be silently dropped and the derived instance would mishandle its values.
  if (discriminant && variants.length > 0 && variants.length === target.type.types.length) {
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
//    (deprecated: warns TS9009; declare the instance with derived<TC<A>>())
// 3. Compile error — no silent runtime fallback
// ============================================================================

export const summonMacro = defineExpressionMacro({
  name: "summon",
  module: "@typesugar/typeclass",
  description:
    "Resolve a typeclass instance at compile time with Scala 3-style auto-derivation via Mirror",
  // The expansion depends on the instances in scope in THIS file (and on the
  // types it names), not just on the call's text — two files with the same
  // `summon<Show<Point>>()` text resolve to different instances.
  cacheable: false,

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
    return summonInstanceExpression(ctx, typeArgs[0], callExpr) ?? callExpr;
  },
});

/**
 * The `ts.Type` a summon type argument denotes, for scope-based instance
 * lookup. A bare generic type constructor (`Functor<Option>`,
 * `Functor<Array>`) has no type arguments, so `getTypeFromTypeNode` gives the
 * checker's error type — `any`, which is assignable both ways to EVERY
 * instance's type and so matched whichever instance came first (docs review
 * C#6: `summon<Functor<Array>>()` silently became `optionFunctor`). Use the
 * symbol's declared type instead, which is exactly what the instance scanner
 * records for `@impl Functor<Option>` (`resolveTypeNameInScope`), so the
 * constructor matches its own instances and nothing else.
 */
function summonTargetType(ctx: MacroContext, innerType: ts.TypeNode): ts.Type {
  const checker = ctx.typeChecker;
  if (ts.isTypeReferenceNode(innerType) && !innerType.typeArguments?.length) {
    let sym = checker.getSymbolAtLocation(innerType.typeName);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    const isGenericDecl = (d: ts.Declaration) =>
      (ts.isTypeAliasDeclaration(d) || ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
      (d.typeParameters?.length ?? 0) > 0;
    if (sym && sym.flags & ts.SymbolFlags.Type && (sym.declarations ?? []).some(isGenericDecl)) {
      return checker.getDeclaredTypeOfSymbol(sym);
    }
  }
  return checker.getTypeFromTypeNode(innerType);
}

/**
 * `methods` as the specialization registry may inline them at call sites:
 *
 * - Without those whose body calls a macro (`summon<Clone<Tree>>()` in a
 *   recursive instance). A method's source still holds the macro call that
 *   the transformer expands only in the instance's own file, so inlining it
 *   would copy an unexpanded call that throws at run time.
 * - Each with the symbols its free value and type names resolve to here
 *   (`methodInlineSymbols`, the instance's own file's module scope allowed),
 *   and without those that can't be inlined anywhere (a `this`-dependent
 *   body). A call site in another file then has to resolve every name to the
 *   same symbol: `ordNumber.eqv` in a test file must not become
 *   `compareNumber(x, y) === EQ` where neither name is in scope (turf case
 *   study, round 2).
 *
 * A method that isn't inlined is called through its dictionary, which is
 * always correct. The checks read the ORIGINAL object literal's members
 * (real nodes, for the checker); `methods` are copies.
 */
function inlineableMethods(
  ctx: MacroContext,
  methods: Map<string, DictMethod>,
  objLiteral: ts.ObjectLiteralExpression
): Map<string, DictMethod> {
  for (const prop of objLiteral.properties) {
    const name =
      prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
        ? prop.name.text
        : undefined;
    const method = name ? methods.get(name) : undefined;
    if (!name || !method) continue;
    if (containsMacroCall(ctx.typeChecker, prop, inliningFailureReporter(ctx))) {
      methods.delete(name);
      continue;
    }
    const real = ts.getOriginalNode(prop);
    const fnNode = ts.isPropertyAssignment(real) ? real.initializer : real;
    // A synthetic member is outside the checker's contract (CLAUDE.md); it is
    // registered without symbols, and the call site then accepts only names
    // bound inside the body, by lib/ambient declarations, or by its own module.
    if (isSyntheticNode(fnNode) || !fnNode.parent) continue;
    const symbols = methodInlineSymbols(
      ctx.typeChecker,
      fnNode,
      fnNode.getSourceFile(),
      inliningFailureReporter(ctx)
    );
    if (!symbols) methods.delete(name);
    else methods.set(name, { ...method, declaration: fnNode, ...symbols });
  }
  return methods;
}

/**
 * The top-level `const` whose initializer evaluates `node` while it is being
 * initialized (no function in between): `export const cloneFeature =
 * summon<Clone<Feature>>()`. Such a const is never the instance `node`
 * resolves to (`const cloneFeature = cloneFeature` throws at run time); a
 * summon inside a function in the initializer (a recursive instance
 * referring to itself) is evaluated later and may resolve to it.
 */
function initializedDeclarationName(node: ts.Node): string | undefined {
  let n: ts.Node | undefined = node;
  while (n && n.parent) {
    const parent: ts.Node = n.parent;
    if (ts.isFunctionLike(parent) || ts.isClassLike(parent)) return undefined;
    if (ts.isVariableDeclaration(parent)) {
      return parent.initializer === n &&
        ts.isIdentifier(parent.name) &&
        ts.isVariableStatement(parent.parent.parent) &&
        ts.isSourceFile(parent.parent.parent.parent)
        ? parent.name.text
        : undefined;
    }
    if (ts.isStatement(parent)) return undefined;
    n = parent;
  }
  return undefined;
}

/**
 * The declaration whose WHOLE initializer is `node` (parentheses aside), when
 * it is a `const` at the top level of its module: `export const cloneFeature
 * = derived<Clone<Feature>>()`. The instance scanner discovers exactly these
 * declarations (top-level variable statements), so this is where a
 * `derived<...>()` instance can be declared.
 */
function topLevelConstInitialized(node: ts.Node): ts.VariableDeclaration | undefined {
  let n: ts.Node = node;
  while (n.parent && ts.isParenthesizedExpression(n.parent)) n = n.parent;
  const decl = n.parent;
  if (!decl || !ts.isVariableDeclaration(decl) || decl.initializer !== n) return undefined;
  if (!ts.isIdentifier(decl.name)) return undefined;
  const list = decl.parent;
  if (!ts.isVariableDeclarationList(list) || !(list.flags & ts.NodeFlags.Const)) return undefined;
  const stmt = list.parent;
  return ts.isVariableStatement(stmt) && ts.isSourceFile(stmt.parent) ? decl : undefined;
}

/**
 * `Feature` written with no type arguments, for `interface Feature<G =
 * Geometry, P = Props>`, means `Feature<Geometry, Props>` to TypeScript. The
 * derivation would otherwise mirror the declared type `Feature<G, P>`, whose
 * fields are the type parameters. Returns that defaulted type for a bare
 * reference to a generic type whose type parameters ALL have defaults (a
 * generic without defaults, `Box<A>`, can't be written bare, so it keeps the
 * declared-type behaviour), else undefined.
 */
function defaultedGenericType(ctx: MacroContext, typeNode: ts.TypeNode): ts.Type | undefined {
  if (!ts.isTypeReferenceNode(typeNode) || typeNode.typeArguments?.length) return undefined;
  if (isSyntheticNode(typeNode)) return undefined; // outside the checker's contract
  try {
    let sym = ctx.typeChecker.getSymbolAtLocation(typeNode.typeName);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = ctx.typeChecker.getAliasedSymbol(sym);
    const generic = sym?.declarations?.find(
      (d): d is ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.ClassDeclaration =>
        (ts.isInterfaceDeclaration(d) ||
          ts.isTypeAliasDeclaration(d) ||
          ts.isClassDeclaration(d)) &&
        (d.typeParameters?.length ?? 0) > 0
    );
    if (!generic || !generic.typeParameters!.every((tp) => tp.default)) return undefined;
    return ctx.typeChecker.getTypeFromTypeNode(typeNode);
  } catch (e) {
    ctx.reportWarning(
      typeNode,
      `could not resolve the default type arguments of '${typeNode.getText()}' ` +
        `(${e instanceof Error ? e.message : String(e)}); deriving for its declared type.`
    );
    return undefined;
  }
}

/** If `typeNode` names a type parameter in scope (`A` in `Show<A>`), its name. */
function typeParameterName(ctx: MacroContext, typeNode: ts.TypeNode): string | undefined {
  if (!ts.isTypeReferenceNode(typeNode) || !ts.isIdentifier(typeNode.typeName)) return undefined;
  if (isSyntheticNode(typeNode)) return undefined;
  try {
    const sym = ctx.typeChecker.getSymbolAtLocation(typeNode.typeName);
    return sym && sym.flags & ts.SymbolFlags.TypeParameter ? typeNode.typeName.text : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve `TC<A>` (a type node such as `Show<Point>`) to an instance
 * expression, as `summon<TC<A>>()` does: an explicit instance in scope
 * (local, explicitly imported, or found in an imported module — imported on
 * demand), else Generic auto-derivation, else a TS9001 diagnostic with the
 * resolution trace. Reports ambiguity instead of picking one. Returns
 * undefined after reporting a diagnostic. Shared by `summon` and `summonAll`.
 */
/**
 * The typeclass the `TC` of `summon<TC<T>>()` / `derived<TC<T>>()` denotes,
 * by identity: the checker follows imports, renames (`Clone as Copyable`) and
 * type aliases that forward to another type (`typesugar`'s `type Clone<A> =
 * import("@typesugar/std").Clone<A>`, next to its derive marker) to the
 * typeclass's own declaration, never comparing spellings. Instances and
 * derivations are still keyed by that declaration's NAME (module-qualified
 * identity is PEP-060 item 13), so its name is what this returns. A name
 * that isn't a type here (a value-only marker, an unresolved name, a
 * macro-generated node the checker can't see) keeps its written spelling.
 */
function typeclassNameOf(ctx: MacroContext, typeName: ts.EntityName): string {
  return typeclassOf(ctx, typeName).name;
}

/**
 * {@link typeclassNameOf} plus the typeclass's symbol (undefined when the name
 * isn't a type here), for searching the typeclass's own package.
 */
export function typeclassOf(
  ctx: MacroContext,
  typeName: ts.EntityName
): { name: string; symbol?: ts.Symbol } {
  const written = getNodeText(typeName);
  if (isSyntheticNode(typeName)) return { name: written };
  try {
    const start = ctx.typeChecker.getSymbolAtLocation(typeName);
    const sym = followTypeclassSymbol(ctx.typeChecker, start);
    return sym
      ? { name: typeclassKeyName(ctx.typeChecker, start, sym), symbol: sym }
      : { name: written };
  } catch (e) {
    ctx.reportWarning(
      typeName,
      `couldn't resolve the typeclass ${written} with the type checker ` +
        `(${e instanceof Error ? e.message : String(e)}); using the name as written.`
    );
    return { name: written };
  }
}

export function summonInstanceExpression(
  ctx: MacroContext,
  typeArg: ts.TypeNode,
  errorNode: ts.Node
): ts.Expression | undefined {
  if (!ts.isTypeReferenceNode(typeArg)) {
    ctx
      .diagnostic(TS9008)
      .at(errorNode)
      .help("Use a typeclass applied to a type: summon<Show<Point>>()")
      .emit();
    return undefined;
  }

  const typeclass = typeclassOf(ctx, typeArg.typeName);
  const tcName = typeclass.name;
  const innerTypeArgs = typeArg.typeArguments;

  if (!innerTypeArgs || innerTypeArgs.length === 0) {
    ctx
      .diagnostic(TS9008)
      .at(errorNode)
      .note(`summon<${tcName}<...>>() requires the typeclass to have a type argument`)
      .help(`Provide a type argument: summon<${tcName}<YourType>>()`)
      .emit();
    return undefined;
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

  // 1. Resolve an explicit instance from scope (PEP-052): a local, imported,
  //    or imported-module `@impl`/`@instance` value for this typeclass +
  //    concrete type. Registry-free — the file brings the instance into scope
  //    by importing (or defining) it. Registry shape (CLAUDE.md): resolveInstance
  //    reads the live same-pass `getSynthesized` table alongside the pass-start
  //    scan, so same-pass `@derive` companions are visible.
  if (isSyntheticNode(innerType)) {
    // The checker cannot resolve a node outside the Program (CLAUDE.md rule 3).
    ctx.reportWarning(
      errorNode,
      `summon<${tcName}<${typeName}>>(): type argument is macro-generated, so scope-based ` +
        `instance lookup was skipped; falling back to auto-derivation.`
    );
  } else {
    try {
      const forType = summonTargetType(ctx, innerType);
      let scopeResult = resolveInstance(
        ctx,
        tcName,
        forType,
        undefined,
        initializedDeclarationName(errorNode),
        errorNode
      );
      // Then the typeclass's own package (`Ord` imported from `typesugar` is
      // `@typesugar/std`'s, whose instances the file doesn't import).
      if (!scopeResult && typeclass.symbol) {
        scopeResult = resolveFromTypeclassHome(ctx, typeclass.symbol, tcName, forType).result;
      }
      if (scopeResult && scopeResult.kind === "resolved") {
        return buildInstanceReference(ctx, scopeResult);
      }
      if (scopeResult && scopeResult.kind === "ambiguous") {
        ctx.reportError(
          errorNode,
          `Ambiguous ${tcName} instance for '${typeName}': ` +
            `${scopeResult.candidates.map((c) => c.localName ?? c.exportName).join(", ")} ` +
            `are all in scope. Keep exactly one in scope, or pass the instance explicitly.`
        );
        return undefined;
      }
    } catch (e) {
      ctx.reportWarning(
        errorNode,
        `summon<${tcName}<${typeName}>>(): scope-based instance lookup failed ` +
          `(${e instanceof Error ? e.message : String(e)}); falling back to auto-derivation.`
      );
    }
  }
  attempts.push({
    step: "explicit-instance",
    target: `${tcName}<${typeName}>`,
    result: "not-found",
    reason: "no @impl/@instance value for this type in scope",
  });

  // 2. Try Scala 3-style derivation via Generic (GenericMeta)
  let derivationResult: DerivationResult;
  try {
    const { tryDeriveViaGeneric } =
      require("./auto-derive.js") as typeof import("./auto-derive.js");
    // The type by identity (CLAUDE.md): the symbol `innerType` names here,
    // so a local type shadowing an outer one of the same name is the local
    // one. Not for an instantiation (`Box<number>`), which summon doesn't
    // derive (its concrete type isn't passed; the declared type's fields are
    // type parameters).
    const isInstantiation =
      ts.isTypeReferenceNode(innerType) && (innerType.typeArguments?.length ?? 0) > 0;
    derivationResult = tryDeriveViaGeneric(
      ctx,
      tcName,
      typeName,
      undefined,
      defaultedGenericType(ctx, innerType),
      isInstantiation ? undefined : typeSymbolOfReference(ctx, innerType)
    );
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
    // Deprecated (TS9009): summon will find instances only. The instance
    // belongs in a declaration, `derived<TC<T>>()`, which other files find.
    warnDerivedInPlace(
      ctx,
      errorNode,
      tcName,
      typeName,
      ts.isCallExpression(errorNode) && topLevelConstInitialized(errorNode) !== undefined
    );
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
    .at(errorNode)
    .withArgs({ typeclass: tcName, type: typeName });

  for (const traceNote of traceNotes) {
    builder.note(traceNote);
  }

  const tcSuggestions = getSuggestionsForTypeclass(tcName);
  const typeParam = typeParameterName(ctx, innerType);
  const notOwned = (() => {
    if (typeParam || isSyntheticNode(innerType)) return undefined;
    try {
      const target = summonTargetType(ctx, innerType);
      const primitive = primitiveInstanceHelp(target, tcName, typeName, ctx.program);
      return primitive ? { replace: primitive } : notOwnedTypeHelp(ctx, target, tcName, typeName);
    } catch (e) {
      ctx.reportWarning(
        errorNode,
        `summon<${tcName}<${typeName}>>(): could not tell where '${typeName}' is declared ` +
          `(${e instanceof Error ? e.message : String(e)}); the help below omits derived<...>().`
      );
      return undefined;
    }
  })();
  const helpText =
    typeof notOwned === "object"
      ? notOwned.replace
      : notOwned
        ? `${helpMessage}\n    ${notOwned}`
        : helpMessage;
  if (typeParam) {
    // `function f<A>(x: A, S: Show<A> = summon<Show<A>>())`: summon resolves
    // at the definition site, where `A` is still abstract. The supported form
    // for an instance-parameter default is `= implicit()`, which the CALLER
    // fills in with the instance for its concrete `A`.
    builder.note(
      `'${typeParam}' is a type parameter, so there is no concrete type to resolve ` +
        `${tcName}<${typeName}> for here; summon() resolves at this definition site, not at each call.`
    );
    builder.help(
      `For an instance parameter, use \`= implicit()\` instead (the caller supplies the instance): ` +
        `\`${tcName.charAt(0)}: ${tcName}<${typeName}> = implicit()\``
    );
  } else if (tcSuggestions.length > 0 && !typeclass.symbol) {
    // Only when the typeclass itself isn't in scope: suggesting an import of
    // the `Eq` the file already imported (the instance is what's missing)
    // was wrong.
    builder.help(`${helpText}\n    Add: ${tcSuggestions[0].importStatement}`);
  } else {
    builder.help(helpText);
  }

  builder.emit();
  return undefined;
}

// ============================================================================
// derived<TC<T>>() - Expression Macro: declare a derived instance, once
// ============================================================================
// `export const cloneFeature = derived<Clone<Feature>>();` derives the
// instance from Feature's structure, in place of the call, with the same
// derivation `@derive(Clone)` and summon's fallback use (tryDeriveViaGeneric).
// The const is the instance: the instance scanner registers a top-level const
// initialized by `derived<TC<T>>()` (no @impl tag needed). The checker types
// it `TC<T>` from the stub's signature, so a `.d.ts` emitted from the source
// declares it with that type, which the scanner finds by its annotation; the
// transformer annotates the expanded declaration with `TC<T>` too
// (`tryAnnotateDerivedInstance`), so the expanded program agrees.
// ============================================================================

export const derivedMacro = defineExpressionMacro({
  name: "derived",
  module: "@typesugar/typeclass",
  description:
    "Derive a typeclass instance once, from a type's structure, as the initializer of a top-level const",
  // Field instances are resolved from THIS file's scope.
  cacheable: false,

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const decl = topLevelConstInitialized(callExpr);
    const outcomes = derivedOutcomesFor(ctx.program);
    // A reference to the const from inside its own derivation (a type that
    // contains itself) is to the instance being declared.
    if (decl) outcomes.set(decl, "expanding");
    const expr = derivedInstanceExpression(ctx, callExpr, args);
    if (decl) outcomes.set(decl, expr ? "ok" : "failed");
    return expr ?? callExpr;
  },
});

/**
 * The outcome of each `derived<TC<T>>()` const's derivation, per program.
 * Registry shape (CLAUDE.md "Resolving things a macro just generated"): live,
 * same-pass state, written when the macro expands and read by the instance
 * resolver, which must not resolve to a const whose derivation failed (it is
 * the un-expanded stub). Keyed by the declaration node.
 */
type DerivedOutcome = "expanding" | "ok" | "failed";
const derivedOutcomes = new WeakMap<ts.Program, Map<ts.VariableDeclaration, DerivedOutcome>>();
function derivedOutcomesFor(program: ts.Program): Map<ts.VariableDeclaration, DerivedOutcome> {
  let m = derivedOutcomes.get(program);
  if (!m) derivedOutcomes.set(program, (m = new Map()));
  return m;
}

/**
 * Whether the `derived<...>()` const `decl` is an instance: its derivation
 * didn't fail. Read from the expansion's recorded outcome; for a const of the
 * file being transformed that is used ABOVE its declaration (not expanded
 * yet), the derivation is tried here, with the same arguments the expansion
 * uses (tryDeriveViaGeneric caches the result, so the expansion reuses it). A
 * const in another file that hasn't been transformed yet counts: that file
 * reports its own failure.
 */
function derivedCallSucceeds(ctx: MacroContext, decl: ts.VariableDeclaration): boolean {
  const outcomes = derivedOutcomesFor(ctx.program);
  const known = outcomes.get(decl);
  if (known) return known !== "failed";
  if (decl.getSourceFile().fileName !== ctx.sourceFile.fileName) return true;
  const call = derivedCallOf(decl);
  const typeArg = call?.typeArguments?.length === 1 ? call.typeArguments[0] : decl.type;
  if (
    !call ||
    !typeArg ||
    !ts.isTypeReferenceNode(typeArg) ||
    !ts.isIdentifier(typeArg.typeName) ||
    typeArg.typeArguments?.length !== 1 ||
    isSyntheticNode(typeArg)
  ) {
    return true; // the expansion reports the shape error
  }
  outcomes.set(decl, "expanding");
  let ok = true;
  try {
    const { tryDeriveViaGeneric } =
      require("./auto-derive.js") as typeof import("./auto-derive.js");
    const subject = derivedSubject(ctx, typeArg.typeArguments[0]);
    ok =
      !subject ||
      tryDeriveViaGeneric(
        ctx,
        typeclassNameOf(ctx, typeArg.typeName),
        subject.typeName,
        undefined,
        subject.concrete,
        subject.symbol
      ).expression !== null;
  } catch (e) {
    // Visible degrade (CLAUDE.md): keep the instance; its expansion reports.
    ctx.reportWarning(
      decl,
      `couldn't check whether this derived<...>() instance derives ` +
        `(${e instanceof Error ? e.message : String(e)}); using it.`
    );
  } finally {
    outcomes.delete(decl);
  }
  if (!ok) outcomes.set(decl, "failed");
  return ok;
}
setDerivedCallCheck(derivedCallSucceeds);

/**
 * The symbol a type reference names, by identity (CLAUDE.md "Deciding what a
 * type is"): imports and renames followed to the declaration, as the checker
 * resolves the name at the reference, so a local type shadowing an outer or
 * global one of the same name is the local one. Undefined for a synthetic
 * node (outside the checker's contract), a non-reference, or a name that
 * isn't a type; a checker failure is warned about and is undefined too.
 */
function typeSymbolOfReference(ctx: MacroContext, typeNode: ts.TypeNode): ts.Symbol | undefined {
  if (!ts.isTypeReferenceNode(typeNode) || isSyntheticNode(typeNode)) return undefined;
  try {
    const checker = ctx.typeChecker;
    let sym = checker.getSymbolAtLocation(typeNode.typeName);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    if (!sym) return undefined;
    if (sym.flags & ts.SymbolFlags.Type) return sym;
    const exported = checker.getExportSymbolOfSymbol(sym);
    return exported.flags & ts.SymbolFlags.Type ? exported : undefined;
  } catch (e) {
    ctx.reportWarning(
      typeNode,
      `could not resolve '${getNodeText(typeNode)}' with the type checker ` +
        `(${e instanceof Error ? e.message : String(e)}); looking it up by name.`
    );
    return undefined;
  }
}

/**
 * What `derived<TC<T>>()` derives for: `T`'s name (as the derivation writes
 * it in generated code), its concrete type when that differs from the
 * declared one, and its symbol by identity. Undefined (after reporting) when
 * the checker can't resolve `T`.
 */
function derivedSubject(
  ctx: MacroContext,
  innerType: ts.TypeNode,
  report?: { at: ts.Node; tcName: string }
): { typeName: string; concrete?: ts.Type; symbol?: ts.Symbol } | undefined {
  const typeText = getNodeText(innerType).replace(/\s+/g, " ").trim();
  const bare = !ts.isTypeReferenceNode(innerType) || !innerType.typeArguments?.length;
  const symbol = typeSymbolOfReference(ctx, innerType);
  if (ts.isTypeReferenceNode(innerType) && bare) {
    // As summon: the bare name of a generic with defaults means its defaults.
    return {
      typeName: getNodeText(innerType.typeName),
      concrete: defaultedGenericType(ctx, innerType),
      symbol,
    };
  }
  try {
    return { typeName: typeText, concrete: ctx.typeChecker.getTypeFromTypeNode(innerType), symbol };
  } catch (e) {
    if (report) {
      ctx.reportError(
        report.at,
        `derived<${report.tcName}<${typeText}>>(): the type checker could not resolve '${typeText}' ` +
          `(${e instanceof Error ? e.message : String(e)}).`
      );
    }
    return undefined;
  }
}

/** The names of type parameters `typeNode` refers to (`G` in `Feature<G>`). */
function freeTypeParameters(ctx: MacroContext, typeNode: ts.TypeNode): string[] {
  const names: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName) && !isSyntheticNode(n)) {
      const sym = ctx.typeChecker.getSymbolAtLocation(n.typeName);
      if (sym && sym.flags & ts.SymbolFlags.TypeParameter && !names.includes(n.typeName.text)) {
        names.push(n.typeName.text);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(typeNode);
  return names;
}

/** The `@impl`/`@instance` tag text on the statement declaring `decl`, if any. */
function implTagText(decl: ts.VariableDeclaration): string | undefined {
  for (const tag of ts.getJSDocTags(decl.parent.parent)) {
    if (tag.tagName.text !== "impl" && tag.tagName.text !== "instance") continue;
    const c = typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
    if (c) return c.replace(/^["'()\s]+|["'()\s]+$/g, "").trim();
  }
  return undefined;
}

/** Split a type-argument list at its top-level commas: `A, B<C, D>` → `["A", "B<C, D>"]`. */
function splitTypeArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "<" || c === "(" || c === "[" || c === "{") depth++;
    else if ((c === ">" && text[i - 1] !== "=") || c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out.filter((t) => t.length > 0);
}

/**
 * Whether the type text of an `@impl` tag (`number[]`, `P2`, `Box<number>`)
 * denotes the same type as `node`, the type argument of `derived<TC<T>>()`,
 * as seen from `location`. By identity, not spelling (CLAUDE.md): names are
 * resolved in scope through imports and aliases, and compared by declared
 * type (so `type P2 = Pt` is `Pt`); `X[]` and `Array<X>` are one type;
 * keywords by the checker's intrinsic type; type arguments recursively. A
 * form this doesn't model (a union, an object literal) falls back to the
 * text with whitespace removed.
 */
function tagTypeMatches(
  checker: ts.TypeChecker,
  text: string,
  node: ts.TypeNode,
  location: ts.Node,
  warn: (message: string) => void
): boolean {
  const t = text.trim();
  const sameText = () => t.replace(/\s+/g, "") === getNodeText(node).replace(/\s+/g, "");
  // Normalize `X[]` / `Array<X>` / `ReadonlyArray<X>` on both sides.
  const textElem = /^(.*)\[\]$/.exec(t)?.[1];
  const nodeElem = ts.isArrayTypeNode(node)
    ? node.elementType
    : ts.isTypeOperatorNode(node) &&
        node.operator === ts.SyntaxKind.ReadonlyKeyword &&
        ts.isArrayTypeNode(node.type)
      ? node.type.elementType
      : undefined;
  const parsed = parseTypeInstantiation(t);
  const unalias = (sym: ts.Symbol | undefined): ts.Symbol | undefined =>
    sym && sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
  // A name in scope at the tag, resolved through the checker; a qualified
  // one (`geo.Point` with `import * as geo`, or a namespace member) by its
  // first segment in scope, then each member of the module or namespace.
  const lookup = (name: string): ts.Symbol | undefined => {
    const [first, ...rest] = name.split(".");
    let sym = unalias(
      checker
        .getSymbolsInScope(
          location,
          rest.length > 0
            ? ts.SymbolFlags.Namespace | ts.SymbolFlags.Alias
            : ts.SymbolFlags.Type | ts.SymbolFlags.Alias
        )
        .find((x) => x.name === first)
    );
    for (const member of rest) {
      if (!sym) return undefined;
      sym = unalias(checker.getExportsOfModule(sym).find((x) => x.name === member));
    }
    return sym;
  };
  const nodeSymbol = (n: ts.TypeReferenceNode): ts.Symbol | undefined => {
    let sym = checker.getSymbolAtLocation(n.typeName);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    return sym;
  };
  const sameDeclaredType = (a: ts.Symbol | undefined, b: ts.Symbol | undefined) =>
    !!a &&
    !!b &&
    (a === b || checker.getDeclaredTypeOfSymbol(a) === checker.getDeclaredTypeOfSymbol(b));
  const isArraySymbol = (sym: ts.Symbol | undefined) =>
    !!sym && (sym === lookup("Array") || sym === lookup("ReadonlyArray"));
  try {
    if (textElem !== undefined || nodeElem) {
      const tElem =
        textElem ??
        (parsed && isArraySymbol(lookup(parsed.base)) ? splitTypeArgs(parsed.args)[0] : undefined);
      const nElem =
        nodeElem ??
        (ts.isTypeReferenceNode(node) &&
        node.typeArguments?.length === 1 &&
        isArraySymbol(nodeSymbol(node))
          ? node.typeArguments[0]
          : undefined);
      if (tElem !== undefined && nElem) {
        return tagTypeMatches(checker, tElem, nElem, location, warn);
      }
      return sameText();
    }
    if (ts.isTypeReferenceNode(node)) {
      const base = parsed ? parsed.base : t;
      if (!/^[A-Za-z_$][\w$.]*$/.test(base)) return sameText();
      const tArgs = parsed ? splitTypeArgs(parsed.args) : [];
      const nArgs = node.typeArguments ?? [];
      if (!sameDeclaredType(lookup(base), nodeSymbol(node))) {
        // `Array<number>` vs `number[]` is handled above; anything else differs.
        return false;
      }
      return (
        tArgs.length === nArgs.length &&
        tArgs.every((a, i) => tagTypeMatches(checker, a, nArgs[i], location, warn))
      );
    }
    // Keywords (`number`): the checker's intrinsic types are singletons.
    if (ts.SyntaxKind.FirstKeyword <= node.kind && node.kind <= ts.SyntaxKind.LastKeyword) {
      return t === getNodeText(node).trim();
    }
    return sameText();
  } catch (e) {
    // Visible degrade (CLAUDE.md): the comparison falls back to the text.
    warn(`(${e instanceof Error ? e.message : String(e)}); comparing the @impl tag as text.`);
    return sameText();
  }
}

function derivedInstanceExpression(
  ctx: MacroContext,
  callExpr: ts.CallExpression,
  args: readonly ts.Expression[]
): ts.Expression | undefined {
  // `derived<Clone<Feature>>()`, or `const cloneFeature: Clone<Feature> =
  // derived()`, which takes the instance type from the annotation (and whose
  // `.d.ts` is then that annotation, as written).
  const typeArg = callExpr.typeArguments?.length
    ? callExpr.typeArguments.length === 1
      ? callExpr.typeArguments[0]
      : undefined
    : topLevelConstInitialized(callExpr)?.type;
  if (
    !typeArg ||
    !ts.isTypeReferenceNode(typeArg) ||
    !ts.isIdentifier(typeArg.typeName) ||
    typeArg.typeArguments?.length !== 1
  ) {
    ctx.reportError(
      callExpr,
      "derived() needs the instance type, a typeclass (by its name) applied to one type: " +
        "derived<Clone<Feature>>(), or an annotated const: " +
        "`export const cloneFeature: Clone<Feature> = derived();`"
    );
    return undefined;
  }
  if (args.length > 0) {
    ctx.reportError(callExpr, "derived<...>() takes no arguments: the type argument says it all");
    return undefined;
  }

  const tcName = typeclassNameOf(ctx, typeArg.typeName);
  const innerType = typeArg.typeArguments[0];
  const typeText = getNodeText(innerType).replace(/\s+/g, " ").trim();
  const withArgs = { typeclass: tcName, type: typeText };

  // A synthetic type argument is outside the checker's contract (CLAUDE.md).
  if (isSyntheticNode(innerType)) {
    ctx.reportError(
      callExpr,
      `derived<${tcName}<${typeText}>>(): the type argument is macro-generated, so its type ` +
        `can't be read; write derived<...>() with a type of your own source.`
    );
    return undefined;
  }

  const typeParams = freeTypeParameters(ctx, innerType);
  if (typeParams.length > 0) {
    ctx
      .diagnostic(TS9011)
      .at(callExpr)
      .withArgs(withArgs)
      .note(
        `${typeParams.map((n) => `\`${n}\``).join(", ")} ${typeParams.length === 1 ? "is a type parameter" : "are type parameters"}, ` +
          `so there is no concrete type to derive ${tcName} for.`
      )
      .help(`Declare one instance per concrete type, e.g. derived<${tcName}<Feature<Point>>>()`)
      .emit();
    return undefined;
  }

  const decl = topLevelConstInitialized(callExpr);
  if (!decl) {
    ctx
      .diagnostic(TS9010)
      .at(callExpr)
      .withArgs(withArgs)
      .help(
        `Declare it as \`export const ${suggestedInstanceName(tcName, typeText)} = derived<${tcName}<${typeText}>>();\` ` +
          `at the top level of a module, or summon<${tcName}<${typeText}>>() an instance that is in scope.`
      )
      .emit();
    return undefined;
  }

  // An @impl tag is optional (the initializer says what the instance is), but
  // one that names something else is a contradiction.
  const tag = implTagText(decl);
  if (tag !== undefined) {
    const parsed = parseTypeInstantiation(tag);
    // Compared through the checker (tagTypeMatches): the tag's typeclass by
    // identity (alias-resolved, as `tcName` is), and its type argument as a
    // type, so `@impl Eq<number[]>` agrees with derived<Eq<Array<number>>>()
    // and an alias of the type agrees with the type.
    const tagArgs = parsed ? splitTypeArgs(parsed.args) : [];
    let tagTc = parsed?.base;
    if (parsed && /^[A-Za-z_$][\w$]*$/.test(parsed.base)) {
      try {
        const sym = ctx.typeChecker
          .getSymbolsInScope(decl, ts.SymbolFlags.Type | ts.SymbolFlags.Alias)
          .find((x) => x.name === parsed.base);
        const tc = followTypeclassSymbol(ctx.typeChecker, sym);
        if (tc) tagTc = typeclassKeyName(ctx.typeChecker, sym, tc);
      } catch (e) {
        ctx.reportWarning(
          decl,
          `couldn't resolve the typeclass of @impl ${tag} with the type checker ` +
            `(${e instanceof Error ? e.message : String(e)}); comparing it by name.`
        );
      }
    }
    const same =
      parsed !== undefined &&
      tagTc === tcName &&
      tagArgs.length === 1 &&
      tagTypeMatches(ctx.typeChecker, tagArgs[0], innerType, decl, (m) =>
        ctx.reportWarning(decl, `couldn't compare @impl ${tag} with the type checker ${m}`)
      );
    if (!same) {
      ctx.reportError(
        callExpr,
        `@impl ${tag} doesn't match derived<${tcName}<${typeText}>>(): the instance is the ` +
          `one derived<...>() names. Remove the tag (it is optional), or make it @impl ${tcName}<${typeText}>.`
      );
      return undefined;
    }
  }

  const { tryDeriveViaGeneric, hasGenericDerivation } =
    require("./auto-derive.js") as typeof import("./auto-derive.js");
  const subject = derivedSubject(ctx, innerType, { at: callExpr, tcName });
  if (!subject) return undefined;

  // The type by identity, not by name (CLAUDE.md): `subject.symbol` is what
  // `T` resolves to at this reference.
  const result = tryDeriveViaGeneric(
    ctx,
    tcName,
    subject.typeName,
    undefined,
    subject.concrete,
    subject.symbol
  );
  if (result.expression) {
    // As @derive's companion const: the initializer needs no parentheses.
    let expr = result.expression;
    while (ts.isParenthesizedExpression(expr)) expr = expr.expression;
    return expr;
  }

  if (result.failedField) {
    const f = result.failedField;
    const builder = ctx
      .diagnostic(TS9107)
      .at(callExpr)
      .withArgs({
        ...withArgs,
        field: f.variant ? `${f.variant}.${f.name}` : f.name,
        fieldType: f.type,
      });
    for (const n of formatResolutionTrace({
      sought: `${tcName}<${typeText}>`,
      attempts: result.trace,
      finalResult: "failed",
    })) {
      builder.note(n);
    }
    builder
      .help(
        `Put a ${tcName}<${f.type}> instance in scope here (declare one, or derived<${tcName}<${f.type}>>() ` +
          `when it can be derived), or write ${tcName}<${typeText}> by hand with /** @impl ${tcName}<${typeText}> */.`
      )
      .emit();
    return undefined;
  }

  const builder = ctx.diagnostic(TS9106).at(callExpr).withArgs(withArgs);
  if (!hasGenericDerivation(tcName)) {
    builder.note(
      globalRegistry.getDerive(tcName)
        ? `${tcName} is derived by a @derive macro, which needs the type's own declaration; ` +
            `derived<...>() works for the typeclasses with a structural derivation ` +
            `(Eq, Ord, Clone, Debug, Hash, Default, Json, TypeGuard, Show, Semigroup, Monoid).`
        : `No derivation is registered for ${tcName}, so there is nothing to derive it with.`
    );
  }
  builder
    .note(
      formatResolutionTrace({
        sought: `${tcName}<${typeText}>`,
        attempts: result.trace,
        finalResult: "failed",
      }).join("\n")
    )
    .help(
      `Write the ${tcName}<${typeText}> instance by hand with /** @impl ${tcName}<${typeText}> */`
    )
    .emit();
  return undefined;
}

// ============================================================================
// extend() - Expression Macro for Extension Methods
// ============================================================================
// Provides Scala 3-like extension method syntax.
//
// extend(point).show()
// // Resolves to: showPoint.show(point)   (the in-scope Show<Point> instance)
//
// extend(point).equals(otherPoint)
// // Resolves to: eqPoint.equals(point, otherPoint)
// ============================================================================

/**
 * The error for `extend(x)` not called as `extend(x).method(...)` -- typically
 * `const e = extend(x); e.show()`. By design that is not supported:
 * `extend(x).m(args)` compiles to `instance.m(x, args)`, so there is no
 * wrapper object to store (a runtime wrapper would cost what extend() exists
 * to avoid, and would need to know every method it will be used with). The
 * message names the user's own value and, when `extend(x)` initialises a
 * variable, the first method called on that variable, with the three things
 * to write instead.
 */
function extendWithoutMethodMessage(
  ctx: MacroContext,
  callExpr: ts.CallExpression,
  value: ts.Expression
): string {
  const real = !isSyntheticNode(value);
  const valueText = real ? value.getText(ctx.sourceFile) : "value";

  // `const e = extend(x)`: find the first `e.m(...)` call in the file, by the
  // variable's SYMBOL (checker identity), not by its name.
  let methodName: string | undefined;
  const decl = callExpr.parent;
  if (
    real &&
    !isSyntheticNode(callExpr) &&
    ts.isVariableDeclaration(decl) &&
    decl.initializer === callExpr &&
    ts.isIdentifier(decl.name)
  ) {
    try {
      const varSym = ctx.typeChecker.getSymbolAtLocation(decl.name);
      const find = (n: ts.Node): void => {
        if (methodName) return;
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          ts.isIdentifier(n.expression.expression) &&
          !isSyntheticNode(n.expression.expression) &&
          varSym !== undefined &&
          ctx.typeChecker.getSymbolAtLocation(n.expression.expression) === varSym
        ) {
          methodName = n.expression.name.text;
          return;
        }
        ts.forEachChild(n, find);
      };
      find(ctx.sourceFile);
    } catch (e) {
      ctx.reportWarning(
        callExpr,
        `extend(): could not look up how '${decl.name.text}' is used ` +
          `(${e instanceof Error ? e.message : String(e)}); the help below uses a placeholder method.`
      );
    }
  }
  const m = methodName ?? "method";

  let typeText = "T";
  if (real) {
    try {
      typeText = ctx.typeChecker.typeToString(
        ctx.typeChecker.getBaseTypeOfLiteralType(ctx.typeChecker.getTypeAtLocation(value))
      );
    } catch {
      // Display only: the placeholder `T` is shown instead.
    }
  }
  const tc = methodName
    ? (getTypeclassesDeclaringMethod(ctx.program, methodName)[0]?.typeclass ?? "TC")
    : "TC";

  return (
    `extend(${valueText}) must be called as a method in the same expression: ` +
    `extend(${valueText}).${m}(). It compiles to a direct call on the ` +
    `${tc === "TC" ? "typeclass" : tc} instance, so there is no wrapper value to store in a ` +
    `variable. Write extend(${valueText}).${m}(), or method syntax ` +
    `${valueText}.${m}(), or keep the instance itself: ` +
    `const S = summon<${tc}<${typeText}>>(); S.${m}(${valueText}).`
  );
}

export const extendMacro = defineExpressionMacro({
  name: "extend",
  module: "@typesugar/typeclass",
  description: "Call extension methods on a value via typeclass instances",
  // Expansion depends on the instances in scope in this file and on the
  // value's type, not only on the call text.
  cacheable: false,
  // extend(value).method(args) is a two-call chain; without this, the
  // transformer would only hand expand() the inner extend(value) call while
  // the outer .method(args) call/property-access stays in the tree untouched
  // around whatever expand() returns — and since expand() already produces
  // the FULL `instance.method(value, ...)` call, the surviving outer
  // `.method(args)` would apply it a second time. `chainable: true` makes the
  // transformer pass the *whole* `extend(value).method(args)` chain as
  // `callExpr`, so there is exactly one substitution point.
  chainable: true,

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length === 0) {
      ctx.reportError(callExpr, "extend() requires a value argument");
      return callExpr;
    }

    // callExpr is the outermost chain call: extend(value).method(args).
    // Its `.expression` is the `.method` property access on `extend(value)`.
    const methodAccess = callExpr.expression;
    if (!ts.isPropertyAccessExpression(methodAccess)) {
      ctx.reportError(callExpr, extendWithoutMethodMessage(ctx, callExpr, args[0]));
      return callExpr;
    }

    const methodName = methodAccess.name.text;
    const value = args[0];
    const extraArgs = Array.from(callExpr.arguments);
    const f = ctx.factory;

    // Type of the value. A macro-generated value node is outside the Program,
    // so the checker can't be asked about it (CLAUDE.md rule 3).
    let valueType: ts.Type | undefined;
    let typeName = "unknown";
    if (isSyntheticNode(value)) {
      ctx.reportWarning(
        callExpr,
        `extend(...).${methodName}(): the value is macro-generated, so its type could not be ` +
          `checked; emitting a plain '.${methodName}()' call instead.`
      );
    } else {
      try {
        valueType = ctx.typeChecker.getBaseTypeOfLiteralType(
          ctx.typeChecker.getTypeAtLocation(value)
        );
        typeName = ctx.typeChecker.typeToString(valueType);
      } catch (e) {
        ctx.reportWarning(
          callExpr,
          `extend(...).${methodName}(): could not determine the value's type ` +
            `(${e instanceof Error ? e.message : String(e)}); emitting a plain call instead.`
        );
      }
    }

    // Find which typeclass provides this method (op-index, scope-based; PEP-052).
    // Multiple typeclasses can declare a method with the same name, so a
    // candidate is only accepted once an INSTANCE for the value's type is
    // actually resolved in scope — otherwise the first (arbitrary-order) match
    // would blindly win. The emitted call references that resolved instance
    // directly (`inst.method(value, ...args)`, built with ts.factory): there is
    // no runtime `TC.summon` to dispatch through.
    if (valueType) {
      for (const candidate of getTypeclassesDeclaringMethod(ctx.program, methodName)) {
        const tcName = candidate.typeclass;
        const r = resolveInstance(ctx, tcName, valueType);
        if (r && r.kind === "ambiguous") {
          ctx.reportError(
            callExpr,
            `Ambiguous ${tcName} instance for '${typeName}' in extend(...).${methodName}(): ` +
              `${r.candidates.map((c) => c.localName ?? c.exportName).join(", ")}. ` +
              `Keep exactly one in scope.`
          );
          return callExpr;
        }
        if (!r) continue;
        return f.createCallExpression(
          f.createPropertyAccessExpression(buildInstanceReference(ctx, r), methodName),
          undefined,
          [value, ...extraArgs]
        );
      }
    }

    // Check standalone extensions (Scala 3-style concrete type extensions)
    const standaloneExt = findStandaloneExtensionForExtend(methodName, typeName);
    if (standaloneExt) {
      return buildStandaloneExtensionCall(ctx.factory, standaloneExt, value, extraArgs);
    }

    // An unconstrained type parameter has no instance or extension to
    // dispatch to here, and `x.show()` would fail at run time: say how
    // generic code gets one. (A constrained one, `T extends number`, is left
    // to the method-call rewrite below, which can use the constraint.)
    const constraint =
      valueType && valueType.flags & ts.TypeFlags.TypeParameter
        ? ctx.typeChecker.getBaseConstraintOfType(valueType)
        : undefined;
    if (
      valueType &&
      valueType.flags & ts.TypeFlags.TypeParameter &&
      (!constraint || constraint.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any))
    ) {
      const valueText = value.getText(ctx.sourceFile);
      const tc = getTypeclassesDeclaringMethod(ctx.program, methodName)[0]?.typeclass ?? "TC";
      ctx.reportError(
        callExpr,
        `extend(${valueText}).${methodName}(): '${typeName}' is a type parameter, so no ` +
          `${tc} instance can be chosen for it here. Take the instance as a parameter ` +
          `(S: ${tc}<${typeName}> = implicit()) and call S.${methodName}(${valueText}); ` +
          `typesugar fills it in at each call site with a concrete type.`
      );
      return callExpr;
    }

    // No instance and no registered standalone extension: emit
    // value.method(args) for the transformer's own method-call rewriting
    // (import-scoped extensions, typeclass method syntax). It must be an
    // UPDATE of the written call, keeping its source range: the visitor never
    // rewrites a synthetic call, so a fresh `value.method(args)` node was left
    // as is (`extend(150).clamp(0, 100)` -> `150..clamp(0, 100)`, a run-time
    // "is not a function"). The checker is only asked about `value`, which is
    // the user's own node.
    return f.updateCallExpression(
      callExpr,
      f.updatePropertyAccessExpression(methodAccess, value, methodAccess.name),
      callExpr.typeArguments,
      callExpr.arguments
    );
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
  // Side effects (specialization registration keyed by the enclosing
  // declaration) must run on every expansion; never serve it from a cache.
  cacheable: false,

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
      const methods = inlineableMethods(
        ctx,
        extractMethodsFromObjectLiteral(objectLiteralArg, ctx.hygiene),
        objectLiteralArg
      );
      if (methods.size > 0) {
        registerInstanceMethodsFromAST(instanceName, forType, methods, ctx.program, varDecl);
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
  // Marks the typeclass in scope for THIS file (a side effect); never cached.
  cacheable: false,

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
  /**
   * @op ===
   * @op ==
   */
  equals(a: A, b: A): boolean;
  /**
   * @op !==
   * @op !=
   */
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
      cacheable: false,
      expand: implMacro.expand,
    })
  );
  globalRegistry.register(summonMacro);
  globalRegistry.register(derivedMacro);
  globalRegistry.register(extendMacro);
}

registerTypeclassMacros();

// ============================================================================
// GenericDerivation expansion for @derive (shared by both transformers)
// ============================================================================

/**
 * Typeclass names @typesugar/macros exports at runtime as objects carrying
 * primitive instances (`Eq.number`, `Semigroup.string`, ...).
 */
const MACROS_PRIMITIVE_COMPANIONS = new Set(["Eq", "Ord", "Show", "Hash", "Semigroup", "Monoid"]);

/**
 * Thrown by {@link tryExpandGenericDerive} when a GenericDerivation strategy
 * exists for the typeclass but could not build an instance. The message keeps
 * the historical text; {@link reportGenericDeriveFailure} turns it into the
 * catalogued TS9106 diagnostic (trace as a note) instead of a generic TS9999.
 */
export class GenericDeriveError extends Error {
  constructor(
    readonly typeclass: string,
    readonly typeName: string,
    readonly traceNotes: string[]
  ) {
    super(
      `cannot derive ${typeclass} for '${typeName}'.\n` + traceNotes.map((n) => `  ${n}`).join("\n")
    );
    this.name = "GenericDeriveError";
  }
}

/**
 * Report a failure thrown by {@link tryExpandGenericDerive} at `node` (the
 * derive argument). A {@link GenericDeriveError} becomes TS9106 with the
 * resolution trace as a note; anything else (a bug in a strategy) keeps the
 * legacy "GenericDerivation failed" error so it is never swallowed.
 */
export function reportGenericDeriveFailure(
  ctx: MacroContext,
  node: ts.Node,
  deriveName: string,
  error: unknown
): void {
  if (error instanceof GenericDeriveError) {
    ctx
      .diagnostic(TS9106)
      .at(node)
      .withArgs({ typeclass: error.typeclass, type: error.typeName })
      .note(error.traceNotes.join("\n"))
      .emit();
    return;
  }
  ctx.reportError(node, `GenericDerivation failed for ${deriveName}: ${error}`);
}

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
  if (!result.expression) {
    // A strategy exists but derivation failed: surface WHY (field-by-field
    // trace) instead of returning null, which the caller would report as the
    // misleading "Unknown derive: 'Eq'". The caller reports a thrown error as
    // "GenericDerivation failed for <TC>: ..." and stops trying other paths.
    const notes = formatResolutionTrace({
      sought: `${deriveName}<${typeName}>`,
      attempts: result.trace,
      finalResult: "failed",
    });
    throw new GenericDeriveError(deriveName, typeName, notes);
  }

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
    // The builtin strategies inline primitive field operations and never
    // reference `TC.number`; only a third-party strategy can get here. If the
    // file doesn't already bind the typeclass name, the only module known to
    // provide `TC.<primitive>` at runtime is @typesugar/macros, and only for
    // the typeclasses it actually exports with primitive members — importing
    // any other name from it would bind `undefined`.
    const alreadyBound = ctx.sourceFile.statements.some(
      (s) =>
        (ts.isImportDeclaration(s) &&
          s.importClause?.namedBindings &&
          ts.isNamedImports(s.importClause.namedBindings) &&
          s.importClause.namedBindings.elements.some((e) => e.name.text === deriveName)) ||
        (ts.isVariableStatement(s) &&
          s.declarationList.declarations.some(
            (d) => ts.isIdentifier(d.name) && d.name.text === deriveName
          ))
    );
    if (!alreadyBound && !MACROS_PRIMITIVE_COMPANIONS.has(deriveName)) {
      throw new Error(
        `the derived ${deriveName}<${typeName}> references '${deriveName}.<primitive>', but ` +
          `'${deriveName}' is not bound in this file. Import the module that provides ` +
          `'${deriveName}' with its primitive instances.`
      );
    }
    if (!alreadyBound) {
      // Routed through ensureImport: deduped per (symbol, module) across every
      // derive in the file (two @derive(TC) types used to inject two identical
      // `import { TC }` declarations — a SyntaxError), and aliased when the
      // name is already taken. Rename the `TC.<primitive>` references to the
      // identifier it returns.
      const tcRef = ctx.ensureImport(deriveName, "@typesugar/macros");
      if (tcRef.text !== deriveName) {
        const rename = (n: ts.Node): ts.Node => {
          if (
            ts.isPropertyAccessExpression(n) &&
            ts.isIdentifier(n.expression) &&
            n.expression.text === deriveName
          ) {
            return ts.factory.updatePropertyAccessExpression(n, tcRef, n.name);
          }
          return ts.visitEachChild(n, rename, ctx.transformContext);
        };
        expr = ts.visitNode(expr, rename) as ts.Expression;
      }
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

    const reExport = withImplTag(
      ts.factory.createVariableStatement(
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
      ),
      deriveName,
      typeName
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
    const companionProperty = withImplTag(
      ts.factory.createVariableStatement(
        [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
        ts.factory.createVariableDeclarationList(
          [ts.factory.createVariableDeclaration(deriveName, undefined, typeAnnotation, expr)],
          ts.NodeFlags.Const
        )
      ),
      deriveName,
      typeName
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

/**
 * `/** @impl TC<Type> *\/` on a derive companion member. The tag says what
 * the member is wherever only its declaration is visible: a library's
 * `.d.ts` keeps it (declaration emit copies JSDoc), and a consumer's instance
 * scanner finds `Type.TC` by it. A decorator `@derive(TC)` leaves no trace in
 * a `.d.ts` otherwise. Nothing transforms the expanded output again, so the
 * tag never dispatches the `@impl` macro.
 */
function withImplTag(stmt: ts.VariableStatement, tcName: string, typeName: string) {
  return ts.addSyntheticLeadingComment(
    stmt,
    ts.SyntaxKind.MultiLineCommentTrivia,
    `* @impl ${tcName}<${typeName}> `,
    true
  );
}

// ============================================================================
// Exports
// ============================================================================

export type { TypeclassInfo, TypeclassMethod, InstanceInfo, SyntaxEntry };

export { instanceVarName, companionPath, getTypeclassesForMethod };
