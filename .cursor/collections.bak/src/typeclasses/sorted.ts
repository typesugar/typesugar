import type { $ } from "../hkt.js";
import type { Seq } from "./seq.js";
import type { SetLike } from "./set-like.js";

export interface SortedSeq<F> extends Seq<F> {
  readonly ordering: <A>(fa: F<A>) => (a: A, b: A) => number;
  readonly range: <A>(fa: F<A>, from: A, until: A) => F<A>;
  readonly insert: <A>(fa: F<A>, value: A) => F<A>;
}

export interface SortedSet<F> extends SetLike<F> {
  readonly ordering: <A>(fa: F<A>) => (a: A, b: A) => number;
  readonly range: <A>(fa: F<A>, from: A, until: A) => F<A>;
  readonly ceiling: <A>(fa: F<A>, value: A) => A | undefined;
  readonly floor: <A>(fa: F<A>, value: A) => A | undefined;
}
