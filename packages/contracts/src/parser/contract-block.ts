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
import { ContractCondition, extractConditionsFromBlock } from "./predicate.js";

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
  /** The name of the result parameter (if `ensures: (result) => { ... }`) */
  resultParam?: string;
}

/**
 * Parse a function body to extract requires:/ensures: labeled blocks.
 * Returns the contract conditions and the remaining body statements.
 */
export function parseContractBlocks(body: ts.Block | undefined): ParsedContractBlocks {
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
        const conditions = parseLabeledConditions(stmt.statement);
        requires.push(...conditions);
        continue;
      }

      if (label === "ensures") {
        const ensuresBlock = parseEnsuresBlock(stmt.statement);
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
function parseLabeledConditions(statement: ts.Statement): ContractCondition[] {
  if (ts.isBlock(statement)) {
    return extractConditionsFromBlock(statement);
  }

  if (ts.isExpressionStatement(statement)) {
    return extractConditionsFromBlock(statement);
  }

  return [];
}

/**
 * Parse an ensures block, which may be:
 * - `ensures: { conditions }` (no result param)
 * - `ensures: (result) => { conditions }` (with result param)
 */
function parseEnsuresBlock(statement: ts.Statement): EnsuresBlock {
  // Case: ensures: (result) => { ... }
  if (ts.isExpressionStatement(statement)) {
    const expr = statement.expression;

    if (ts.isArrowFunction(expr) && expr.parameters.length >= 1) {
      const resultParam = expr.parameters[0].name.getText();
      const conditions = extractConditionsFromArrowBody(expr.body);
      return { conditions, resultParam };
    }

    // Single expression: ensures: condition;
    return {
      conditions: extractConditionsFromBlock(statement),
    };
  }

  // Block form: ensures: { ... }
  if (ts.isBlock(statement)) {
    return {
      conditions: extractConditionsFromBlock(statement),
    };
  }

  return { conditions: [] };
}

/**
 * Extract conditions from an arrow function body.
 */
function extractConditionsFromArrowBody(body: ts.ConciseBody): ContractCondition[] {
  if (ts.isBlock(body)) {
    return extractConditionsFromBlock(body);
  }

  // Expression body: (result) => result > 0
  return extractConditionsFromBlock(ts.factory.createExpressionStatement(body));
}
