/**
 * Legacy match API — REMOVED (PEP-025)
 *
 * The old `when()`, `otherwise()`, `isType()`, and `P.*` APIs have been removed.
 * Use the fluent API instead: `match(value).case(...).then(...).else(...)`
 *
 * See https://typesugar.dev/guides/pattern-matching#migration
 */

const REMOVED_MSG =
  "This function was removed in PEP-025. Use the fluent match API instead: " +
  "match(value).case(...).then(...).else(...)";

/** @deprecated Removed — use `.case(x).if(pred).then(handler)` */
export function when(): never {
  throw new Error(REMOVED_MSG);
}

/** @deprecated Removed — use `.else(defaultValue)` */
export function otherwise(): never {
  throw new Error(REMOVED_MSG);
}

/** @deprecated Removed — use `.case(String(s))` / `.case(Number(n))` */
export function isType(): never {
  throw new Error(REMOVED_MSG);
}

/** @deprecated Removed — use `.case([])`, `.case([x])`, etc. */
export const P = new Proxy({} as Record<string, never>, {
  get(_target, prop) {
    throw new Error(`P.${String(prop)} was removed in PEP-025. ${REMOVED_MSG}`);
  },
});

/** @deprecated Removed — use GuardArm is no longer needed with the fluent API */
export type GuardArm<T = unknown, R = unknown> = {
  readonly predicate: (value: T) => boolean;
  readonly handler: (value: T) => R;
};
