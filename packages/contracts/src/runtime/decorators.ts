/**
 * Runtime stubs for the `@invariant` and `@contract` attribute macros.
 *
 * With the transformer, both decorators are expanded at compile time and
 * removed — but the `import { invariant, contract } from "@typesugar/contracts"`
 * that the docs show survives, so the runtime entry must export these names or
 * ESM linking fails before any code runs.
 *
 * These are only ever CALLED when the transformer did not run. Then nothing is
 * checked, so each stub leaves its target unchanged (returns `undefined`,
 * which keeps the original under both legacy and TC39 decorator protocols)
 * and warns once that the contract is not being enforced — silently skipping
 * a class invariant would be worse than the warning.
 */

const warned = new Set<string>();

function warnNotEnforced(name: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(
    `[@typesugar/contracts] @${name} ran at runtime without the typesugar transformer: ` +
      `its checks are NOT enforced. Enable the transformer to expand it at compile time.`
  );
}

/**
 * Class invariant: `@invariant((self) => self.min <= self.max, "min must be <= max")`.
 * Expanded by the transformer; see the runtime-stub note above.
 */
export function invariant<T = any>(
  predicate: (self: T) => boolean,
  message?: string
): (target: any, context?: unknown) => void {
  void predicate;
  void message;
  return () => {
    warnNotEnforced("invariant");
  };
}

/**
 * Optional explicit marker for `requires:` / `ensures:` blocks: `@contract`.
 * Expanded by the transformer; see the runtime-stub note above.
 */
export function contract(target: unknown, ...rest: unknown[]): void {
  void target;
  void rest;
  warnNotEnforced("contract");
}
