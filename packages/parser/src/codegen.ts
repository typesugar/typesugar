/**
 * Phase 2: Compile-time code generation for PEG grammars.
 *
 * Transforms a parsed PEG grammar IR (Map<string, GrammarRule>) into JavaScript
 * source code for an inline recursive-descent parser. The generated code has
 * zero runtime grammar interpretation — the grammar is fully compiled away.
 *
 * The generated parser conforms to the Grammar<T> interface:
 * - parse(input, pos?) -> ParseResult<T>
 * - parseAll(input) -> T
 * - rules (Map of the original grammar rules)
 * - startRule (name of the entry rule)
 *
 * @module
 */

import type { GrammarRule } from "./types.js";

// ---------------------------------------------------------------------------
// Code generation from GrammarRule IR
// ---------------------------------------------------------------------------

/**
 * Generate JavaScript source code for an inline recursive-descent parser
 * from a map of grammar rules.
 *
 * @param rules - Named grammar rules (from `parseGrammarDef`)
 * @param startRule - Which rule is the entry point (defaults to first rule)
 * @returns A string of JavaScript code that evaluates to a Grammar-like object
 */
export function generateParserCode(rules: Map<string, GrammarRule>, startRule?: string): string {
  varCounter = 0; // Reset per invocation for deterministic output
  const start = startRule ?? rules.keys().next().value!;

  const lines: string[] = [];
  lines.push(`(function() {`);
  lines.push(`  "use strict";`);
  lines.push(``);

  // Emit helper functions
  lines.push(`  function __ok(value, pos) { return { ok: true, value: value, pos: pos }; }`);
  lines.push(
    `  function __fail(pos, expected) { return { ok: false, pos: pos, expected: expected }; }`
  );
  lines.push(``);

  // Emit a parse function for each rule
  for (const [name, rule] of rules) {
    lines.push(`  function $${sanitizeName(name)}(input, pos) {`);
    const body = emitRule(rule, `    `);
    lines.push(body);
    lines.push(`  }`);
    lines.push(``);
  }

  // Emit the lineCol helper for error reporting
  lines.push(`  function __lineCol(input, pos) {`);
  lines.push(`    var line = 1, col = 1;`);
  lines.push(`    for (var i = 0; i < pos && i < input.length; i++) {`);
  lines.push(`      if (input[i] === "\\n") { line++; col = 1; } else { col++; }`);
  lines.push(`    }`);
  lines.push(`    return { line: line, col: col };`);
  lines.push(`  }`);
  lines.push(``);

  // Build the rules Map for the Grammar interface
  lines.push(`  var __rules = new Map();`);
  for (const [name, rule] of rules) {
    lines.push(`  __rules.set(${JSON.stringify(name)}, ${JSON.stringify(rule)});`);
  }
  lines.push(``);

  // Return the Grammar object
  lines.push(`  return {`);
  lines.push(`    rules: __rules,`);
  lines.push(`    startRule: ${JSON.stringify(start)},`);
  lines.push(`    parse: function(input, pos) {`);
  lines.push(`      if (pos === undefined) pos = 0;`);
  lines.push(`      return $${sanitizeName(start)}(input, pos);`);
  lines.push(`    },`);
  lines.push(`    parseAll: function(input) {`);
  lines.push(`      var __furthestPos = 0, __furthestExpected = "unknown";`);
  lines.push(`      var result = $${sanitizeName(start)}(input, 0);`);
  lines.push(`      if (!result.ok) {`);
  lines.push(`        var lc = __lineCol(input, result.pos);`);
  lines.push(
    `        throw new Error("Parse error at line " + lc.line + ", col " + lc.col + ": expected " + result.expected);`
  );
  lines.push(`      }`);
  lines.push(`      if (result.pos !== input.length) {`);
  lines.push(`        var lc = __lineCol(input, result.pos);`);
  lines.push(
    `        throw new Error("Parse error at line " + lc.line + ", col " + lc.col + ": expected end of input");`
  );
  lines.push(`      }`);
  lines.push(`      return result.value;`);
  lines.push(`    }`);
  lines.push(`  };`);
  lines.push(`})()`);

  return lines.join("\n");
}

/** Sanitize a rule name so it's a valid JS identifier suffix */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Counter for generating unique variable names within a codegen run */
let varCounter = 0;

function freshVar(prefix: string): string {
  return `${prefix}${varCounter++}`;
}

/**
 * Emit JavaScript code for a single GrammarRule node.
 * Returns a block of code that, when executed, results in a ParseResult.
 * The code assumes `input` and `pos` are in scope.
 */
function emitRule(rule: GrammarRule, indent: string): string {
  // Reset counter at top-level call boundaries is handled externally.
  // Each call here generates self-contained code using fresh variables.
  switch (rule.type) {
    case "literal":
      return emitLiteral(rule.value, indent);
    case "charRange":
      return emitCharRange(rule.from, rule.to, indent);
    case "any":
      return emitAny(indent);
    case "sequence":
      return emitSequence(rule.rules, indent);
    case "alternation":
      return emitAlternation(rule.rules, indent);
    case "repetition":
      return emitRepetition(rule.rule, rule.min, rule.max, indent);
    case "optional":
      return emitOptional(rule.rule, indent);
    case "negation":
      return emitNegation(rule.rule, rule.then, indent);
    case "lookahead":
      return emitLookahead(rule.rule, indent);
    case "reference":
      return emitReference(rule.name, indent);
    case "action":
      // Actions are a future concern; emit the inner rule
      return emitRule(rule.rule, indent);
  }
}

function emitLiteral(value: string, indent: string): string {
  const escaped = JSON.stringify(value);
  if (value.length === 0) {
    return `${indent}return __ok("", pos);`;
  }
  return [
    `${indent}if (input.slice(pos, pos + ${value.length}) === ${escaped}) {`,
    `${indent}  return __ok(${escaped}, pos + ${value.length});`,
    `${indent}}`,
    `${indent}return __fail(pos, ${JSON.stringify(escaped)});`,
  ].join("\n");
}

function emitCharRange(from: string, to: string, indent: string): string {
  const f = JSON.stringify(from);
  const t = JSON.stringify(to);
  return [
    `${indent}if (pos < input.length && input[pos] >= ${f} && input[pos] <= ${t}) {`,
    `${indent}  return __ok(input[pos], pos + 1);`,
    `${indent}}`,
    `${indent}return __fail(pos, ${JSON.stringify(`'${from}'..'${to}'`)});`,
  ].join("\n");
}

function emitAny(indent: string): string {
  return [
    `${indent}if (pos < input.length) {`,
    `${indent}  return __ok(input[pos], pos + 1);`,
    `${indent}}`,
    `${indent}return __fail(pos, "any character");`,
  ].join("\n");
}

function emitSequence(rules: GrammarRule[], indent: string): string {
  const lines: string[] = [];
  const vals: string[] = [];
  const curPos = freshVar("p");

  lines.push(`${indent}var ${curPos} = pos;`);

  for (const rule of rules) {
    const rVar = freshVar("r");

    // Wrap each sub-rule in an inline function to get its result
    lines.push(`${indent}var ${rVar} = (function(input, pos) {`);
    lines.push(emitRule(rule, indent + "  "));
    lines.push(`${indent}})(input, ${curPos});`);
    lines.push(`${indent}if (!${rVar}.ok) return ${rVar};`);
    lines.push(`${indent}${curPos} = ${rVar}.pos;`);
    vals.push(`${rVar}.value`);
  }

  if (vals.length === 1) {
    lines.push(`${indent}return __ok(${vals[0]}, ${curPos});`);
  } else {
    lines.push(`${indent}return __ok([${vals.join(", ")}], ${curPos});`);
  }

  return lines.join("\n");
}

function emitAlternation(rules: GrammarRule[], indent: string): string {
  const lines: string[] = [];
  const bestFail = freshVar("bf");
  lines.push(`${indent}var ${bestFail} = null;`);

  for (const rule of rules) {
    const rVar = freshVar("a");
    lines.push(`${indent}var ${rVar} = (function(input, pos) {`);
    lines.push(emitRule(rule, indent + "  "));
    lines.push(`${indent}})(input, pos);`);
    lines.push(`${indent}if (${rVar}.ok) return ${rVar};`);
    lines.push(
      `${indent}if (!${bestFail} || ${rVar}.pos > ${bestFail}.pos) ${bestFail} = ${rVar};`
    );
  }

  lines.push(`${indent}return ${bestFail} || __fail(pos, "alternation");`);
  return lines.join("\n");
}

function emitRepetition(
  rule: GrammarRule,
  min: number,
  max: number | null,
  indent: string
): string {
  const lines: string[] = [];
  const items = freshVar("items");
  const curPos = freshVar("rp");
  const rVar = freshVar("rr");

  lines.push(`${indent}var ${items} = [], ${curPos} = pos;`);
  lines.push(`${indent}for (;;) {`);
  if (max !== null) {
    lines.push(`${indent}  if (${items}.length >= ${max}) break;`);
  }
  lines.push(`${indent}  var ${rVar} = (function(input, pos) {`);
  lines.push(emitRule(rule, indent + "    "));
  lines.push(`${indent}  })(input, ${curPos});`);
  lines.push(`${indent}  if (!${rVar}.ok) break;`);
  lines.push(`${indent}  if (${rVar}.pos === ${curPos}) break;`);
  lines.push(`${indent}  ${items}.push(${rVar}.value);`);
  lines.push(`${indent}  ${curPos} = ${rVar}.pos;`);
  lines.push(`${indent}}`);

  if (min > 0) {
    lines.push(
      `${indent}if (${items}.length < ${min}) return __fail(pos, "at least ${min} repetition(s)");`
    );
  }

  lines.push(`${indent}return __ok(${items}, ${curPos});`);
  return lines.join("\n");
}

function emitOptional(rule: GrammarRule, indent: string): string {
  const lines: string[] = [];
  const rVar = freshVar("opt");

  lines.push(`${indent}var ${rVar} = (function(input, pos) {`);
  lines.push(emitRule(rule, indent + "  "));
  lines.push(`${indent}})(input, pos);`);
  lines.push(`${indent}if (${rVar}.ok) return ${rVar};`);
  lines.push(`${indent}return __ok(null, pos);`);

  return lines.join("\n");
}

function emitNegation(negRule: GrammarRule, thenRule: GrammarRule, indent: string): string {
  const lines: string[] = [];
  const negVar = freshVar("neg");
  const thenVar = freshVar("then");

  lines.push(`${indent}var ${negVar} = (function(input, pos) {`);
  lines.push(emitRule(negRule, indent + "  "));
  lines.push(`${indent}})(input, pos);`);
  lines.push(`${indent}if (${negVar}.ok) return __fail(pos, "negation to fail");`);

  // The `then` part: for pure `!expr`, then is { type: "literal", value: "" }
  // which would return __ok("", pos) — i.e., consume nothing.
  lines.push(`${indent}var ${thenVar} = (function(input, pos) {`);
  lines.push(emitRule(thenRule, indent + "  "));
  lines.push(`${indent}})(input, pos);`);
  lines.push(`${indent}return ${thenVar};`);

  return lines.join("\n");
}

function emitLookahead(rule: GrammarRule, indent: string): string {
  const lines: string[] = [];
  const laVar = freshVar("la");

  lines.push(`${indent}var ${laVar} = (function(input, pos) {`);
  lines.push(emitRule(rule, indent + "  "));
  lines.push(`${indent}})(input, pos);`);
  lines.push(`${indent}if (${laVar}.ok) return __ok("", pos);`);
  lines.push(`${indent}return __fail(pos, "positive lookahead");`);

  return lines.join("\n");
}

function emitReference(name: string, indent: string): string {
  return `${indent}return $${sanitizeName(name)}(input, pos);`;
}

// ---------------------------------------------------------------------------
// Public API for resetting counter (needed between codegen invocations)
// ---------------------------------------------------------------------------

/** Reset the internal variable counter. Call before each codegen invocation. */
export function resetVarCounter(): void {
  varCounter = 0;
}
