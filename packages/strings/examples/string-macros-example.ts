/**
 * String Macros Example
 *
 * Demonstrates compile-time validated strings:
 * - regex — validated regular expressions
 * - html — XSS-safe HTML templates
 * - fmt — printf-style formatting
 */

import { regex, html, fmt, raw } from "@typesugar/strings";

console.log("=== String Macros Example ===\n");

// --- regex: Compile-Time Validated ---

console.log("--- regex ---");

const emailPattern = regex`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`;
console.log("Email regex:", emailPattern);
console.log("Test 'user@example.com':", emailPattern.test("user@example.com"));
console.log("Test 'not-an-email':", emailPattern.test("not-an-email"));

const phonePattern = regex`^\+?[1-9]\d{1,14}$`;
console.log("\nPhone regex:", phonePattern);
console.log("Test '+12025551234':", phonePattern.test("+12025551234"));

// --- html: XSS-Safe Templates ---

console.log("\n--- html ---");

const userInput = "<script>alert('xss')</script>";
const userName = "Alice & Bob";

const safeHtml = html`
  <div class="user-card">
    <h2>${userName}</h2>
    <p>Message: ${userInput}</p>
  </div>
`;

console.log("Safe HTML (XSS escaped):");
console.log(safeHtml);

// --- fmt: Printf-Style Formatting ---

console.log("\n--- fmt ---");

const greeting = fmt`Hello, ${userName}!`;
console.log(greeting);

const stats = fmt`Processed ${1000} items in ${2.5} seconds`;
console.log(stats);

// --- raw: Escape Preservation ---

console.log("\n--- raw ---");

const windowsPath = raw`C:\Users\name\Documents\file.txt`;
console.log("Windows path:", windowsPath);

const regexString = raw`\d+\.\d+\.\d+`;
console.log("Regex string:", regexString);
