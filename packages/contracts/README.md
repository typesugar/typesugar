# @typesugar/contracts

> 📖 **Full documentation:** [Design by Contract guide](https://typesugar.org/guides/contracts). The microsite is the canonical reference; this README is a quickstart.

Eiffel/Dafny-style Design by Contract for TypeScript, with a multi-layer proof engine that eliminates runtime checks when conditions can be proven at compile time.

## Installation

```bash
npm install @typesugar/contracts
```

## Quick Start

```typescript
import "@typesugar/contracts/syntax"; // turns on requires: / ensures: blocks in this file
import { old } from "@typesugar/contracts";
import { Positive } from "@typesugar/type-system";

interface Account {
  balance: number;
}

function withdraw(account: Account, amount: Positive): number {
  requires: {
    (account.balance >= amount, "Insufficient funds");
  }
  ensures: {
    account.balance === old(account.balance) - amount;
  }
  account.balance -= amount;
  return account.balance;
}

const acc: Account = { balance: 10 };
withdraw(acc, 3 as Positive); // 7
withdraw(acc, 100 as Positive); // throws PreconditionError: Insufficient funds
```

Without the `@typesugar/contracts/syntax` import, `requires:` and `ensures:` are plain
labels: the checks don't run, and the compiler only warns (TS9224).

## Documentation

- [Design by Contract guide](https://typesugar.org/guides/contracts) — full reference
- [Refined Contracts guide](https://typesugar.org/guides/contracts-refined) — bridging contracts with refined types
