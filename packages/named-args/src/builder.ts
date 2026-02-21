import type { ParamMeta } from "./types.js";
import { NamedArgsError } from "./errors.js";

/**
 * A type-safe builder for functions with many parameters.
 *
 * Each `.set()` call returns a new builder (immutable accumulation),
 * so partial builders can be safely shared and extended.
 */
export interface Builder<F extends (...args: any[]) => any> {
  /** Set a named parameter value, returning a new builder. */
  set(name: string, value: unknown): Builder<F>;

  /** Call the underlying function once all required params are set. */
  build(): ReturnType<F>;

  /** Snapshot of currently accumulated values. */
  values(): Record<string, unknown>;
}

/**
 * Create a builder for a named-args function.
 *
 * The builder accumulates parameter values via `.set()` and validates
 * that all required parameters are present when `.build()` is called.
 */
export function createBuilder<F extends (...args: any[]) => any>(
  fn: F,
  params: ParamMeta[],
): Builder<F> {
  const sorted = [...params].sort((a, b) => a.position - b.position);
  const knownNames = new Set(sorted.map((p) => p.name));

  return makeBuilder(fn, sorted, knownNames, Object.create(null) as Record<string, unknown>);
}

function makeBuilder<F extends (...args: any[]) => any>(
  fn: F,
  params: ReadonlyArray<ParamMeta>,
  knownNames: ReadonlySet<string>,
  accumulated: Record<string, unknown>,
): Builder<F> {
  return {
    set(name: string, value: unknown): Builder<F> {
      if (!knownNames.has(name)) {
        throw new NamedArgsError(
          fn.name || "<anonymous>",
          name,
          "unknown_param",
          `Unknown parameter '${name}' for function '${fn.name || "<anonymous>"}'`,
        );
      }

      const next: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(accumulated)) {
        next[key] = accumulated[key];
      }
      next[name] = value;

      return makeBuilder(fn, params, knownNames, next);
    },

    build(): ReturnType<F> {
      const fnName = fn.name || "<anonymous>";
      const positionalArgs: unknown[] = [];

      for (const param of params) {
        const hasKey = Object.prototype.hasOwnProperty.call(
          accumulated,
          param.name,
        );

        if (hasKey) {
          positionalArgs[param.position] = accumulated[param.name];
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
    },

    values(): Record<string, unknown> {
      const snapshot: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(accumulated)) {
        snapshot[key] = accumulated[key];
      }
      return snapshot;
    },
  };
}
