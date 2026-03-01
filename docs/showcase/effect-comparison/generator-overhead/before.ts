/**
 * Generator Overhead Example — Plain Effect.gen
 *
 * This example demonstrates the runtime overhead of Effect.gen's generator
 * protocol, especially in hot paths with deep nesting.
 *
 * Generator overhead includes:
 * - Iterator object allocation for each Effect.gen call
 * - .next() method calls for each yield*
 * - State machine maintenance in the generator
 * - Closure allocation for the generator function
 */

import { Effect, pipe } from "effect";

// ============================================================================
// Domain Types
// ============================================================================

interface Config {
  apiKey: string;
  baseUrl: string;
  timeout: number;
}

interface User {
  id: string;
  name: string;
  email: string;
}

interface Account {
  id: string;
  userId: string;
  balance: number;
}

interface Transaction {
  id: string;
  accountId: string;
  amount: number;
  timestamp: Date;
}

// Mock services (would be real in production)
const Config = {
  get: Effect.succeed<Config>({
    apiKey: "test-key",
    baseUrl: "https://api.example.com",
    timeout: 5000,
  }),
};

const UserService = {
  findById: (id: string) =>
    Effect.succeed<User>({
      id,
      name: "Test User",
      email: "test@example.com",
    }),
  findByEmail: (email: string) =>
    Effect.succeed<User | null>(
      email === "test@example.com"
        ? { id: "user_1", name: "Test User", email }
        : null
    ),
};

const AccountService = {
  findByUserId: (userId: string) =>
    Effect.succeed<Account>({
      id: `acc_${userId}`,
      userId,
      balance: 1000,
    }),
  updateBalance: (accountId: string, amount: number) =>
    Effect.succeed<Account>({
      id: accountId,
      userId: "user_1",
      balance: amount,
    }),
};

const TransactionService = {
  create: (accountId: string, amount: number) =>
    Effect.succeed<Transaction>({
      id: `txn_${Date.now()}`,
      accountId,
      amount,
      timestamp: new Date(),
    }),
  findByAccount: (accountId: string) =>
    Effect.succeed<Transaction[]>([
      { id: "txn_1", accountId, amount: 100, timestamp: new Date() },
      { id: "txn_2", accountId, amount: -50, timestamp: new Date() },
    ]),
};

// ============================================================================
// Business Logic with Effect.gen — Generator Overhead
// ============================================================================

// Simple example: 3 yields = 3 .next() calls + 1 iterator object
const getConfiguredUser = (userId: string) =>
  Effect.gen(function* () {
    const config = yield* Config.get;
    const user = yield* UserService.findById(userId);
    return { config, user };
  });
// Runtime behavior:
// 1. Create generator function instance (allocation)
// 2. Create iterator object from generator (allocation)
// 3. Call iterator.next() → runs to first yield*
// 4. Call iterator.next(config) → runs to second yield*
// 5. Call iterator.next(user) → runs to return
// Total: 2 allocations + 3 method calls

// More complex: nested generators compound the overhead
const getUserWithAccount = (userId: string) =>
  Effect.gen(function* () {
    // This yield* creates its own generator + iterator
    const { config, user } = yield* getConfiguredUser(userId);

    // Another effect chain
    const account = yield* AccountService.findByUserId(userId);
    const transactions = yield* TransactionService.findByAccount(account.id);

    return { config, user, account, transactions };
  });
// Runtime behavior:
// Outer generator: 1 allocation + 4 .next() calls
// Inner getConfiguredUser: 1 allocation + 3 .next() calls
// Total: 4 allocations + 7 method calls

// Deep nesting: even more overhead
const processPayment = (
  userId: string,
  amount: number
) =>
  Effect.gen(function* () {
    // Nested generators compound
    const { user, account } = yield* getUserWithAccount(userId)
      .pipe(Effect.map(({ user, account }) => ({ user, account })));

    // Validate balance
    if (account.balance < amount) {
      return yield* Effect.fail(new Error("Insufficient funds"));
    }

    // Create transaction
    const transaction = yield* TransactionService.create(account.id, -amount);

    // Update balance
    const newBalance = account.balance - amount;
    const updatedAccount = yield* AccountService.updateBalance(
      account.id,
      newBalance
    );

    return { user, transaction, updatedAccount };
  });
// This has even more nesting — we're now at:
// - 6+ allocations
// - 12+ .next() calls
// For a single payment operation!

// ============================================================================
// Pipeline-Heavy Code — More Allocations
// ============================================================================

// Each Effect.map/flatMap creates an intermediate Effect object
const transformUserData = (userId: string) =>
  pipe(
    UserService.findById(userId),
    Effect.map((user) => ({ ...user, displayName: user.name.toUpperCase() })),
    Effect.map((user) => ({ ...user, initials: user.name.split(" ").map(n => n[0]).join("") })),
    Effect.map((user) => ({ ...user, slug: user.name.toLowerCase().replace(/\s+/g, "-") })),
    Effect.flatMap((user) =>
      AccountService.findByUserId(user.id).pipe(
        Effect.map((account) => ({ user, account }))
      )
    )
  );
// 4 intermediate Effect objects allocated
// Each map/flatMap is a function call wrapping the previous

// Combining generators with pipes — maximum overhead
const fullUserProfile = (userId: string) =>
  Effect.gen(function* () {
    // Generator overhead
    const user = yield* UserService.findById(userId);
    const account = yield* AccountService.findByUserId(userId);

    // Pipeline overhead (intermediate Effects)
    const enrichedUser = yield* pipe(
      Effect.succeed(user),
      Effect.map((u) => ({ ...u, accountId: account.id })),
      Effect.map((u) => ({ ...u, balance: account.balance })),
      Effect.map((u) => ({ ...u, hasPositiveBalance: account.balance > 0 }))
    );

    // More generator overhead
    const transactions = yield* TransactionService.findByAccount(account.id);

    return {
      ...enrichedUser,
      transactionCount: transactions.length,
      recentTransactions: transactions.slice(0, 5),
    };
  });

// ============================================================================
// Hot Path Example — Where Overhead Matters Most
// ============================================================================

// Imagine this runs 10,000 times per second
const validateAndProcessRequest = (requestData: {
  userId: string;
  action: string;
  payload: unknown;
}) =>
  Effect.gen(function* () {
    // Step 1: Load config
    const config = yield* Config.get;

    // Step 2: Authenticate user
    const user = yield* UserService.findById(requestData.userId);

    // Step 3: Load account
    const account = yield* AccountService.findByUserId(user.id);

    // Step 4: Validate action
    if (requestData.action === "payment" && typeof requestData.payload === "number") {
      const amount = requestData.payload;
      if (account.balance < amount) {
        return yield* Effect.fail(new Error("Insufficient funds"));
      }

      // Step 5: Process payment
      const transaction = yield* TransactionService.create(account.id, -amount);

      // Step 6: Update balance
      const updatedAccount = yield* AccountService.updateBalance(
        account.id,
        account.balance - amount
      );

      return { success: true, transaction, account: updatedAccount };
    }

    return { success: true, user, account };
  });

// At 10,000 req/s:
// - ~60,000 .next() calls per second (6 yields × 10k)
// - ~10,000 iterator objects allocated per second
// - Significant GC pressure

// ============================================================================
// Benchmark
// ============================================================================

async function benchmarkGeneratorOverhead(iterations: number): Promise<void> {
  console.log(`Running ${iterations} iterations of validateAndProcessRequest...`);

  const testRequest = {
    userId: "user_1",
    action: "view",
    payload: null,
  };

  console.time("Effect.gen (with generator overhead)");
  for (let i = 0; i < iterations; i++) {
    await Effect.runPromise(validateAndProcessRequest(testRequest));
  }
  console.timeEnd("Effect.gen (with generator overhead)");
}

// Run: benchmarkGeneratorOverhead(10000);
// Typical result: ~150-200ms for 10k iterations

export {
  getConfiguredUser,
  getUserWithAccount,
  processPayment,
  transformUserData,
  fullUserProfile,
  validateAndProcessRequest,
  benchmarkGeneratorOverhead,
};
