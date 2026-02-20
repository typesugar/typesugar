/**
 * Typeclass Macros - Scala 3-like typeclasses with auto-derivation
 *
 * Provides a complete typeclass system inspired by Scala 3:
 *
 * 1. @typeclass - Defines a typeclass from an interface
 * 2. @instance - Registers a typeclass instance for a type
 * 3. @deriving - Auto-derives typeclass instances for product/sum types
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
 * @deriving(Show, Eq)
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
} from "../core/registry.js";
import {
  MacroContext,
  DeriveTypeInfo,
  DeriveFieldInfo,
  DeriveVariantInfo,
} from "../core/types.js";
import { OPERATOR_SYMBOLS } from "../core/types.js";
import {
  findStandaloneExtension as findStandaloneExtensionForExtend,
  buildStandaloneExtensionCall,
} from "./extension.js";
import type { OperatorSymbol } from "../core/types.js";
import {
  registerInstanceMethodsFromAST,
  extractMethodsFromObjectLiteral,
  registerInstanceMethods,
} from "./specialize.js";
import { quoteStatements } from "./quote.js";

// ============================================================================
// Primitive Registration Hook
// ============================================================================

// Hook for coverage module to register itself
let onPrimitiveRegistered:
  | ((typeName: string, typeclassName: string) => void)
  | undefined;
let onCoverageCheck:
  | ((
      ctx: MacroContext,
      node: ts.Node,
      typeclassName: string,
      typeName: string,
      fields: Array<{ name: string; typeName: string }>,
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
    fields: Array<{ name: string; typeName: string }>,
  ) => boolean,
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
function notifyPrimitiveRegistered(
  typeName: string,
  typeclassName: string,
): void {
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
  fields: DeriveFieldInfo[],
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
    fields.map((f) => ({ name: f.name, typeName: f.typeString })),
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
function parseTransitiveOptions(
  args: readonly ts.Expression[],
): TransitiveOptions {
  const options: TransitiveOptions = { transitive: true, maxDepth: 10 };

  for (const arg of args) {
    if (ts.isObjectLiteralExpression(arg)) {
      for (const prop of arg.properties) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
          if (prop.name.text === "transitive") {
            options.transitive =
              prop.initializer.kind !== ts.SyntaxKind.FalseKeyword;
          }
          if (
            prop.name.text === "maxDepth" &&
            ts.isNumericLiteral(prop.initializer)
          ) {
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
  typeName: string,
):
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration
  | ts.ClassDeclaration
  | undefined {
  for (const statement of ctx.sourceFile.statements) {
    if (
      ts.isInterfaceDeclaration(statement) &&
      statement.name.text === typeName
    ) {
      return statement;
    }
    if (
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text === typeName
    ) {
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
function hasPrimitiveOrInstance(
  typeName: string,
  typeclassName: string,
): boolean {
  // Check instance registry
  if (
    instanceRegistry.some(
      (i) => i.typeclassName === typeclassName && i.forType === typeName,
    )
  ) {
    return true;
  }
  // Check via coverage hook
  if (onPrimitiveRegistered) {
    // Primitives are registered there
  }
  // Hardcoded primitives as fallback
  const primitives = [
    "number",
    "string",
    "boolean",
    "bigint",
    "null",
    "undefined",
  ];
  return primitives.includes(typeName.toLowerCase());
}

/**
 * Build a derivation plan for transitive derivation.
 * Returns types to derive in dependency order (leaves first).
 */
function buildTransitiveDerivationPlan(
  ctx: MacroContext,
  rootTypeName: string,
  typeclassName: string,
  options: TransitiveOptions,
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
          `Add @derive(${typeclassName}) to '${typeName}' or provide an @instance.`,
      );
      return false;
    }

    visiting.add(typeName);

    // Get fields
    const type = ctx.typeChecker.getTypeAtLocation(typeNode);
    const properties = ctx.typeChecker.getPropertiesOfType(type);
    const fields: DeriveFieldInfo[] = [];
    let allOk = true;

    for (const prop of properties) {
      const decls = prop.getDeclarations();
      if (!decls || decls.length === 0) continue;

      const decl = decls[0];
      const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, decl);
      const propTypeString = ctx.typeChecker.typeToString(propType);
      const baseTypeName = normalizeTypeNameForLookup(propTypeString);

      // Recursively analyze field type
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
  plan: { types: TransitiveTypeInfo[]; errors: string[]; cycles: string[][] },
): ts.Statement[] {
  const statements: ts.Statement[] = [];
  const derivation = builtinDerivations[typeclassName];

  if (!derivation) return statements;

  for (const typeInfo of plan.types) {
    // Skip if already has instance (explicit override)
    if (
      instanceRegistry.some(
        (i) =>
          i.typeclassName === typeclassName && i.forType === typeInfo.typeName,
      )
    ) {
      continue;
    }

    // Generate instance
    const code = derivation.deriveProduct(typeInfo.typeName, typeInfo.fields);
    statements.push(...ctx.parseStatements(code));

    // Register
    const varName = instanceVarName(
      uncapitalize(typeclassName),
      typeInfo.typeName,
    );
    instanceRegistry.push({
      typeclassName,
      forType: typeInfo.typeName,
      instanceName: varName,
      derived: true,
    });

    // Register extension methods
    registerExtensionMethods(typeInfo.typeName, typeclassName);

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
   * Used to dynamically generate concrete types by substituting $<F, A> → ConcreteType<A>.
   */
  fullSignatureText?: string;
  /**
   * Operator syntax mappings: operator string -> method name.
   * Built automatically from methods annotated with `& Op<"+">` return types.
   */
  syntax?: Map<string, string>;
}

interface TypeclassMethod {
  name: string;
  /** Parameters (excluding the typeclass's type param, which is the "self") */
  params: Array<{ name: string; typeString: string }>;
  /** Return type as string */
  returnType: string;
  /** Whether the first parameter is the "self" type (for extension methods) */
  isSelfMethod: boolean;
  /** Operator symbol declared via `& Op<"+">` on the return type, if any. */
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
}

/** Tracks which extension methods are available for which types */
interface ExtensionMethodInfo {
  /** The method name (e.g., "show", "eq") */
  methodName: string;
  /** The type this extension is available on (e.g., "Point") */
  forType: string;
  /** The typeclass providing this method (e.g., "Show") */
  typeclassName: string;
  /** Whether the first param is "self" (always true for extensions) */
  isSelfMethod: boolean;
  /** Additional params beyond self */
  extraParams: Array<{ name: string; typeString: string }>;
  /** Return type */
  returnType: string;
}

/** Global compile-time registry of typeclasses and instances */
const typeclassRegistry = new Map<string, TypeclassInfo>();
const instanceRegistry: InstanceInfo[] = [];
const extensionMethodRegistry: ExtensionMethodInfo[] = [];

// ============================================================================
// Syntax Registry — operator → typeclass method mappings
// ============================================================================

interface SyntaxEntry {
  typeclass: string;
  method: string;
}

/**
 * Maps operator strings (e.g., "+", "==") to the typeclasses that provide
 * syntax for them. Multiple typeclasses may map the same operator — ambiguity
 * is resolved at the call site by checking which typeclass has an instance
 * for the operand type.
 */
const syntaxRegistry = new Map<string, SyntaxEntry[]>();

/**
 * Register operator syntax for a typeclass.
 * Called when a typeclass with Op<> annotated methods is registered.
 */
function registerTypeclassSyntax(
  tcName: string,
  syntax: Map<string, string>,
): void {
  for (const [op, method] of syntax) {
    let entries = syntaxRegistry.get(op);
    if (!entries) {
      entries = [];
      syntaxRegistry.set(op, entries);
    }
    entries.push({ typeclass: tcName, method });
  }
}

/**
 * Get all syntax entries for a given operator.
 */
function getSyntaxForOperator(op: string): SyntaxEntry[] | undefined {
  return syntaxRegistry.get(op);
}

/**
 * Clear syntax registry (for testing).
 */
function clearSyntaxRegistry(): void {
  syntaxRegistry.clear();
}

const operatorSymbolSet: ReadonlySet<string> = new Set(
  OPERATOR_SYMBOLS as readonly string[],
);

/**
 * Extract an operator symbol from a return type node of the form `T & Op<"+">`.
 *
 * Walks intersection types looking for `Op<S>` where S is a string literal
 * that is a valid OperatorSymbol. Returns the operator string and the cleaned
 * return type with `Op<>` stripped out.
 */
function extractOpFromReturnType(typeNode: ts.TypeNode | undefined): {
  operatorSymbol: string | undefined;
  cleanReturnType: string;
} {
  if (!typeNode) {
    return { operatorSymbol: undefined, cleanReturnType: "void" };
  }

  if (!ts.isIntersectionTypeNode(typeNode)) {
    return { operatorSymbol: undefined, cleanReturnType: typeNode.getText() };
  }

  let operatorSymbol: string | undefined;
  const nonOpTypes: ts.TypeNode[] = [];

  for (const member of typeNode.types) {
    if (
      ts.isTypeReferenceNode(member) &&
      ts.isIdentifier(member.typeName) &&
      member.typeName.text === "Op" &&
      member.typeArguments &&
      member.typeArguments.length === 1
    ) {
      const arg = member.typeArguments[0];
      if (ts.isLiteralTypeNode(arg) && ts.isStringLiteral(arg.literal)) {
        const sym = arg.literal.text;
        if (operatorSymbolSet.has(sym)) {
          operatorSymbol = sym;
          continue; // skip — don't include Op<> in clean return type
        }
      }
    }
    nonOpTypes.push(member);
  }

  // Rebuild the return type text without Op<>
  let cleanReturnType: string;
  if (nonOpTypes.length === 0) {
    cleanReturnType = "void";
  } else if (nonOpTypes.length === 1) {
    cleanReturnType = nonOpTypes[0].getText();
  } else {
    cleanReturnType = nonOpTypes.map((t) => t.getText()).join(" & ");
  }

  return { operatorSymbol, cleanReturnType };
}

/**
 * Strip `Op<>` from all method return types in an interface declaration.
 * Returns a new interface with clean signatures for the emitted code.
 */
function stripOpFromInterface(
  ctx: MacroContext,
  iface: ts.InterfaceDeclaration,
): ts.InterfaceDeclaration {
  const factory = ctx.factory;
  let needsUpdate = false;

  const newMembers = iface.members.map((member) => {
    if (!ts.isMethodSignature(member) || !member.type) return member;
    if (!ts.isIntersectionTypeNode(member.type)) return member;

    const hasOp = member.type.types.some(
      (t) =>
        ts.isTypeReferenceNode(t) &&
        ts.isIdentifier(t.typeName) &&
        t.typeName.text === "Op",
    );
    if (!hasOp) return member;

    needsUpdate = true;
    const { cleanReturnType } = extractOpFromReturnType(member.type);
    const newReturnType = ctx.parseExpression(`null! as ${cleanReturnType}`);
    let newTypeNode: ts.TypeNode;
    if (ts.isAsExpression(newReturnType)) {
      newTypeNode = newReturnType.type;
    } else {
      newTypeNode = factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword);
    }

    return factory.updateMethodSignature(
      member,
      member.modifiers,
      member.name,
      member.questionToken,
      member.typeParameters,
      member.parameters,
      newTypeNode,
    );
  });

  if (!needsUpdate) return iface;

  return factory.updateInterfaceDeclaration(
    iface,
    iface.modifiers,
    iface.name,
    iface.typeParameters,
    iface.heritageClauses,
    newMembers,
  );
}

/**
 * Register extension methods for a type based on its derived typeclasses.
 * Called by @deriving when it derives typeclass instances.
 */
function registerExtensionMethods(typeName: string, tcName: string): void {
  const tc = typeclassRegistry.get(tcName);
  if (!tc) return;

  for (const method of tc.methods) {
    if (method.isSelfMethod) {
      // Avoid duplicates
      const exists = extensionMethodRegistry.some(
        (e) =>
          e.methodName === method.name &&
          e.forType === typeName &&
          e.typeclassName === tcName,
      );
      if (!exists) {
        extensionMethodRegistry.push({
          methodName: method.name,
          forType: typeName,
          typeclassName: tcName,
          isSelfMethod: true,
          extraParams: method.params.slice(1),
          returnType: method.returnType,
        });
      }
    }
  }
}

/**
 * Find an extension method for a given type and method name.
 * Returns the first matching extension, or undefined.
 */
function findExtensionMethod(
  methodName: string,
  typeName: string,
): ExtensionMethodInfo | undefined {
  return extensionMethodRegistry.find(
    (e) => e.methodName === methodName && e.forType === typeName,
  );
}

/**
 * Get all extension methods available for a given type.
 */
function getExtensionMethodsForType(typeName: string): ExtensionMethodInfo[] {
  return extensionMethodRegistry.filter((e) => e.forType === typeName);
}

/**
 * Get all registered extension methods (for language service integration).
 */
function getAllExtensionMethods(): ExtensionMethodInfo[] {
  return [...extensionMethodRegistry];
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
 * Get method implementations for specialization based on derived typeclass.
 * Returns source strings suitable for registration with the specialization system.
 */
function getSpecializationMethodsForDerivation(
  tcName: string,
  typeName: string,
  fields: DeriveFieldInfo[],
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
      const checks = fields
        .map((f) => `a.${f.name} === b.${f.name}`)
        .join(" && ");
      return {
        eq: {
          source: `(a, b) => ${checks || "true"}`,
          params: ["a", "b"],
        },
        neq: {
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
            `((h << 5) - h + (typeof a.${f.name} === 'number' ? a.${f.name} : String(a.${f.name}).length))`,
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
              i === 0
                ? c.replace(/ : $/, "")
                : `(${acc.replace(/ : $/, "")} || ${c})`,
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
      const combines = fields
        .map((f) => `${f.name}: a.${f.name} + b.${f.name}`)
        .join(", ");
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
      const combines = fields
        .map((f) => `${f.name}: a.${f.name} + b.${f.name}`)
        .join(", ");
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

    default:
      return undefined;
  }
}

function getBaseType(field: DeriveFieldInfo): string {
  const typeStr = field.typeString.toLowerCase();
  if (typeStr === "number" || typeStr.includes("number")) return "number";
  if (typeStr === "string" || typeStr.includes("string")) return "string";
  if (typeStr === "boolean" || typeStr.includes("boolean")) return "boolean";
  if (typeStr.startsWith("array") || typeStr.includes("[]")) return "array";
  return "object";
}

/**
 * Find a registered instance for a given typeclass and type.
 */
function findInstance(
  tcName: string,
  typeName: string,
): InstanceInfo | undefined {
  return instanceRegistry.find(
    (i) => i.typeclassName === tcName && i.forType === typeName,
  );
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
  module: "typemacro",
  cacheable: false,
  description:
    "Define a typeclass from an interface, enabling derivation and extension methods",
  validTargets: ["interface"],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    _args: readonly ts.Expression[],
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
        "@typeclass interface must have at least one type parameter (e.g., interface Show<A>)",
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
        const methodName = ts.isIdentifier(member.name)
          ? member.name.text
          : member.name.getText();

        const params: Array<{ name: string; typeString: string }> = [];
        let isSelfMethod = false;

        for (let i = 0; i < member.parameters.length; i++) {
          const param = member.parameters[i];
          const paramName = ts.isIdentifier(param.name)
            ? param.name.text
            : param.name.getText();
          const paramType = param.type ? param.type.getText() : "unknown";

          // Check if this parameter uses the typeclass's type param
          if (i === 0 && paramType === typeParam) {
            isSelfMethod = true;
          }

          params.push({ name: paramName, typeString: paramType });
        }

        const { operatorSymbol, cleanReturnType } = extractOpFromReturnType(
          member.type,
        );

        methods.push({
          name: methodName,
          params,
          returnType: cleanReturnType,
          isSelfMethod,
          operatorSymbol,
        });
      } else if (ts.isPropertySignature(member) && member.name) {
        const methodName = ts.isIdentifier(member.name)
          ? member.name.text
          : member.name.getText();

        methods.push({
          name: methodName,
          params: [],
          returnType: member.type ? member.type.getText() : "unknown",
          isSelfMethod: false,
        });
      }
    }

    // Build the full interface body text for HKT expansion
    const fullSignatureText =
      memberTexts.length > 0 ? `{ ${memberTexts.join("; ")} }` : undefined;

    // Build syntax map from Op<> annotations on methods
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

    // Register operator syntax in the global registry
    if (syntax.size > 0) {
      registerTypeclassSyntax(tcName, syntax);
    }

    // Generate the companion namespace with utility functions
    const companionCode = generateCompanionNamespace(ctx, tcInfo);

    // Generate extension method helpers
    const extensionCode = generateExtensionHelpers(tcInfo);

    const statements = [
      ...ctx.parseStatements(companionCode),
      ...ctx.parseStatements(extensionCode),
    ];

    // Strip Op<> from the emitted interface
    const cleanTarget = stripOpFromInterface(ctx, target);

    return [cleanTarget, ...statements];
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
): string {
  const { name } = tc;
  const registryVar = ctx.hygiene.mangleName(`${uncapitalize(name)}Instances`);

  return `
// Typeclass instance registry for ${name}
const ${registryVar}: Map<string, ${name}<any>> = new Map();

namespace ${name} {
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
      const otherParamDecls = otherParams
        .map((p) => `${p.name}: ${p.typeString}`)
        .join(", ");
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

export const instanceAttribute = defineAttributeMacro({
  name: "instance",
  module: "typemacro",
  cacheable: false,
  description: "Register a typeclass instance for a specific type",
  validTargets: ["property", "class"],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[],
  ): ts.Node | ts.Node[] {
    const factory = ctx.factory;

    if (args.length === 0) {
      ctx.reportError(
        target,
        '@instance requires arguments: @instance("Type"), @instance("Typeclass<Type>"), or @instance(Typeclass, Type)',
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

      // Check for "Typeclass<Type>" format
      const hktMatch = text.match(/^(\w+)<(\w+)>$/);
      if (hktMatch) {
        tcName = hktMatch[1];
        typeName = hktMatch[2];
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
          "@instance with identifier requires two arguments: @instance(Typeclass, Type)",
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
        ctx.reportError(
          secondArg,
          "Second argument must be an identifier or string",
        );
        return target;
      }

      isHKTInstance = isHKTTypeclass(tcName);
    } else {
      ctx.reportError(
        firstArg,
        "@instance argument must be a string or identifier",
      );
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
        '@instance: could not determine typeclass and type. Use @instance("Typeclass<Type>") or @instance(Typeclass, Type)',
      );
      return target;
    }

    // For HKT typeclasses, generate expanded type annotation
    let updatedTarget = target;
    if (isHKTInstance && decl) {
      const expandedType = generateHKTExpandedType(ctx, tcName, typeName);
      if (expandedType) {
        // Update the variable declaration with the expanded type
        const newDecl = factory.updateVariableDeclaration(
          decl,
          decl.name,
          decl.exclamationToken,
          expandedType,
          decl.initializer,
        );

        if (ts.isVariableStatement(target)) {
          const newDeclList = factory.updateVariableDeclarationList(
            target.declarationList,
            [newDecl],
          );
          updatedTarget = factory.updateVariableStatement(
            target,
            target.modifiers,
            newDeclList,
          );
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

    // Register extension methods for this type+typeclass
    registerExtensionMethods(typeName, tcName);

    // Notify coverage system that this type has an instance
    notifyPrimitiveRegistered(typeName, tcName);

    // Bridge to specialization registry: extract methods from the object literal
    // and register them for zero-cost specialization
    let objLiteral: ts.ObjectLiteralExpression | undefined;
    if (ts.isVariableStatement(updatedTarget)) {
      const d = (updatedTarget as ts.VariableStatement).declarationList
        .declarations[0];
      if (d?.initializer && ts.isObjectLiteralExpression(d.initializer)) {
        objLiteral = d.initializer;
      }
    } else if (ts.isVariableDeclaration(updatedTarget)) {
      if (
        (updatedTarget as ts.VariableDeclaration).initializer &&
        ts.isObjectLiteralExpression(
          (updatedTarget as ts.VariableDeclaration).initializer!,
        )
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

    // Generate registration call using quoteStatements
    const registrationStatements = quoteStatements(ctx)`${tcName}.registerInstance<${typeName}>("${typeName}", ${varName});`;

    return [updatedTarget, ...registrationStatements];
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
// use an encoding ($<F, A>) that triggers "Type instantiation is excessively
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
export function registerHKTExpansion(
  hktName: string,
  concreteName: string,
): void {
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
  hktParam: string,
): ts.TypeNode | undefined {
  const expansion = getHKTExpansion(hktParam);

  // First, try dynamic expansion from registered typeclass
  const tcInfo = typeclassRegistry.get(typeclassName);
  let signature: string | undefined;

  if (tcInfo?.fullSignatureText) {
    // Dynamic substitution: replace $<F, A> with ConcreteType<A>
    // where F is the type parameter from the typeclass (e.g., "F" in Monad<F>)
    signature = expandHKTInSignature(
      tcInfo.fullSignatureText,
      tcInfo.typeParam,
      expansion,
    );
  } else {
    // Fall back to hardcoded templates for unregistered typeclasses (e.g., cats)
    signature = getTypeclassSignatureTemplate(typeclassName, expansion);
  }

  if (!signature) return undefined;

  // Parse the signature into a TypeNode
  try {
    // SAFE: __T is only used for parsing, never emitted into generated code.
    const tempSource = `type __T = ${signature};`;
    const tempFile = ts.createSourceFile(
      "__temp.ts",
      tempSource,
      ts.ScriptTarget.Latest,
      true,
    );

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
 * Replaces $<F, X> with ConcreteType<X> throughout.
 */
function expandHKTInSignature(
  signatureText: string,
  typeParam: string,
  expansion: string,
): string {
  // Match $<TypeParam, ...> and replace with Expansion<...>
  // Handle nested type parameters gracefully
  const pattern = new RegExp(`\\$<${typeParam},\\s*([^<>]+(?:<[^>]+>)?)>`, "g");

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
 * Get the concrete type signature template for a typeclass.
 * Returns a string representation of the expanded type.
 */
function getTypeclassSignatureTemplate(
  typeclassName: string,
  concreteType: string,
): string | undefined {
  const exp = concreteType;

  // Templates for common HKT typeclasses
  // These expand $<F, A> to ConcreteType<A>
  const templates: Record<string, string> = {
    Functor: `{ readonly map: <A, B>(fa: ${exp}<A>, f: (a: A) => B) => ${exp}<B> }`,

    Applicative: `{
      readonly map: <A, B>(fa: ${exp}<A>, f: (a: A) => B) => ${exp}<B>;
      readonly pure: <A>(a: A) => ${exp}<A>;
      readonly ap: <A, B>(fab: ${exp}<(a: A) => B>, fa: ${exp}<A>) => ${exp}<B>
    }`,

    Monad: `{
      readonly map: <A, B>(fa: ${exp}<A>, f: (a: A) => B) => ${exp}<B>;
      readonly flatMap: <A, B>(fa: ${exp}<A>, f: (a: A) => ${exp}<B>) => ${exp}<B>;
      readonly pure: <A>(a: A) => ${exp}<A>;
      readonly ap: <A, B>(fab: ${exp}<(a: A) => B>, fa: ${exp}<A>) => ${exp}<B>
    }`,

    Foldable: `{
      readonly foldLeft: <A, B>(fa: ${exp}<A>, b: B, f: (b: B, a: A) => B) => B;
      readonly foldRight: <A, B>(fa: ${exp}<A>, b: B, f: (a: A, b: B) => B) => B
    }`,

    Traverse: `{
      readonly map: <A, B>(fa: ${exp}<A>, f: (a: A) => B) => ${exp}<B>;
      readonly foldLeft: <A, B>(fa: ${exp}<A>, b: B, f: (b: B, a: A) => B) => B;
      readonly foldRight: <A, B>(fa: ${exp}<A>, b: B, f: (a: A, b: B) => B) => B;
      readonly traverse: <G>(G: any) => <A, B>(fa: ${exp}<A>, f: (a: A) => any) => any
    }`,

    SemigroupK: `{ readonly combineK: <A>(x: ${exp}<A>, y: ${exp}<A>) => ${exp}<A> }`,

    MonoidK: `{
      readonly combineK: <A>(x: ${exp}<A>, y: ${exp}<A>) => ${exp}<A>;
      readonly emptyK: <A>() => ${exp}<A>
    }`,

    Alternative: `{
      readonly map: <A, B>(fa: ${exp}<A>, f: (a: A) => B) => ${exp}<B>;
      readonly flatMap: <A, B>(fa: ${exp}<A>, f: (a: A) => ${exp}<B>) => ${exp}<B>;
      readonly pure: <A>(a: A) => ${exp}<A>;
      readonly ap: <A, B>(fab: ${exp}<(a: A) => B>, fa: ${exp}<A>) => ${exp}<B>;
      readonly combineK: <A>(x: ${exp}<A>, y: ${exp}<A>) => ${exp}<A>;
      readonly emptyK: <A>() => ${exp}<A>
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
    variants: Array<{ tag: string; typeName: string }>,
  ): string;
  /**
   * Generate factory function for a generic sum type.
   * Returns undefined if not supported, falling back to non-generic derivation.
   */
  deriveGenericSum?(
    typeName: string,
    discriminant: string,
    variants: DeriveVariantInfo[],
    typeParams: ts.TypeParameterDeclaration[],
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
function getInstanceParamName(
  tcName: string,
  typeParamName: string,
): string {
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
  typeParams: ts.TypeParameterDeclaration[],
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
  paramMap: Map<string, string>,
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
const ${varName}: Show<${typeName}> = {
  show: (a: ${typeName}): string => \`${typeName}(${fieldShows})\`,
};
Show.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },

    deriveSum(
      typeName: string,
      discriminant: string,
      variants: Array<{ tag: string; typeName: string }>,
    ): string {
      const varName = instanceVarName("show", typeName);
      const cases = variants
        .map((v) => {
          const inst = instanceVarName("show", v.typeName);
          return `    case "${v.tag}": return ${inst}.show(a as any);`;
        })
        .join("\n");

      return `
const ${varName}: Show<${typeName}> = {
  show: (a: ${typeName}): string => {
    switch ((a as any).${discriminant}) {
${cases}
      default: return String(a);
    }
  },
};
Show.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },

    deriveGenericSum(
      typeName: string,
      discriminant: string,
      variants: DeriveVariantInfo[],
      typeParams: ts.TypeParameterDeclaration[],
    ): string | undefined {
      if (typeParams.length === 0) return undefined;

      const { signature, paramMap } = buildGenericFactorySignature(
        "Show",
        typeName,
        typeParams,
      );
      const typeParamsStr = typeParams.map((tp) => tp.name.text).join(", ");
      const fullTypeName = `${typeName}<${typeParamsStr}>`;

      // Build cases for each variant - show the variant name with its field values
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
          // Multiple fields: show as "Tag(field1 = val1, field2 = val2)"
          const fieldShows = fields
            .map((f) => {
              const inst = getFieldInstanceRef("Show", f, paramMap);
              return `${f.name} = \${${inst}.show((a as any).${f.name})}`;
            })
            .join(", ");
          return `      case "${v.tag}": return \`${v.tag}(${fieldShows})\`;`;
        })
        .join("\n");

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
    },
  },

  Eq: {
    deriveProduct(typeName: string, fields: DeriveFieldInfo[]): string {
      const fieldEqs = fields.map((f) => {
        const inst = instanceVarName("eq", getBaseType(f));
        return `${inst}.eq(a.${f.name}, b.${f.name})`;
      });
      const body = fieldEqs.length > 0 ? fieldEqs.join(" && ") : "true";

      const varName = instanceVarName("eq", typeName);
      return `
const ${varName}: Eq<${typeName}> = {
  eq: (a: ${typeName}, b: ${typeName}): boolean => ${body},
  neq: (a: ${typeName}, b: ${typeName}): boolean => !(${body}),
};
Eq.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },

    deriveSum(
      typeName: string,
      discriminant: string,
      variants: Array<{ tag: string; typeName: string }>,
    ): string {
      const varName = instanceVarName("eq", typeName);
      const cases = variants
        .map((v) => {
          const inst = instanceVarName("eq", v.typeName);
          return `    case "${v.tag}": return (b as any).${discriminant} === "${v.tag}" && ${inst}.eq(a as any, b as any);`;
        })
        .join("\n");

      return `
const ${varName}: Eq<${typeName}> = {
  eq: (a: ${typeName}, b: ${typeName}): boolean => {
    if ((a as any).${discriminant} !== (b as any).${discriminant}) return false;
    switch ((a as any).${discriminant}) {
${cases}
      default: return false;
    }
  },
  neq: (a: ${typeName}, b: ${typeName}): boolean => !${varName}.eq(a, b),
};
Eq.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },

    deriveGenericSum(
      typeName: string,
      discriminant: string,
      variants: DeriveVariantInfo[],
      typeParams: ts.TypeParameterDeclaration[],
    ): string | undefined {
      if (typeParams.length === 0) return undefined;

      const { signature, paramMap } = buildGenericFactorySignature(
        "Eq",
        typeName,
        typeParams,
      );
      const typeParamsStr = typeParams.map((tp) => tp.name.text).join(", ");
      const fullTypeName = `${typeName}<${typeParamsStr}>`;

      // Build cases for each variant
      const cases = variants
        .map((v) => {
          // For each variant, compare its fields using the appropriate instance
          const fieldEqs = v.fields
            .filter((f) => f.name !== discriminant)
            .map((f) => {
              const inst = getFieldInstanceRef("Eq", f, paramMap);
              return `${inst}.eqv((x as any).${f.name}, (y as any).${f.name})`;
            });
          const body = fieldEqs.length > 0 ? fieldEqs.join(" && ") : "true";
          return `      case "${v.tag}": return ${body};`;
        })
        .join("\n");

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
const ${varName}: Ord<${typeName}> = {
  compare: (a: ${typeName}, b: ${typeName}): -1 | 0 | 1 => {
${fieldComparisons}
    return 0;
  },
};
Ord.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },

    deriveSum(
      typeName: string,
      discriminant: string,
      variants: Array<{ tag: string; typeName: string }>,
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
const ${varName}: Ord<${typeName}> = {
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
Ord.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },

    deriveGenericSum(
      typeName: string,
      discriminant: string,
      variants: DeriveVariantInfo[],
      typeParams: ts.TypeParameterDeclaration[],
    ): string | undefined {
      if (typeParams.length === 0) return undefined;

      const { signature, paramMap } = buildGenericFactorySignature(
        "Ord",
        typeName,
        typeParams,
      );
      const typeParamsStr = typeParams.map((tp) => tp.name.text).join(", ");
      const fullTypeName = `${typeName}<${typeParamsStr}>`;

      // Build Eq signature for eqv method (needed by Ord)
      const eqParams = typeParams
        .map((tp) => getInstanceParamName("Ord", tp.name.text))
        .join(", ");

      // Build cases for each variant
      const cases = variants
        .map((v) => {
          // For each variant, compare its fields using the appropriate instance
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

      // Tag ordering (first variant < second variant < ...)
      const tagOrder = variants.map((v, i) => `"${v.tag}": ${i}`).join(", ");

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
const ${varName}: Hash<${typeName}> = {
  hash: (a: ${typeName}): number => {
    let hash = 5381;
${fieldHashes}
    return hash >>> 0;
  },
};
Hash.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },

    deriveSum(
      typeName: string,
      discriminant: string,
      variants: Array<{ tag: string; typeName: string }>,
    ): string {
      const varName = instanceVarName("hash", typeName);
      const cases = variants
        .map((v, i) => {
          const inst = instanceVarName("hash", v.typeName);
          return `    case "${v.tag}": return ((${i} << 16) | ${inst}.hash(a as any)) >>> 0;`;
        })
        .join("\n");

      return `
const ${varName}: Hash<${typeName}> = {
  hash: (a: ${typeName}): number => {
    switch ((a as any).${discriminant}) {
${cases}
      default: return 0;
    }
  },
};
Hash.registerInstance<${typeName}>("${typeName}", ${varName});
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
const ${varName}: Functor<${typeName}> = {
  map: <A, B>(fa: ${typeName}, f: (a: A) => B): ${typeName} => {
    return { ...fa } as any;
  },
};
Functor.registerInstance<${typeName}>("${typeName}", ${varName});
`;
    },

    deriveSum(
      typeName: string,
      discriminant: string,
      variants: Array<{ tag: string; typeName: string }>,
    ): string {
      const varName = instanceVarName("functor", typeName);
      const cases = variants
        .map((v) => {
          const inst = instanceVarName("functor", v.typeName);
          return `    case "${v.tag}": return ${inst}.map(fa as any, f) as any;`;
        })
        .join("\n");

      return `
const ${varName}: Functor<${typeName}> = {
  map: <A, B>(fa: ${typeName}, f: (a: A) => B): ${typeName} => {
    switch ((fa as any).${discriminant}) {
${cases}
      default: return fa;
    }
  },
};
Functor.registerInstance<${typeName}>("${typeName}", ${varName});
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
      target:
        | ts.InterfaceDeclaration
        | ts.ClassDeclaration
        | ts.TypeAliasDeclaration,
      typeInfo: DeriveTypeInfo,
    ): ts.Statement[] {
      const derivation = builtinDerivations[tcName];
      if (!derivation) {
        ctx.reportError(
          target,
          `No built-in derivation strategy for typeclass '${tcName}'. ` +
            `Register a custom derivation or provide a manual instance.`,
        );
        return [];
      }

      const {
        name: typeName,
        fields,
        kind,
        discriminant,
        variants,
        typeParameters,
      } = typeInfo;
      let code: string | undefined;

      // Use typeInfo.kind to determine derivation method (zero-cost: metadata-driven)
      if (kind === "sum" && discriminant && variants) {
        // For generic types with type parameters, try factory function derivation
        if (
          typeParameters.length > 0 &&
          derivation.deriveGenericSum
        ) {
          code = derivation.deriveGenericSum(
            typeName,
            discriminant,
            variants,
            typeParameters,
          );
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

      const stmts = ctx.parseStatements(code);

      // Only register instance if not a generic factory function
      // (generic factories are called at use site, not registered globally)
      if (typeParameters.length === 0) {
        instanceRegistry.push({
          typeclassName: tcName,
          forType: typeName,
          instanceName: instanceVarName(uncapitalize(tcName), typeName),
          derived: true,
        });

        // Register extension methods
        registerExtensionMethods(typeName, tcName);
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
  target: ts.TypeAliasDeclaration,
):
  | { discriminant: string; variants: Array<{ tag: string; typeName: string }> }
  | undefined {
  if (!ts.isUnionTypeNode(target.type)) {
    return undefined;
  }

  const variants: Array<{ tag: string; typeName: string }> = [];
  let discriminant: string | undefined;

  for (const member of target.type.types) {
    if (!ts.isTypeReferenceNode(member)) {
      return undefined; // Not a named type reference
    }

    const typeName = member.typeName.getText();
    const type = ctx.typeChecker.getTypeFromTypeNode(member);
    const props = ctx.typeChecker.getPropertiesOfType(type);

    // Look for common discriminant fields
    for (const prop of props) {
      const name = prop.name;
      if (
        name === "kind" ||
        name === "_tag" ||
        name === "type" ||
        name === "tag"
      ) {
        if (!discriminant) {
          discriminant = name;
        } else if (discriminant !== name) {
          continue;
        }

        // Get the literal type of the discriminant
        const declarations = prop.getDeclarations();
        if (declarations && declarations.length > 0) {
          const decl = declarations[0];
          const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(
            prop,
            decl,
          );
          if (propType.isStringLiteral()) {
            variants.push({ tag: propType.value, typeName });
          }
        }
      }
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

export const derivingAttribute = defineAttributeMacro({
  name: "deriving",
  module: "typemacro",
  cacheable: false,
  description:
    "Auto-derive typeclass instances for a type (Scala 3-like derives clause)",
  validTargets: ["interface", "class", "type"],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[],
  ): ts.Node | ts.Node[] {
    if (
      !ts.isInterfaceDeclaration(target) &&
      !ts.isClassDeclaration(target) &&
      !ts.isTypeAliasDeclaration(target)
    ) {
      ctx.reportError(
        target,
        "@deriving can only be applied to interfaces, classes, or type aliases",
      );
      return target;
    }

    const typeName = target.name?.text ?? "Anonymous";
    const type = ctx.typeChecker.getTypeAtLocation(target);
    const typeParameters = target.typeParameters
      ? Array.from(target.typeParameters)
      : [];

    // Extract fields
    const fields: DeriveFieldInfo[] = [];
    const properties = ctx.typeChecker.getPropertiesOfType(type);
    for (const prop of properties) {
      const declarations = prop.getDeclarations();
      if (!declarations || declarations.length === 0) continue;
      const decl = declarations[0];
      const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, decl);
      const propTypeString = ctx.typeChecker.typeToString(propType);
      const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
      const readonly =
        ts.isPropertyDeclaration(decl) || ts.isPropertySignature(decl)
          ? (decl.modifiers?.some(
              (m) => m.kind === ts.SyntaxKind.ReadonlyKeyword,
            ) ?? false)
          : false;

      fields.push({
        name: prop.name,
        typeString: propTypeString,
        type: propType,
        optional,
        readonly,
      });
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
        // Find the variant type and extract its fields
        if (ts.isUnionTypeNode(target.type)) {
          for (const member of target.type.types) {
            if (
              ts.isTypeReferenceNode(member) &&
              member.typeName.getText() === variant.typeName
            ) {
              const variantType = ctx.typeChecker.getTypeFromTypeNode(member);
              const props = ctx.typeChecker.getPropertiesOfType(variantType);
              for (const prop of props) {
                if (prop.name === sumInfo.discriminant) continue;
                const decl = prop.getDeclarations()?.[0];
                if (!decl) continue;
                const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(
                  prop,
                  decl,
                );
                variantFields.push({
                  name: prop.name,
                  typeString: ctx.typeChecker.typeToString(propType),
                  type: propType,
                  optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
                  readonly: false,
                });
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

    // Construct complete DeriveTypeInfo with sum type metadata
    const typeInfo: DeriveTypeInfo = {
      name: typeName,
      fields,
      typeParameters,
      type,
      kind: sumInfo ? "sum" : "product",
      ...(sumInfo && {
        discriminant: sumInfo.discriminant,
        variants,
      }),
    };

    const allStatements: ts.Statement[] = [];

    // Parse transitive options from args (e.g., { transitive: false })
    const transitiveOptions = parseTransitiveOptions(args);

    for (const arg of args) {
      // Skip object literals (they're options, not typeclass names)
      if (ts.isObjectLiteralExpression(arg)) {
        continue;
      }

      if (!ts.isIdentifier(arg)) {
        ctx.reportError(arg, "@deriving arguments must be typeclass names");
        continue;
      }

      const tcName = arg.text;
      const derivation = builtinDerivations[tcName];

      if (derivation) {
        // === TRANSITIVE DERIVATION ===
        // First, derive any nested types that need instances
        const plan = buildTransitiveDerivationPlan(
          ctx,
          typeName,
          tcName,
          transitiveOptions,
        );

        // Report any errors
        for (const err of plan.errors) {
          ctx.reportError(target, err);
        }
        for (const cycle of plan.cycles) {
          ctx.reportError(
            target,
            `Circular reference in transitive derivation: ${cycle.join(" → ")}. ` +
              `Add explicit @derive(${tcName}) to break the cycle.`,
          );
        }

        // Execute transitive derivation for nested types (dependencies first)
        // Skip the root type - we'll derive it below
        const nestedTypes = plan.types.filter((t) => t.typeName !== typeName);
        if (nestedTypes.length > 0) {
          const nestedStatements = executeTransitiveDerivation(ctx, tcName, {
            ...plan,
            types: nestedTypes,
          });
          allStatements.push(...nestedStatements);
        }

        // === DERIVE ROOT TYPE ===
        let code: string | undefined;
        const varName = instanceVarName(uncapitalize(tcName), typeName);
        const { typeParameters } = typeInfo;

        // Use typeInfo.kind to determine derivation method
        if (typeInfo.kind === "sum" && typeInfo.discriminant && sumInfo) {
          // For generic types with type parameters, try factory function derivation
          if (
            typeParameters.length > 0 &&
            derivation.deriveGenericSum
          ) {
            code = derivation.deriveGenericSum(
              typeName,
              typeInfo.discriminant,
              sumInfo.variants,
              typeParameters,
            );
          }

          // Fall back to non-generic derivation if generic not supported
          if (!code) {
            code = derivation.deriveSum(
              typeName,
              typeInfo.discriminant,
              sumInfo.variants,
            );
          }
        } else {
          code = derivation.deriveProduct(typeName, fields);
        }

        allStatements.push(...ctx.parseStatements(code));

        // Only register instance if not a generic factory function
        // (generic factories are called at use site, not registered globally)
        if (typeParameters.length === 0) {
          instanceRegistry.push({
            typeclassName: tcName,
            forType: typeName,
            instanceName: varName,
            derived: true,
          });

          // Register extension methods for this type+typeclass
          registerExtensionMethods(typeName, tcName);

          // Notify coverage system
          notifyPrimitiveRegistered(typeName, tcName);

          // Bridge to specialization registry: register derived instance methods
          // For HKT typeclasses (Functor, Monad, etc.), this enables zero-cost specialization
          const specMethods = getSpecializationMethodsForDerivation(
            tcName,
            typeName,
            fields,
          );
          if (specMethods && Object.keys(specMethods).length > 0) {
            registerInstanceMethods(varName, typeName, specMethods);
          }
        }
      } else {
        // Try the derive macro registry
        const deriveMacro = globalRegistry.getDerive(`${tcName}TC`);
        if (deriveMacro) {
          const stmts = deriveMacro.expand(ctx, target, typeInfo);
          allStatements.push(...stmts);
        } else {
          ctx.reportError(
            arg,
            `No derivation strategy found for typeclass '${tcName}'. ` +
              `Define a custom derivation or provide a manual instance.`,
          );
        }
      }
    }

    return [target, ...allStatements];
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
  module: "typemacro",
  description:
    "Resolve a typeclass instance at compile time with Scala 3-style auto-derivation via Mirror",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[],
  ): ts.Expression {
    // Get the type argument: summon<Show<Point>>()
    const typeArgs = callExpr.typeArguments;
    if (!typeArgs || typeArgs.length === 0) {
      ctx.reportError(
        callExpr,
        "summon requires a type argument, e.g., summon<Show<Point>>()",
      );
      return callExpr;
    }

    const typeArg = typeArgs[0];
    if (!ts.isTypeReferenceNode(typeArg)) {
      ctx.reportError(
        callExpr,
        "summon type argument must be a type reference like Show<Point>",
      );
      return callExpr;
    }

    const tcName = typeArg.typeName.getText();
    const innerTypeArgs = typeArg.typeArguments;

    if (!innerTypeArgs || innerTypeArgs.length === 0) {
      ctx.reportError(
        callExpr,
        `summon<${tcName}<...>>() requires the typeclass to have a type argument`,
      );
      return callExpr;
    }

    const innerType = innerTypeArgs[0];
    let typeName: string;

    if (ts.isTypeReferenceNode(innerType)) {
      typeName = innerType.typeName.getText();
    } else if (innerType.kind === ts.SyntaxKind.NumberKeyword) {
      typeName = "number";
    } else if (innerType.kind === ts.SyntaxKind.StringKeyword) {
      typeName = "string";
    } else if (innerType.kind === ts.SyntaxKind.BooleanKeyword) {
      typeName = "boolean";
    } else {
      typeName = innerType.getText();
    }

    // 1. Check for explicit instance in the compile-time registry
    const explicitInstance = findInstance(tcName, typeName);
    if (explicitInstance) {
      return ctx.parseExpression(instanceVarName(tcName, typeName));
    }

    // 2. Try Scala 3-style derivation via Mirror (GenericMeta)
    const { tryDeriveViaGeneric } =
      require("./auto-derive.js") as typeof import("./auto-derive.js");
    const derived = tryDeriveViaGeneric(ctx, tcName, typeName);
    if (derived) {
      return derived;
    }

    // 3. No instance found — compile error with actionable guidance
    ctx.reportError(
      callExpr,
      `No instance of ${tcName}<${typeName}> found.\n` +
        `\n` +
        `summon resolves instances at compile time in order:\n` +
        `\n` +
        `  1. Explicit instance — register one with @instance:\n` +
        `       @instance("${tcName}<${typeName}>")\n` +
        `       const ${tcName.toLowerCase()}${typeName}: ${tcName}<${typeName}> = { ... };\n` +
        `\n` +
        `  2. Explicit derivation — use @deriving on the type definition:\n` +
        `       @deriving(${tcName})\n` +
        `       interface ${typeName} { ... }\n` +
        `\n` +
        `  3. Auto-derivation — summon inspects ${typeName} via the TypeChecker and\n` +
        `     derives ${tcName}<${typeName}> automatically if a derivation strategy is\n` +
        `     registered for ${tcName} (via registerGenericDerivation) and every field\n` +
        `     of ${typeName} has the required element-level instance.\n` +
        `\n` +
        `Auto-derivation failed because either no derivation strategy is registered\n` +
        `for ${tcName}, or ${typeName} has fields whose types lack the required instances.`,
    );
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
  module: "typemacro",
  description: "Call extension methods on a value via typeclass instances",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
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
        "extend() must be followed by a method call, e.g., extend(value).show()",
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
          const allArgs = extraArgs
            ? `${value.getText()}, ${extraArgs}`
            : value.getText();
          const code = `${tcName}.summon<${typeName}>("${typeName}").${methodName}(${allArgs})`;
          return ctx.parseExpression(code);
        }

        const code = `${tcName}.summon<${typeName}>("${typeName}").${methodName}(${value.getText()})`;
        return ctx.parseExpression(code);
      }
    }

    // Check standalone extensions (Scala 3-style concrete type extensions)
    const standaloneExt = findStandaloneExtensionForExtend(
      methodName,
      typeName,
    );
    if (standaloneExt) {
      const grandParent = parent.parent;
      const extraArgs =
        grandParent && ts.isCallExpression(grandParent)
          ? Array.from(grandParent.arguments)
          : [];
      return buildStandaloneExtensionCall(
        ctx.factory,
        standaloneExt,
        value,
        extraArgs,
      );
    }

    // No match in registries — strip the extend() wrapper and emit
    // value.method(args) so the transformer's implicit extension rewriting
    // (which includes import-scoped resolution) can handle it.
    const grandParent = parent.parent;
    if (grandParent && ts.isCallExpression(grandParent)) {
      const methodCall = ctx.factory.createCallExpression(
        ctx.factory.createPropertyAccessExpression(value, methodName),
        undefined,
        Array.from(grandParent.arguments),
      );
      return methodCall;
    }
    const propAccess = ctx.factory.createPropertyAccessExpression(
      value,
      methodName,
    );
    return propAccess;
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
@typeclass
interface Eq<A> {
  eq(a: A, b: A): boolean & Op<"===">;
  neq(a: A, b: A): boolean & Op<"!==">;
}

/** Ordering typeclass - Scala 3: trait Ord[A] extends Eq[A] */
@typeclass
interface Ord<A> {
  compare(a: A, b: A): (-1 | 0 | 1) & Op<"<">;
}

/** Show typeclass - Scala 3: trait Show[A] */
@typeclass
interface Show<A> {
  show(a: A): string;
}

/** Hash typeclass */
@typeclass
interface Hash<A> {
  hash(a: A): number;
}

/** Semigroup typeclass - Scala 3: trait Semigroup[A] */
@typeclass
interface Semigroup<A> {
  combine(a: A, b: A): A & Op<"+">;
}

/** Monoid typeclass - Scala 3: trait Monoid[A] extends Semigroup[A] */
@typeclass
interface Monoid<A> {
  empty(): A;
  combine(a: A, b: A): A & Op<"+">;
}

/** Functor typeclass - Scala 3: trait Functor[F[_]] */
@typeclass
interface Functor<F> {
  map<A, B>(fa: F, f: (a: A) => B): F;
}

// ============================================================================
// Primitive Instances
// ============================================================================

// Eq instances for primitives
const eqNumber: Eq<number> = {
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
};
Eq.registerInstance<number>("number", eqNumber);

const eqString: Eq<string> = {
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
};
Eq.registerInstance<string>("string", eqString);

const eqBoolean: Eq<boolean> = {
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
};
Eq.registerInstance<boolean>("boolean", eqBoolean);

// Show instances for primitives
const showNumber: Show<number> = {
  show: (a) => String(a),
};
Show.registerInstance<number>("number", showNumber);

const showString: Show<string> = {
  show: (a) => JSON.stringify(a),
};
Show.registerInstance<string>("string", showString);

const showBoolean: Show<boolean> = {
  show: (a) => String(a),
};
Show.registerInstance<boolean>("boolean", showBoolean);

// Ord instances for primitives
const ordNumber: Ord<number> = {
  compare: (a, b) => a < b ? -1 : a > b ? 1 : 0,
};
Ord.registerInstance<number>("number", ordNumber);

const ordString: Ord<string> = {
  compare: (a, b) => a < b ? -1 : a > b ? 1 : 0,
};
Ord.registerInstance<string>("string", ordString);

// Hash instances for primitives
const hashNumber: Hash<number> = {
  hash: (a) => a | 0,
};
Hash.registerInstance<number>("number", hashNumber);

const hashString: Hash<string> = {
  hash: (a) => {
    let h = 5381;
    for (let i = 0; i < a.length; i++) {
      h = ((h << 5) + h) + a.charCodeAt(i);
    }
    return h >>> 0;
  },
};
Hash.registerInstance<string>("string", hashString);

const hashBoolean: Hash<boolean> = {
  hash: (a) => a ? 1 : 0,
};
Hash.registerInstance<boolean>("boolean", hashBoolean);

// Semigroup instances for primitives
const semigroupNumber: Semigroup<number> = {
  combine: (a, b) => a + b,
};
Semigroup.registerInstance<number>("number", semigroupNumber);

const semigroupString: Semigroup<string> = {
  combine: (a, b) => a + b,
};
Semigroup.registerInstance<string>("string", semigroupString);

// Monoid instances for primitives
const monoidNumber: Monoid<number> = {
  empty: () => 0,
  combine: (a, b) => a + b,
};
Monoid.registerInstance<number>("number", monoidNumber);

const monoidString: Monoid<string> = {
  empty: () => "",
  combine: (a, b) => a + b,
};
Monoid.registerInstance<string>("string", monoidString);
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
const ${varName}: Semigroup<${typeName}> = {
  combine: (a: ${typeName}, b: ${typeName}): ${typeName} => ({
${fieldCombines}
  }),
};
Semigroup.registerInstance<${typeName}>("${typeName}", ${varName});
`;
  },

  deriveSum(
    _typeName: string,
    _discriminant: string,
    _variants: Array<{ tag: string; typeName: string }>,
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
const ${varName}: Monoid<${typeName}> = {
  empty: (): ${typeName} => ({
${fieldEmpties}
  }),
  combine: (a: ${typeName}, b: ${typeName}): ${typeName} => ({
${fieldCombines}
  }),
};
Monoid.registerInstance<${typeName}>("${typeName}", ${varName});
`;
  },

  deriveSum(
    _typeName: string,
    _discriminant: string,
    _variants: Array<{ tag: string; typeName: string }>,
  ): string {
    return `// Monoid cannot be auto-derived for sum types`;
  },
};

// ============================================================================
// Register all macros with the global registry
// ============================================================================

globalRegistry.register(typeclassAttribute);
globalRegistry.register(instanceAttribute);
globalRegistry.register(derivingAttribute);
globalRegistry.register(summonMacro);
globalRegistry.register(extendMacro);
globalRegistry.register(showTCDerive);
globalRegistry.register(eqTCDerive);
globalRegistry.register(ordTCDerive);
globalRegistry.register(hashTCDerive);
globalRegistry.register(functorTCDerive);

// ============================================================================
// Exports
// ============================================================================

export {
  typeclassRegistry,
  instanceRegistry,
  extensionMethodRegistry,
  builtinDerivations,
  TypeclassInfo,
  TypeclassMethod,
  InstanceInfo,
  ExtensionMethodInfo,
  BuiltinTypeclassDerivation,
  SyntaxEntry,
  findInstance,
  getTypeclass,
  findExtensionMethod,
  getExtensionMethodsForType,
  getAllExtensionMethods,
  registerExtensionMethods,
  instanceVarName,
  createTypeclassDeriveMacro,
  syntaxRegistry,
  getSyntaxForOperator,
  registerTypeclassSyntax,
  clearSyntaxRegistry,
  extractOpFromReturnType,
};
