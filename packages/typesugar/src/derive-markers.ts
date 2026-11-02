/**
 * Derive name markers (`@derive(Eq, Ord, ...)`), from the TypeScript-free
 * `@typesugar/macros/runtime` entry so importing a marker doesn't pull the compiler
 * into application bundles.
 */
export {
  Eq,
  Ord,
  Clone,
  Debug,
  Hash,
  Default,
  Json,
  TypeGuard,
  Show,
  Semigroup,
  Monoid,
} from "@typesugar/macros/runtime";
