# @typesugar/contracts

> 📖 **Full documentation:** [Design by Contract guide](https://typesugar.org/guides/contracts). The microsite is the canonical reference; this README is a quickstart.

Eiffel/Dafny-style Design by Contract for TypeScript, with a multi-layer proof engine that eliminates runtime checks when conditions can be proven at compile time.

## Installation

```bash
npm install @typesugar/contracts
```

## Quick Start

```typescript
import { old } from "@typesugar/contracts";
import { Positive } from "@typesugar/type-system";

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
```

## Documentation

- [Design by Contract guide](https://typesugar.org/guides/contracts) — full reference
- [Refined Contracts guide](https://typesugar.org/guides/contracts-refined) — bridging contracts with refined types
