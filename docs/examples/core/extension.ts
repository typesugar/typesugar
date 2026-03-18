//! Extension Methods
//! Import-scoped method activation (Scala 3 model)

// Extensions activate when you import the function — no import, no method.
// The transformer rewrites n.clamp(0, 100) → clamp(n, 0, 100).
// No prototype mutation. Zero runtime cost.
import { clamp, isEven, isPrime, toHex, toRoman } from "@typesugar/std";
import { capitalize, kebabCase, reverse, isPalindrome } from "@typesugar/std";

// Number extensions — dot-syntax on primitives
const score = (95).clamp(0, 100);
const primes = [2, 3, 4, 5, 6, 7].filter(n => n.isPrime());
const hexColor = (255).toHex();

console.log("score:", score);
console.log("primes:", primes);
console.log("hex 255:", hexColor);
console.log("42 even?", (42).isEven());
console.log("7 roman:", (7).toRoman());

// String extensions — same pattern
const title = "hello world".capitalize();
const slug = "My Blog Post Title".kebabCase();
const reversed = "typesugar".reverse();

console.log("title:", title);
console.log("slug:", slug);
console.log("reversed:", reversed);
console.log("racecar palindrome?", "racecar".isPalindrome());

// 👀 Check JS Output — every .method() becomes a function call.
//    Number.prototype and String.prototype are untouched!
// Try: remove an import and watch the method call disappear
