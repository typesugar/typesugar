import type { ParamMeta, NamedArgsFunctionMeta, WithNamedArgs } from "./types.js";
import { NamedArgsError } from "./errors.js";

/** Registry of named-args function metadata, keyed by function name. */
const namedArgsRegistry = new Map<string, NamedArgsFunctionMeta>();

/** Register a function's parameter metadata. */
export function registerNamedArgs(meta: NamedArgsFunctionMeta): void {
  namedArgsRegistry.set(meta.functionName, meta);
}

/** Look up registered metadata for a function by name. */
export function getNamedArgsMeta(
  name: string,
): NamedArgsFunctionMeta | undefined {
  return namedArgsRegistry.get(name);
}

/**
 * Call a function with named arguments.
 *
 * Resolves parameter order from `params`, fills defaults for missing optional
 * params, and validates that all required params are present.  Unknown keys
 * in `args` are rejected.
 */
export function callWithNamedArgs<F extends (...args: any[]) => any>(
  fn: F,
  params: ReadonlyArray<ParamMeta>,
  args: Record<string, unknown>,
): ReturnType<F> {
  const fnName = fn.name || "<anonymous>";
  const knownNames = new Set(params.map((p) => p.name));

  for (const key of Object.keys(args)) {
    if (!knownNames.has(key)) {
      throw new NamedArgsError(
        fnName,
        key,
        "unknown_param",
        `Unknown parameter '${key}' for function '${fnName}'. ` +
          `Known parameters: ${[...knownNames].join(", ")}`,
      );
    }
  }

  const positionalArgs: unknown[] = [];

  for (const param of params) {
    const hasKey = Object.prototype.hasOwnProperty.call(args, param.name);

    if (hasKey) {
      positionalArgs[param.position] = args[param.name];
    } else if (param.required) {
      throw new NamedArgsError(
        fnName,
        param.name,
        "missing_required",
        `Missing required parameter '${param.name}' for function '${fnName}'`,
      );
    } else {
      positionalArgs[param.position] = param.defaultValue;
    }
  }

  return fn(...positionalArgs) as ReturnType<F>;
}

/**
 * Create a named-args wrapper for a function.
 *
 * Returns the original function augmented with:
 * - `.namedCall(obj)` — call with an object of named parameters
 * - `.__namedArgsMeta__` — the registered parameter metadata
 *
 * The original positional calling convention is preserved.
 */
export function namedArgs<F extends (...args: any[]) => any>(
  fn: F,
  params: ParamMeta[],
): WithNamedArgs<F> {
  const sorted = [...params].sort((a, b) => a.position - b.position);
  const meta: NamedArgsFunctionMeta = {
    functionName: fn.name || "<anonymous>",
    params: sorted,
    requiredParams: sorted.filter((p) => p.required).map((p) => p.name),
    optionalParams: sorted.filter((p) => !p.required).map((p) => p.name),
  };

  registerNamedArgs(meta);

  const wrapper = function (this: unknown, ...args: unknown[]) {
    return fn.apply(this, args);
  } as unknown as WithNamedArgs<F>;

  Object.defineProperties(wrapper, {
    name: { value: fn.name, configurable: true },
    length: { value: fn.length, configurable: true },
    namedCall: {
      value(args: Record<string, unknown>) {
        return callWithNamedArgs(fn, sorted, args);
      },
      writable: false,
      enumerable: false,
      configurable: false,
    },
    __namedArgsMeta__: {
      value: meta,
      writable: false,
      enumerable: false,
      configurable: false,
    },
  });

  return wrapper;
}
