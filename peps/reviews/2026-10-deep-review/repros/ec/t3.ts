import { invariant } from "@typesugar/contracts";

@invariant((self) => self.balance >= 0, "Balance must be non-negative")
export class BankAccount {
  balance = 0;
  withdraw(amount: number): number {
    this.balance -= amount;
    return this.balance;
  }
  static create(): BankAccount { return new BankAccount(); }
  static reset(): void { }
  set raw(v: number) { this.balance = v; }
}
