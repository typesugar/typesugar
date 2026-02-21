/**
 * Pipeline IR types for @typesugar/fusion
 *
 * Represents the intermediate representation of lazy pipeline steps
 * before they are fused into a single-pass execution.
 */

/** A step in a lazy pipeline — the IR for fusion */
export type PipelineStep =
  | { readonly type: "map"; readonly f: (value: any) => any }
  | { readonly type: "filter"; readonly predicate: (value: any) => boolean }
  | { readonly type: "flatMap"; readonly f: (value: any) => Iterable<any> }
  | { readonly type: "take"; readonly count: number }
  | { readonly type: "drop"; readonly count: number }
  | { readonly type: "takeWhile"; readonly predicate: (value: any) => boolean }
  | {
      readonly type: "dropWhile";
      readonly predicate: (value: any) => boolean;
    };

/** A vector wrapper for element-wise operations */
export interface FusedVec<T> {
  readonly data: readonly T[];
  readonly length: number;
}
