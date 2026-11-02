/**
 * @typesugar/codec — Macro definitions (BUILD-TIME ONLY).
 *
 * This entry imports `typescript` and is loaded by the transformer at build time
 * (via the `./macros` subpath). It must NOT be imported by application runtime
 * code — the runtime values, types, and helpers live in the package's `.` entry.
 * See PEP-050.
 *
 * Macros registered with the transformer.
 * @codec extracts type structure and generates defineSchema() call,
 * reading @since, @removed, @renamed, @defaultValue annotations from members.
 */

import * as ts from "typescript";
import { defineAttributeMacro, globalRegistry } from "@typesugar/core";
import type { MacroContext } from "@typesugar/core";

/**
 * Map a property's checker type to the codec schema's `type` tag. Type
 * directed (flags / checker queries), never string matching on the printed
 * type. `null`/`undefined` alternatives are ignored (optionality is recorded
 * separately); anything else that is not a single runtime kind is "unknown".
 */
function schemaTypeOf(ctx: MacroContext, type: ts.Type): string {
  const checker = ctx.typeChecker;
  let t = type;
  if (t.isUnion() && !(t.flags & ts.TypeFlags.Boolean)) {
    const rest = t.types.filter(
      (m) => !(m.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void))
    );
    const kinds = new Set(rest.map((m) => schemaTypeOf(ctx, m)));
    return kinds.size === 1 ? [...kinds][0] : "unknown";
  }
  const f = t.flags;
  if (f & ts.TypeFlags.StringLike) return "string";
  if (f & ts.TypeFlags.NumberLike) return "number";
  if (f & ts.TypeFlags.BooleanLike) return "boolean";
  if (f & ts.TypeFlags.BigIntLike) return "bigint";
  if (f & ts.TypeFlags.Object) {
    if (checker.isArrayType(t) || checker.isTupleType(t)) return "array";
    const sym = t.getSymbol();
    if (
      sym?.name === "Date" &&
      (sym.declarations ?? []).some((d) =>
        ctx.program.isSourceFileDefaultLibrary(d.getSourceFile())
      )
    ) {
      return "date";
    }
    return "object";
  }
  if (f & ts.TypeFlags.NonPrimitive) return "object";
  return "unknown";
}

// -------------------------------------------------------------------------
// Decorator argument extraction helpers
// -------------------------------------------------------------------------

/** Known field-level decorator names. */
const FIELD_DECORATOR_NAMES = new Set(["since", "removed", "renamed", "defaultValue"]);

/**
 * Extract the name from a decorator expression.
 * Handles both `@foo` and `@foo(args)` forms.
 */
function getDecoratorName(decorator: ts.Decorator): string | undefined {
  const expr = decorator.expression;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text;
  }
  return undefined;
}

/**
 * Extract the arguments from a decorator call expression.
 * Returns an empty array for bare `@foo` decorators.
 */
function getDecoratorArgs(decorator: ts.Decorator): readonly ts.Expression[] {
  const expr = decorator.expression;
  if (ts.isCallExpression(expr)) return expr.arguments;
  return [];
}

/**
 * Evaluate a simple literal expression to a JS value.
 * Supports numbers, strings, booleans, null, arrays, and object literals.
 */
function evalLiteral(node: ts.Expression): unknown {
  if (ts.isNumericLiteral(node)) return parseFloat(node.text);
  if (ts.isStringLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const operand = evalLiteral(node.operand as ts.Expression);
    return typeof operand === "number" ? -operand : undefined;
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((e) => evalLiteral(e));
  }
  if (ts.isObjectLiteralExpression(node)) {
    const obj: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop) && prop.name && ts.isIdentifier(prop.name)) {
        obj[prop.name.text] = evalLiteral(prop.initializer);
      }
    }
    return obj;
  }
  return undefined;
}

/** Field metadata collected from decorators on a single property. */
interface FieldDecoratorMeta {
  since?: number;
  removed?: number;
  renamed?: { version: number; oldName: string };
  defaultValue?: unknown;
  hasDefaultValue?: boolean;
  /** The `@defaultValue(...)` argument as written (emitted as-is, so non-literal defaults work). */
  defaultValueExpr?: ts.Expression;
}

/** Called for a field decorator whose arguments are not the required literals. */
export type FieldMetaErrorReporter = (node: ts.Node, message: string) => void;

/**
 * Scan decorators on a class/interface member and extract field-level metadata.
 */
function extractFieldDecoratorMeta(
  member: ts.ClassElement | ts.TypeElement,
  onError?: FieldMetaErrorReporter
): FieldDecoratorMeta {
  const meta: FieldDecoratorMeta = {};

  // ts.getDecorators only works on nodes that can have decorators (class elements).
  // For interface property signatures we check the `modifiers` array directly since
  // typesugar's attribute macros on interface members are stored as synthetic modifiers.
  const decorators = memberDecorators(member);

  for (const dec of decorators) {
    const name = getDecoratorName(dec);
    if (!name || !FIELD_DECORATOR_NAMES.has(name)) continue;
    const args = getDecoratorArgs(dec);

    switch (name) {
      case "since": {
        const v = args[0] ? evalLiteral(args[0]) : undefined;
        if (typeof v === "number") meta.since = v;
        else onError?.(dec, "@since(version) requires a numeric literal version");
        break;
      }
      case "removed": {
        const v = args[0] ? evalLiteral(args[0]) : undefined;
        if (typeof v === "number") meta.removed = v;
        else onError?.(dec, "@removed(version) requires a numeric literal version");
        break;
      }
      case "renamed": {
        const ver = args[0] ? evalLiteral(args[0]) : undefined;
        const oldName = args[1] ? evalLiteral(args[1]) : undefined;
        if (typeof ver === "number" && typeof oldName === "string") {
          meta.renamed = { version: ver, oldName };
        } else {
          onError?.(
            dec,
            "@renamed(version, oldName) requires a numeric literal version and a string literal old name"
          );
        }
        break;
      }
      case "defaultValue": {
        if (args[0]) {
          meta.defaultValue = evalLiteral(args[0]);
          meta.hasDefaultValue = true;
          meta.defaultValueExpr = args[0];
        } else {
          onError?.(dec, "@defaultValue(value) requires an argument");
        }
        break;
      }
    }
  }

  return meta;
}

/**
 * Build a mapping from property name to decorator metadata for all members
 * of a class or interface declaration.
 */
export function collectFieldMeta(
  target: ts.ClassDeclaration | ts.InterfaceDeclaration,
  onError?: FieldMetaErrorReporter
): Map<string, FieldDecoratorMeta> {
  const map = new Map<string, FieldDecoratorMeta>();

  for (const member of target.members) {
    let propName: string | undefined;
    if (ts.isPropertyDeclaration(member) || ts.isPropertySignature(member)) {
      if (member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))) {
        propName = member.name.text;
      }
    }
    if (!propName) continue;
    const meta = extractFieldDecoratorMeta(member, onError);
    if (
      meta.since !== undefined ||
      meta.removed !== undefined ||
      meta.renamed !== undefined ||
      meta.hasDefaultValue
    ) {
      map.set(propName, meta);
    }
  }

  return map;
}

/**
 * Decorators attached to a member. Class members expose them through
 * `ts.getDecorators`; on interface members (where TypeScript itself reports
 * TS1206) the parser still records them in `modifiers`.
 */
function memberDecorators(member: ts.Node): readonly ts.Decorator[] {
  if (ts.canHaveDecorators(member)) return ts.getDecorators(member) ?? [];
  const mods = (member as { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers;
  return (mods ?? []).filter((m) => ts.isDecorator(m)) as ts.Decorator[];
}

// -------------------------------------------------------------------------
// AST construction for the generated defineSchema(...) call
// -------------------------------------------------------------------------

interface FieldDescriptor extends FieldDecoratorMeta {
  name: string;
  type: string;
  optional?: boolean;
}

function fieldToAst(f: ts.NodeFactory, d: FieldDescriptor): ts.Expression {
  const props: ts.ObjectLiteralElementLike[] = [
    f.createPropertyAssignment("name", f.createStringLiteral(d.name)),
    f.createPropertyAssignment("type", f.createStringLiteral(d.type)),
  ];
  if (d.optional) props.push(f.createPropertyAssignment("optional", f.createTrue()));
  if (d.since !== undefined)
    props.push(f.createPropertyAssignment("since", f.createNumericLiteral(d.since)));
  if (d.removed !== undefined) {
    props.push(f.createPropertyAssignment("removed", f.createNumericLiteral(d.removed)));
  }
  if (d.renamed) {
    props.push(
      f.createPropertyAssignment(
        "renamed",
        f.createObjectLiteralExpression([
          f.createPropertyAssignment("version", f.createNumericLiteral(d.renamed.version)),
          f.createPropertyAssignment("oldName", f.createStringLiteral(d.renamed.oldName)),
        ])
      )
    );
  }
  if (d.defaultValueExpr) {
    // The decorator argument exactly as written — a non-literal default
    // (`@defaultValue(DEFAULTS.tags)`) is preserved instead of dropped.
    props.push(f.createPropertyAssignment("defaultValue", d.defaultValueExpr));
  }
  return f.createObjectLiteralExpression(props);
}

/** Read `@codec(N)` / `@codec({ version: N, format })`. Reports and returns undefined when malformed. */
function readCodecOptions(
  ctx: MacroContext,
  node: ts.Node,
  args: readonly ts.Expression[]
): { version: number; format?: "json" | "binary" } | undefined {
  if (args.length === 0) return { version: 1 };
  const bad = (msg: string) => {
    ctx.reportError(node, `@codec: ${msg}`);
    return undefined;
  };
  if (args.length > 1)
    return bad("expected a single argument: @codec(version) or @codec({ version })");
  const arg = args[0];
  const v = evalLiteral(arg);
  if (typeof v === "number") {
    return Number.isInteger(v) && v >= 1
      ? { version: v }
      : bad(`version must be an integer >= 1, got ${v}`);
  }
  if (ts.isObjectLiteralExpression(arg) && v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      if (k !== "version" && k !== "format") return bad(`unknown option '${k}'`);
    }
    const version = o.version === undefined ? 1 : o.version;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
      return bad("'version' must be an integer literal >= 1");
    }
    if (o.format !== undefined && o.format !== "json" && o.format !== "binary") {
      return bad(`'format' must be "json" or "binary"`);
    }
    return { version, format: o.format as "json" | "binary" | undefined };
  }
  return bad("expected @codec(version) or @codec({ version: N }) with literal values");
}

// -------------------------------------------------------------------------
// @codec macro
// -------------------------------------------------------------------------

export const codecMacro = defineAttributeMacro({
  name: "codec",
  module: "@typesugar/codec",
  description: "Generate versioned codec for a type with schema evolution",
  validTargets: ["interface", "class"],
  expand(ctx: MacroContext, decorator, target, args) {
    if (!ts.isClassDeclaration(target) && !ts.isInterfaceDeclaration(target)) {
      return target;
    }
    const name = target.name?.text;
    if (!name) {
      ctx.reportError(target, "@codec requires a named class or interface");
      return target;
    }

    const options = readCodecOptions(ctx, decorator, args as readonly ts.Expression[]);
    if (!options) return target;

    // Collect decorator metadata from members.
    const fieldMeta = collectFieldMeta(target, (node, message) => ctx.reportError(node, message));

    let properties: ts.Symbol[];
    try {
      properties = ctx.typeChecker.getPropertiesOfType(ctx.typeChecker.getTypeAtLocation(target));
    } catch (e) {
      ctx.reportWarning(target, `@codec: Could not extract type for ${name}: ${String(e)}`);
      return target;
    }

    const fields: FieldDescriptor[] = [];
    for (const prop of properties) {
      const propName = prop.getName();
      if (propName.startsWith("__") || propName === "constructor") continue;
      const decl = prop.getDeclarations()?.[0];
      if (decl && (ts.isMethodDeclaration(decl) || ts.isMethodSignature(decl))) continue;

      let type = "unknown";
      try {
        type = schemaTypeOf(ctx, ctx.typeChecker.getTypeOfSymbolAtLocation(prop, decl || target));
      } catch (e) {
        ctx.reportWarning(
          target,
          `@codec: could not resolve the type of '${propName}' (${String(e)}); using "unknown"`
        );
      }

      fields.push({
        name: propName,
        type,
        ...(prop.flags & ts.SymbolFlags.Optional ? { optional: true } : {}),
        ...fieldMeta.get(propName),
      });
    }

    const f = ctx.factory;
    const optionProps: ts.ObjectLiteralElementLike[] = [
      f.createPropertyAssignment("version", f.createNumericLiteral(options.version)),
    ];
    if (options.format) {
      optionProps.push(f.createPropertyAssignment("format", f.createStringLiteral(options.format)));
    }
    optionProps.push(
      f.createPropertyAssignment(
        "fields",
        f.createArrayLiteralExpression(
          fields.map((d) => fieldToAst(f, d)),
          true
        )
      )
    );
    const defineSchemaCall = f.createCallExpression(f.createIdentifier("defineSchema"), undefined, [
      f.createStringLiteral(name),
      f.createObjectLiteralExpression(optionProps, true),
    ]);
    const stmt = f.createVariableStatement(
      undefined,
      f.createVariableDeclarationList(
        [f.createVariableDeclaration(`${name}Schema`, undefined, undefined, defineSchemaCall)],
        ts.NodeFlags.Const
      )
    );

    return [target, stmt];
  },
});

/**
 * Field decorators carry metadata that `@codec` reads off the declaration;
 * at expansion they only need to remove THEMSELVES from the member (the
 * decorator has no runtime meaning, and leaving it attached makes the
 * transformer re-visit the member and expand it again, forever).
 */
function stripDecorator(ctx: MacroContext, decorator: ts.Decorator, target: ts.Node): ts.Node {
  const f = ctx.factory;
  if (ts.isPropertyDeclaration(target)) {
    return f.updatePropertyDeclaration(
      target,
      target.modifiers?.filter((m) => m !== decorator),
      target.name,
      target.questionToken ?? target.exclamationToken,
      target.type,
      target.initializer
    );
  }
  if (ts.isPropertySignature(target)) {
    return f.updatePropertySignature(
      target,
      (target.modifiers as readonly ts.ModifierLike[] | undefined)?.filter(
        (m) => m !== decorator
      ) as ts.Modifier[] | undefined,
      target.name,
      target.questionToken,
      target.type
    );
  }
  ctx.reportError(decorator, "codec field decorators can only be applied to properties");
  return target;
}

function fieldDecoratorMacro(name: string, description: string) {
  return defineAttributeMacro({
    name,
    module: "@typesugar/codec",
    description,
    validTargets: ["property"],
    expand(ctx, decorator, target, _args) {
      return stripDecorator(ctx, decorator, target) as typeof target;
    },
  });
}

export const sinceMacro = fieldDecoratorMacro(
  "since",
  "Mark the version in which a field was introduced"
);

export const removedMacro = fieldDecoratorMacro(
  "removed",
  "Mark the version in which a field was removed"
);

export const renamedMacro = fieldDecoratorMacro(
  "renamed",
  "Mark that a field was renamed from an older name at a given version"
);

export const defaultValueMacro = fieldDecoratorMacro(
  "defaultValue",
  "Provide a default value for decoding older versions"
);

/** Register all codec macros with the global registry. Called on package import. */
export function register(): void {
  globalRegistry.register(codecMacro);
  globalRegistry.register(sinceMacro);
  globalRegistry.register(removedMacro);
  globalRegistry.register(renamedMacro);
  globalRegistry.register(defaultValueMacro);
}

// Auto-register on import (the transformer loads this entry for its side effects).
register();
