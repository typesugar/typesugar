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
 * Per-call state for evaluating suppression rules.
 *
 * Rules are registered once per process, but a long-lived host (tsserver with
 * several projects open, the LSP server) evaluates diagnostics for more than
 * one program. Anything that is per-project -- the program itself, the
 * project's transformed-position mapper -- must therefore travel with the
 * call, not be captured in a rule's closure at registration time (deep-review
 * core #33: the first project's mapper was used for every later project).
 */
export interface DiagnosticSuppressionContext {
  /** The program the diagnostics were computed against. */
  readonly program?: ts.Program;
  /**
   * Maps a position in the transformed file back to the original source, or
   * `null` for macro-generated code. Overrides the callback the MacroGenerated
   * rule was created with.
   */
  readonly positionMapFn?: (fileName: string, transformedPos: number) => number | null;
}

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
   *
   * A rule must only return `true` when the transformer will actually make
   * that exact code valid. Hiding a real error is far worse than leaving an
   * extra red squiggle, so when in doubt, return `false`.
   */
  shouldSuppress(
    diagnostic: ts.Diagnostic,
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile,
    context?: DiagnosticSuppressionContext
  ): boolean;

  /**
   * Diagnostics to report in place of one this rule suppresses (optional),
   * for a suppression that would otherwise hide a real error TypeScript
   * never reports separately: tsc reports only the first failing argument of
   * a call, so suppressing that one hides the next; and TypeScript types the
   * code before the rewrite, so a rewritten value used where its rewritten
   * type doesn't fit has no error of its own. Each replacement should be the
   * error TypeScript would report on the expanded code.
   *
   * Called only after `shouldSuppress` returned `true` for `diagnostic`.
   * Identical replacements (same file, span, code and message) are reported
   * once. If this throws, the original diagnostic is kept (and a warning
   * printed): hiding an error is worse than an extra one.
   */
  replacementDiagnostics?(
    diagnostic: ts.Diagnostic,
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile,
    context?: DiagnosticSuppressionContext
  ): readonly ts.Diagnostic[];
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
/** Rule names whose evaluation threw and that have already been warned about. */
const warnedThrowingRules = new Set<string>();

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
  warnedThrowingRules.clear();
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
 * Register a diagnostic suppression rule, replacing a registered rule with the
 * same name in place (keeping its position in the evaluation order).
 * Returns `true` if the rule was newly added, `false` if it replaced one.
 *
 * Used for rules whose behaviour depends on what they were created with
 * (MacroGenerated's position mapper): keeping the FIRST instance, as
 * {@link registerDiagnosticSuppressionRuleOnce} does, pinned the first
 * project's mapper -- and its language service -- for the process lifetime.
 */
export function registerOrReplaceDiagnosticSuppressionRule(
  rule: DiagnosticSuppressionRule
): boolean {
  const idx = diagnosticSuppressionRules.findIndex((r) => r.name === rule.name);
  if (idx >= 0) {
    diagnosticSuppressionRules[idx] = rule;
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
  sourceFile: ts.SourceFile,
  context?: DiagnosticSuppressionContext
): boolean {
  return suppressingRule(diagnostic, checker, sourceFile, context) !== undefined;
}

/** The first registered rule that suppresses `diagnostic`, if any (see `evaluateDiagnosticSuppression`). */
function suppressingRule(
  diagnostic: ts.Diagnostic,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  context?: DiagnosticSuppressionContext
): DiagnosticSuppressionRule | undefined {
  const errorCode = diagnostic.code;

  for (const rule of diagnosticSuppressionRules) {
    // Skip rules that don't handle this error code (empty = wildcard)
    if (rule.errorCodes.length > 0 && !rule.errorCodes.includes(errorCode)) {
      continue;
    }

    let suppressed: boolean;
    try {
      suppressed = rule.shouldSuppress(diagnostic, checker, sourceFile, context);
    } catch (e) {
      // The rule is skipped (the diagnostic stays visible), but the user must
      // be able to see that a rule failed (deep-review core #50): once per
      // rule name unconditionally, every time in audit mode.
      if (isDiagnosticSuppressionAuditEnabled()) {
        console.error(`[DiagnosticSuppression] Rule "${rule.name}" threw during evaluation: ${e}`);
      } else if (!warnedThrowingRules.has(rule.name)) {
        warnedThrowingRules.add(rule.name);
        console.warn(
          `[typesugar] diagnostic suppression rule "${rule.name}" threw and was skipped ` +
            `(${e instanceof Error ? e.message : String(e)}); some diagnostics it would ` +
            `normally hide may be shown. Set TYPESUGAR_SHOW_SUPPRESSED_DIAGNOSTICS=1 for details.`
        );
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

      return rule;
    }
  }

  return undefined;
}

/**
 * Filter an array of diagnostics through the diagnostic suppression rule registry.
 *
 * This is the main entry point for bulk filtering in both the language
 * service plugin and the CLI build pipeline. Pass `context` (at least the
 * `program`, plus the project's `positionMapFn` in an IDE host) so that rules
 * evaluate against THIS project rather than state captured at registration.
 */
export function filterDiagnostics(
  diagnostics: readonly ts.Diagnostic[],
  checker: ts.TypeChecker,
  getSourceFile: (fileName: string) => ts.SourceFile | undefined,
  context?: DiagnosticSuppressionContext,
  /** Called for each diagnostic a rule suppresses (or replaces), with the rule's name. */
  onSuppressed?: (diagnostic: ts.Diagnostic, ruleName: string) => void
): ts.Diagnostic[] {
  if (diagnosticSuppressionRules.length === 0) return [...diagnostics];

  const out: ts.Diagnostic[] = [];
  const replaced = new Set<string>();
  for (const diag of diagnostics) {
    const sf = diag.file ? getSourceFile(diag.file.fileName) : undefined;
    const rule = sf ? suppressingRule(diag, checker, sf, context) : undefined;
    if (!rule || !sf) {
      out.push(diag);
      continue;
    }
    onSuppressed?.(diag, rule.name);
    if (!rule.replacementDiagnostics) continue;
    let replacements: readonly ts.Diagnostic[];
    try {
      replacements = rule.replacementDiagnostics(diag, checker, sf, context);
    } catch (e) {
      // Keep the original: the suppression may have been hiding a real error.
      console.warn(
        `[typesugar] diagnostic suppression rule "${rule.name}" could not compute the ` +
          `diagnostics that replace a suppressed one ` +
          `(${e instanceof Error ? e.message : String(e)}); the original is shown.`
      );
      out.push(diag);
      continue;
    }
    for (const r of replacements) {
      const key = [
        r.file?.fileName,
        r.start,
        r.length,
        r.code,
        typeof r.messageText === "string" ? r.messageText : r.messageText.messageText,
      ].join("\0");
      if (replaced.has(key)) continue;
      replaced.add(key);
      out.push(r);
    }
  }
  return out;
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
