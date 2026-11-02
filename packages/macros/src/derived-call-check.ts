/**
 * The slot through which the instance resolver asks the `derived` macro's
 * module (typeclass.ts) whether a `derived<TC<T>>()` const is an instance,
 * i.e. its derivation did not fail (see `derivedCallSucceeds` there).
 *
 * A module of its own, with no imports of its own, so it is initialized
 * before either side whatever order the module cycle between typeclass.ts
 * and instance-resolver.ts is entered in.
 */
import type * as ts from "typescript";
import type { MacroContext } from "@typesugar/core";

export type DerivedCallCheck = (ctx: MacroContext, decl: ts.VariableDeclaration) => boolean;

let check: DerivedCallCheck | undefined;

/** Install the check (called once, by typeclass.ts). */
export function setDerivedCallCheck(fn: DerivedCallCheck): void {
  check = fn;
}

/** The installed check, if typeclass.ts has been loaded. */
export function getDerivedCallCheck(): DerivedCallCheck | undefined {
  return check;
}
