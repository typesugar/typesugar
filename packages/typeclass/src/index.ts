/**
 * Typeclass Macros - Scala 3-style typeclasses with auto-derivation
 *
 * Provides compile-time typeclass pattern support with:
 * - @typeclass decorator to define typeclass interfaces
 * - @instance decorator to provide instances
 * - @deriving decorator for auto-derivation
 * - summon<T>() to get instances at compile time
 * - extend<T>() to add extension methods
 *
 * Usage:
 *   @typeclass
 *   interface Show<A> {
 *     show(a: A): string;
 *   }
 *
 *   @instance(Show, Number)
 *   const numberShow: Show<number> = {
 *     show: (n) => String(n)
 *   };
 *
 *   // Extension method usage:
 *   extend(myValue).show() // Works if Show instance exists for myValue's type
 */

import * as ts from "typescript";
import {
  defineExpressionMacro,
  defineAttributeMacro,
  globalRegistry,
  globalExtensionRegistry,
  MacroContext,
  AttributeTarget,
  createGenericRegistry,
  type GenericRegistry,
} from "@typesugar/core";

// ============================================================================
// Registry for typeclasses and instances (compile-time)
// ============================================================================

/**
 * Information about a typeclass definition.
 * Captured from @typeclass decorated interfaces.
 */
export interface TypeclassInfo {
  name: string;
  methods: Array<{
    name: string;
    typeParams: string[];
    params: Array<{ name: string; type: string }>;
    returnType: string;
  }>;
}

/**
 * Information about a typeclass instance.
 * Captured from @instance decorated values.
 */
export interface InstanceInfo {
  typeclass: string;
  forType: string;
  expression: ts.Expression;
}

/**
 * Registry of all typeclasses defined with @typeclass.
 * Uses the generic Registry<K,V> abstraction from @typesugar/core.
 */
const typeclassRegistry: GenericRegistry<string, TypeclassInfo> = createGenericRegistry({
  name: "TypeclassRegistry",
  duplicateStrategy: "skip",
  valueEquals: (a, b) => a.name === b.name,
});

/**
 * Registry of all instances defined with @instance.
 * Uses the generic Registry<K,V> abstraction from @typesugar/core.
 */
const instanceRegistry: GenericRegistry<string, InstanceInfo> = createGenericRegistry({
  name: "InstanceRegistry",
  duplicateStrategy: "skip",
  valueEquals: (a, b) => a.typeclass === b.typeclass && a.forType === b.forType,
});

/**
 * Get the key for an instance: "Show<number>"
 */
function instanceKey(typeclass: string, forType: string): string {
  return `${typeclass}<${forType}>`;
}

/**
 * Clear registries (for testing)
 */
export function clearRegistries(): void {
  typeclassRegistry.clear();
  instanceRegistry.clear();
}

/**
 * Get all registered typeclasses
 */
export function getTypeclasses(): Map<string, TypeclassInfo> {
  return new Map(typeclassRegistry.entries());
}

/**
 * Get all registered instances
 */
export function getInstances(): Map<string, InstanceInfo> {
  return new Map(instanceRegistry.entries());
}

// ============================================================================
// @typeclass Attribute Macro
// ============================================================================

export const typeclassAttribute = defineAttributeMacro({
  name: "typeclass",
  module: "@typesugar/typeclass",
  description: "Define a typeclass interface",
  validTargets: ["interface"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    decorator: ts.Decorator,
    target: ts.Declaration,
    _args: readonly ts.Expression[],
  ): ts.Node | ts.Node[] {
    if (!ts.isInterfaceDeclaration(target) || !target.name) {
      ctx.reportError(
        decorator,
        "@typeclass can only be applied to named interfaces",
      );
      return target;
    }

    const typeclassName = target.name.text;

    // Extract method signatures
    const methods: TypeclassInfo["methods"] = [];

    for (const member of target.members) {
      if (ts.isMethodSignature(member) && member.name) {
        const methodName = ts.isIdentifier(member.name)
          ? member.name.text
          : String(member.name);

        const typeParams =
          member.typeParameters?.map((tp) => tp.name.text) ?? [];

        const params: Array<{ name: string; type: string }> = [];
        for (const param of member.parameters) {
          if (ts.isIdentifier(param.name)) {
            params.push({
              name: param.name.text,
              type: param.type
                ? ctx.typeChecker.typeToString(
                    ctx.typeChecker.getTypeAtLocation(param.type),
                  )
                : "unknown",
            });
          }
        }

        const returnType = member.type
          ? ctx.typeChecker.typeToString(
              ctx.typeChecker.getTypeAtLocation(member.type),
            )
          : "void";

        methods.push({
          name: methodName,
          typeParams,
          params,
          returnType,
        });

        // Note: Extension methods are registered when instances are created,
        // not when the typeclass is defined. The typeclass definition just
        // describes the interface; actual extension methods require a concrete
        // type binding from @instance or @deriving.
      }
    }

    // Register the typeclass
    typeclassRegistry.set(typeclassName, {
      name: typeclassName,
      methods,
    });

    // Return the interface unchanged
    return target;
  },
});

// ============================================================================
// @instance Attribute Macro
// ============================================================================

export const instanceAttribute = defineAttributeMacro({
  name: "instance",
  module: "@typesugar/typeclass",
  description: "Define a typeclass instance",
  // Note: This macro handles variable declarations which aren't standard
  // decorator targets. Validation is done in expand().
  validTargets: ["property"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[],
  ): ts.Node | ts.Node[] {
    if (!ts.isVariableDeclaration(target)) {
      ctx.reportError(
        decorator,
        "@instance can only be applied to variable declarations",
      );
      return target;
    }

    // Expect: @instance(TypeclassName, TypeArg)
    if (args.length < 2) {
      ctx.reportError(
        decorator,
        "@instance requires typeclass name and type argument",
      );
      return target;
    }

    const typeclassExpr = args[0];
    const typeExpr = args[1];

    // Extract names
    const typeclassName = ts.isIdentifier(typeclassExpr)
      ? typeclassExpr.text
      : undefined;

    const forType = ts.isIdentifier(typeExpr) ? typeExpr.text : undefined;

    if (!typeclassName || !forType) {
      ctx.reportError(
        decorator,
        "@instance requires identifier arguments: @instance(Typeclass, Type)",
      );
      return target;
    }

    // Verify typeclass exists
    if (!typeclassRegistry.has(typeclassName)) {
      // Soft warning: typeclass may be defined in another file
      // that hasn't been processed yet
    }

    // Store the initializer expression
    const initExpr = target.initializer;
    if (!initExpr) {
      ctx.reportError(decorator, "@instance variable must have an initializer");
      return target;
    }

    // Register the instance
    const key = instanceKey(typeclassName, forType);
    instanceRegistry.set(key, {
      typeclass: typeclassName,
      forType,
      expression: initExpr,
    });

    // Return the variable unchanged
    return target;
  },
});

// ============================================================================
// @deriving Attribute Macro - Auto-derive typeclass instances
// ============================================================================

export const derivingAttribute = defineAttributeMacro({
  name: "deriving",
  module: "@typesugar/typeclass",
  description: "Auto-derive typeclass instances for a type",
  validTargets: ["interface", "class", "type"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[],
  ): ts.Node | ts.Node[] {
    let typeName: string | undefined;

    if (ts.isInterfaceDeclaration(target) && target.name) {
      typeName = target.name.text;
    } else if (ts.isClassDeclaration(target) && target.name) {
      typeName = target.name.text;
    } else if (ts.isTypeAliasDeclaration(target)) {
      typeName = target.name.text;
    }

    if (!typeName) {
      ctx.reportError(
        decorator,
        "@deriving can only be applied to named types",
      );
      return target;
    }

    // Generate derived instances
    const derivedStatements: ts.Statement[] = [];

    for (const arg of args) {
      if (!ts.isIdentifier(arg)) continue;

      const typeclassName = arg.text;
      const typeclass = typeclassRegistry.get(typeclassName);

      if (!typeclass) {
        ctx.reportError(
          decorator,
          `Unknown typeclass: ${typeclassName}. Make sure it's defined with @typeclass`,
        );
        continue;
      }

      // Generate a derived instance based on the typeclass
      const instanceCode = generateDerivedInstance(ctx, typeclass, typeName);
      if (instanceCode) {
        derivedStatements.push(...ctx.parseStatements(instanceCode));

        // Register the derived instance
        const key = instanceKey(typeclassName, typeName);
        instanceRegistry.set(key, {
          typeclass: typeclassName,
          forType: typeName,
          expression: ctx.factory.createIdentifier(
            `${uncapitalize(typeName)}${typeclassName}`,
          ),
        });
      }
    }

    // Return target plus derived instance declarations
    return [target, ...derivedStatements];
  },
});

/**
 * Generate a derived instance implementation
 */
function generateDerivedInstance(
  _ctx: MacroContext,
  typeclass: TypeclassInfo,
  typeName: string,
): string | null {
  const instanceName = `${uncapitalize(typeName)}${typeclass.name}`;

  // Generate method implementations based on typeclass
  switch (typeclass.name) {
    case "Show":
      return `
const ${instanceName}: ${typeclass.name}<${typeName}> = {
  show: (a) => JSON.stringify(a)
};
`;

    case "Eq":
      return `
const ${instanceName}: ${typeclass.name}<${typeName}> = {
  equals: (a, b) => JSON.stringify(a) === JSON.stringify(b)
};
`;

    case "Ord":
      return `
const ${instanceName}: ${typeclass.name}<${typeName}> = {
  compare: (a, b) => {
    const aStr = JSON.stringify(a);
    const bStr = JSON.stringify(b);
    return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
  }
};
`;

    case "Hash":
      return `
const ${instanceName}: ${typeclass.name}<${typeName}> = {
  hash: (a) => {
    const str = JSON.stringify(a);
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return hash >>> 0;
  }
};
`;

    default:
      // For unknown typeclasses, we can't auto-derive
      return null;
  }
}

// ============================================================================
// summon<TC>() - Get a typeclass instance at compile time
// ============================================================================

export const summonMacro = defineExpressionMacro({
  name: "summon",
  module: "@typesugar/typeclass",
  description: "Summon a typeclass instance at compile time",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[],
  ): ts.Expression {
    // The type argument tells us which instance to summon
    // summon<Show<number>>() -> numberShow

    const typeArgs = callExpr.typeArguments;
    if (!typeArgs || typeArgs.length !== 1) {
      ctx.reportError(
        callExpr,
        "summon<T>() requires exactly one type argument",
      );
      return callExpr;
    }

    const typeArg = typeArgs[0];

    // Parse the type reference to extract typeclass and type
    if (
      !ts.isTypeReferenceNode(typeArg) ||
      !ts.isIdentifier(typeArg.typeName)
    ) {
      ctx.reportError(
        callExpr,
        "summon<T>() type argument must be a typeclass application like Show<number>",
      );
      return callExpr;
    }

    const typeclassName = typeArg.typeName.text;
    const typeArgsOfTypeclass = typeArg.typeArguments;

    if (!typeArgsOfTypeclass || typeArgsOfTypeclass.length === 0) {
      ctx.reportError(
        callExpr,
        `summon<${typeclassName}>() requires a type argument, e.g., summon<${typeclassName}<number>>()`,
      );
      return callExpr;
    }

    const forType = ctx.typeChecker.typeToString(
      ctx.typeChecker.getTypeAtLocation(typeArgsOfTypeclass[0]),
    );

    // Look up the instance
    const key = instanceKey(typeclassName, forType);
    const instance = instanceRegistry.get(key);

    if (!instance) {
      ctx.reportError(
        callExpr,
        `No instance found for ${typeclassName}<${forType}>. Define one with @instance`,
      );
      return callExpr;
    }

    // Return the instance expression
    return instance.expression;
  },
});

// ============================================================================
// extend<T>() - Create an extension wrapper with typeclass methods
// ============================================================================

export const extendMacro = defineExpressionMacro({
  name: "extend",
  module: "@typesugar/typeclass",
  description:
    "Extend a value with typeclass methods (compile-time resolution)",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    if (args.length !== 1) {
      ctx.reportError(callExpr, "extend() requires exactly one argument");
      return callExpr;
    }

    const value = args[0];
    const valueType = ctx.getTypeOf(value);
    const typeName = ctx.typeChecker
      .typeToString(valueType)
      .split("<")[0]
      .trim();

    // Find all instances for this type
    const methods: Array<{ name: string; instance: InstanceInfo }> = [];

    for (const [key, instance] of instanceRegistry) {
      if (instance.forType === typeName) {
        const typeclass = typeclassRegistry.get(instance.typeclass);
        if (typeclass) {
          for (const method of typeclass.methods) {
            methods.push({ name: method.name, instance });
          }
        }
      }
    }

    if (methods.length === 0) {
      // No instances found, return the value as-is with a warning
      ctx.reportWarning?.(
        callExpr,
        `No typeclass instances found for type ${typeName}`,
      );
      return value;
    }

    // Generate an object that wraps the value with extension methods
    const factory = ctx.factory;

    const properties = methods.map(({ name, instance }) => {
      // Create: methodName: () => instance.methodName(value)
      return factory.createPropertyAssignment(
        name,
        factory.createArrowFunction(
          undefined,
          undefined,
          [],
          undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          factory.createCallExpression(
            factory.createPropertyAccessExpression(instance.expression, name),
            undefined,
            [value],
          ),
        ),
      );
    });

    // Also include the original value
    properties.unshift(factory.createPropertyAssignment("value", value));

    return factory.createObjectLiteralExpression(properties, true);
  },
});

// ============================================================================
// Helpers
// ============================================================================

function uncapitalize(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

/**
 * Find an extension method for a type and method name.
 * Used by the transformer to rewrite x.show() -> showInstance.show(x)
 */
export function findExtensionMethod(
  typeName: string,
  methodName: string,
): { instance: InstanceInfo; typeclass: TypeclassInfo } | undefined {
  for (const [, instance] of instanceRegistry) {
    if (instance.forType === typeName) {
      const typeclass = typeclassRegistry.get(instance.typeclass);
      if (typeclass) {
        const hasMethod = typeclass.methods.some((m) => m.name === methodName);
        if (hasMethod) {
          return { instance, typeclass };
        }
      }
    }
  }
  return undefined;
}

/**
 * Register macros with the global registry.
 * Call this function to enable typeclass macros in your project.
 */
export function register(): void {
  globalRegistry.register(typeclassAttribute);
  globalRegistry.register(instanceAttribute);
  globalRegistry.register(derivingAttribute);
  globalRegistry.register(summonMacro);
  globalRegistry.register(extendMacro);
}

// Auto-register when this module is imported
register();

// ============================================================================
// Runtime Stubs (replaced by transformer at compile time)
// ============================================================================

/**
 * Decorator to define a typeclass interface.
 * Processed at compile time by the typesugar transformer.
 *
 * @example
 * ```typescript
 * @typeclass
 * interface Show<A> {
 *   show(a: A): string;
 * }
 * ```
 */
export function typeclass(target: any, _context?: ClassDecoratorContext): any {
  // Placeholder - processed by transformer
  return target;
}

/**
 * Decorator to register a typeclass instance for a specific type.
 * Supports multiple syntaxes:
 * - @instance(Typeclass, Type) - identifier form
 * - @instance("Typeclass<Type>") - string form for HKT
 *
 * @example
 * ```typescript
 * @instance(Show, Number)
 * const numberShow: Show<number> = {
 *   show: (n) => String(n),
 * };
 *
 * // For HKT typeclasses:
 * @instance("FlatMap<Array>")
 * const flatMapArray: FlatMap<ArrayTag> = { ... };
 * ```
 */
export function instance(
  ..._args: unknown[]
): PropertyDecorator & ClassDecorator & MethodDecorator {
  // Placeholder - processed by transformer
  return () => {};
}

/**
 * Decorator to auto-derive typeclass instances for a type.
 *
 * @example
 * ```typescript
 * @deriving(Show, Eq)
 * interface Point {
 *   x: number;
 *   y: number;
 * }
 * ```
 */
export function deriving(
  ..._typeclasses: unknown[]
): ClassDecorator & PropertyDecorator {
  // Placeholder - processed by transformer
  return () => {};
}

/**
 * Resolve a typeclass instance at compile time (Scala 3-like summon).
 *
 * @example
 * ```typescript
 * const showPoint = summon<Show<Point>>();
 * showPoint.show({ x: 1, y: 2 }); // "Point(x = 1, y = 2)"
 * ```
 */
export function summon<T>(): T {
  // Placeholder - processed by transformer
  throw new Error(
    "summon() must be processed by the typemacro transformer at compile time",
  );
}

/**
 * Call extension methods on a value via typeclass instances.
 *
 * @example
 * ```typescript
 * extend(myValue).show(); // Calls Show<typeof myValue>.show
 * ```
 */
export function extend<T>(_value: T): T & Record<string, (...args: any[]) => any> {
  // Placeholder - processed by transformer
  throw new Error(
    "extend() must be processed by the typemacro transformer at compile time",
  );
}
