//! comptime
//! Evaluate code at compile time — results are inlined as literals

import { comptime, staticAssert } from "typesugar";

// comptime() evaluates its argument at BUILD TIME
// The result is inlined into the output as a literal — zero runtime cost

// Build metadata — frozen at compile time
const buildDate = comptime(() => new Date().toISOString().split("T")[0]);
const buildId = comptime(() => Math.random().toString(36).slice(2, 8));

// 👀 Check JS Output — these become string literals, not function calls!
console.log("Built on:", buildDate);
console.log("Build ID:", buildId);

// Lookup table generation — computed once at compile time
const PRIMES_UNDER_50 = comptime(() => {
  const primes: number[] = [];
  for (let n = 2; n < 50; n++) {
    let isPrime = true;
    for (let d = 2; d * d <= n; d++) {
      if (n % d === 0) { isPrime = false; break; }
    }
    if (isPrime) primes.push(n);
  }
  return primes;
});
console.log("Primes < 50:", PRIMES_UNDER_50);
console.log("Count:", PRIMES_UNDER_50.length); // 15

// Config validation — catch mistakes at compile time, not runtime
const HTTP_METHODS = comptime(() => ["GET", "POST", "PUT", "DELETE", "PATCH"]);
staticAssert(HTTP_METHODS.includes("GET"), "GET must be supported");
staticAssert(HTTP_METHODS.length > 0, "need at least one HTTP method");
console.log("HTTP methods:", HTTP_METHODS.join(", "));

// Compile-time string processing
const API_PREFIX = comptime(() => "/api/v" + Math.max(1, 2, 3));
console.log("API prefix:", API_PREFIX);

// Try: add comptime(() => fibonacci(10)) and watch the result get inlined
