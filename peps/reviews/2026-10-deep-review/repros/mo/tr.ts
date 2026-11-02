interface Option<A> { map<B>(f: (a: A) => B): Option<B>; }
interface Box<T> { get(): T }
declare const n: number | null;
export const o: Option<number> = n;
export const b: Box<number> = n;
