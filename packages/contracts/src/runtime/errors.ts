/**
 * Contract Error Types
 *
 * Specialized error classes for contract violations, providing clear
 * diagnostics about which contract failed and where.
 */

/**
 * Base class for all contract violations.
 */
export class ContractError extends Error {
  constructor(
    message: string,
    public readonly contractType: "precondition" | "postcondition" | "invariant"
  ) {
    super(message);
    this.name = "ContractError";
  }
}

/**
 * Thrown when a precondition (requires) is violated.
 */
export class PreconditionError extends ContractError {
  constructor(message: string) {
    super(message, "precondition");
    this.name = "PreconditionError";
  }
}

/**
 * Thrown when a postcondition (ensures) is violated.
 */
export class PostconditionError extends ContractError {
  constructor(message: string) {
    super(message, "postcondition");
    this.name = "PostconditionError";
  }
}

/**
 * Thrown when a class invariant is violated.
 */
export class InvariantError extends ContractError {
  constructor(message: string) {
    super(message, "invariant");
    this.name = "InvariantError";
  }
}
