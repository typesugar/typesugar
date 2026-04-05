// Integration test fixture: completions
//
// Test positions:
//   Line 8, char 2: completions after "c." — should include r, g, b
//   Line 13, char 8: completions after "result." — should include toString, toFixed

/** @derive(Eq) */
interface Color { r: number; g: number; b: number; }

const c: Color = { r: 0, g: 0, b: 0 };
c.

import { pipe } from "typesugar";
const result = pipe(42, (n: number) => n + 1);
result.
