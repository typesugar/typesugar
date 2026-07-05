/**
 * Test utilities for Diagnostic Suppression and Type Rewrite registries.
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

import {
  clearDiagnosticSuppressionRules,
  clearDiagnosticSuppressionAuditLog,
} from "./diagnostic-suppression.js";
import { clearTypeRewrites } from "./type-rewrite-registry.js";

/**
 * Create an isolated scope for diagnostic suppression and type rewrite registries.
 * Call the returned function in afterEach to restore clean state.
 *
 * This is preferred over manual clear calls because it's harder to forget
 * and documents the intent clearly.
 */
export function withIsolatedRegistries(): () => void {
  clearDiagnosticSuppressionRules();
  clearDiagnosticSuppressionAuditLog();
  clearTypeRewrites();

  return () => {
    clearDiagnosticSuppressionRules();
    clearDiagnosticSuppressionAuditLog();
    clearTypeRewrites();
  };
}

/**
 * Create an isolated scope for just the diagnostic suppression rule registry.
 */
export function withIsolatedDiagnosticSuppressionRules(): () => void {
  clearDiagnosticSuppressionRules();
  clearDiagnosticSuppressionAuditLog();
  return () => {
    clearDiagnosticSuppressionRules();
    clearDiagnosticSuppressionAuditLog();
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
