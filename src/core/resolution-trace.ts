/**
 * Resolution Trace Types for Error Diagnostics
 *
 * These types capture the resolution attempt tree for building
 * detailed error messages when typeclass resolution fails.
 *
 * See packages/core/src/resolution-trace.ts for the full tracer class
 * used for IDE features and CLI tracing.
 */

/**
 * A single resolution attempt, used to build detailed error messages
 * when instance resolution fails.
 *
 * Unlike ResolutionRecord (which tracks successful resolutions for IDE features),
 * ResolutionAttempt tracks both successful and failed resolution steps,
 * forming a tree of what was tried and why each path succeeded or failed.
 */
export interface ResolutionAttempt {
  /** The resolution step being attempted (e.g., "explicit-instance", "auto-derive", "field-check") */
  step: string;
  /** What we were looking for (e.g., "Eq<Point>", "GenericMeta for Point", "field `color`") */
  target: string;
  /** The outcome of this attempt */
  result: "found" | "not-found" | "rejected";
  /** Human-readable reason for the outcome (especially for failures) */
  reason?: string;
  /** Nested attempts (e.g., per-field checks under an auto-derive attempt) */
  children?: ResolutionAttempt[];
}

/**
 * A complete resolution trace, capturing all attempts made when resolving
 * a typeclass instance. Used to generate detailed error messages.
 */
export interface ResolutionTrace {
  /** What we were trying to resolve (e.g., "Eq<Point>") */
  sought: string;
  /** All resolution attempts in order */
  attempts: ResolutionAttempt[];
  /** Final outcome */
  finalResult: "resolved" | "failed";
}

/**
 * Format a resolution trace into lines suitable for diagnostic notes.
 *
 * Produces output like:
 * ```
 * resolution trace for Eq<Point>:
 *   1. explicit instance lookup — not found
 *   2. auto-derive via Generic:
 *        GenericMeta for Point: { x: number, y: number, color: Color }
 *        field `x`: number has Eq — ok
 *        field `y`: number has Eq — ok
 *        field `color`: Color lacks Eq — FAILED
 * ```
 *
 * @param trace - The resolution trace to format
 * @returns Array of lines (without leading "= note:" prefix, caller adds that)
 */
export function formatResolutionTrace(trace: ResolutionTrace): string[] {
  const lines: string[] = [];
  lines.push(`resolution trace for ${trace.sought}:`);

  for (let i = 0; i < trace.attempts.length; i++) {
    const attempt = trace.attempts[i];
    const stepNum = i + 1;
    lines.push(...formatAttempt(attempt, stepNum, 1));
  }

  return lines;
}

/**
 * Format a single resolution attempt with optional children.
 */
function formatAttempt(
  attempt: ResolutionAttempt,
  stepNum: number | null,
  depth: number
): string[] {
  const lines: string[] = [];
  const indent = "  ".repeat(depth);
  const prefix = stepNum !== null ? `${stepNum}. ` : "";

  const resultIndicator = formatResultIndicator(attempt.result);
  const reasonSuffix = attempt.reason ? ` — ${attempt.reason}` : "";

  lines.push(
    `${indent}${prefix}${attempt.step}: ${attempt.target}${resultIndicator}${reasonSuffix}`
  );

  if (attempt.children && attempt.children.length > 0) {
    for (const child of attempt.children) {
      lines.push(...formatAttempt(child, null, depth + 1));
    }
  }

  return lines;
}

/**
 * Format result indicator for trace output.
 */
function formatResultIndicator(result: ResolutionAttempt["result"]): string {
  switch (result) {
    case "found":
      return " — ok";
    case "not-found":
      return " — not found";
    case "rejected":
      return " — FAILED";
  }
}

/**
 * Generate a help message based on the resolution trace.
 * Identifies the most specific actionable fix.
 */
export function generateHelpFromTrace(
  trace: ResolutionTrace,
  typeclassName: string,
  typeName: string
): string {
  // Find the most specific failure
  for (const attempt of trace.attempts) {
    if (attempt.step === "auto-derive" && attempt.children) {
      // Look for a failing field check
      for (const child of attempt.children) {
        if (child.result === "rejected" && child.step === "field-check") {
          // Extract the field type from the target (e.g., "field `color`: Color")
          const match = child.target.match(/field `(\w+)`: (\w+)/);
          if (match) {
            const [, fieldName, fieldType] = match;
            return `Add @derive(${typeclassName}) to ${fieldType}, or provide @instance ${typeclassName}<${fieldType}>`;
          }
        }
      }

      // Generic meta not found
      if (attempt.result === "not-found") {
        return `Ensure ${typeName} is defined in the current file or imported`;
      }
    }

    if (attempt.step === "derivation-strategy" && attempt.result === "not-found") {
      return `No derivation strategy registered for ${typeclassName}. Provide @instance ${typeclassName}<${typeName}>`;
    }
  }

  // Fallback
  return `Add @derive(${typeclassName}) to ${typeName}, or provide @instance ${typeclassName}<${typeName}>`;
}
