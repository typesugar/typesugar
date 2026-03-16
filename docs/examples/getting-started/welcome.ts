//! Welcome
//! Introduction to the playground

// Welcome to the typesugar Playground!
// Try editing the code below and press Run (or Cmd+Enter)

import { staticAssert } from "typesugar";

// Static assertion at compile time
staticAssert(1 + 1 === 2);

// Regular TypeScript
const greet = (name: string) => `Hello, ${name}!`;
console.log(greet("World"));

// Try adding more code!
const numbers = [1, 2, 3, 4, 5];
const doubled = numbers.map(n => n * 2);
console.log("Doubled:", doubled);
