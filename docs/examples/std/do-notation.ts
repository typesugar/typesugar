//! Do-Notation
//! let:/yield: desugars to flatMap/then chains

// let:/yield: is monadic do-notation that works with any FlatMap type.
// << binds a monadic value, = does pure computation.
// The macro desugars to flatMap/map chains at compile time.

// Array comprehensions — let: desugars to .flatMap()/.map()
// Cartesian product of numbers and letters:
let: {
  x << [1, 2, 3];
  y << ["a", "b"];
}
yield: { `${x}${y}` }
// Compiles to: [1,2,3].flatMap(x => ["a","b"].map(y => `${x}${y}`))

// Pythagorean triples — nested arrays with filtering
let: {
  a << [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  b << [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  c << [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  if (a * a + b * b === c * c && a <= b) {}
}
yield: { [a, b, c] }
// Compiles to: nested flatMap with ternary guard

// Pure map step — intermediate computation without binding
let: {
  x << [1, 2, 3];
  doubled = x * 2;
  y << [doubled + 1, doubled + 2];
}
yield: { y }
// Compiles to: .flatMap(x => ((doubled) => [...].map(y => y))(x * 2))

// Promise do-notation — seq: desugars to .then() chains
// seq: {
//   response << fetch("/api/user");
//   data << response.json();
//   name = data.name;
// }
// yield: { `Hello, ${name}` }
// Compiles to: fetch(...).then(response => response.json().then(data => ...))

// 👀 Check JS Output — let:/yield: becomes .flatMap()/.map() chains
console.log("Do-notation examples compiled successfully");
// Try: add a guard `if (x > 1) {}` to the first comprehension
