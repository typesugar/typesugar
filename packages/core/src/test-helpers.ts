/**
 * Test utilities for SFINAE and Type Rewrite registries.
 *
 * These helpers save and restore global registry state, ensuring test
 * isolation when running tests that register rules or type rewrites.
 *
 * @example
 * ```typescript
 * import { withIsolatedRegistries } from "@typesugar/core/test-helpers";
 *
 * describe("my test", () => {
 *   const cleanup = withIsolatedRegistries();
 *   afterEach(() => cleanup());
 *   // ... tests that register rules freely
 * });
 * ```
 */

import { clearSfinaeRules, clearSfinaeAuditLog } from "./sfinae.js";
import { clearTypeRewrites } from "./type-rewrite-registry.js";

/**
 * Create an isolated scope for SFINAE and type rewrite registries.
 * Call the returned function in afterEach to restore clean state.
 *
 * This is preferred over manual clear calls because it's harder to forget
 * and documents the intent clearly.
 */
export function withIsolatedRegistries(): () => void {
  clearSfinaeRules();
  clearSfinaeAuditLog();
  clearTypeRewrites();

  return () => {
    clearSfinaeRules();
    clearSfinaeAuditLog();
    clearTypeRewrites();
  };
}

/**
 * Create an isolated scope for just the SFINAE rule registry.
 */
export function withIsolatedSfinaeRules(): () => void {
  clearSfinaeRules();
  clearSfinaeAuditLog();
  return () => {
    clearSfinaeRules();
    clearSfinaeAuditLog();
  };
}

/**
 * Create an isolated scope for just the type rewrite registry.
 */
export function withIsolatedTypeRewrites(): () => void {
  clearTypeRewrites();
  return () => {
    clearTypeRewrites();
  };
}
