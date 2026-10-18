/**
 * Contract Block Parser
 *
 * Parses `requires:` and `ensures:` labeled blocks from a function body
 * when decorated with @contract.
 *
 * ```typescript
 * @contract
 * function withdraw(account: Account, amount: Positive): Balance {
 *   requires: {
 *     account.balance >= amount;
 *     !account.frozen;
 *   }
 *   ensures: (result) => {
 *     result === old(account.balance) - amount;
 *   }
 *   // ... body ...
 * }
 * ```
 */

import * as ts from "typescript";
import {
  type ContractCondition,
  type ContractBlockDiagnostic,
  extractConditionsFromBlock,
} from "./predicate.js";

/**
 * Parsed contract blocks from a function body.
 */
export interface ParsedContractBlocks {
  /** Preconditions from requires: blocks */
  requires: ContractCondition[];
  /** Postconditions from ensures: blocks */
  ensures: EnsuresBlock[];
  /** The remaining function body (with contract blocks removed) */
  body: ts.Statement[];
}

/**
 * A parsed ensures block, which may have a result parameter.
 */
export interface EnsuresBlock {
  /** The conditions to check */
  conditions: ContractCondition[];
  /**
   * The name the conditions use for the return value: the arrow parameter of
   * `ensures: (r) => { ... }`, or `"result"` for the block / expression forms
   * (`ensures: { result > 0; }`), which the docs use with an implicit
   * `result`. Undefined only when the arrow form declares no parameter.
   */
  resultParam?: string;
  /** True when `resultParam` is the implicit `result` of the block form. */
  implicitResult?: boolean;
}

/**
 * Parse a function body to extract requires:/ensures: labeled blocks.
 * Returns the contract conditions and the remaining body statements.
 */
export function parseContractBlocks(
  body: ts.Block | undefined,
  onDiagnostic?: ContractBlockDiagnostic
): ParsedContractBlocks {
  if (!body) {
    return { requires: [], ensures: [], body: [] };
  }

  const requires: ContractCondition[] = [];
  const ensures: EnsuresBlock[] = [];
  const remainingBody: ts.Statement[] = [];

  for (const stmt of body.statements) {
    if (ts.isLabeledStatement(stmt)) {
      const label = stmt.label.text;

      if (label === "requires") {
        const conditions = parseLabeledConditions(stmt.statement, onDiagnostic);
        requires.push(...conditions);
        continue;
      }

      if (label === "ensures") {
        const ensuresBlock = parseEnsuresBlock(stmt.statement, onDiagnostic);
        ensures.push(ensuresBlock);
        continue;
      }
    }

    remainingBody.push(stmt);
  }

  return { requires, ensures, body: remainingBody };
}

/**
 * Parse conditions from a labeled statement body.
 * Handles both block form `requires: { ... }` and single expression
 * `requires: condition;`
 */
function parseLabeledConditions(
  statement: ts.Statement,
  onDiagnostic?: ContractBlockDiagnostic
): ContractCondition[] {
  return extractConditionsFromBlock(statement, onDiagnostic);
}

/**
 * Parse an ensures block, which may be:
 * - `ensures: { conditions }` (implicit `result`)
 * - `ensures: condition;` (implicit `result`)
 * - `ensures: (result) => { conditions }` / `ensures: (r) => expr`
 * - `ensures: { result => expr }` — a lone arrow inside the braces, treated
 *   like the arrow form (it used to become the condition itself: a function
 *   value, always truthy, so the postcondition was never checked)
 */
function parseEnsuresBlock(
  statement: ts.Statement,
  onDiagnostic?: ContractBlockDiagnostic
): EnsuresBlock {
  if (ts.isBlock(statement)) {
    const stmts = statement.statements.filter((s) => !ts.isEmptyStatement(s));
    const only = stmts.length === 1 ? stmts[0] : undefined;
    if (only && ts.isExpressionStatement(only) && ts.isArrowFunction(only.expression)) {
      statement = only;
    }
  }
  if (ts.isExpressionStatement(statement)) {
    const expr = statement.expression;
    if (ts.isArrowFunction(expr)) {
      if (expr.parameters.length > 1) {
        onDiagnostic?.(
          expr,
          "An `ensures: (result) => ...` block takes a single parameter (the return value).",
          "error"
        );
      }
      const p = expr.parameters[0];
      if (p && !ts.isIdentifier(p.name)) {
        onDiagnostic?.(p, "The `ensures` result parameter must be a plain identifier.", "error");
      }
      const resultParam = p && ts.isIdentifier(p.name) ? p.name.text : undefined;
      const conditions = ts.isBlock(expr.body)
        ? extractConditionsFromBlock(expr.body, onDiagnostic)
        : extractConditionsFromBlock(ts.factory.createExpressionStatement(expr.body), onDiagnostic);
      return { conditions, resultParam };
    }
  }

  return {
    conditions: extractConditionsFromBlock(statement, onDiagnostic),
    resultParam: "result",
    implicitResult: true,
  };
}
