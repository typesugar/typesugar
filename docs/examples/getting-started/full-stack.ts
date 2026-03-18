//! Full Stack — Everything Together
//! comptime + @operators + @opaque + ops + match + pipe in 30 lines

import { comptime, staticAssert, operators, ops, pipe } from "typesugar";
import { match } from "@typesugar/std";
import { Some, None } from "@typesugar/fp";
import type { Option } from "@typesugar/fp";

const VERSION = comptime(() => "1.0.0");
staticAssert(VERSION.startsWith("1."), "expected v1.x");

@operators({ "+": "add", "==": "equals" })
class Money {
  constructor(public cents: number, public currency: string) {}
  add(o: Money): Money { return new Money(this.cents + o.cents, this.currency); }
  equals(o: Money): boolean { return this.cents === o.cents && this.currency === o.currency; }
  toString(): string { return `${(this.cents / 100).toFixed(2)} ${this.currency}`; }
}

type Status = { kind: "paid"; amount: Money } | { kind: "pending" } | { kind: "failed"; reason: string };

function describe(s: Status): string {
  return match(s)
    .case({ kind: "paid", amount: a }).then(`Paid ${a}`)
    .case({ kind: "pending" }).then("Awaiting payment")
    .case({ kind: "failed", reason: r }).then(`Failed: ${r}`)
    .else("unknown");
}

const price = new Money(1999, "USD");
const tax = new Money(160, "USD");
const total = ops(price + tax);

// @opaque: Some(x) IS x, None IS null — dot-syntax compiles to null checks
const discount: Option<Money> = Some(new Money(500, "USD"));
const final = discount.map(d => new Money(total.cents - d.cents, total.currency)).getOrElse(() => total);

// 👀 Check JS Output — 6 features compile away: comptime, staticAssert, @operators, ops, match, @opaque
console.log(pipe(final.toString(), s => `Total: ${s} (v${VERSION})`));
console.log(describe({ kind: "paid", amount: final }));
console.log("price == price?", ops(price == price));

// Try: change discount to None and watch the output adapt
