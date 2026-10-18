import { implicit } from "typesugar";
interface Show<A> { show(a: A): string }
function display<A>(a: A, S: Show<A> = implicit()): string { return S.show(a); }
export function outerDecl<A>(a: A, S: Show<A> = implicit()): string { return display(a); }
export const outerArrowBlock = <A,>(a: A, S: Show<A> = implicit()): string => { return display(a); };
export const outerArrowExpr = <A,>(a: A, S: Show<A> = implicit()): string => display(a);
