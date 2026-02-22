/**
 * Register Standard Library Instances Macro
 *
 * This macro registers all @typesugar/std typeclass instances in the compile-time
 * registry, enabling summon<>() resolution for standard types AND operator
 * dispatch via Op<> annotations.
 *
 * @example
 * ```typescript
 * // In your application entry point:
 * import { registerStdInstances } from "@typesugar/std/macros";
 *
 * registerStdInstances(); // Macro call - processed at compile time
 *
 * // Now you can use summon<>() for std instances:
 * import { summon } from "@typesugar/typeclass";
 * import type { Bounded, Numeric } from "@typesugar/std/typeclasses";
 *
 * const bounded = summon<Bounded<number>>();
 * console.log(bounded.minBound()); // Number.MIN_SAFE_INTEGER
 *
 * const numeric = summon<Numeric<number>>();
 * console.log(numeric.add(1, 2)); // 3
 *
 * // Operator dispatch works automatically:
 * // a === b → eqNumber.equals(a, b)
 * // a < b  → ordNumber.lessThan(a, b)
 * // a + b  → semigroupNumber.combine(a, b) or numericNumber.add(a, b)
 * ```
 *
 * ## Why is this needed?
 *
 * The @instance decorator cannot be used on const declarations in library
 * code because TypeScript's type declaration generator (tsc) doesn't accept
 * decorators on variable declarations. This macro provides an alternative
 * way to register instances at compile time.
 *
 * ## What gets registered?
 *
 * **Typeclasses (with Op<> syntax for operator dispatch):**
 * - Eq (Op<"===">, Op<"!==">) — equality comparison
 * - Ord (Op<"<">, Op<"<=">, Op<">">, Op<">=">) — ordering
 * - Semigroup (Op<"+">) — associative combine
 * - Monoid (extends Semigroup) — with identity
 * - Group (extends Monoid) — with inverse
 * - Numeric (Op<"+">, Op<"-">, Op<"*">) — ring arithmetic
 * - Integral (Op<"/">, Op<"%">) — integer division
 * - Fractional (Op<"/">) — real division
 *
 * **Instances:**
 * - Eq<number>, Eq<string>, Eq<boolean>, Eq<bigint>, Eq<Date>
 * - Ord<number>, Ord<string>, Ord<boolean>, Ord<bigint>, Ord<Date>
 * - Semigroup<number>, Semigroup<string>, Semigroup<bigint>
 * - Monoid<number>, Monoid<string>, Monoid<bigint>
 * - Group<number>, Group<bigint>
 * - Bounded<number>, Bounded<bigint>, Bounded<boolean>, Bounded<string>
 * - Enum<number>, Enum<boolean>, Enum<string>
 * - Numeric<number>, Numeric<bigint>
 * - Integral<number>, Integral<bigint>
 * - Fractional<number>
 * - Floating<number>
 * - FlatMap<Array>, FlatMap<Promise>, FlatMap<Iterable>, FlatMap<AsyncIterable>
 */

import * as ts from "typescript";
import {
  type MacroContext,
  type ExpressionMacro,
  defineExpressionMacro,
  globalRegistry,
} from "@typesugar/core";
import {
  registerTypeclassDef,
  registerInstanceWithMeta,
  type TypeclassInfo,
  type InstanceInfo,
} from "@typesugar/macros";

/**
 * Instance registration info for the macro.
 */
interface InstanceReg {
  typeclass: string;
  forType: string;
  importPath: string;
  exportName: string;
}

// ============================================================================
// Typeclass Definitions with Op<> Syntax
// ============================================================================

/**
 * Typeclass definitions with their Op<> operator mappings.
 * These are registered in the syntax registry for operator dispatch.
 */
const TYPECLASS_DEFS: TypeclassInfo[] = [
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
        isSelfMethod: true,
        operatorSymbol: "===",
      },
      {
        name: "notEquals",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "boolean",
        isSelfMethod: true,
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
        returnType: "Ordering",
        isSelfMethod: true,
      },
      {
        name: "lessThan",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "boolean",
        isSelfMethod: true,
        operatorSymbol: "<",
      },
      {
        name: "lessThanOrEqual",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "boolean",
        isSelfMethod: true,
        operatorSymbol: "<=",
      },
      {
        name: "greaterThan",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "boolean",
        isSelfMethod: true,
        operatorSymbol: ">",
      },
      {
        name: "greaterThanOrEqual",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "boolean",
        isSelfMethod: true,
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
        isSelfMethod: true,
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
        name: "empty",
        params: [],
        returnType: "A",
        isSelfMethod: false,
      },
      {
        name: "combine",
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
    canDeriveSum: false,
    syntax: new Map([["+", "combine"]]),
  },
  {
    name: "Group",
    typeParam: "A",
    methods: [
      {
        name: "empty",
        params: [],
        returnType: "A",
        isSelfMethod: false,
      },
      {
        name: "combine",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "A",
        isSelfMethod: true,
        operatorSymbol: "+",
      },
      {
        name: "invert",
        params: [{ name: "a", typeString: "A" }],
        returnType: "A",
        isSelfMethod: true,
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
        isSelfMethod: true,
        operatorSymbol: "+",
      },
      {
        name: "sub",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "A",
        isSelfMethod: true,
        operatorSymbol: "-",
      },
      {
        name: "mul",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "A",
        isSelfMethod: true,
        operatorSymbol: "*",
      },
    ],
    canDeriveProduct: false,
    canDeriveSum: false,
    syntax: new Map([
      ["+", "add"],
      ["-", "sub"],
      ["*", "mul"],
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
        isSelfMethod: true,
        operatorSymbol: "/",
      },
      {
        name: "mod",
        params: [
          { name: "a", typeString: "A" },
          { name: "b", typeString: "A" },
        ],
        returnType: "A",
        isSelfMethod: true,
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
        isSelfMethod: true,
        operatorSymbol: "/",
      },
    ],
    canDeriveProduct: false,
    canDeriveSum: false,
    syntax: new Map([["/", "div"]]),
  },
];

// ============================================================================
// Instance Definitions
// ============================================================================

/**
 * All standard library instances that should be registered.
 */
const STD_INSTANCES: InstanceReg[] = [
  // Eq instances
  {
    typeclass: "Eq",
    forType: "number",
    importPath: "@typesugar/std/typeclasses",
    exportName: "eqNumber",
  },
  {
    typeclass: "Eq",
    forType: "string",
    importPath: "@typesugar/std/typeclasses",
    exportName: "eqString",
  },
  {
    typeclass: "Eq",
    forType: "boolean",
    importPath: "@typesugar/std/typeclasses",
    exportName: "eqBoolean",
  },
  {
    typeclass: "Eq",
    forType: "bigint",
    importPath: "@typesugar/std/typeclasses",
    exportName: "eqBigInt",
  },
  {
    typeclass: "Eq",
    forType: "Date",
    importPath: "@typesugar/std/typeclasses",
    exportName: "eqDate",
  },

  // Ord instances
  {
    typeclass: "Ord",
    forType: "number",
    importPath: "@typesugar/std/typeclasses",
    exportName: "ordNumber",
  },
  {
    typeclass: "Ord",
    forType: "string",
    importPath: "@typesugar/std/typeclasses",
    exportName: "ordString",
  },
  {
    typeclass: "Ord",
    forType: "boolean",
    importPath: "@typesugar/std/typeclasses",
    exportName: "ordBoolean",
  },
  {
    typeclass: "Ord",
    forType: "bigint",
    importPath: "@typesugar/std/typeclasses",
    exportName: "ordBigInt",
  },
  {
    typeclass: "Ord",
    forType: "Date",
    importPath: "@typesugar/std/typeclasses",
    exportName: "ordDate",
  },

  // Semigroup instances
  {
    typeclass: "Semigroup",
    forType: "number",
    importPath: "@typesugar/std/typeclasses",
    exportName: "semigroupNumber",
  },
  {
    typeclass: "Semigroup",
    forType: "string",
    importPath: "@typesugar/std/typeclasses",
    exportName: "semigroupString",
  },
  {
    typeclass: "Semigroup",
    forType: "bigint",
    importPath: "@typesugar/std/typeclasses",
    exportName: "semigroupBigInt",
  },

  // Monoid instances
  {
    typeclass: "Monoid",
    forType: "number",
    importPath: "@typesugar/std/typeclasses",
    exportName: "monoidNumber",
  },
  {
    typeclass: "Monoid",
    forType: "string",
    importPath: "@typesugar/std/typeclasses",
    exportName: "monoidString",
  },
  {
    typeclass: "Monoid",
    forType: "bigint",
    importPath: "@typesugar/std/typeclasses",
    exportName: "monoidBigInt",
  },

  // Group instances
  {
    typeclass: "Group",
    forType: "number",
    importPath: "@typesugar/std/typeclasses",
    exportName: "groupNumber",
  },
  {
    typeclass: "Group",
    forType: "bigint",
    importPath: "@typesugar/std/typeclasses",
    exportName: "groupBigInt",
  },

  // Bounded instances
  {
    typeclass: "Bounded",
    forType: "number",
    importPath: "@typesugar/std/typeclasses",
    exportName: "boundedNumber",
  },
  {
    typeclass: "Bounded",
    forType: "bigint",
    importPath: "@typesugar/std/typeclasses",
    exportName: "boundedBigInt",
  },
  {
    typeclass: "Bounded",
    forType: "boolean",
    importPath: "@typesugar/std/typeclasses",
    exportName: "boundedBoolean",
  },
  {
    typeclass: "Bounded",
    forType: "string",
    importPath: "@typesugar/std/typeclasses",
    exportName: "boundedString",
  },

  // Enum instances
  {
    typeclass: "Enum",
    forType: "number",
    importPath: "@typesugar/std/typeclasses",
    exportName: "enumNumber",
  },
  {
    typeclass: "Enum",
    forType: "boolean",
    importPath: "@typesugar/std/typeclasses",
    exportName: "enumBoolean",
  },
  {
    typeclass: "Enum",
    forType: "string",
    importPath: "@typesugar/std/typeclasses",
    exportName: "enumString",
  },

  // Numeric instances (Ring with Op<+>, Op<->, Op<*>)
  {
    typeclass: "Numeric",
    forType: "number",
    importPath: "@typesugar/std/typeclasses",
    exportName: "numericNumber",
  },
  {
    typeclass: "Numeric",
    forType: "bigint",
    importPath: "@typesugar/std/typeclasses",
    exportName: "numericBigInt",
  },

  // Integral instances (Euclidean Ring with Op</>, Op<%>)
  {
    typeclass: "Integral",
    forType: "number",
    importPath: "@typesugar/std/typeclasses",
    exportName: "integralNumber",
  },
  {
    typeclass: "Integral",
    forType: "bigint",
    importPath: "@typesugar/std/typeclasses",
    exportName: "integralBigInt",
  },

  // Fractional instances (Field with Op</>)
  {
    typeclass: "Fractional",
    forType: "number",
    importPath: "@typesugar/std/typeclasses",
    exportName: "fractionalNumber",
  },

  // Floating instances (transcendental functions)
  {
    typeclass: "Floating",
    forType: "number",
    importPath: "@typesugar/std/typeclasses",
    exportName: "floatingNumber",
  },

  // FlatMap instances (HKT)
  {
    typeclass: "FlatMap",
    forType: "Array",
    importPath: "@typesugar/std/typeclasses/flatmap",
    exportName: "flatMapArray",
  },
  {
    typeclass: "FlatMap",
    forType: "Promise",
    importPath: "@typesugar/std/typeclasses/flatmap",
    exportName: "flatMapPromise",
  },
  {
    typeclass: "FlatMap",
    forType: "Iterable",
    importPath: "@typesugar/std/typeclasses/flatmap",
    exportName: "flatMapIterable",
  },
  {
    typeclass: "FlatMap",
    forType: "AsyncIterable",
    importPath: "@typesugar/std/typeclasses/flatmap",
    exportName: "flatMapAsyncIterable",
  },

  // Data type instances
  { typeclass: "Eq", forType: "Range", importPath: "@typesugar/std/data", exportName: "eqRange" },
  { typeclass: "Ord", forType: "Range", importPath: "@typesugar/std/data", exportName: "ordRange" },
];

// ============================================================================
// Registration State
// ============================================================================

let _registered = false;

/**
 * Perform the actual registration of typeclasses and instances.
 * This is called at module load time and also can be triggered by the macro.
 */
function performRegistration(): void {
  if (_registered) return;
  _registered = true;

  // Register typeclass definitions with Op<> syntax mappings
  for (const tcDef of TYPECLASS_DEFS) {
    registerTypeclassDef(tcDef);
  }

  // Register all primitive instances
  for (const inst of STD_INSTANCES) {
    const info: InstanceInfo = {
      typeclassName: inst.typeclass,
      forType: inst.forType,
      instanceName: inst.exportName,
      derived: false,
    };
    registerInstanceWithMeta(info);
  }
}

// Auto-register at module load time
performRegistration();

/**
 * Macro definition for registerStdInstances().
 *
 * When this macro is called, it:
 * 1. Ensures typeclass definitions are registered with their Op<> syntax
 * 2. Ensures all primitive instances are registered
 * 3. Returns a void expression (registration happens at module load)
 *
 * Note: Registration actually happens at module load time via performRegistration().
 * The macro call is a no-op but serves as documentation that the user expects
 * the standard instances to be available.
 */
export const registerStdInstancesMacro: ExpressionMacro = defineExpressionMacro({
  name: "registerStdInstances",
  module: "@typesugar/std/macros",
  description:
    "Register all @typesugar/std typeclass instances for summon<>() and operator dispatch",

  expand(
    ctx: MacroContext,
    _callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    const { factory } = ctx;

    // Registration already happened at module load time.
    // Return a void expression.
    return factory.createVoidExpression(factory.createNumericLiteral("0"));
  },
});

/**
 * Runtime stub for registerStdInstances.
 * This function does nothing at runtime - all work is done at compile time.
 */
export function registerStdInstances(): void {
  // Placeholder - processed by transformer at compile time
}

/**
 * Get the list of standard instances for programmatic access.
 * Useful for documentation or custom registration logic.
 */
export function getStdInstanceDefinitions(): readonly InstanceReg[] {
  return STD_INSTANCES;
}

/**
 * Register the macro with the global registry when this module is imported.
 */
export function register(): void {
  globalRegistry.register(registerStdInstancesMacro);
}

// Auto-register
register();

export default registerStdInstancesMacro;
