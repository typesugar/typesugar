/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}
export function Some<A>(a: A): Option<A> { return a as unknown as Option<A>; }
export const None: Option<never> = null as unknown as Option<never>;
export function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B> { return (o === null ? null : f(o as any)) as any; }
export interface Options { verbose: boolean }
export function WithOptions(o: Partial<Options>): Options { return { verbose: false, ...o }; }
