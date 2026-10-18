interface Some<A> { readonly value: A }
interface None {}
/** @adt */
export type Option<A> = Some<A> | None | "missing";

interface Circle { radius: number; label?: string }
interface Square { side: number; label?: string }
interface Labeled { label: string }
/** @adt */
export type Shape = Circle | Square | Labeled;
