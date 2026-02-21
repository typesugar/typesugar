/** Reason codes for named-args validation failures. */
export type NamedArgsErrorReason =
  | "missing_required"
  | "unknown_param"
  | "duplicate_param"
  | "type_mismatch";

/** Error thrown when a named-args call fails validation. */
export class NamedArgsError extends Error {
  constructor(
    readonly functionName: string,
    readonly paramName: string,
    readonly reason: NamedArgsErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "NamedArgsError";
  }
}
