/**
 * Built-in capabilities matching common typeclasses.
 *
 * Each capability interface extends {@link Capability} with a specific
 * name and method signature. These are the standard building blocks for
 * describing what operations an erased value supports.
 *
 * @module
 */

import type { Capability } from "./types.js";

/** Show — can be converted to a human-readable string. */
export interface ShowCapability extends Capability<"Show"> {
  readonly methods: { show(value: unknown): string };
}

/** Eq — supports equality comparison. */
export interface EqCapability extends Capability<"Eq"> {
  readonly methods: { equals(a: unknown, b: unknown): boolean };
}

/** Ord — supports ordering comparison. Returns negative, zero, or positive. */
export interface OrdCapability extends Capability<"Ord"> {
  readonly methods: { compare(a: unknown, b: unknown): number };
}

/** Hash — can produce a numeric hash code. */
export interface HashCapability extends Capability<"Hash"> {
  readonly methods: { hash(value: unknown): number };
}

/** Clone — can be deep-copied. */
export interface CloneCapability extends Capability<"Clone"> {
  readonly methods: { clone(value: unknown): unknown };
}

/** Debug — can produce a debug/inspect representation. */
export interface DebugCapability extends Capability<"Debug"> {
  readonly methods: { debug(value: unknown): string };
}

/** Json — can be serialized to and deserialized from JSON. */
export interface JsonCapability extends Capability<"Json"> {
  readonly methods: {
    toJson(value: unknown): unknown;
    fromJson(json: unknown): unknown;
  };
}
