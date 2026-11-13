/**
 * Test utility for the type rewrite registry.
 *
 * Saves and restores global registry state, ensuring test isolation when
 * running tests that register type rewrites.
 *
 * @example
 * ```typescript
 * import { withIsolatedTypeRewrites } from "../src/test-helpers.js";
 *
 * describe("my test", () => {
 *   const cleanup = withIsolatedTypeRewrites();
 *   afterEach(() => cleanup());
 *   // ... tests that register type rewrites freely
 * });
 * ```
 */

import { clearTypeRewrites } from "./type-rewrite-registry.js";

/**
 * Create an isolated scope for just the type rewrite registry.
 */
export function withIsolatedTypeRewrites(): () => void {
  clearTypeRewrites();
  return () => {
    clearTypeRewrites();
  };
}
