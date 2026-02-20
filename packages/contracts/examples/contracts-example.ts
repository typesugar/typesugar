/**
 * @typesugar/contracts — Comprehensive Examples
 *
 * This file demonstrates the full capabilities of the Design by Contract
 * system, including what the prover can prove at compile time, what requires
 * runtime checks, and important edge cases to be aware of.
 *
 * KEY TAKEAWAYS:
 * 1. Refined types enable proof elision — Use Positive, Byte, etc. for compile-time guarantees
 * 2. old() captures by value for primitives, by reference for objects — Capture .length not the array
 * 3. Method calls always need runtime checks — .includes(), .startsWith(), etc.
 * 4. Property chains need runtime checks — obj.nested.value can't be proven
 * 5. Async/generics work — Contracts apply normally
 * 6. Multiple invariants compose — Each checked after every public method
 * 7. Z3 extends proof power — But WASM init is async, may miss first file
 */

/**
 * NOTE: This file demonstrates the INTENDED usage with the typesugar transformer.
 *
 * DECORATORS (@contract, @invariant):
 *   These are attribute macros recognized by the transformer during compilation.
 *   They don't need to be imported — the transformer matches them by name.
 *   The declarations below are stubs for TypeScript type-checking only.
 *
 * RUNTIME FUNCTIONS (requires, ensures, old):
 *   These ARE imported and work both with and without the transformer.
 *   Without the transformer: requires/ensures throw on false, old() is identity.
 *   With the transformer: converted to optimized checks or stripped entirely.
 *
 * TO RUN THIS EXAMPLE:
 *   Compile with typesugar transformer enabled (via ts-patch or tsup with plugin).
 */

// =============================================================================
// IMPORTANT: Enable Refined Types Integration
// =============================================================================
//
// Import @typesugar/contracts-refined to connect the contracts prover with
// the refinement types from @typesugar/type-system. This import:
//
// 1. Registers ALL built-in refinement predicates (Positive, Byte, Port, etc.)
// 2. Enables the prover to extract type facts from Refined<T, Brand> types
// 3. Single source of truth — predicates defined in type-system, used by contracts
//
// Without this import, the prover has NO knowledge of refined types!
// =============================================================================
import "@typesugar/contracts-refined";

import {
  requires,
  ensures,
  old,
  comptime,
  registerAlgebraicRule,
} from "@typesugar/contracts";
import { Positive, NonNegative, Port, Byte, NonEmpty } from "@typesugar/type-system";

// =============================================================================
// Decorator Stubs (for TypeScript type-checking without transformer)
// =============================================================================
// These are recognized by the typesugar transformer by name.
// The stubs allow this file to type-check in a regular IDE.

/**
 * @contract — Attribute macro enabling requires:/ensures: labeled blocks.
 * Applied to functions/methods to activate contract parsing.
 */
function contract<T extends Function>(
  target: T,
  context?: ClassMethodDecoratorContext,
): T {
  return target; // Stub: real implementation is compile-time
}

/**
 * @invariant — Class invariant decorator.
 * Inserts the predicate check after every public method and constructor.
 */
function invariant(
  predicate: (self: any) => boolean,
  message?: string,
): <T extends new (...args: any[]) => any>(target: T, context?: ClassDecoratorContext) => T {
  return (target) => target; // Stub: real implementation is compile-time
}

// =============================================================================
// SECTION 1: Basic Contracts (What Works)
// =============================================================================

console.log("=== Section 1: Basic Contracts ===\n");

// -----------------------------------------------------------------------------
// 1.1 Bank Account — Classic Design by Contract
// -----------------------------------------------------------------------------

/**
 * The canonical DbC example: a bank account with balance invariant.
 *
 * - @invariant ensures balance never goes negative
 * - deposit() has a precondition PROVEN by Positive type
 * - withdraw() has a precondition that needs RUNTIME check (involves this)
 * - Both have postconditions using old() to verify state changes
 */
@invariant((self: BankAccount) => self.balance >= 0, "Balance must be non-negative")
class BankAccount {
  balance = 0;

  /**
   * Deposit money into the account.
   * The `amount > 0` precondition is PROVEN at compile time because
   * `amount` has type `Positive`, and the prover knows Positive implies > 0.
   */
  @contract
  deposit(amount: Positive): void {
    requires: {
      amount > 0; // PROVEN: Positive type fact eliminates this check
    }
    ensures: {
      this.balance === old(this.balance) + amount;
    }
    this.balance += amount;
  }

  /**
   * Withdraw money from the account.
   * The `this.balance >= amount` precondition CANNOT be proven because
   * it involves `this` — a runtime value the prover can't reason about.
   */
  @contract
  withdraw(amount: Positive): void {
    requires: {
      this.balance >= amount; // RUNTIME: involves this.balance
    }
    ensures: {
      this.balance === old(this.balance) - amount;
    }
    this.balance -= amount;
  }

  /**
   * Transfer to another account — combines multiple contracts.
   */
  @contract
  transfer(to: BankAccount, amount: Positive): void {
    requires: {
      this.balance >= amount;
      this !== to; // Can't transfer to self
    }
    ensures: {
      this.balance === old(this.balance) - amount;
      to.balance === old(to.balance) + amount;
    }
    this.balance -= amount;
    to.balance += amount;
  }
}

// Demo
const alice = new BankAccount();
const bob = new BankAccount();
alice.deposit(Positive.refine(100));
alice.transfer(bob, Positive.refine(30));
console.log("Alice balance:", alice.balance); // 70
console.log("Bob balance:", bob.balance); // 30

// -----------------------------------------------------------------------------
// 1.2 Safe Division — Refined Type Proofs
// -----------------------------------------------------------------------------

/**
 * Division where the divide-by-zero check is PROVEN at compile time.
 * Because `divisor` is typed as `Positive`, the prover knows it's > 0.
 */
function safeDivide(dividend: number, divisor: Positive): number {
  requires(divisor > 0); // PROVEN: Positive type guarantees this
  return dividend / divisor;
}

console.log("\nSafe divide 10/2:", safeDivide(10, Positive.refine(2))); // 5

// -----------------------------------------------------------------------------
// 1.3 Arithmetic Propagation — Sum of Positives
// -----------------------------------------------------------------------------

/**
 * The prover can chain arithmetic facts:
 * - Positive + Positive > 0 (sum_of_positives rule)
 * - Positive * Positive > 0 (product_of_positives rule)
 */
function sumPositives(a: Positive, b: Positive): number {
  // All these are PROVEN at compile time:
  requires(a > 0); // PROVEN: identity (Positive → > 0)
  requires(b > 0); // PROVEN: identity
  ensures(a + b > 0); // PROVEN: sum_of_positives rule

  return a + b;
}

function multiplyPositives(a: Positive, b: Positive): number {
  ensures(a * b > 0); // PROVEN: product_of_positives rule
  return a * b;
}

console.log("Sum:", sumPositives(Positive.refine(3), Positive.refine(4))); // 7
console.log("Product:", multiplyPositives(Positive.refine(3), Positive.refine(4))); // 12

// =============================================================================
// SECTION 1.5: Compile-Time Evaluation with comptime()
// =============================================================================

console.log("\n=== Section 1.5: Compile-Time Evaluation ===\n");

/**
 * The comptime() macro evaluates expressions at build time and integrates
 * with the prover's constant evaluation layer. Use it for:
 *
 * - Complex constant computations (loops, recursion, array methods)
 * - Precomputed lookup tables
 * - Configuration values that should be inlined
 */

// -----------------------------------------------------------------------------
// 1.5.1 Basic Compile-Time Constants
// -----------------------------------------------------------------------------

/**
 * Simple compile-time computation.
 * After build: const BUFFER_SIZE = 16384;
 */
const BUFFER_SIZE = comptime(() => 1024 * 16);

/**
 * Factorial computed at build time.
 * After build: const FACTORIAL_10 = 3628800;
 */
const FACTORIAL_10 = comptime(() => {
  let result = 1;
  for (let i = 1; i <= 10; i++) result *= i;
  return result;
});

console.log("BUFFER_SIZE:", BUFFER_SIZE); // 16384
console.log("FACTORIAL_10:", FACTORIAL_10); // 3628800

// -----------------------------------------------------------------------------
// 1.5.2 Precomputed Lookup Tables
// -----------------------------------------------------------------------------

/**
 * Prime numbers up to 100, computed at build time.
 * After build: const PRIMES = [2, 3, 5, 7, 11, ...]
 */
const PRIMES = comptime(() => {
  const sieve = (n: number): number[] => {
    const isPrime = Array(n + 1).fill(true);
    isPrime[0] = isPrime[1] = false;
    for (let i = 2; i * i <= n; i++) {
      if (isPrime[i]) {
        for (let j = i * i; j <= n; j += i) {
          isPrime[j] = false;
        }
      }
    }
    return isPrime.map((p, i) => (p ? i : -1)).filter((x) => x > 0);
  };
  return sieve(100);
});

console.log("Primes up to 100:", PRIMES.length, "primes");

// -----------------------------------------------------------------------------
// 1.5.3 Contracts with Compile-Time Constants
// -----------------------------------------------------------------------------

/**
 * Using comptime() values in contracts allows the prover to reason
 * about the constant values at compile time.
 */
function allocateBuffer(size: number): ArrayBuffer {
  // The prover knows BUFFER_SIZE = 16384 from comptime evaluation
  requires(size > 0, "size must be positive");
  requires(size <= BUFFER_SIZE, "size exceeds maximum buffer size");
  return new ArrayBuffer(size);
}

function isPrime(n: number): boolean {
  requires(n > 0, "n must be positive");
  return PRIMES.includes(n);
}

console.log("allocateBuffer(1024):", allocateBuffer(1024).byteLength);
console.log("isPrime(17):", isPrime(17)); // true
console.log("isPrime(18):", isPrime(18)); // false

// -----------------------------------------------------------------------------
// 1.5.4 Configuration Constants
// -----------------------------------------------------------------------------

/**
 * Compile-time configuration values.
 * These become literal values in the output, enabling dead code elimination.
 */
const CONFIG = comptime(() => ({
  maxRetries: Math.min(10, 3 + 2),
  timeout: 30 * 1000,
  features: {
    logging: true,
    metrics: process?.env?.NODE_ENV !== "production",
  },
}));

console.log("CONFIG:", CONFIG);

// =============================================================================
// SECTION 2: Data Structure Invariants
// =============================================================================

console.log("\n=== Section 2: Data Structure Invariants ===\n");

// -----------------------------------------------------------------------------
// 2.1 Bounded Stack — Capacity Invariant
// -----------------------------------------------------------------------------

/**
 * A stack with a maximum capacity.
 * Demonstrates multiple invariants and method contracts.
 */
@invariant(
  (self: BoundedStack<unknown>) => self.items.length <= self.capacity,
  "Stack size must not exceed capacity",
)
@invariant(
  (self: BoundedStack<unknown>) => self.items.length >= 0,
  "Stack size must be non-negative",
)
class BoundedStack<T> {
  items: T[] = [];

  constructor(readonly capacity: number) {}

  get size(): number {
    return this.items.length;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  get isFull(): boolean {
    return this.items.length >= this.capacity;
  }

  /**
   * Push an item onto the stack.
   * Precondition: stack not full (RUNTIME check — involves this)
   * Postcondition: size increased by 1
   */
  @contract
  push(item: T): void {
    requires: {
      this.items.length < this.capacity; // RUNTIME: involves this
    }
    ensures: {
      this.items.length === old(this.items.length) + 1;
    }
    this.items.push(item);
  }

  /**
   * Pop an item from the stack.
   * Precondition: stack not empty (RUNTIME check)
   * Postcondition: size decreased by 1
   */
  @contract
  pop(): T {
    requires: {
      this.items.length > 0; // RUNTIME: involves this
    }
    ensures: {
      this.items.length === old(this.items.length) - 1;
    }
    return this.items.pop()!;
  }

  /**
   * Peek at the top item without removing it.
   */
  @contract
  peek(): T {
    requires: {
      this.items.length > 0;
    }
    return this.items[this.items.length - 1];
  }
}

// Demo
const stack = new BoundedStack<number>(3);
stack.push(1);
stack.push(2);
stack.push(3);
console.log("Stack full:", stack.isFull); // true
console.log("Popped:", stack.pop()); // 3
console.log("Top:", stack.peek()); // 2

// -----------------------------------------------------------------------------
// 2.2 Sorted Array — Complex Postconditions
// -----------------------------------------------------------------------------

/**
 * Helper to check if an array is sorted.
 */
function isSorted(arr: readonly number[]): boolean {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < arr[i - 1]) return false;
  }
  return true;
}

/**
 * Insert a value into a sorted array, maintaining sort order.
 *
 * IMPORTANT: These conditions CANNOT be proven at compile time because
 * they involve method calls (isSorted, includes). They become runtime checks.
 */
@contract
function insertSorted(arr: number[], value: number): number[] {
  requires: {
    isSorted(arr); // RUNTIME: method call
  }
  ensures: (result) => {
    result.length === arr.length + 1; // RUNTIME
    isSorted(result); // RUNTIME: method call
    result.includes(value); // RUNTIME: method call
  };

  // Binary search for insertion point
  let left = 0;
  let right = arr.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (arr[mid] < value) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  // Insert at the found position
  const result = [...arr];
  result.splice(left, 0, value);
  return result;
}

// Demo
const sorted = insertSorted([1, 3, 5, 7], 4);
console.log("\nInserted into sorted array:", sorted); // [1, 3, 4, 5, 7]

// =============================================================================
// SECTION 3: Edge Cases and Limitations
// =============================================================================

console.log("\n=== Section 3: Edge Cases and Limitations ===\n");

// -----------------------------------------------------------------------------
// 3.1 old() with Object Mutation — SHALLOW COPY WARNING
// -----------------------------------------------------------------------------

/**
 * WARNING: old() captures values, not deep copies!
 *
 * For objects and arrays, old() captures the REFERENCE at function entry.
 * If you mutate the object, the captured reference sees the mutation.
 */

interface Container {
  items: number[];
}

/**
 * BROKEN: old(obj.items) captures the array reference, not a copy.
 * After push(), both obj.items and old(obj.items) point to the same array,
 * so the length comparison is always true!
 */
@contract
function appendBroken(obj: Container, value: number): void {
  ensures: {
    // BUG: old(obj.items) is the SAME ARRAY as obj.items after mutation!
    // This check passes but doesn't verify what we intended.
    obj.items.length === old(obj.items).length + 1;
  }
  obj.items.push(value);
}

/**
 * CORRECT: Capture the LENGTH (a primitive), not the array reference.
 * Primitives are copied by value, so old(obj.items.length) captures
 * the numeric value at function entry.
 */
@contract
function appendCorrect(obj: Container, value: number): void {
  ensures: {
    // CORRECT: old() captures the primitive number value
    obj.items.length === old(obj.items.length) + 1;
  }
  obj.items.push(value);
}

// Demo
const container = { items: [1, 2, 3] };
console.log("Before append:", container.items.length); // 3
appendCorrect(container, 4);
console.log("After append:", container.items.length); // 4

// -----------------------------------------------------------------------------
// 3.2 old() with Primitives — Works Correctly
// -----------------------------------------------------------------------------

/**
 * For objects with primitive properties, old() works as expected
 * because it captures the primitive VALUE, not a reference.
 */
interface Counter {
  value: number;
}

@contract
function increment(counter: Counter): void {
  ensures: {
    counter.value === old(counter.value) + 1; // Works correctly!
  }
  counter.value++;
}

// Demo
const counter = { value: 10 };
increment(counter);
console.log("Incremented counter:", counter.value); // 11

// -----------------------------------------------------------------------------
// 3.3 What the Prover CANNOT Do
// -----------------------------------------------------------------------------

/**
 * The following conditions CANNOT be proven at compile time.
 * They will always generate runtime checks (unless stripped).
 */

// 1. Method calls in conditions — always runtime
function exampleMethodCall(arr: number[]): void {
  requires(arr.includes(5)); // RUNTIME: method call
  console.log("Array includes 5");
}

// 2. Property access chains — always runtime
function examplePropertyChain(obj: { nested: { value: number } }): void {
  requires(obj.nested.value > 0); // RUNTIME: property chain
  console.log("Nested value is positive");
}

// 3. Non-linear arithmetic — even Z3 may struggle
function exampleNonLinear(x: Positive, y: Positive): number {
  // x*x + y*y > 0 is TRUE but harder to prove without full SMT
  ensures(x * x + y * y > 0); // May need RUNTIME check
  return x * x + y * y;
}

// 4. Array indexing bounds — always runtime
function exampleArrayBounds(arr: number[], i: number): number {
  requires(i >= 0 && i < arr.length); // RUNTIME: involves arr.length
  return arr[i];
}

// 5. String operations — always runtime
function exampleStringOps(s: string): void {
  requires(s.length > 0); // RUNTIME: .length property access
  requires(s.startsWith("http")); // RUNTIME: method call
  console.log("Valid URL prefix");
}

// Demo
exampleMethodCall([1, 5, 10]);
examplePropertyChain({ nested: { value: 42 } });
console.log("Non-linear result:", exampleNonLinear(Positive.refine(3), Positive.refine(4))); // 25

// -----------------------------------------------------------------------------
// 3.4 Async Functions — Contracts Apply
// -----------------------------------------------------------------------------

/**
 * Contracts work on async functions.
 * Preconditions are checked before the async body starts.
 * Postconditions are checked when the promise resolves.
 */
@contract
async function fetchData(url: string): Promise<string> {
  requires: {
    url.length > 0; // RUNTIME
    url.startsWith("https://"); // RUNTIME: method call
  }
  ensures: (result) => {
    result.length > 0; // RUNTIME: checked on resolution
  };

  // Simulated fetch
  await new Promise((resolve) => setTimeout(resolve, 10));
  return `Data from ${url}`;
}

// Demo (async)
fetchData("https://example.com").then((data) => {
  console.log("\nAsync result:", data);
});

// -----------------------------------------------------------------------------
// 3.5 Generic Functions
// -----------------------------------------------------------------------------

/**
 * Generics work with contracts.
 * However, type facts are only extracted from CONCRETE Refined types,
 * not generic type parameters.
 */
@contract
function firstElement<T>(arr: T[]): T {
  requires: {
    arr.length > 0; // RUNTIME: can't prove without knowing array
  }
  return arr[0];
}

@contract
function lastElement<T>(arr: T[]): T {
  requires: {
    arr.length > 0;
  }
  ensures: (result) => {
    result !== undefined; // RUNTIME
  };
  return arr[arr.length - 1];
}

// Demo
console.log("\nFirst element:", firstElement([10, 20, 30])); // 10
console.log("Last element:", lastElement(["a", "b", "c"])); // "c"

// -----------------------------------------------------------------------------
// 3.6 Multiple Invariants Compose
// -----------------------------------------------------------------------------

/**
 * Multiple @invariant decorators compose — each is checked after
 * every public method and the constructor.
 */
@invariant((self: BoundedValue) => self.min <= self.max, "min must be <= max")
@invariant((self: BoundedValue) => self.value >= self.min, "value must be >= min")
@invariant((self: BoundedValue) => self.value <= self.max, "value must be <= max")
class BoundedValue {
  constructor(
    public value: number,
    public min: number,
    public max: number,
  ) {
    // All three invariants are checked here after construction
  }

  @contract
  setValue(newValue: number): void {
    requires: {
      newValue >= this.min;
      newValue <= this.max;
    }
    this.value = newValue;
    // All three invariants are checked here after the method
  }

  @contract
  clamp(newValue: number): void {
    ensures: {
      this.value >= this.min;
      this.value <= this.max;
    }
    this.value = Math.max(this.min, Math.min(this.max, newValue));
  }
}

// Demo
const bounded = new BoundedValue(50, 0, 100);
bounded.setValue(75);
console.log("\nBounded value:", bounded.value); // 75
bounded.clamp(150); // Clamped to 100
console.log("Clamped value:", bounded.value); // 100

// =============================================================================
// SECTION 4: Configuration and Stripping
// =============================================================================

console.log("\n=== Section 4: Configuration and Stripping ===\n");

// -----------------------------------------------------------------------------
// 4.1 Production Mode Demo
// -----------------------------------------------------------------------------

/**
 * Contract checks can be stripped for production builds.
 *
 * Configuration modes:
 * - "full": All checks emitted (default, for development)
 * - "assertions": Only @invariant checks emitted
 * - "none": All checks stripped (for production)
 *
 * Set via:
 * - Environment variable: TYPESUGAR_CONTRACTS_MODE=none
 * - Transformer config: { contracts: { mode: "none" } }
 */
function productionExample(x: number): number {
  // In mode="none", these become no-ops (void 0):
  requires(x > 0); // Stripped in production
  ensures(x * 2 > 0); // Stripped in production

  return x * 2;
}

/**
 * Fine-grained stripping allows keeping some checks:
 *
 * {
 *   contracts: {
 *     mode: "full",
 *     strip: {
 *       preconditions: true,   // Strip requires()
 *       postconditions: false, // Keep ensures()
 *       invariants: false      // Keep @invariant
 *     }
 *   }
 * }
 */

console.log("Production example:", productionExample(5)); // 10

// -----------------------------------------------------------------------------
// 4.2 Custom Proof Rules
// -----------------------------------------------------------------------------

/**
 * You can extend the prover with domain-specific rules.
 * This is useful when you have knowledge the prover doesn't have built-in.
 */

// Register a custom rule: Percentage type is always 0-100
registerAlgebraicRule({
  name: "percentage_upper_bound",
  description: "Percentage <= 100",
  match(goal, facts) {
    const m = goal.match(/^(\w+)\s*<=\s*100$/);
    if (!m) return false;
    return facts.some(
      (f) => f.variable === m[1] && f.predicate.includes("Percentage"),
    );
  },
});

registerAlgebraicRule({
  name: "percentage_lower_bound",
  description: "Percentage >= 0",
  match(goal, facts) {
    const m = goal.match(/^(\w+)\s*>=\s*0$/);
    if (!m) return false;
    return facts.some(
      (f) => f.variable === m[1] && f.predicate.includes("Percentage"),
    );
  },
});

console.log("Custom rules registered for Percentage type");

// =============================================================================
// SECTION 5: Integration with Refined Types
// =============================================================================

console.log("\n=== Section 5: Integration with Refined Types ===\n");

// -----------------------------------------------------------------------------
// 5.1 Zero-Check Elimination
// -----------------------------------------------------------------------------

/**
 * When parameters have Refined types, the prover extracts "type facts"
 * that can eliminate runtime checks entirely.
 *
 * Built-in type facts:
 * - Positive: $ > 0
 * - NonNegative: $ >= 0
 * - Byte: $ >= 0 && $ <= 255
 * - Port: $ >= 1 && $ <= 65535
 * - And more...
 */

// All these preconditions are PROVEN at compile time:
function processPort(port: Port): void {
  requires(port >= 1); // PROVEN: Port type guarantees >= 1
  requires(port <= 65535); // PROVEN: Port type guarantees <= 65535
  console.log(`Processing port ${port}`);
}

function processByte(byte: Byte): void {
  requires(byte >= 0); // PROVEN: Byte type guarantees >= 0
  requires(byte <= 255); // PROVEN: Byte type guarantees <= 255
  console.log(`Processing byte ${byte}`);
}

function processPositive(n: Positive): void {
  requires(n > 0); // PROVEN: Positive identity
  requires(n >= 0); // PROVEN: positive_implies_non_negative rule
  console.log(`Processing positive ${n}`);
}

// Demo
processPort(Port.refine(8080));
processByte(Byte.refine(255));
processPositive(Positive.refine(42));

// -----------------------------------------------------------------------------
// 5.2 Proof Propagation
// -----------------------------------------------------------------------------

/**
 * The prover can chain multiple facts together using algebraic rules.
 * This allows proving compound conditions from individual type facts.
 */
function compound(a: Positive, b: Positive): void {
  // These are all PROVEN at compile time through rule chaining:
  requires(a > 0); // PROVEN: identity (Positive → > 0)
  requires(b > 0); // PROVEN: identity (Positive → > 0)
  requires(a + b > 0); // PROVEN: sum_of_positives (a > 0 ∧ b > 0 → a + b > 0)
  requires(a * b > 0); // PROVEN: product_of_positives (a > 0 ∧ b > 0 → a * b > 0)
  requires(a >= 0); // PROVEN: positive_implies_non_negative (a > 0 → a >= 0)
  requires(b >= 0); // PROVEN: positive_implies_non_negative

  console.log(`Compound: a=${a}, b=${b}, sum=${a + b}, product=${a * b}`);
}

// Demo
compound(Positive.refine(7), Positive.refine(3));

// -----------------------------------------------------------------------------
// 5.3 Creating Refined Outputs
// -----------------------------------------------------------------------------

/**
 * When a function returns a Refined type, postconditions can help
 * document and verify the refinement is valid.
 */
function absoluteValue(n: number): NonNegative {
  ensures(Math.abs(n) >= 0); // RUNTIME: Math.abs is a method call
  return NonNegative.refine(Math.abs(n));
}

function clampToPort(n: number): Port {
  const clamped = Math.max(1, Math.min(65535, n));
  return Port.refine(clamped);
}

// Demo
console.log("\nAbsolute value of -5:", absoluteValue(-5));
console.log("Clamped to port range:", clampToPort(100000)); // 65535

// =============================================================================
// SECTION 6: Coq-Inspired Extensions
// =============================================================================

console.log("\n=== Section 6: Coq-Inspired Extensions ===\n");

// Import additional Coq-inspired APIs
import {
  registerDecidability,
  getDecidability,
  canProveAtCompileTime,
  mustCheckAtRuntime,
  registerSubtypingRule,
  canWiden,
  getSubtypingRule,
  trySimpleLinearProof,
  createCertificate,
  succeedCertificate,
  failCertificate,
  addStep,
  formatCertificate,
  type TypeFact,
  type ProofCertificate,
} from "@typesugar/contracts";

// -----------------------------------------------------------------------------
// 6.1 Decidability Annotations
// -----------------------------------------------------------------------------

/**
 * Decidability annotations tell the prover what strategy to use and
 * warn when proofs fall back to runtime unexpectedly.
 */

// Register decidability for custom brands
registerDecidability({
  brand: "AlwaysProvable",
  predicate: "$ === 42",  // Trivially constant
  decidability: "compile-time",
  preferredStrategy: "constant",
});

registerDecidability({
  brand: "NeedsRuntime",
  predicate: "validateAtRuntime($)",  // External function
  decidability: "runtime",
});

registerDecidability({
  brand: "MayNeedSMT",
  predicate: "$ * $ + 1 > 0",  // Non-linear, decidable via SMT
  decidability: "decidable",
  preferredStrategy: "z3",
});

// Query decidability
const alwaysProvable = getDecidability("AlwaysProvable");
const needsRuntime = getDecidability("NeedsRuntime");

console.log("AlwaysProvable decidability:", alwaysProvable?.decidability);  // "compile-time"
console.log("NeedsRuntime decidability:", needsRuntime?.decidability);      // "runtime"

// Check if compile-time proofs are expected
console.log(
  "Can prove AlwaysProvable at compile time:",
  alwaysProvable ? canProveAtCompileTime(alwaysProvable.decidability) : false
);  // true

console.log(
  "Must check NeedsRuntime at runtime:",
  needsRuntime ? mustCheckAtRuntime(needsRuntime.decidability) : false
);  // true

// -----------------------------------------------------------------------------
// 6.2 Subtyping Rules
// -----------------------------------------------------------------------------

/**
 * Subtyping rules define safe coercions between related refined types.
 * When the prover needs to show "x: Positive satisfies NonNegative",
 * it can use the subtyping rule instead of re-proving from scratch.
 */

// Register a custom subtyping rule
registerSubtypingRule({
  from: "StrictlyPositive",
  to: "Positive",
  proof: "strictly_positive_is_positive",
  justification: "x > 1 implies x > 0",
});

registerSubtypingRule({
  from: "Positive",
  to: "NonZero",
  proof: "positive_is_nonzero",
  justification: "x > 0 implies x !== 0",
});

// Query subtyping
console.log("\nCan widen StrictlyPositive to Positive:", canWiden("StrictlyPositive", "Positive"));  // true
console.log("Can widen Positive to NonZero:", canWiden("Positive", "NonZero"));  // true
console.log("Can widen NonZero to Positive:", canWiden("NonZero", "Positive"));  // false

// Get rule details
const rule = getSubtypingRule("StrictlyPositive", "Positive");
if (rule) {
  console.log("Subtyping rule:", rule.proof, "-", rule.justification);
}

// -----------------------------------------------------------------------------
// 6.3 Linear Arithmetic Solver
// -----------------------------------------------------------------------------

/**
 * The linear arithmetic solver proves linear inequalities using
 * Fourier-Motzkin elimination. For common patterns, trySimpleLinearProof
 * provides fast pattern-based proofs.
 */

// Example: Prove x + y >= 0 given x > 0 and y >= 0
const facts: TypeFact[] = [
  { variable: "x", predicate: "x > 0" },
  { variable: "y", predicate: "y >= 0" },
];

const linearResult = trySimpleLinearProof("x + y >= 0", facts);
console.log("\nLinear proof for 'x + y >= 0':");
console.log("  Proven:", linearResult.proven);  // true
console.log("  Method:", linearResult.method);  // "linear"
console.log("  Reason:", linearResult.reason);  // "sum of non-negative..."

// Example: Transitivity
const transitivityFacts: TypeFact[] = [
  { variable: "a", predicate: "a > b" },
  { variable: "b", predicate: "b > c" },
];
const transitivityResult = trySimpleLinearProof("a > c", transitivityFacts);
console.log("\nTransitivity proof for 'a > c' given a > b, b > c:");
console.log("  Proven:", transitivityResult.proven);  // true

// Example: Sum of positives
const sumPosFacts: TypeFact[] = [
  { variable: "x", predicate: "x > 0" },
  { variable: "y", predicate: "y > 0" },
];
const sumPosResult = trySimpleLinearProof("x + y > 0", sumPosFacts);
console.log("\nSum of positives proof:");
console.log("  Proven:", sumPosResult.proven);  // true

// -----------------------------------------------------------------------------
// 6.4 Proof Certificates
// -----------------------------------------------------------------------------

/**
 * Proof certificates capture the proof trace for debugging and auditing.
 * They record the goal, assumptions, steps taken, and final outcome.
 */

// Create a certificate for a goal
const assumptions: TypeFact[] = [
  { variable: "amount", predicate: "amount: Positive" },
];
let cert: ProofCertificate = createCertificate("amount > 0", assumptions);

console.log("\n--- Proof Certificate Example ---");
console.log("Initial certificate:");
console.log(formatCertificate(cert));

// Add a proof step
cert = addStep(cert, {
  rule: "type_identity",
  description: "Extract type fact from Positive",
  justification: "amount: Positive implies amount > 0",
  usedFacts: assumptions,
  subgoals: [],
});

// Mark the proof as successful
cert = succeedCertificate(cert, "type", {
  rule: "type_identity",
  description: "Proven by type deduction",
});

console.log("\nCompleted certificate:");
console.log(formatCertificate(cert));

// Example of a failed proof
let failedCert = createCertificate("x > 1000", [
  { variable: "x", predicate: "x: Positive" },
]);
failedCert = failCertificate(failedCert, "Positive only guarantees x > 0, not x > 1000");

console.log("\nFailed certificate:");
console.log(formatCertificate(failedCert));

// -----------------------------------------------------------------------------
// 6.5 Putting It Together: Check Elision Decision Flow
// -----------------------------------------------------------------------------

/**
 * Here's how the prover decides whether to elide a runtime check:
 *
 * 1. Extract type facts from function parameters
 * 2. Try constant evaluation (is condition statically known?)
 * 3. Try type deduction (does a type fact match the goal?)
 * 4. Try algebraic rules (do known patterns apply?)
 * 5. Try linear arithmetic (can FM elimination prove it?)
 * 6. Try prover plugins (Z3 SMT solver)
 * 7. If all fail and decidability is "compile-time", emit warning
 * 8. If all fail, emit runtime check
 *
 * Subtyping rules are used in step 3 when a wider type is needed.
 * Decidability annotations control warning behavior in step 7.
 */

function elisionDemoWithRefinedTypes(x: Positive, y: NonNegative): number {
  // PROVEN via type deduction (step 3):
  requires(x > 0);       // x: Positive → x > 0

  // PROVEN via subtyping + type deduction (step 3):
  requires(x >= 0);      // Positive widens to NonNegative → x >= 0

  // PROVEN via linear arithmetic (step 5):
  requires(x + y >= 0);  // x > 0, y >= 0 → x + y >= 0 by sum_nonneg

  // RUNTIME: Cannot prove upper bound
  // (would trigger decidability warning if x were marked compile-time decidable)
  requires(x < 1000000);

  return x + y;
}

console.log("\nElision demo result:", elisionDemoWithRefinedTypes(
  Positive.refine(10),
  NonNegative.refine(5)
));  // 15

// =============================================================================
// Summary
// =============================================================================

console.log("\n=== Summary ===");
console.log(`
INTEGRATION:
  import "@typesugar/contracts-refined";  // Enable refined types integration
  
  This import is REQUIRED to connect contracts with type-system.
  Without it, the prover has no knowledge of Positive, Byte, Port, etc.

What the prover CAN prove (compile-time elimination):
  - Refined type bounds (Positive → > 0, Byte → 0-255, Port → 1-65535)
  - Sum/product of positives is positive
  - Positive implies non-negative
  - Static constants (literal true)
  - Identity facts (x > 0 when x: Positive)
  - Linear inequalities via Fourier-Motzkin
  - Transitivity chains (a > b ∧ b > c → a > c)

What REQUIRES runtime checks:
  - Method calls (.includes(), .startsWith(), .length)
  - Property chains (obj.nested.value)
  - Conditions involving 'this'
  - Array indexing bounds
  - Non-linear arithmetic (sometimes)
  - Any condition the prover can't pattern-match

Coq-inspired extensions (Phase 4):
  - Decidability annotations — Control proof strategy, warn on fallback
  - Subtyping rules — Auto-widen related types (Positive → NonNegative)
  - Linear arithmetic solver — Fourier-Motzkin for inequalities
  - Proof certificates — Structured traces for debugging

Edge cases to remember:
  - old() captures primitives by value, objects by reference
  - Async functions work — checks at entry and resolution
  - Generics work — but no type facts from generic params
  - Multiple invariants all checked after each method
  - Z3 extends proof power but has async init delay

Package architecture:
  @typesugar/type-system       — Defines Refined<T, Brand> types + predicates
  @typesugar/contracts         — Contract macros + prover (no built-in predicates)
  @typesugar/contracts-refined — Bridges the two (import to activate)
  @typesugar/contracts-z3      — Optional Z3 SMT solver plugin
`);
