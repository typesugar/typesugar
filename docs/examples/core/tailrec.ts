//! @tailrec
//! Tail call optimization

import { tailrec } from "typesugar";

// 👀 Check JS Output to see the zero-cost compilation — recursion becomes a while loop!
// @tailrec transforms recursive functions into efficient iteration.
// This prevents stack overflow for deep recursion!

@tailrec
function factorial(n: bigint, acc: bigint = 1n): bigint {
  if (n <= 1n) return acc;
  return factorial(n - 1n, n * acc);
}

@tailrec
function fibonacci(n: bigint, a: bigint = 0n, b: bigint = 1n): bigint {
  if (n === 0n) return a;
  if (n === 1n) return b;
  return fibonacci(n - 1n, b, a + b);
}

console.log("20! =", factorial(20n));
console.log("Fib(10) =", fibonacci(10n));      // 55n
console.log("Fib(100) =", fibonacci(100n));    // 354224848179261915075n

// Without @tailrec these would stack overflow:
console.log("Fib(10000) digit count:", fibonacci(10000n).toString().length);

// Try: write a @tailrec gcd(a, b) and test with gcd(48n, 18n)
