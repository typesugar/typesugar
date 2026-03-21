/**
 * Cons operator extension: ::
 *
 * Transforms: head :: tail
 * To: __cons__(head, tail)
 *
 * Chained: 1 :: 2 :: []
 * To: __cons__(1, __cons__(2, []))  (right-associative)
 *
 * The __cons__ macro is resolved by the transformer based on the
 * operand types:
 * - If the type has @operator('::') → rewrite to method call
 * - Default fallback: [head, ...tail] (array cons semantics)
 *
 * Precedence: 5 (higher than |>, lower than all standard TS ops)
 * Associativity: right (1 :: 2 :: [] = 1 :: (2 :: []))
 */

import type { CustomOperatorExtension } from "./types.js";

export const consExtension: CustomOperatorExtension = {
  name: "cons",
  symbol: "::",
  precedence: 5,
  associativity: "right",

  transform(left: string, right: string): string {
    return `__cons__(${left}, ${right})`;
  },
};

export default consExtension;
