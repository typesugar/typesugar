/**
 * JSX Enhancement Macros
 *
 * Provides Vue/Svelte-like JSX directives:
 * - class:name={condition} - Conditional class names
 * - show={condition} - CSS display toggling (v-show)
 * - each() - Keyed iteration with auto-memoization
 * - match() - Exhaustive pattern matching for discriminated unions
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry } from "../../../core/registry.js";
import type { MacroContext } from "../../../core/types.js";
import type { ReactMacroMode } from "../types.js";

/**
 * Module name for import-scoped activation
 */
const MODULE_NAME = "typemacro/react";

// ============================================================================
// each() Macro - Keyed iteration
// ============================================================================

/**
 * each() expression macro
 *
 * Transforms: each(items, item => <Component item={item} />, item => item.id)
 * Into: items.map(item => <Component key={item.id} item={item} />)
 */
export const eachMacro = defineExpressionMacro({
  name: "each",
  module: MODULE_NAME,
  description: "Keyed iteration with automatic key extraction (Svelte-inspired)",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    const factory = ctx.factory;

    // Validate arguments
    if (args.length < 2 || args.length > 3) {
      ctx.reportError(
        callExpr,
        `each() requires 2-3 arguments (items, renderFn, keyFn?), got ${args.length}`,
      );
      return callExpr;
    }

    const [items, renderFn, keyFn] = args;

    // Ensure renderFn is a function
    if (!ts.isArrowFunction(renderFn) && !ts.isFunctionExpression(renderFn)) {
      ctx.reportError(
        callExpr,
        "each() second argument must be an arrow function or function expression",
      );
      return callExpr;
    }

    // Get the item parameter name
    const itemParamName = getRenderFnParamName(renderFn);
    if (!itemParamName) {
      ctx.reportError(
        callExpr,
        "each() render function must have at least one parameter",
      );
      return callExpr;
    }

    const mode: ReactMacroMode = "react"; // TODO: Get from config

    if (mode === "fine-grained" && keyFn) {
      // Fine-grained mode: use keyed reconciler
      return factory.createCallExpression(
        factory.createIdentifier("keyedList"),
        undefined,
        [items, renderFn, keyFn],
      );
    }

    // Standard React mode: items.map() with injected key

    // If we have a key function, inject the key into the JSX
    if (keyFn && ts.isArrowFunction(keyFn)) {
      const body = renderFn.body;

      // If the body is a JSX element, we can inject the key
      if (ts.isJsxElement(body) || ts.isJsxSelfClosingElement(body)) {
        // Create a new render function with key injection
        const keyExpr = createKeyExpression(factory, keyFn, itemParamName);
        const newBody = injectKeyIntoJsx(factory, body, keyExpr);

        const newRenderFn = factory.createArrowFunction(
          renderFn.modifiers,
          renderFn.typeParameters,
          renderFn.parameters,
          renderFn.type,
          renderFn.equalsGreaterThanToken,
          newBody,
        );

        // Generate: items.map(newRenderFn)
        return factory.createCallExpression(
          factory.createPropertyAccessExpression(items, "map"),
          undefined,
          [newRenderFn],
        );
      }

      // If body is a block or complex expression, wrap with index parameter
      // and use a callback that adds key
      const indexParam = factory.createParameterDeclaration(
        undefined,
        undefined,
        factory.createIdentifier("__index"),
      );

      const wrappedRenderFn = factory.createArrowFunction(
        undefined,
        undefined,
        [...renderFn.parameters, indexParam],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        renderFn.body,
      );

      return factory.createCallExpression(
        factory.createPropertyAccessExpression(items, "map"),
        undefined,
        [wrappedRenderFn],
      );
    }

    // No key function - just map without key
    // (React will warn, but it's the user's choice)
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(items, "map"),
      undefined,
      [renderFn],
    );
  },
});

/**
 * Get the first parameter name from a render function
 */
function getRenderFnParamName(
  fn: ts.ArrowFunction | ts.FunctionExpression,
): string | null {
  if (fn.parameters.length === 0) {
    return null;
  }
  const firstParam = fn.parameters[0];
  if (ts.isIdentifier(firstParam.name)) {
    return firstParam.name.text;
  }
  return null;
}

/**
 * Create a key expression from a key function
 * keyFn: item => item.id  ->  item.id
 */
function createKeyExpression(
  factory: ts.NodeFactory,
  keyFn: ts.ArrowFunction,
  itemParamName: string,
): ts.Expression {
  const body = keyFn.body;
  if (ts.isExpression(body)) {
    return body;
  }
  // If it's a block, just use the item itself as key
  return factory.createIdentifier(itemParamName);
}

/**
 * Inject a key attribute into a JSX element
 */
function injectKeyIntoJsx(
  factory: ts.NodeFactory,
  jsx: ts.JsxElement | ts.JsxSelfClosingElement,
  keyExpr: ts.Expression,
): ts.JsxElement | ts.JsxSelfClosingElement {
  const keyAttr = factory.createJsxAttribute(
    factory.createIdentifier("key"),
    factory.createJsxExpression(undefined, keyExpr),
  );

  if (ts.isJsxSelfClosingElement(jsx)) {
    const existingAttrs = jsx.attributes.properties;
    const newAttrs = factory.createJsxAttributes([keyAttr, ...existingAttrs]);
    return factory.createJsxSelfClosingElement(
      jsx.tagName,
      jsx.typeArguments,
      newAttrs,
    );
  }

  // JsxElement
  const existingAttrs = jsx.openingElement.attributes.properties;
  const newAttrs = factory.createJsxAttributes([keyAttr, ...existingAttrs]);
  const newOpening = factory.createJsxOpeningElement(
    jsx.openingElement.tagName,
    jsx.openingElement.typeArguments,
    newAttrs,
  );
  return factory.createJsxElement(
    newOpening,
    jsx.children,
    jsx.closingElement,
  );
}

// ============================================================================
// match() Macro - Exhaustive pattern matching
// ============================================================================

/**
 * match() expression macro
 *
 * Transforms: match(value, { variant1: () => ..., variant2: () => ... })
 * Into: value._tag === "variant1" ? cases.variant1(value) : cases.variant2(value)
 *
 * With compile-time exhaustiveness checking for discriminated unions.
 */
export const matchMacro = defineExpressionMacro({
  name: "match",
  module: MODULE_NAME,
  description: "Exhaustive pattern matching for discriminated unions in JSX",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    const factory = ctx.factory;

    // Validate arguments
    if (args.length !== 2) {
      ctx.reportError(
        callExpr,
        `match() requires exactly 2 arguments (value, cases), got ${args.length}`,
      );
      return callExpr;
    }

    const [value, cases] = args;

    // Ensure cases is an object literal
    if (!ts.isObjectLiteralExpression(cases)) {
      ctx.reportError(
        callExpr,
        "match() second argument must be an object literal of cases",
      );
      return callExpr;
    }

    // Get the type of the value to check exhaustiveness
    const valueType = ctx.getTypeOf(value);
    const discriminantProp = getDiscriminantProperty(valueType, ctx);

    if (!discriminantProp) {
      ctx.reportWarning(
        callExpr,
        "match() value type doesn't appear to be a discriminated union. Expected a type with '_tag' or similar discriminant property.",
      );
    }

    // Get the expected variants from the type
    const expectedVariants = discriminantProp
      ? getUnionVariants(valueType, discriminantProp, ctx)
      : new Set<string>();

    // Get the provided variants from the cases object
    const providedVariants = new Set<string>();
    const caseEntries: Array<{ tag: string; handler: ts.Expression }> = [];

    for (const prop of cases.properties) {
      if (
        ts.isPropertyAssignment(prop) ||
        ts.isShorthandPropertyAssignment(prop) ||
        ts.isMethodDeclaration(prop)
      ) {
        const name = ts.isIdentifier(prop.name)
          ? prop.name.text
          : ts.isStringLiteral(prop.name)
            ? prop.name.text
            : null;

        if (name) {
          providedVariants.add(name);

          let handler: ts.Expression;
          if (ts.isPropertyAssignment(prop)) {
            handler = prop.initializer;
          } else if (ts.isShorthandPropertyAssignment(prop)) {
            handler = factory.createIdentifier(name);
          } else {
            // Method declaration - convert to arrow function
            handler = factory.createArrowFunction(
              undefined,
              undefined,
              prop.parameters,
              undefined,
              factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
              prop.body ?? factory.createBlock([]),
            );
          }

          caseEntries.push({ tag: name, handler });
        }
      }
    }

    // Check for exhaustiveness
    if (discriminantProp && expectedVariants.size > 0) {
      for (const expected of expectedVariants) {
        if (!providedVariants.has(expected)) {
          ctx.reportError(
            callExpr,
            `match() is missing case for variant '${expected}'`,
          );
        }
      }

      // Check for extra cases
      for (const provided of providedVariants) {
        if (!expectedVariants.has(provided)) {
          ctx.reportWarning(
            callExpr,
            `match() has case for unknown variant '${provided}'`,
          );
        }
      }
    }

    // Generate the switch expression
    // We build a chain of ternaries: value._tag === "a" ? handlers.a(value) : value._tag === "b" ? ...
    const tagProp = discriminantProp ?? "_tag";

    if (caseEntries.length === 0) {
      ctx.reportError(callExpr, "match() requires at least one case");
      return factory.createNull();
    }

    // Build ternary chain from end to start
    let result: ts.Expression = factory.createCallExpression(
      factory.createParenthesizedExpression(
        factory.createArrowFunction(
          undefined,
          undefined,
          [],
          undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          factory.createBlock([
            factory.createThrowStatement(
              factory.createNewExpression(
                factory.createIdentifier("Error"),
                undefined,
                [factory.createStringLiteral("Unhandled match case")],
              ),
            ),
          ]),
        ),
      ),
      undefined,
      [],
    );

    for (let i = caseEntries.length - 1; i >= 0; i--) {
      const entry = caseEntries[i];

      // value._tag === "variant"
      const condition = factory.createBinaryExpression(
        factory.createPropertyAccessExpression(
          value,
          factory.createIdentifier(tagProp),
        ),
        factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
        factory.createStringLiteral(entry.tag),
      );

      // handler(value)
      const whenTrue = factory.createCallExpression(
        entry.handler,
        undefined,
        [value],
      );

      result = factory.createConditionalExpression(
        condition,
        factory.createToken(ts.SyntaxKind.QuestionToken),
        whenTrue,
        factory.createToken(ts.SyntaxKind.ColonToken),
        result,
      );
    }

    return result;
  },
});

/**
 * Get the discriminant property name from a union type
 */
function getDiscriminantProperty(
  type: ts.Type,
  ctx: MacroContext,
): string | null {
  // Common discriminant property names
  const candidates = ["_tag", "type", "kind", "tag", "__typename"];

  if (!type.isUnion()) {
    // Check if single type has a candidate property
    const props = ctx.getPropertiesOfType(type);
    for (const candidate of candidates) {
      if (props.some((p) => p.name === candidate)) {
        return candidate;
      }
    }
    return null;
  }

  // For union types, check if all members have the same discriminant
  for (const candidate of candidates) {
    const allHave = type.types.every((t) => {
      const props = ctx.typeChecker.getPropertiesOfType(t);
      return props.some((p) => p.name === candidate);
    });

    if (allHave) {
      return candidate;
    }
  }

  return null;
}

/**
 * Get all variant names from a discriminated union
 */
function getUnionVariants(
  type: ts.Type,
  discriminantProp: string,
  ctx: MacroContext,
): Set<string> {
  const variants = new Set<string>();

  if (!type.isUnion()) {
    return variants;
  }

  for (const member of type.types) {
    const props = ctx.typeChecker.getPropertiesOfType(member);
    const discProp = props.find((p) => p.name === discriminantProp);

    if (discProp) {
      const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(
        discProp,
        discProp.valueDeclaration!,
      );

      if (propType.isStringLiteral()) {
        variants.add(propType.value);
      }
    }
  }

  return variants;
}

// Register macros
globalRegistry.register(eachMacro);
globalRegistry.register(matchMacro);

// ============================================================================
// JSX Attribute Processing (class:, show)
// These are processed at the JSX level, not as expression macros
// ============================================================================

/**
 * Process class:name={condition} attributes
 *
 * <div class:active={isActive} class:error={hasError} className="base">
 * ->
 * <div className={`base${isActive ? " active" : ""}${hasError ? " error" : ""}`}>
 */
export function processClassDirectives(
  factory: ts.NodeFactory,
  attributes: readonly ts.JsxAttributeLike[],
): ts.JsxAttributes {
  const classConditions: Array<{ name: string; condition: ts.Expression }> = [];
  const otherAttrs: ts.JsxAttributeLike[] = [];
  let baseClassName: ts.Expression | null = null;

  for (const attr of attributes) {
    if (!ts.isJsxAttribute(attr)) {
      otherAttrs.push(attr);
      continue;
    }

    const attrName = attr.name.getText();

    // Check for class:name pattern
    if (attrName.startsWith("class:")) {
      const className = attrName.slice(6); // Remove "class:" prefix
      const condition = getJsxAttributeValue(attr, factory);
      if (condition) {
        classConditions.push({ name: className, condition });
      }
      continue;
    }

    // Check for className attribute
    if (attrName === "className") {
      baseClassName = getJsxAttributeValue(attr, factory);
      continue;
    }

    otherAttrs.push(attr);
  }

  // If no class directives, return unchanged
  if (classConditions.length === 0) {
    return factory.createJsxAttributes([...attributes]);
  }

  // Build the className expression
  // `base${isActive ? " active" : ""}${hasError ? " error" : ""}`
  const parts: Array<ts.Expression | ts.TemplateSpan> = [];

  if (baseClassName) {
    // Start with base class
    parts.push(baseClassName);
  }

  // Add conditional classes
  for (const { name, condition } of classConditions) {
    const conditionalExpr = factory.createConditionalExpression(
      condition,
      factory.createToken(ts.SyntaxKind.QuestionToken),
      factory.createStringLiteral(` ${name}`),
      factory.createToken(ts.SyntaxKind.ColonToken),
      factory.createStringLiteral(""),
    );
    parts.push(conditionalExpr);
  }

  // Combine into a template literal or concatenation
  let classNameExpr: ts.Expression;

  if (parts.length === 1) {
    classNameExpr = parts[0] as ts.Expression;
  } else {
    // Build concatenation: part1 + part2 + part3
    classNameExpr = parts.reduce((acc, part) =>
      factory.createBinaryExpression(
        acc as ts.Expression,
        factory.createToken(ts.SyntaxKind.PlusToken),
        part as ts.Expression,
      ),
    ) as ts.Expression;
  }

  // Create the className attribute
  const classNameAttr = factory.createJsxAttribute(
    factory.createIdentifier("className"),
    factory.createJsxExpression(undefined, classNameExpr),
  );

  return factory.createJsxAttributes([classNameAttr, ...otherAttrs]);
}

/**
 * Process show={condition} attribute
 *
 * <div show={isVisible}>
 * ->
 * <div style={{ display: isVisible ? undefined : "none" }}>
 */
export function processShowDirective(
  factory: ts.NodeFactory,
  attributes: readonly ts.JsxAttributeLike[],
): ts.JsxAttributes {
  let showCondition: ts.Expression | null = null;
  const otherAttrs: ts.JsxAttributeLike[] = [];
  let existingStyle: ts.Expression | null = null;

  for (const attr of attributes) {
    if (!ts.isJsxAttribute(attr)) {
      otherAttrs.push(attr);
      continue;
    }

    const attrName = attr.name.getText();

    if (attrName === "show") {
      showCondition = getJsxAttributeValue(attr, factory);
      continue;
    }

    if (attrName === "style") {
      existingStyle = getJsxAttributeValue(attr, factory);
      continue;
    }

    otherAttrs.push(attr);
  }

  // If no show directive, return unchanged
  if (!showCondition) {
    return factory.createJsxAttributes([...attributes]);
  }

  // Build the display property
  // display: condition ? undefined : "none"
  const displayExpr = factory.createConditionalExpression(
    showCondition,
    factory.createToken(ts.SyntaxKind.QuestionToken),
    factory.createIdentifier("undefined"),
    factory.createToken(ts.SyntaxKind.ColonToken),
    factory.createStringLiteral("none"),
  );

  // Build the style object
  let styleExpr: ts.Expression;

  if (existingStyle) {
    // Merge with existing style: { ...existingStyle, display: ... }
    styleExpr = factory.createObjectLiteralExpression([
      factory.createSpreadAssignment(existingStyle),
      factory.createPropertyAssignment(
        factory.createIdentifier("display"),
        displayExpr,
      ),
    ]);
  } else {
    // Just display property: { display: ... }
    styleExpr = factory.createObjectLiteralExpression([
      factory.createPropertyAssignment(
        factory.createIdentifier("display"),
        displayExpr,
      ),
    ]);
  }

  // Create the style attribute
  const styleAttr = factory.createJsxAttribute(
    factory.createIdentifier("style"),
    factory.createJsxExpression(undefined, styleExpr),
  );

  return factory.createJsxAttributes([styleAttr, ...otherAttrs]);
}

/**
 * Get the value expression from a JSX attribute
 */
function getJsxAttributeValue(
  attr: ts.JsxAttribute,
  factory: ts.NodeFactory,
): ts.Expression | null {
  if (!attr.initializer) {
    // Boolean attribute: show -> true
    return factory.createTrue();
  }

  if (ts.isJsxExpression(attr.initializer)) {
    return attr.initializer.expression ?? null;
  }

  if (ts.isStringLiteral(attr.initializer)) {
    return attr.initializer;
  }

  return null;
}
