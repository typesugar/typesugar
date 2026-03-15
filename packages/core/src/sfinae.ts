/**
 * SFINAE (Substitution Failure Is Not An Error) Diagnostic Resolution
 *
 * Provides a principled mechanism for suppressing TypeScript diagnostics that
 * are invalid from typesugar's perspective because the transformer will resolve
 * them at emit time.
 *
 * Each SfinaeRule encodes a specific rewrite category (extension methods,
 * newtype assignment, opaque type boundaries, macro-generated code) and
 * evaluates whether a given diagnostic should be suppressed.
 *
 * @see PEP-011 for the full design document
 */

import type * as ts from "typescript";

/**
 * A SFINAE rule that can evaluate whether a TypeScript diagnostic should
 * be suppressed because typesugar's rewrite system handles the case.
 *
 * Rules are registered at transformer initialization and evaluated in order
 * for each diagnostic. The first rule that returns `true` from
 * `shouldSuppress` wins.
 */
export interface SfinaeRule {
  /** Human-readable name for audit output */
  readonly name: string;

  /** TypeScript error codes this rule can suppress. Empty array means "any code". */
  readonly errorCodes: readonly number[];

  /**
   * Evaluate whether this diagnostic should be suppressed.
   * Returns `true` if the typesugar rewrite system handles this case.
   */
  shouldSuppress(
    diagnostic: ts.Diagnostic,
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile
  ): boolean;
}

/**
 * Audit log entry recording a suppressed diagnostic and which rule suppressed it.
 */
export interface SfinaeAuditEntry {
  /** The TypeScript error code (e.g., 2339) */
  errorCode: number;
  /** File where the diagnostic occurred */
  fileName: string;
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based) */
  column: number;
  /** The original diagnostic message text */
  messageText: string;
  /** The SFINAE rule that suppressed this diagnostic */
  ruleName: string;
}

/**
 * Result of evaluating SFINAE rules against a diagnostic.
 */
export interface SfinaeEvalResult {
  /** Whether the diagnostic was suppressed */
  suppressed: boolean;
  /** The rule that suppressed it, if any */
  rule?: SfinaeRule;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const sfinaeRules: SfinaeRule[] = [];
const auditLog: SfinaeAuditEntry[] = [];

/**
 * Register a SFINAE rule. Rules are evaluated in registration order;
 * the first match wins.
 */
export function registerSfinaeRule(rule: SfinaeRule): void {
  sfinaeRules.push(rule);
}

/**
 * Remove all registered SFINAE rules. Intended for testing only.
 */
export function clearSfinaeRules(): void {
  sfinaeRules.length = 0;
  auditLog.length = 0;
}

/**
 * Get a snapshot of currently registered SFINAE rules.
 */
export function getSfinaeRules(): readonly SfinaeRule[] {
  return sfinaeRules;
}

/**
 * Get the SFINAE audit log (populated when audit mode is enabled).
 */
export function getSfinaeAuditLog(): readonly SfinaeAuditEntry[] {
  return auditLog;
}

/**
 * Clear the audit log without clearing rules.
 */
export function clearSfinaeAuditLog(): void {
  auditLog.length = 0;
}

// ---------------------------------------------------------------------------
// Audit mode detection
// ---------------------------------------------------------------------------

let auditModeOverride: boolean | undefined;

/**
 * Check whether SFINAE audit mode is enabled.
 *
 * Enabled by:
 * - `TYPESUGAR_SHOW_SFINAE=1` environment variable
 * - `--show-sfinae` CLI flag (sets the env var)
 * - Programmatic override via `setSfinaeAuditMode()`
 */
export function isSfinaeAuditEnabled(): boolean {
  if (auditModeOverride !== undefined) return auditModeOverride;
  if (typeof process !== "undefined" && process.env) {
    return process.env.TYPESUGAR_SHOW_SFINAE === "1";
  }
  return false;
}

/**
 * Programmatically enable or disable SFINAE audit mode.
 * Pass `undefined` to revert to environment-variable detection.
 */
export function setSfinaeAuditMode(enabled: boolean | undefined): void {
  auditModeOverride = enabled;
}

// ---------------------------------------------------------------------------
// Core evaluation
// ---------------------------------------------------------------------------

/**
 * Flatten `ts.Diagnostic.messageText` to a plain string.
 */
function flattenDiagnosticMessage(messageText: string | ts.DiagnosticMessageChain): string {
  if (typeof messageText === "string") return messageText;
  return messageText.messageText;
}

/**
 * Evaluate all registered SFINAE rules against a single diagnostic.
 *
 * Returns `true` if the diagnostic should be suppressed (i.e., a rule
 * matched and declared that typesugar's rewrite system handles this case).
 *
 * When audit mode is enabled, suppressed diagnostics are logged to the
 * audit log and printed to stderr.
 */
export function evaluateSfinae(
  diagnostic: ts.Diagnostic,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile
): boolean {
  const errorCode = diagnostic.code;

  for (const rule of sfinaeRules) {
    // Skip rules that don't handle this error code (empty = wildcard)
    if (rule.errorCodes.length > 0 && !rule.errorCodes.includes(errorCode)) {
      continue;
    }

    let suppressed: boolean;
    try {
      suppressed = rule.shouldSuppress(diagnostic, checker, sourceFile);
    } catch {
      // A broken rule should not crash the compiler — skip it
      continue;
    }

    if (suppressed) {
      if (isSfinaeAuditEnabled()) {
        const { line, column } = resolvePosition(diagnostic, sourceFile);
        const messageText = flattenDiagnosticMessage(diagnostic.messageText);

        const entry: SfinaeAuditEntry = {
          errorCode,
          fileName: sourceFile.fileName,
          line,
          column,
          messageText,
          ruleName: rule.name,
        };
        auditLog.push(entry);

        printAuditEntry(entry);
      }

      return true;
    }
  }

  return false;
}

/**
 * Filter an array of diagnostics through the SFINAE rule registry.
 *
 * This is the main entry point for bulk filtering in both the language
 * service plugin and the CLI build pipeline.
 */
export function filterDiagnostics(
  diagnostics: readonly ts.Diagnostic[],
  checker: ts.TypeChecker,
  getSourceFile: (fileName: string) => ts.SourceFile | undefined
): ts.Diagnostic[] {
  if (sfinaeRules.length === 0) return [...diagnostics];

  return diagnostics.filter((diag) => {
    if (!diag.file) return true;
    const sf = getSourceFile(diag.file.fileName);
    if (!sf) return true;
    return !evaluateSfinae(diag, checker, sf);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolvePosition(
  diagnostic: ts.Diagnostic,
  sourceFile: ts.SourceFile
): { line: number; column: number } {
  if (diagnostic.start !== undefined) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
    return { line: line + 1, column: character + 1 };
  }
  return { line: 0, column: 0 };
}

function printAuditEntry(entry: SfinaeAuditEntry): void {
  const loc = `${entry.fileName}:${entry.line}:${entry.column}`;
  const lines = [
    `[SFINAE] Suppressed TS${entry.errorCode} at ${loc}`,
    `  "${entry.messageText}"`,
    `  Rule: ${entry.ruleName}`,
  ];
  if (typeof console !== "undefined") {
    console.error(lines.join("\n"));
  }
}
