/** Metadata for a single parameter of a named-args function. */
export interface ParamMeta {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly defaultValue?: unknown;
  readonly position: number;
}

/** Metadata registered by @namedArgs for a function. */
export interface NamedArgsFunctionMeta {
  readonly functionName: string;
  readonly params: ReadonlyArray<ParamMeta>;
  readonly requiredParams: ReadonlyArray<string>;
  readonly optionalParams: ReadonlyArray<string>;
}

/** Extract required keys from a type (keys where `undefined` is not assignable). */
export type RequiredKeys<T> = {
  [K in keyof T]-?: undefined extends T[K] ? never : K;
}[keyof T];

/** Extract optional keys from a type (keys where `undefined` is assignable). */
export type OptionalKeys<T> = {
  [K in keyof T]-?: undefined extends T[K] ? K : never;
}[keyof T];

/**
 * A function augmented with named-argument calling support.
 *
 * Retains the original positional signature and adds a `.namedCall()` method
 * that accepts an object keyed by parameter name.
 */
export type WithNamedArgs<
  F extends (...args: any[]) => any,
  ArgsObj extends Record<string, unknown> = Record<string, unknown>,
> = F & {
  namedCall(args: ArgsObj): ReturnType<F>;
  readonly __namedArgsMeta__: NamedArgsFunctionMeta;
};
