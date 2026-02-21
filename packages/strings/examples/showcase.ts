/**
 * @typesugar/strings Showcase
 *
 * Self-documenting examples of compile-time validated string macros:
 * tagged template literals for regex, HTML, JSON, formatting, and raw strings.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()        - A and B are the same type
 *   typeAssert<Extends<A, B>>()      - A is assignable to B
 *   typeAssert<Not<Equal<A, B>>>()   - A and B are DIFFERENT
 *   typeAssert<Not<Extends<A, B>>>() - A is NOT assignable to B
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal, type Extends, type Not } from "@typesugar/testing";

import { __typemacro_escapeHtml } from "../src/index.js";

// ============================================================================
// 1. HTML ESCAPING - XSS Protection Runtime Helper
// ============================================================================

// The html`` tagged template macro wraps interpolations in __typemacro_escapeHtml()
// at compile time. Here we verify the runtime helper directly.

const safe = __typemacro_escapeHtml("<script>alert('xss')</script>");
assert(
  safe === "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;",
  "script tags are escaped"
);

const ampersands = __typemacro_escapeHtml("Tom & Jerry");
assert(ampersands === "Tom &amp; Jerry", "ampersands escaped");

const quotes = __typemacro_escapeHtml('She said "hello"');
assert(quotes === "She said &quot;hello&quot;", "double quotes escaped");

const singleQuotes = __typemacro_escapeHtml("It's fine");
assert(singleQuotes === "It&#039;s fine", "single quotes escaped");

const angles = __typemacro_escapeHtml("a < b > c");
assert(angles === "a &lt; b &gt; c", "angle brackets escaped");

// Non-string values are coerced
assert(__typemacro_escapeHtml(42) === "42", "numbers pass through as strings");
assert(__typemacro_escapeHtml(null) === "null", "null coerced to string");
assert(__typemacro_escapeHtml(undefined) === "undefined", "undefined coerced to string");

typeAssert<Equal<ReturnType<typeof __typemacro_escapeHtml>, string>>();

// ============================================================================
// 2. REGEX MACRO - Compile-Time Validated Regular Expressions
// ============================================================================

// The regex`` tagged template validates the pattern at compile time.
// At runtime without the transformer, we demonstrate the intent:

const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
assert(emailPattern.test("user@example.com"), "valid email matches");
assert(!emailPattern.test("not-an-email"), "invalid email rejected");
typeAssert<Equal<typeof emailPattern, RegExp>>();

const phonePattern = /^\+?[1-9]\d{1,14}$/;
assert(phonePattern.test("+12025551234"), "E.164 phone matches");
assert(!phonePattern.test("abc"), "non-phone rejected");

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
assert(
  uuidPattern.test("550e8400-e29b-41d4-a716-446655440000"),
  "valid UUID matches"
);
assert(!uuidPattern.test("not-a-uuid"), "invalid UUID rejected");

// ============================================================================
// 3. JSON MACRO - Compile-Time JSON Parsing
// ============================================================================

// The json`` tagged template parses JSON at compile time and embeds the
// resulting object literal directly in the output. No JSON.parse at runtime.

// Simulating what the macro produces: a direct object literal
const config = {
  name: "my-app",
  version: "1.0.0",
  features: ["auth", "logging", "cache"],
  database: {
    host: "localhost",
    port: 5432,
  },
};

assert(config.name === "my-app", "json string field");
assert(config.version === "1.0.0", "json version field");
assert(config.features.length === 3, "json array field");
assert(config.features[0] === "auth", "json array element");
assert(config.database.host === "localhost", "json nested object");
assert(config.database.port === 5432, "json nested number");

typeAssert<Extends<typeof config, { name: string; version: string }>>();

// JSON with different value types
const mixed = {
  str: "hello",
  num: 42,
  bool: true,
  nil: null as null,
  arr: [1, "two", false],
};

assert(mixed.str === "hello", "json string");
assert(mixed.num === 42, "json number");
assert(mixed.bool === true, "json boolean");
assert(mixed.nil === null, "json null");
assert(mixed.arr.length === 3, "json mixed array");

// ============================================================================
// 4. FMT MACRO - Printf-Style Formatting
// ============================================================================

// The fmt`` tagged template converts interpolations to String() calls
// at compile time, building a concatenated string.

// Runtime equivalent of what fmt`` produces:
const name = "Alice";
const age = 30;
const greeting = "Hello, " + String(name) + "! You are " + String(age) + " years old.";
assert(
  greeting === "Hello, Alice! You are 30 years old.",
  "fmt-style string concatenation"
);

const count = 1000;
const duration = 2.5;
const stats = "Processed " + String(count) + " items in " + String(duration) + " seconds";
assert(
  stats === "Processed 1000 items in 2.5 seconds",
  "fmt with numeric interpolations"
);

// ============================================================================
// 5. RAW STRINGS - Escape Preservation
// ============================================================================

// The raw`` tagged template preserves escape sequences.
// Without the transformer, we use String.raw for equivalent behavior.

const windowsPath = String.raw`C:\Users\name\Documents\file.txt`;
assert(windowsPath.includes("\\Users\\"), "backslashes preserved in raw string");
assert(!windowsPath.includes("\n"), "no newline interpretation");

const regexSource = String.raw`\d+\.\d+\.\d+`;
assert(regexSource === "\\d+\\.\\d+\\.\\d+", "regex special chars preserved");

const multiEscape = String.raw`\n\t\r\0`;
assert(multiEscape === "\\n\\t\\r\\0", "all escape sequences preserved");

// Raw strings with interpolations still evaluate the expression
const version = "3.2.1";
const rawWithInterp = String.raw`Version: ${version} (path: C:\builds)`;
assert(rawWithInterp.includes("3.2.1"), "interpolation evaluated in raw string");
assert(rawWithInterp.includes("C:\\builds"), "escapes preserved around interpolation");

// ============================================================================
// 6. HTML ESCAPING - Comprehensive Edge Cases
// ============================================================================

// Empty string
assert(__typemacro_escapeHtml("") === "", "empty string unchanged");

// No special characters
assert(
  __typemacro_escapeHtml("Hello World 123") === "Hello World 123",
  "plain text unchanged"
);

// All special characters combined
const allSpecial = __typemacro_escapeHtml(`<div class="test">&'`);
assert(
  allSpecial === "&lt;div class=&quot;test&quot;&gt;&amp;&#039;",
  "all HTML special chars escaped"
);

// Nested HTML
const nested = __typemacro_escapeHtml("<b><i>bold italic</i></b>");
assert(
  nested === "&lt;b&gt;&lt;i&gt;bold italic&lt;/i&gt;&lt;/b&gt;",
  "nested HTML fully escaped"
);

// ============================================================================
// 7. REAL-WORLD EXAMPLE - Template-Based Code Generation
// ============================================================================

// Building safe HTML from user data using the escape helper
function renderUserCard(user: { name: string; bio: string; url: string }): string {
  const safeName = __typemacro_escapeHtml(user.name);
  const safeBio = __typemacro_escapeHtml(user.bio);
  const safeUrl = __typemacro_escapeHtml(user.url);
  return `<div class="card"><h2>${safeName}</h2><p>${safeBio}</p><a href="${safeUrl}">Profile</a></div>`;
}

const card = renderUserCard({
  name: 'Alice "The Coder"',
  bio: "Loves <TypeScript> & Rust",
  url: "https://example.com?user=alice&tab=1",
});

assert(card.includes("Alice &quot;The Coder&quot;"), "user name escaped in card");
assert(card.includes("&lt;TypeScript&gt;"), "bio HTML escaped in card");
assert(card.includes("user=alice&amp;tab=1"), "URL ampersand escaped in card");
