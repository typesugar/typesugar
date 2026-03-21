/**
 * Pipeline operator extension: |>
 *
 * Transforms: expr |> f |> g
 * To: __pipe__(__pipe__(expr, f), g)
 *
 * The __pipe__ macro is resolved by the transformer based on the
 * left operand's type:
 * - If the type has @operator('|>') → rewrite to method call
 * - Default fallback: f(expr) (standard pipeline semantics)
 *
 * Precedence: 1 (lowest custom operator)
 * Associativity: left (a |> b |> c = (a |> b) |> c)
 */

import type { CustomOperatorExtension } from "./types.js";

export const pipelineExtension: CustomOperatorExtension = {
  name: "pipeline",
  symbol: "|>",
  precedence: 1,
  associativity: "left",

  transform(left: string, right: string): string {
    return `__pipe__(${left}, ${right})`;
  },
};

export default pipelineExtension;
