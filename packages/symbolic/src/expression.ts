/**
 * Expression AST for Symbolic Mathematics
 *
 * A type-safe symbolic expression system where Expression<T> tracks
 * the result type T at compile time.
 *
 * @example
 * ```typescript
 * const x = var_("x");           // Expression<number>
 * const expr = mul(x, x);        // Expression<number>
 * const result = evaluate(expr, { x: 5 }); // 25
 * ```
 */

import type {
  BinaryOpSymbol,
  UnaryOpSymbol,
  FunctionName,
  Mul,
  Div,
  Add,
  Sub,
  Pow,
  Sqrt,
} from "./types.js";

// ============================================================================
// AST Node Types
// ============================================================================

/**
 * A numeric constant in the expression tree.
 */
export interface Constant<T = number> {
  readonly kind: "constant";
  readonly value: number;
  readonly name?: string;
  readonly _type?: T;
}

/**
 * A symbolic variable.
 */
export interface Variable<T = number> {
  readonly kind: "variable";
  readonly name: string;
  readonly _type?: T;
}

/**
 * A binary operation node.
 */
export interface BinaryOp<A = number, B = number, R = number> {
  readonly kind: "binary";
  readonly op: BinaryOpSymbol;
  readonly left: Expression<A>;
  readonly right: Expression<B>;
  readonly _type?: R;
}

/**
 * A unary operation node.
 */
export interface UnaryOp<A = number, R = number> {
  readonly kind: "unary";
  readonly op: UnaryOpSymbol;
  readonly arg: Expression<A>;
  readonly _type?: R;
}

/**
 * A function call node.
 */
export interface FunctionCall<A = number, R = number> {
  readonly kind: "function";
  readonly fn: FunctionName;
  readonly arg: Expression<A>;
  readonly _type?: R;
}

/**
 * A derivative expression (symbolic, not yet computed).
 */
export interface Derivative<T = number> {
  readonly kind: "derivative";
  readonly expr: Expression<T>;
  readonly variable: string;
  readonly order: number;
  readonly _type?: T;
}

/**
 * An integral expression (symbolic, not yet computed).
 */
export interface Integral<T = number> {
  readonly kind: "integral";
  readonly expr: Expression<T>;
  readonly variable: string;
  readonly _type?: T;
}

/**
 * A limit expression.
 */
export interface Limit<T = number> {
  readonly kind: "limit";
  readonly expr: Expression<T>;
  readonly variable: string;
  readonly approaching: number;
  readonly direction?: "left" | "right" | "both";
  readonly _type?: T;
}

/**
 * An equation (left = right).
 */
export interface Equation<T = number> {
  readonly kind: "equation";
  readonly left: Expression<T>;
  readonly right: Expression<T>;
  readonly _type?: T;
}

/**
 * A sum expression (Σ).
 */
export interface Sum<T = number> {
  readonly kind: "sum";
  readonly expr: Expression<T>;
  readonly variable: string;
  readonly from: Expression<number>;
  readonly to: Expression<number>;
  readonly _type?: T;
}

/**
 * A product expression (Π).
 */
export interface Product<T = number> {
  readonly kind: "product";
  readonly expr: Expression<T>;
  readonly variable: string;
  readonly from: Expression<number>;
  readonly to: Expression<number>;
  readonly _type?: T;
}

// ============================================================================
// Expression Union Type
// ============================================================================

/**
 * A symbolic mathematical expression with compile-time type tracking.
 *
 * The type parameter T represents the result type when the expression
 * is evaluated. For plain numbers, T is `number`. When used with
 * @typesugar/units, T can track physical dimensions.
 */
export type Expression<T = number> =
  | Constant<T>
  | Variable<T>
  | BinaryOp<unknown, unknown, T>
  | UnaryOp<unknown, T>
  | FunctionCall<unknown, T>
  | Derivative<T>
  | Integral<T>
  | Limit<T>
  | Equation<T>
  | Sum<T>
  | Product<T>;

// ============================================================================
// Type Guards
// ============================================================================

export function isConstant<T>(expr: Expression<T>): expr is Constant<T> {
  return expr.kind === "constant";
}

export function isVariable<T>(expr: Expression<T>): expr is Variable<T> {
  return expr.kind === "variable";
}

export function isBinaryOp<T>(expr: Expression<T>): expr is BinaryOp<unknown, unknown, T> {
  return expr.kind === "binary";
}

export function isUnaryOp<T>(expr: Expression<T>): expr is UnaryOp<unknown, T> {
  return expr.kind === "unary";
}

export function isFunctionCall<T>(expr: Expression<T>): expr is FunctionCall<unknown, T> {
  return expr.kind === "function";
}

export function isDerivative<T>(expr: Expression<T>): expr is Derivative<T> {
  return expr.kind === "derivative";
}

export function isIntegral<T>(expr: Expression<T>): expr is Integral<T> {
  return expr.kind === "integral";
}

export function isLimit<T>(expr: Expression<T>): expr is Limit<T> {
  return expr.kind === "limit";
}

export function isEquation<T>(expr: Expression<T>): expr is Equation<T> {
  return expr.kind === "equation";
}

export function isSum<T>(expr: Expression<T>): expr is Sum<T> {
  return expr.kind === "sum";
}

export function isProduct<T>(expr: Expression<T>): expr is Product<T> {
  return expr.kind === "product";
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if an expression is a constant with a specific value.
 */
export function isConstantValue<T>(expr: Expression<T>, value: number): boolean {
  return isConstant(expr) && expr.value === value;
}

/**
 * Check if an expression is zero.
 */
export function isZero<T>(expr: Expression<T>): boolean {
  return isConstantValue(expr, 0);
}

/**
 * Check if an expression is one.
 */
export function isOne<T>(expr: Expression<T>): boolean {
  return isConstantValue(expr, 1);
}

/**
 * Check if an expression is negative one.
 */
export function isNegativeOne<T>(expr: Expression<T>): boolean {
  return isConstantValue(expr, -1);
}

/**
 * Check if an expression is a constant with an integer value.
 */
export function isIntegerConstant<T>(expr: Expression<T>): boolean {
  return isConstant(expr) && Number.isInteger(expr.value);
}

// ============================================================================
// Shared Variable Traversal
// ============================================================================

/**
 * Options for variable traversal.
 */
interface TraverseVariablesOptions {
  /** If true, include bound variables (e.g., sum/product index variables). Default: false */
  includeBound?: boolean;
}

/**
 * Shared traversal helper for collecting variables from an expression.
 * Handles bound variable tracking with reference counting when excludeBound is true.
 *
 * @param expr - The expression to traverse
 * @param options - Configuration for what variables to include
 * @returns Set of variable names found
 */
function traverseVariables<T>(
  expr: Expression<T>,
  options: TraverseVariablesOptions = {}
): Set<string> {
  const vars = new Set<string>();
  const { includeBound = false } = options;
  const bound = includeBound ? null : new Map<string, number>();

  function isBound(name: string): boolean {
    return bound !== null && bound.has(name) && bound.get(name)! > 0;
  }

  function enterScope(variable: string): void {
    if (bound) {
      bound.set(variable, (bound.get(variable) ?? 0) + 1);
    }
  }

  function exitScope(variable: string): void {
    if (bound) {
      const count = bound.get(variable)! - 1;
      if (count === 0) {
        bound.delete(variable);
      } else {
        bound.set(variable, count);
      }
    }
  }

  function collect(e: Expression<unknown>): void {
    switch (e.kind) {
      case "constant":
        break;
      case "variable":
        if (!isBound(e.name)) {
          vars.add(e.name);
        }
        break;
      case "binary":
        collect(e.left);
        collect(e.right);
        break;
      case "unary":
      case "function":
        collect(e.arg);
        break;
      case "derivative":
      case "integral":
        if (includeBound) {
          vars.add(e.variable);
        }
        collect(e.expr);
        break;
      case "limit":
        if (includeBound) {
          vars.add(e.variable);
        }
        enterScope(e.variable);
        collect(e.expr);
        exitScope(e.variable);
        break;
      case "equation":
        collect(e.left);
        collect(e.right);
        break;
      case "sum":
      case "product":
        if (includeBound) {
          vars.add(e.variable);
        }
        collect(e.from);
        collect(e.to);
        enterScope(e.variable);
        collect(e.expr);
        exitScope(e.variable);
        break;
    }
  }

  collect(expr);
  return vars;
}

/**
 * Get all free variable names in an expression.
 * Bound variables (e.g., index variable in sum/product) are excluded.
 *
 * Uses reference counting for bound variables to correctly handle
 * nested scopes that bind the same variable name.
 */
export function getVariables<T>(expr: Expression<T>): Set<string> {
  return traverseVariables(expr);
}

/**
 * Get ALL variable names including bound index variables.
 * Use getVariables() for free variables only (the common case).
 */
export function getAllVariables<T>(expr: Expression<T>): Set<string> {
  return traverseVariables(expr, { includeBound: true });
}

/**
 * Check if an expression contains a specific free variable.
 * Short-circuits on first match for O(1) best case.
 */
export function hasVariable<T>(expr: Expression<T>, varName: string): boolean {
  const bound = new Map<string, number>();

  function search(e: Expression<unknown>): boolean {
    switch (e.kind) {
      case "constant":
        return false;
      case "variable":
        if (e.name === varName && (!bound.has(e.name) || bound.get(e.name) === 0)) {
          return true;
        }
        return false;
      case "binary":
        return search(e.left) || search(e.right);
      case "unary":
      case "function":
        return search(e.arg);
      case "derivative":
      case "integral":
        return search(e.expr);
      case "limit":
        return search(e.expr);
      case "equation":
        return search(e.left) || search(e.right);
      case "sum":
      case "product": {
        // from/to are evaluated in the outer scope (before variable is bound)
        if (search(e.from) || search(e.to)) return true;
        // Variable is bound in the body
        bound.set(e.variable, (bound.get(e.variable) ?? 0) + 1);
        const found = search(e.expr);
        const count = bound.get(e.variable)! - 1;
        if (count === 0) {
          bound.delete(e.variable);
        } else {
          bound.set(e.variable, count);
        }
        return found;
      }
    }
  }

  return search(expr);
}

/**
 * Check if an expression is purely constant (contains no free variables).
 * Short-circuits on first variable found for O(1) best case.
 */
export function isPureConstant<T>(expr: Expression<T>): boolean {
  const bound = new Map<string, number>();

  function hasAnyVariable(e: Expression<unknown>): boolean {
    switch (e.kind) {
      case "constant":
        return false;
      case "variable":
        return !bound.has(e.name) || bound.get(e.name) === 0;
      case "binary":
        return hasAnyVariable(e.left) || hasAnyVariable(e.right);
      case "unary":
      case "function":
        return hasAnyVariable(e.arg);
      case "derivative":
      case "integral":
        return hasAnyVariable(e.expr);
      case "limit":
        return hasAnyVariable(e.expr);
      case "equation":
        return hasAnyVariable(e.left) || hasAnyVariable(e.right);
      case "sum":
      case "product": {
        // from/to are evaluated in the outer scope (before variable is bound)
        if (hasAnyVariable(e.from) || hasAnyVariable(e.to)) return true;
        // Variable is bound in the body
        bound.set(e.variable, (bound.get(e.variable) ?? 0) + 1);
        const found = hasAnyVariable(e.expr);
        const count = bound.get(e.variable)! - 1;
        if (count === 0) {
          bound.delete(e.variable);
        } else {
          bound.set(e.variable, count);
        }
        return found;
      }
    }
  }

  return !hasAnyVariable(expr);
}

/**
 * Count the depth of the expression tree.
 */
export function depth<T>(expr: Expression<T>): number {
  switch (expr.kind) {
    case "constant":
    case "variable":
      return 1;
    case "binary":
      return 1 + Math.max(depth(expr.left), depth(expr.right));
    case "unary":
    case "function":
      return 1 + depth(expr.arg);
    case "derivative":
    case "integral":
      return 1 + depth(expr.expr);
    case "limit":
      return 1 + depth(expr.expr);
    case "equation":
      return 1 + Math.max(depth(expr.left), depth(expr.right));
    case "sum":
    case "product":
      return 1 + Math.max(depth(expr.expr), depth(expr.from), depth(expr.to));
  }
}

/**
 * Count the number of nodes in the expression tree.
 */
export function nodeCount<T>(expr: Expression<T>): number {
  switch (expr.kind) {
    case "constant":
    case "variable":
      return 1;
    case "binary":
      return 1 + nodeCount(expr.left) + nodeCount(expr.right);
    case "unary":
    case "function":
      return 1 + nodeCount(expr.arg);
    case "derivative":
    case "integral":
      return 1 + nodeCount(expr.expr);
    case "limit":
      return 1 + nodeCount(expr.expr);
    case "equation":
      return 1 + nodeCount(expr.left) + nodeCount(expr.right);
    case "sum":
    case "product":
      return 1 + nodeCount(expr.expr) + nodeCount(expr.from) + nodeCount(expr.to);
  }
}
