/**
 * Diagnostic Suppression Rules
 *
 * Provides a principled mechanism for suppressing TypeScript diagnostics that
 * are invalid from typesugar's perspective because the transformer will resolve
 * them at emit time.
 *
 * Each DiagnosticSuppressionRule encodes a specific rewrite category (extension methods,
 * newtype assignment, opaque type boundaries, macro-generated code) and
 * evaluates whether a given diagnostic should be suppressed.
 *
 * @see PEP-011 for the full design document
 * @see PEP-054 for the rename from "SFINAE rules" to "diagnostic suppression rules"
 */

import type * as ts from "typescript";

/**
 * A diagnostic suppression rule that can evaluate whether a TypeScript diagnostic should
 * be suppressed because typesugar's rewrite system handles the case.
 *
 * Rules are registered at transformer initialization and evaluated in order
 * for each diagnostic. The first rule that returns `true` from
 * `shouldSuppress` wins.
 */
export interface DiagnosticSuppressionRule {
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
export interface DiagnosticSuppressionAuditEntry {
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
  /** The diagnostic suppression rule that suppressed this diagnostic */
  ruleName: string;
}

/**
 * Result of evaluating diagnostic suppression rules against a diagnostic.
 */
export interface DiagnosticSuppressionEvalResult {
  /** Whether the diagnostic was suppressed */
  suppressed: boolean;
  /** The rule that suppressed it, if any */
  rule?: DiagnosticSuppressionRule;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const diagnosticSuppressionRules: DiagnosticSuppressionRule[] = [];
const auditLog: DiagnosticSuppressionAuditEntry[] = [];

/**
 * Register a diagnostic suppression rule. Rules are evaluated in registration order;
 * the first match wins.
 */
export function registerDiagnosticSuppressionRule(rule: DiagnosticSuppressionRule): void {
  diagnosticSuppressionRules.push(rule);
}

/**
 * Remove all registered diagnostic suppression rules. Intended for testing only.
 */
export function clearDiagnosticSuppressionRules(): void {
  diagnosticSuppressionRules.length = 0;
  auditLog.length = 0;
}

/**
 * Register a diagnostic suppression rule, skipping if a rule with the same name is already registered.
 * Returns `true` if the rule was registered, `false` if it was already present.
 */
export function registerDiagnosticSuppressionRuleOnce(rule: DiagnosticSuppressionRule): boolean {
  if (diagnosticSuppressionRules.some((r) => r.name === rule.name)) {
    return false;
  }
  diagnosticSuppressionRules.push(rule);
  return true;
}

/**
 * Get a snapshot of currently registered diagnostic suppression rules.
 */
export function getDiagnosticSuppressionRules(): readonly DiagnosticSuppressionRule[] {
  return diagnosticSuppressionRules;
}

/**
 * Get the diagnostic suppression audit log (populated when audit mode is enabled).
 */
export function getDiagnosticSuppressionAuditLog(): readonly DiagnosticSuppressionAuditEntry[] {
  return auditLog;
}

/**
 * Clear the audit log without clearing rules.
 */
export function clearDiagnosticSuppressionAuditLog(): void {
  auditLog.length = 0;
}

// ---------------------------------------------------------------------------
// Audit mode detection
// ---------------------------------------------------------------------------

let auditModeOverride: boolean | undefined;

/**
 * Check whether diagnostic suppression audit mode is enabled.
 *
 * Enabled by:
 * - `TYPESUGAR_SHOW_SUPPRESSED_DIAGNOSTICS=1` environment variable
 * - `--show-suppressed-diagnostics` CLI flag (sets the env var)
 * - Programmatic override via `setDiagnosticSuppressionAuditMode()`
 */
export function isDiagnosticSuppressionAuditEnabled(): boolean {
  if (auditModeOverride !== undefined) return auditModeOverride;
  if (typeof process !== "undefined" && process.env) {
    return process.env.TYPESUGAR_SHOW_SUPPRESSED_DIAGNOSTICS === "1";
  }
  return false;
}

/**
 * Programmatically enable or disable diagnostic suppression audit mode.
 * Pass `undefined` to revert to environment-variable detection.
 */
export function setDiagnosticSuppressionAuditMode(enabled: boolean | undefined): void {
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
 * Evaluate all registered diagnostic suppression rules against a single diagnostic.
 *
 * Returns `true` if the diagnostic should be suppressed (i.e., a rule
 * matched and declared that typesugar's rewrite system handles this case).
 *
 * When audit mode is enabled, suppressed diagnostics are logged to the
 * audit log and printed to stderr.
 */
export function evaluateDiagnosticSuppression(
  diagnostic: ts.Diagnostic,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile
): boolean {
  const errorCode = diagnostic.code;

  for (const rule of diagnosticSuppressionRules) {
    // Skip rules that don't handle this error code (empty = wildcard)
    if (rule.errorCodes.length > 0 && !rule.errorCodes.includes(errorCode)) {
      continue;
    }

    let suppressed: boolean;
    try {
      suppressed = rule.shouldSuppress(diagnostic, checker, sourceFile);
    } catch (e) {
      if (isDiagnosticSuppressionAuditEnabled()) {
        console.error(`[DiagnosticSuppression] Rule "${rule.name}" threw during evaluation: ${e}`);
      }
      continue;
    }

    if (suppressed) {
      if (isDiagnosticSuppressionAuditEnabled()) {
        const { line, column } = resolvePosition(diagnostic, sourceFile);
        const messageText = flattenDiagnosticMessage(diagnostic.messageText);

        const entry: DiagnosticSuppressionAuditEntry = {
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
 * Filter an array of diagnostics through the diagnostic suppression rule registry.
 *
 * This is the main entry point for bulk filtering in both the language
 * service plugin and the CLI build pipeline.
 */
export function filterDiagnostics(
  diagnostics: readonly ts.Diagnostic[],
  checker: ts.TypeChecker,
  getSourceFile: (fileName: string) => ts.SourceFile | undefined
): ts.Diagnostic[] {
  if (diagnosticSuppressionRules.length === 0) return [...diagnostics];

  return diagnostics.filter((diag) => {
    if (!diag.file) return true;
    const sf = getSourceFile(diag.file.fileName);
    if (!sf) return true;
    return !evaluateDiagnosticSuppression(diag, checker, sf);
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

function printAuditEntry(entry: DiagnosticSuppressionAuditEntry): void {
  const loc = `${entry.fileName}:${entry.line}:${entry.column}`;
  const lines = [
    `[DiagnosticSuppression] Suppressed TS${entry.errorCode} at ${loc}`,
    `  "${entry.messageText}"`,
    `  Rule: ${entry.ruleName}`,
  ];
  if (typeof console !== "undefined") {
    console.error(lines.join("\n"));
  }
}
