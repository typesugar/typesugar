import { comptime } from "typesugar";
interface Functor<F> { map<A, B>(fa: F<A>, f: (a: A) => B): F<B>; }
export const x = comptime(() => { throw new Error("boom"); });
