interface Cons<A> { readonly head: A; readonly tail: List<A> }
interface Nil {}
/** @adt { Nil: null } */
export type List<A> = Cons<A> | Nil;
