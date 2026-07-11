/**
 * Macro Registration
 *
 * This module registers macros with the typesugar transformer.
 * It should be imported by the transformer, not by user code.
 */

import {
  defineExpressionMacro,
  defineDeriveMacro,
  quote,
  quoteStatements,
  ident,
  spread,
  type MacroContext,
  type DeriveTypeInfo,
} from "@typesugar/core";
import type * as ts from "typescript";

// ============================================================================
// logged() - Expression Macro
// ============================================================================

defineExpressionMacro("logged", "my-typesugar-macros", {
  expand(ctx: MacroContext, node: ts.CallExpression): ts.Expression {
    const fnArg = node.arguments[0];
    if (!fnArg) {
      ctx.reportError(node, "logged() requires a function argument");
      return node;
    }

    // Generate unique names
    const fnName = ctx.generateUniqueName("fn");
    const resultName = ctx.generateUniqueName("result");
    const argsName = ctx.generateUniqueName("args");

    // Build the wrapper using quasiquoting
    return quote(ctx)`
      ((...${ident(argsName.text)}) => {
        const ${fnName} = ${fnArg};
        console.log("Call:", ...${ident(argsName.text)});
        const ${resultName} = ${fnName}(...${ident(argsName.text)});
        console.log("Result:", ${resultName});
        return ${resultName};
      })
    `;
  },
});

// ============================================================================
// memo() - Expression Macro
// ============================================================================

defineExpressionMacro("memo", "my-typesugar-macros", {
  expand(ctx: MacroContext, node: ts.CallExpression): ts.Expression {
    const fnArg = node.arguments[0];
    if (!fnArg) {
      ctx.reportError(node, "memo() requires a function argument");
      return node;
    }

    const cacheName = ctx.generateUniqueName("cache");
    const keyName = ctx.generateUniqueName("key");
    const argsName = ctx.generateUniqueName("args");
    const fnName = ctx.generateUniqueName("fn");

    return quote(ctx)`
      (() => {
        const ${cacheName} = new Map();
        const ${fnName} = ${fnArg};
        return (...${ident(argsName.text)}) => {
          const ${keyName} = JSON.stringify(${ident(argsName.text)});
          if (${cacheName}.has(${keyName})) {
            return ${cacheName}.get(${keyName});
          }
          const result = ${fnName}(...${ident(argsName.text)});
          ${cacheName}.set(${keyName}, result);
          return result;
        };
      })()
    `;
  },
});

// ============================================================================
// @derive(Validation) - Derive Macro
// ============================================================================

defineDeriveMacro("Validation", "my-typesugar-macros", {
  expand(ctx: MacroContext, target: ts.Node, typeInfo: DeriveTypeInfo): ts.Statement[] {
    const { name, fields } = typeInfo;

    // Build validation checks for each field
    const checks = fields.map((field) => {
      const fieldName = field.name;
      const fieldType = field.type;

      if (fieldType === "string") {
        return `if (typeof this.${fieldName} !== "string") {
          errors.push("${fieldName} must be a string");
        }`;
      } else if (fieldType === "number") {
        return `if (typeof this.${fieldName} !== "number" || isNaN(this.${fieldName})) {
          errors.push("${fieldName} must be a valid number");
        }`;
      } else if (fieldType === "boolean") {
        return `if (typeof this.${fieldName} !== "boolean") {
          errors.push("${fieldName} must be a boolean");
        }`;
      } else {
        return `if (this.${fieldName} === undefined) {
          errors.push("${fieldName} is required");
        }`;
      }
    });

    // Generate validation method
    const validationCode = `
      ${name}.prototype.validate = function(): string[] {
        const errors: string[] = [];
        ${checks.join("\n")}
        return errors;
      };

      ${name}.prototype.isValid = function(): boolean {
        return this.validate().length === 0;
      };
    `;

    return ctx.parseStatements(validationCode);
  },
});

// Export for testing
export { defineExpressionMacro, defineDeriveMacro };
