/**
 * @typesugar/named-args — Named function arguments with compile-time validation.
 *
 * Wrap functions with `namedArgs()` to enable object-style calling with
 * automatic parameter reordering, default filling, and clear error messages.
 *
 * @packageDocumentation
 */

export type {
  ParamMeta,
  NamedArgsFunctionMeta,
  WithNamedArgs,
  RequiredKeys,
  OptionalKeys,
} from "./types.js";

export { NamedArgsError } from "./errors.js";
export type { NamedArgsErrorReason } from "./errors.js";

export {
  namedArgs,
  callWithNamedArgs,
  registerNamedArgs,
  getNamedArgsMeta,
} from "./named-args.js";

export { createBuilder } from "./builder.js";
export type { Builder } from "./builder.js";

export { namedArgsMacro } from "./macros.js";
