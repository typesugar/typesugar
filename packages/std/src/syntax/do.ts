/**
 * Activation marker (PEP-052) — import this module to activate do-notation
 * LABEL syntax in the importing file: `let:`/`seq:` comprehensions (with
 * `yield:`/`pure:`/`return:` continuations) and the parallel `par:`/`all:`
 * form (with `yield:`/`pure:` continuations).
 *
 * ```ts
 * import "@typesugar/std/syntax/do";
 * ```
 *
 * Without this import the labels are left as ordinary JavaScript labeled
 * statements and the transformer warns (TS9224). The markers are carried by
 * the `@syntax-labels` JSDoc tags on the exported constant (a real
 * declaration, so it survives `.d.ts` generation).
 *
 * @syntax-labels letYield
 * @syntax-labels parYield
 */
export const __typesugar_syntax_labels_do = true;

// PEP-052 Wave 3: this marker doubles as the INSTANCE PROVIDER for the std
// builtins. Do-notation instance lookup is scope-based (an instance must be
// exported by some module the file imports); since every do-notation file
// already imports this module for the labels, re-exporting the builtin
// instances here means the common case needs zero additional imports. The
// re-exported modules are the runtime-only twins — no `typescript` in the
// user's bundle.
export {
  flatMapArray,
  flatMapPromise,
  flatMapIterable,
  flatMapAsyncIterable,
} from "../typeclasses/flatmap-instances.js";
export {
  parCombinePromise,
  parCombineArray,
  parCombineIterable,
  parCombineAsyncIterable,
} from "../typeclasses/par-combine-instances.js";
