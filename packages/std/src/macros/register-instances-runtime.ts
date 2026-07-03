/**
 * Runtime stub for `registerStdInstances()`.
 *
 * @deprecated No-op kept for API compatibility. Instance resolution is
 * scope-based (PEP-052): std's instances are discovered from their type
 * annotations / `@impl` tags by the instance scanner — there is nothing to
 * register, at compile time or runtime. The compile-time registration macro
 * this used to pair with was deleted in Wave 4 (its registrations had been
 * no-ops since the registry deletion in Wave 3).
 */
export function registerStdInstances(): void {
  // Deliberately empty.
}
