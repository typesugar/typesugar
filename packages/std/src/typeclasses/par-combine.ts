/**
 * ParCombine Typeclass
 *
 * Defines how to combine multiple independent effects of the same type constructor
 * into a single effect. Used by the `par:/yield:` macro for parallel applicative
 * comprehensions.
 *
 * ## Instances
 *
 * Built-in instances:
 * - Promise — Promise.all + .then()
 * - AsyncIterable — Array.fromAsync + Promise.all + .then()
 * - Array — cartesian product
 * - Iterable — collect to arrays, then cartesian product
 *
 * ## Usage with par:/yield:
 *
 * ```typescript
 * par: {
 *   user   << fetchUser(id)
 *   config << loadConfig()
 * }
 * yield: ({ user, config })
 * // Promise: Promise.all([...]).then(([user, config]) => ({ user, config }))
 * ```
 *
 * @internal
 */

import * as ts from "typescript";
import { createGenericRegistry, type GenericRegistry } from "@typesugar/core";
import type { MacroContext } from "@typesugar/core";
import type { BindStep, MapStep } from "../macros/comprehension-utils.js";
import { createArrowFn, createIIFE } from "../macros/comprehension-utils.js";
import {
  type ParCombine,
  parCombinePromise,
  parCombineAsyncIterable,
  parCombineArray,
  parCombineIterable,
} from "./par-combine-instances.js";

// ============================================================================
// ParCombine Typeclass + runtime instances
// ============================================================================
//
// The `ParCombine` interface and the built-in runtime instances live in the
// `typescript`-free `par-combine-instances.ts` (PEP-050 Case-1). This module
// (which imports `typescript` for the compile-time builders) re-exports them so
// existing importers of `par-combine.ts` keep working.

export {
  type ParCombine,
  parCombinePromise,
  parCombineAsyncIterable,
  parCombineArray,
  parCombineIterable,
} from "./par-combine-instances.js";

// ============================================================================
// Std-local builder map
// ============================================================================
// Maps type-constructor brands to zero-cost AST builders for par:/yield:.
// Instance *resolution* is scope-based (PEP-052, resolveDoNotationInstance);
// this map only supplies the optimized emission strategy for std builtins.

export type ParCombineBuilder = (
  ctx: MacroContext,
  steps: (BindStep | MapStep)[],
  returnExpr: ts.Expression
) => ts.Expression;

type ParCombineEntry = {
  instance: ParCombine<unknown>;
  builder: ParCombineBuilder;
};

const parCombineRegistry: GenericRegistry<string, ParCombineEntry> = createGenericRegistry({
  name: "ParCombineRegistry",
  duplicateStrategy: "replace",
});

function registerBuiltin(
  name: string,
  instance: ParCombine<unknown>,
  builder: ParCombineBuilder
): void {
  parCombineRegistry.set(name, { instance, builder });
}

// Register built-in instances with their zero-cost builders
registerBuiltin("Promise", parCombinePromise as ParCombine<unknown>, buildPromiseAll);
registerBuiltin(
  "AsyncIterable",
  parCombineAsyncIterable as ParCombine<unknown>,
  buildAsyncIterableAll
);
registerBuiltin("Array", parCombineArray as ParCombine<unknown>, buildArrayParCombine);
registerBuiltin("Iterable", parCombineIterable as ParCombine<unknown>, buildIterableParCombine);

/**
 * Get a ParCombine instance by type constructor name.
 *
 * @deprecated Instance resolution is scope-based (PEP-052); prefer an @impl
 * instance in scope. This function is maintained for backward compatibility.
 */
export function getParCombine(name: string): ParCombine<unknown> | undefined {
  return parCombineRegistry.get(name)?.instance;
}

/**
 * Get the std-local zero-cost AST builder for a type-constructor brand, if any.
 * Consumed by the par:/yield: macro to emit optimized code for std builtins
 * (Promise, AsyncIterable, Array, Iterable) and locally registered types.
 */
export function getStdParCombineBuilder(brand: string): ParCombineBuilder | undefined {
  return parCombineRegistry.get(brand)?.builder;
}

/**
 * Get the zero-cost builder for a type constructor, if registered.
 *
 * @deprecated Use {@link getStdParCombineBuilder}.
 */
export function getParCombineBuilder(name: string): ParCombineBuilder | undefined {
  return getStdParCombineBuilder(name);
}

/**
 * Register a ParCombine instance for a type constructor.
 * Provide a builder for zero-cost macro expansion, or omit to use runtime dispatch.
 *
 * @deprecated Declare an @impl ParCombine<F> instance instead — resolution is
 * scope-based (PEP-052). This function is maintained for backward compatibility.
 */
export function registerParCombine<F>(
  name: string,
  instance: ParCombine<F>,
  builder?: ParCombineBuilder
): void {
  const actualBuilder = builder ?? createGenericParCombineBuilder(name);
  parCombineRegistry.set(name, {
    instance: instance as ParCombine<unknown>,
    builder: actualBuilder,
  });
}

// ============================================================================
// Builders (zero-cost code generation)
// ============================================================================

function buildPromiseAll(
  ctx: MacroContext,
  steps: (BindStep | MapStep)[],
  returnExpr: ts.Expression
): ts.Expression {
  const { factory } = ctx;
  const bindSteps = steps.filter((s): s is BindStep => s.kind === "bind");
  const mapSteps = steps.filter((s): s is MapStep => s.kind === "map");

  let yieldExpr = returnExpr;
  for (let i = mapSteps.length - 1; i >= 0; i--) {
    const step = mapSteps[i];
    yieldExpr = createIIFE(factory, step.name, yieldExpr, step.expression);
  }

  if (bindSteps.length === 0) return yieldExpr;

  if (bindSteps.length === 1) {
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(bindSteps[0].effect, factory.createIdentifier("then")),
      undefined,
      [createArrowFn(factory, bindSteps[0].name, yieldExpr)]
    );
  }

  const allCall = factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier("Promise"),
      factory.createIdentifier("all")
    ),
    undefined,
    [factory.createArrayLiteralExpression(bindSteps.map((s) => s.effect))]
  );

  const destructuredParam = factory.createParameterDeclaration(
    undefined,
    undefined,
    factory.createArrayBindingPattern(
      bindSteps.map((s) =>
        factory.createBindingElement(undefined, undefined, factory.createIdentifier(s.name))
      )
    )
  );

  return factory.createCallExpression(
    factory.createPropertyAccessExpression(allCall, factory.createIdentifier("then")),
    undefined,
    [
      factory.createArrowFunction(
        undefined,
        undefined,
        [destructuredParam],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        yieldExpr
      ),
    ]
  );
}

function buildAsyncIterableAll(
  ctx: MacroContext,
  steps: (BindStep | MapStep)[],
  returnExpr: ts.Expression
): ts.Expression {
  const { factory } = ctx;
  const bindSteps = steps.filter((s): s is BindStep => s.kind === "bind");
  const mapSteps = steps.filter((s): s is MapStep => s.kind === "map");

  let yieldExpr = returnExpr;
  for (let i = mapSteps.length - 1; i >= 0; i--) {
    const step = mapSteps[i];
    yieldExpr = createIIFE(factory, step.name, yieldExpr, step.expression);
  }

  if (bindSteps.length === 0) return yieldExpr;

  // Emit inline async collection (works in es2022, no Array.fromAsync dependency)
  const createCollectAsync = (expr: ts.Expression): ts.Expression => {
    const iterParam = factory.createParameterDeclaration(
      undefined,
      undefined,
      factory.createIdentifier("__iter")
    );
    const resultVar = factory.createVariableDeclaration(
      factory.createIdentifier("__r"),
      undefined,
      undefined,
      factory.createArrayLiteralExpression([])
    );
    const forOfStmt = factory.createForOfStatement(
      factory.createToken(ts.SyntaxKind.AwaitKeyword),
      factory.createVariableDeclarationList(
        [
          factory.createVariableDeclaration(
            factory.createIdentifier("__x"),
            undefined,
            undefined,
            undefined
          ),
        ],
        ts.NodeFlags.Const
      ),
      factory.createIdentifier("__iter"),
      factory.createBlock([
        factory.createExpressionStatement(
          factory.createCallExpression(
            factory.createPropertyAccessExpression(
              factory.createIdentifier("__r"),
              factory.createIdentifier("push")
            ),
            undefined,
            [factory.createIdentifier("__x")]
          )
        ),
      ])
    );
    const returnStmt = factory.createReturnStatement(factory.createIdentifier("__r"));
    const block = factory.createBlock(
      [
        factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList([resultVar], ts.NodeFlags.Const)
        ),
        forOfStmt,
        returnStmt,
      ],
      true
    );
    const asyncArrow = factory.createArrowFunction(
      [factory.createToken(ts.SyntaxKind.AsyncKeyword)],
      undefined,
      [iterParam],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      block
    );
    return factory.createCallExpression(
      factory.createParenthesizedExpression(asyncArrow),
      undefined,
      [expr]
    );
  };

  if (bindSteps.length === 1) {
    const collected = createCollectAsync(bindSteps[0].effect);
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(collected, factory.createIdentifier("then")),
      undefined,
      [createArrowFn(factory, bindSteps[0].name, yieldExpr)]
    );
  }

  const allCall = factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier("Promise"),
      factory.createIdentifier("all")
    ),
    undefined,
    [factory.createArrayLiteralExpression(bindSteps.map((s) => createCollectAsync(s.effect)))]
  );

  const destructuredParam = factory.createParameterDeclaration(
    undefined,
    undefined,
    factory.createArrayBindingPattern(
      bindSteps.map((s) =>
        factory.createBindingElement(undefined, undefined, factory.createIdentifier(s.name))
      )
    )
  );

  return factory.createCallExpression(
    factory.createPropertyAccessExpression(allCall, factory.createIdentifier("then")),
    undefined,
    [
      factory.createArrowFunction(
        undefined,
        undefined,
        [destructuredParam],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        yieldExpr
      ),
    ]
  );
}

function buildArrayParCombine(
  ctx: MacroContext,
  steps: (BindStep | MapStep)[],
  returnExpr: ts.Expression
): ts.Expression {
  const { factory } = ctx;
  const bindSteps = steps.filter((s): s is BindStep => s.kind === "bind");
  const mapSteps = steps.filter((s): s is MapStep => s.kind === "map");

  let yieldExpr = returnExpr;
  for (let i = mapSteps.length - 1; i >= 0; i--) {
    const step = mapSteps[i];
    yieldExpr = createIIFE(factory, step.name, yieldExpr, step.expression);
  }

  if (bindSteps.length === 0) return yieldExpr;

  // Cartesian product: reduce with flatMap
  // [[1,2], [3,4]] -> [[1,3],[1,4],[2,3],[2,4]]
  if (bindSteps.length === 1) {
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(bindSteps[0].effect, factory.createIdentifier("map")),
      undefined,
      [createArrowFn(factory, bindSteps[0].name, yieldExpr)]
    );
  }

  // (effects as unknown[][]).reduce((acc, arr) => acc.flatMap(combo => arr.map(item => [...combo, item])), [[]])
  const effectsArray = factory.createArrayLiteralExpression(bindSteps.map((s) => s.effect));
  const spreadComboAndItem = factory.createArrayLiteralExpression([
    factory.createSpreadElement(factory.createIdentifier("combo")),
    factory.createIdentifier("item"),
  ]);
  const reduceCallback = factory.createArrowFunction(
    undefined,
    undefined,
    [
      factory.createParameterDeclaration(undefined, undefined, factory.createIdentifier("acc")),
      factory.createParameterDeclaration(undefined, undefined, factory.createIdentifier("arr")),
    ],
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("acc"),
        factory.createIdentifier("flatMap")
      ),
      undefined,
      [
        factory.createArrowFunction(
          undefined,
          undefined,
          [
            factory.createParameterDeclaration(
              undefined,
              undefined,
              factory.createIdentifier("combo")
            ),
          ],
          undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          factory.createCallExpression(
            factory.createPropertyAccessExpression(
              factory.createIdentifier("arr"),
              factory.createIdentifier("map")
            ),
            undefined,
            [
              factory.createArrowFunction(
                undefined,
                undefined,
                [
                  factory.createParameterDeclaration(
                    undefined,
                    undefined,
                    factory.createIdentifier("item")
                  ),
                ],
                undefined,
                factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                spreadComboAndItem
              ),
            ]
          )
        ),
      ]
    )
  );

  const reduceCall = factory.createCallExpression(
    factory.createPropertyAccessExpression(effectsArray, factory.createIdentifier("reduce")),
    undefined,
    [
      reduceCallback,
      factory.createArrayLiteralExpression([factory.createArrayLiteralExpression([])]),
    ]
  );

  // .map(([a, b, c]) => yieldExpr)
  const destructuredParam = factory.createParameterDeclaration(
    undefined,
    undefined,
    factory.createArrayBindingPattern(
      bindSteps.map((s) =>
        factory.createBindingElement(undefined, undefined, factory.createIdentifier(s.name))
      )
    )
  );

  return factory.createCallExpression(
    factory.createPropertyAccessExpression(reduceCall, factory.createIdentifier("map")),
    undefined,
    [
      factory.createArrowFunction(
        undefined,
        undefined,
        [destructuredParam],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        yieldExpr
      ),
    ]
  );
}

function buildIterableParCombine(
  ctx: MacroContext,
  steps: (BindStep | MapStep)[],
  returnExpr: ts.Expression
): ts.Expression {
  const { factory } = ctx;
  const bindSteps = steps.filter((s): s is BindStep => s.kind === "bind");
  const mapSteps = steps.filter((s): s is MapStep => s.kind === "map");

  let yieldExpr = returnExpr;
  for (let i = mapSteps.length - 1; i >= 0; i--) {
    const step = mapSteps[i];
    yieldExpr = createIIFE(factory, step.name, yieldExpr, step.expression);
  }

  if (bindSteps.length === 0) return yieldExpr;

  // Array.from each, then cartesian product
  const arraysExpr = factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createArrayLiteralExpression(bindSteps.map((s) => s.effect)),
      factory.createIdentifier("map")
    ),
    undefined,
    [
      factory.createArrowFunction(
        undefined,
        undefined,
        [factory.createParameterDeclaration(undefined, undefined, factory.createIdentifier("it"))],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        factory.createCallExpression(
          factory.createPropertyAccessExpression(
            factory.createIdentifier("Array"),
            factory.createIdentifier("from")
          ),
          undefined,
          [factory.createIdentifier("it")]
        )
      ),
    ]
  );

  if (bindSteps.length === 1) {
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createCallExpression(
          factory.createPropertyAccessExpression(
            factory.createIdentifier("Array"),
            factory.createIdentifier("from")
          ),
          undefined,
          [bindSteps[0].effect]
        ),
        factory.createIdentifier("map")
      ),
      undefined,
      [createArrowFn(factory, bindSteps[0].name, yieldExpr)]
    );
  }

  const spreadComboAndItem = factory.createArrayLiteralExpression([
    factory.createSpreadElement(factory.createIdentifier("combo")),
    factory.createIdentifier("item"),
  ]);
  const reduceCallback = factory.createArrowFunction(
    undefined,
    undefined,
    [
      factory.createParameterDeclaration(undefined, undefined, factory.createIdentifier("acc")),
      factory.createParameterDeclaration(undefined, undefined, factory.createIdentifier("arr")),
    ],
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("acc"),
        factory.createIdentifier("flatMap")
      ),
      undefined,
      [
        factory.createArrowFunction(
          undefined,
          undefined,
          [
            factory.createParameterDeclaration(
              undefined,
              undefined,
              factory.createIdentifier("combo")
            ),
          ],
          undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          factory.createCallExpression(
            factory.createPropertyAccessExpression(
              factory.createIdentifier("arr"),
              factory.createIdentifier("map")
            ),
            undefined,
            [
              factory.createArrowFunction(
                undefined,
                undefined,
                [
                  factory.createParameterDeclaration(
                    undefined,
                    undefined,
                    factory.createIdentifier("item")
                  ),
                ],
                undefined,
                factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                spreadComboAndItem
              ),
            ]
          )
        ),
      ]
    )
  );

  const reduceCall = factory.createCallExpression(
    factory.createPropertyAccessExpression(arraysExpr, factory.createIdentifier("reduce")),
    undefined,
    [
      reduceCallback,
      factory.createArrayLiteralExpression([factory.createArrayLiteralExpression([])]),
    ]
  );

  const destructuredParam = factory.createParameterDeclaration(
    undefined,
    undefined,
    factory.createArrayBindingPattern(
      bindSteps.map((s) =>
        factory.createBindingElement(undefined, undefined, factory.createIdentifier(s.name))
      )
    )
  );

  return factory.createCallExpression(
    factory.createPropertyAccessExpression(reduceCall, factory.createIdentifier("map")),
    undefined,
    [
      factory.createArrowFunction(
        undefined,
        undefined,
        [destructuredParam],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        yieldExpr
      ),
    ]
  );
}

function createGenericParCombineBuilder(name: string): ParCombineBuilder {
  return (ctx, steps, returnExpr) => {
    const { factory } = ctx;
    const bindSteps = steps.filter((s): s is BindStep => s.kind === "bind");
    const mapSteps = steps.filter((s): s is MapStep => s.kind === "map");

    let yieldExpr = returnExpr;
    for (let i = mapSteps.length - 1; i >= 0; i--) {
      const step = mapSteps[i];
      yieldExpr = createIIFE(factory, step.name, yieldExpr, step.expression);
    }

    if (bindSteps.length === 0) return yieldExpr;

    const nameLiteral = factory.createStringLiteral(name);
    const effectsArray = factory.createArrayLiteralExpression(bindSteps.map((s) => s.effect));

    const destructuredParam = factory.createParameterDeclaration(
      undefined,
      undefined,
      factory.createArrayBindingPattern(
        bindSteps.map((s) =>
          factory.createBindingElement(undefined, undefined, factory.createIdentifier(s.name))
        )
      )
    );

    const mapArrow = factory.createArrowFunction(
      undefined,
      undefined,
      [destructuredParam],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      yieldExpr
    );

    // IIFE: (function() { const __pc = getParCombine("name")!; return __pc.map(__pc.all([...]), f); })()
    const pcDecl = factory.createVariableDeclaration(
      factory.createIdentifier("__pc"),
      undefined,
      undefined,
      factory.createNonNullExpression(
        factory.createCallExpression(factory.createIdentifier("getParCombine"), undefined, [
          nameLiteral,
        ])
      )
    );
    const allCall = factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("__pc"),
        factory.createIdentifier("all")
      ),
      undefined,
      [effectsArray]
    );
    const mapCall = factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("__pc"),
        factory.createIdentifier("map")
      ),
      undefined,
      [allCall, mapArrow]
    );
    const returnStmt = factory.createReturnStatement(mapCall);
    const block = factory.createBlock(
      [
        factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList([pcDecl], ts.NodeFlags.Const)
        ),
        returnStmt,
      ],
      true
    );
    const iife = factory.createCallExpression(
      factory.createParenthesizedExpression(
        factory.createArrowFunction(undefined, undefined, [], undefined, undefined, block)
      ),
      undefined,
      []
    );
    return iife;
  };
}
