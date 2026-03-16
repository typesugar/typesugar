/**
 * Browser shim for Node.js `vm` module
 *
 * The comptime macro uses vm.runInNewContext() to evaluate code.
 * In the browser, we use Function constructor as a fallback.
 * This is less secure but acceptable for a playground environment.
 */

export interface Context {
  [key: string]: unknown;
}

export interface RunningScriptOptions {
  filename?: string;
  timeout?: number;
}

export function runInNewContext(
  code: string,
  context: Context = {},
  _options?: RunningScriptOptions | string
): unknown {
  // Create a function that has the context variables as parameters
  const keys = Object.keys(context);
  const values = keys.map((k) => context[k]);

  // The code from comptime is already an expression wrapped in parens,
  // e.g. "((() => { ... })())" - but transpileModule may add trailing
  // semicolons. We need to execute it as-is, not wrap in return().
  //
  // Trim any trailing semicolons/whitespace and wrap the whole thing
  // so it evaluates as an expression.
  const trimmed = code.trim().replace(/;+\s*$/, "");
  const fn = new Function(...keys, `return (${trimmed})`);

  try {
    return fn(...values);
  } catch (e) {
    throw new Error(`comptime evaluation failed: ${e}`);
  }
}

export function createContext(context: Context = {}): Context {
  return { ...context };
}

export function runInContext(
  code: string,
  context: Context,
  _options?: RunningScriptOptions | string
): unknown {
  return runInNewContext(code, context, _options);
}

export class Script {
  private code: string;

  constructor(code: string, _options?: RunningScriptOptions) {
    this.code = code;
  }

  runInNewContext(context: Context = {}, _options?: RunningScriptOptions): unknown {
    return runInNewContext(this.code, context);
  }

  runInThisContext(_options?: RunningScriptOptions): unknown {
    return eval(this.code);
  }
}

export default {
  runInNewContext,
  createContext,
  Script,
};
