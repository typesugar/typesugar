/**
 * Type-Level Arithmetic Macros
 *
 * TypeScript's type system can do some arithmetic via recursive conditional
 * types and tuple manipulation, but it's fragile, slow, and hits recursion
 * limits quickly. These macros compute arithmetic at compile time using the
 * TypeMacro infrastructure, emitting literal number types directly.
 *
 * ## What this enables
 *
 * - Fixed-size vectors/matrices with compile-time dimension checking
 * - Type-safe array indexing with bounds checking
 * - Compile-time range types
 * - Type-level assertions on numeric constraints
 *
 * @example
 * ```typescript
 * // Type-level arithmetic (computed at compile time by the macro):
 * type Three = Add<1, 2>;        // 3
 * type Six = Mul<2, 3>;          // 6
 * type Two = Div<6, 3>;          // 2
 * type One = Mod<7, 3>;          // 1
 * type Eight = Pow<2, 3>;        // 8
 *
 * // Type-safe fixed-size vectors:
 * type Vec<N extends number> = { length: N; data: number[] };
 *
 * function concat<A extends number, B extends number>(
 *   a: Vec<A>,
 *   b: Vec<B>,
 * ): Vec<Add<A, B>> { ... }
 *
 * const v3: Vec<3> = { length: 3, data: [1, 2, 3] };
 * const v2: Vec<2> = { length: 2, data: [4, 5] };
 * const v5: Vec<Add<3, 2>> = concat(v3, v2); // Vec<5>
 *
 * // Type-level comparisons:
 * type Yes = Lt<3, 5>;           // true
 * type No = Gte<2, 7>;           // false
 *
 * // Range types:
 * type Byte = Range<0, 255>;     // 0 | 1 | 2 | ... | 255
 * ```
 */

import * as ts from "typescript";
import { defineTypeMacro, globalRegistry, MacroContext } from "@typesugar/core";

// ============================================================================
// Helper: Extract numeric literal from a TypeNode
// ============================================================================

function extractNumericLiteral(ctx: MacroContext, typeNode: ts.TypeNode): number | undefined {
  // Direct literal type: 42
  if (ts.isLiteralTypeNode(typeNode)) {
    if (ts.isNumericLiteral(typeNode.literal)) {
      return parseFloat(typeNode.literal.text);
    }
    // Handle negative literals: -42
    if (
      ts.isPrefixUnaryExpression(typeNode.literal) &&
      typeNode.literal.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(typeNode.literal.operand)
    ) {
      return -parseFloat(typeNode.literal.operand.text);
    }
  }

  // Try to resolve via the type checker (for type aliases that resolve to literals)
  const type = ctx.typeChecker.getTypeFromTypeNode(typeNode);
  if (type.isNumberLiteral()) {
    return type.value;
  }

  return undefined;
}

/**
 * Create a literal number type node from a numeric value.
 */
function createNumericLiteralType(factory: ts.NodeFactory, value: number): ts.TypeNode {
  if (value < 0) {
    return factory.createLiteralTypeNode(
      factory.createPrefixUnaryExpression(
        ts.SyntaxKind.MinusToken,
        factory.createNumericLiteral(Math.abs(value))
      )
    );
  }
  return factory.createLiteralTypeNode(factory.createNumericLiteral(value));
}

/**
 * Create a boolean literal type node.
 */
function createBooleanLiteralType(factory: ts.NodeFactory, value: boolean): ts.TypeNode {
  return value
    ? factory.createLiteralTypeNode(factory.createTrue())
    : factory.createLiteralTypeNode(factory.createFalse());
}

// ============================================================================
// Arithmetic Type Macros
// ============================================================================

/** Add<A, B> — compile-time addition */
export const addTypeMacro = defineTypeMacro({
  name: "Add",
  description: "Type-level addition: Add<3, 4> = 7",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Add<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createNumericLiteralType(ctx.factory, a + b);
    }

    // Can't resolve at compile time — return the original
    return _typeRef;
  },
});

/** Sub<A, B> — compile-time subtraction */
export const subTypeMacro = defineTypeMacro({
  name: "Sub",
  description: "Type-level subtraction: Sub<7, 3> = 4",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Sub<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createNumericLiteralType(ctx.factory, a - b);
    }

    return _typeRef;
  },
});

/** Mul<A, B> — compile-time multiplication */
export const mulTypeMacro = defineTypeMacro({
  name: "Mul",
  description: "Type-level multiplication: Mul<3, 4> = 12",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Mul<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createNumericLiteralType(ctx.factory, a * b);
    }

    return _typeRef;
  },
});

/** Div<A, B> — compile-time integer division */
export const divTypeMacro = defineTypeMacro({
  name: "Div",
  description: "Type-level integer division: Div<7, 2> = 3",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Div<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      if (b === 0) {
        ctx.reportError(_typeRef, "Division by zero in Div<A, B>");
        return _typeRef;
      }
      return createNumericLiteralType(ctx.factory, Math.trunc(a / b));
    }

    return _typeRef;
  },
});

/** Mod<A, B> — compile-time modulo */
export const modTypeMacro = defineTypeMacro({
  name: "Mod",
  description: "Type-level modulo: Mod<7, 3> = 1",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Mod<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      if (b === 0) {
        ctx.reportError(_typeRef, "Division by zero in Mod<A, B>");
        return _typeRef;
      }
      return createNumericLiteralType(ctx.factory, a % b);
    }

    return _typeRef;
  },
});

/** Pow<Base, Exp> — compile-time exponentiation */
export const powTypeMacro = defineTypeMacro({
  name: "Pow",
  description: "Type-level exponentiation: Pow<2, 10> = 1024",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Pow<Base, Exp> requires exactly 2 type arguments");
      return _typeRef;
    }

    const base = extractNumericLiteral(ctx, args[0]);
    const exp = extractNumericLiteral(ctx, args[1]);

    if (base !== undefined && exp !== undefined) {
      return createNumericLiteralType(ctx.factory, Math.pow(base, exp));
    }

    return _typeRef;
  },
});

/** Negate<A> — compile-time negation */
export const negateTypeMacro = defineTypeMacro({
  name: "Negate",
  description: "Type-level negation: Negate<5> = -5",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 1) {
      ctx.reportError(_typeRef, "Negate<A> requires exactly 1 type argument");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    if (a !== undefined) {
      return createNumericLiteralType(ctx.factory, -a);
    }

    return _typeRef;
  },
});

/** Abs<A> — compile-time absolute value */
export const absTypeMacro = defineTypeMacro({
  name: "Abs",
  description: "Type-level absolute value: Abs<-5> = 5",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 1) {
      ctx.reportError(_typeRef, "Abs<A> requires exactly 1 type argument");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    if (a !== undefined) {
      return createNumericLiteralType(ctx.factory, Math.abs(a));
    }

    return _typeRef;
  },
});

/** Max<A, B> — compile-time maximum */
export const maxTypeMacro = defineTypeMacro({
  name: "Max",
  description: "Type-level maximum: Max<3, 7> = 7",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Max<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createNumericLiteralType(ctx.factory, Math.max(a, b));
    }

    return _typeRef;
  },
});

/** Min<A, B> — compile-time minimum */
export const minTypeMacro = defineTypeMacro({
  name: "Min",
  description: "Type-level minimum: Min<3, 7> = 3",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Min<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createNumericLiteralType(ctx.factory, Math.min(a, b));
    }

    return _typeRef;
  },
});

// ============================================================================
// Comparison Type Macros
// ============================================================================

/** Lt<A, B> — compile-time less-than */
export const ltTypeMacro = defineTypeMacro({
  name: "Lt",
  description: "Type-level less-than: Lt<3, 5> = true",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Lt<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createBooleanLiteralType(ctx.factory, a < b);
    }

    return _typeRef;
  },
});

/** Lte<A, B> — compile-time less-than-or-equal */
export const lteTypeMacro = defineTypeMacro({
  name: "Lte",
  description: "Type-level less-than-or-equal: Lte<3, 3> = true",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Lte<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createBooleanLiteralType(ctx.factory, a <= b);
    }

    return _typeRef;
  },
});

/** Gt<A, B> — compile-time greater-than */
export const gtTypeMacro = defineTypeMacro({
  name: "Gt",
  description: "Type-level greater-than: Gt<5, 3> = true",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Gt<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createBooleanLiteralType(ctx.factory, a > b);
    }

    return _typeRef;
  },
});

/** Gte<A, B> — compile-time greater-than-or-equal */
export const gteTypeMacro = defineTypeMacro({
  name: "Gte",
  description: "Type-level greater-than-or-equal: Gte<5, 5> = true",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Gte<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createBooleanLiteralType(ctx.factory, a >= b);
    }

    return _typeRef;
  },
});

/** Eq<A, B> — compile-time numeric equality */
export const eqTypeMacro = defineTypeMacro({
  name: "NumEq",
  description: "Type-level numeric equality: NumEq<3, 3> = true",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "NumEq<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createBooleanLiteralType(ctx.factory, a === b);
    }

    return _typeRef;
  },
});

// ============================================================================
// Utility Type Macros
// ============================================================================

/** Increment<A> — A + 1 */
export const incTypeMacro = defineTypeMacro({
  name: "Increment",
  description: "Type-level increment: Increment<4> = 5",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 1) {
      ctx.reportError(_typeRef, "Increment<A> requires exactly 1 type argument");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    if (a !== undefined) {
      return createNumericLiteralType(ctx.factory, a + 1);
    }

    return _typeRef;
  },
});

/** Decrement<A> — A - 1 */
export const decTypeMacro = defineTypeMacro({
  name: "Decrement",
  description: "Type-level decrement: Decrement<5> = 4",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 1) {
      ctx.reportError(_typeRef, "Decrement<A> requires exactly 1 type argument");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    if (a !== undefined) {
      return createNumericLiteralType(ctx.factory, a - 1);
    }

    return _typeRef;
  },
});

/** IsEven<A> — check if a number is even */
export const isEvenTypeMacro = defineTypeMacro({
  name: "IsEven",
  description: "Type-level even check: IsEven<4> = true",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 1) {
      ctx.reportError(_typeRef, "IsEven<A> requires exactly 1 type argument");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    if (a !== undefined) {
      return createBooleanLiteralType(ctx.factory, a % 2 === 0);
    }

    return _typeRef;
  },
});

/** IsOdd<A> — check if a number is odd */
export const isOddTypeMacro = defineTypeMacro({
  name: "IsOdd",
  description: "Type-level odd check: IsOdd<3> = true",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 1) {
      ctx.reportError(_typeRef, "IsOdd<A> requires exactly 1 type argument");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    if (a !== undefined) {
      return createBooleanLiteralType(ctx.factory, a % 2 !== 0);
    }

    return _typeRef;
  },
});

// ============================================================================
// Register all type macros
// ============================================================================

const allTypeMacros = [
  addTypeMacro,
  subTypeMacro,
  mulTypeMacro,
  divTypeMacro,
  modTypeMacro,
  powTypeMacro,
  negateTypeMacro,
  absTypeMacro,
  maxTypeMacro,
  minTypeMacro,
  ltTypeMacro,
  lteTypeMacro,
  gtTypeMacro,
  gteTypeMacro,
  eqTypeMacro,
  incTypeMacro,
  decTypeMacro,
  isEvenTypeMacro,
  isOddTypeMacro,
];

for (const macro of allTypeMacros) {
  globalRegistry.register(macro);
}
