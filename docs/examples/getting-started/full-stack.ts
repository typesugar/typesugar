//! Full Stack — Everything Together
//! comptime + @adt + match + @typeclass + @opaque + pipe

import { comptime, staticAssert, pipe } from "typesugar";
import { match } from "@typesugar/std";
import { Some, None } from "@typesugar/fp";
import type { Option } from "@typesugar/fp";

const VERSION = comptime(() => "1.0.0");
staticAssert(VERSION.startsWith("1."), "expected v1.x");

class Money {
  constructor(public cents: number, public currency: string) {}
  toString(): string { return `${(this.cents / 100).toFixed(2)} ${this.currency}`; }
}

/** @typeclass */
interface Addable<A> {
  /** @op + */
  add(a: A, b: A): A;
}

/** @typeclass */
interface Eqable<A> {
  /** @op == */
  equals(a: A, b: A): boolean;
}

/** @impl Addable<Money> */
const addableMoney: Addable<Money> = {
  add: (a, b) => new Money(a.cents + b.cents, a.currency),
};

/** @impl Eqable<Money> */
const eqableMoney: Eqable<Money> = {
  equals: (a, b) => a.cents === b.cents && a.currency === b.currency,
};

// @adt generates constructors (Paid, Pending, Failed) and type guards (isPaid, etc.)
interface Paid { amount: Money }
interface Pending {}
interface Failed { reason: string }

/** @adt */
type Status = Paid | Pending | Failed;

function describe(s: Status): string {
  return match(s)
    .case({ amount: a }).then(`Paid ${a}`)
    .case({ reason: r }).then(`Failed: ${r}`)
    .else("Awaiting payment");
}

const price = new Money(1999, "USD");
const tax = new Money(160, "USD");
const total = price + tax; // @op: compiles to addableMoney.add(price, tax)

// @opaque: Some(x) erases to x, .map/.getOrElse compile to null-checking functions
const discount: Option<Money> = Some(new Money(500, "USD"));
const final = discount.map(d => new Money(total.cents - d.cents, total.currency)).getOrElse(() => total);

// 👀 Check JS Output — comptime, staticAssert, match, @typeclass operators, @opaque all compile away
console.log(pipe(final.toString(), s => `Total: ${s} (v${VERSION})`));
console.log(describe(Paid(final)));
console.log("price == price?", price == price); // @op: compiles to eqableMoney.equals(price, price)

// Try: change Paid(final) to Failed("timeout") or Pending() and watch the output adapt
