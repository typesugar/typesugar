/**
 * Runtime stub for `registerStdInstances()` (PEP-050 Case-1).
 *
 * This entry is **runtime-only** and does NOT import `typescript`. The actual
 * instance registration is performed at compile time by the macro in
 * `register-instances.ts` (loaded by the transformer via the `./macros` entry);
 * at runtime this is a no-op.
 */

/**
 * Runtime stub for registerStdInstances.
 * This function does nothing at runtime - all work is done at compile time.
 */
export function registerStdInstances(): void {
  // Placeholder - processed by transformer at compile time
}
