/**
 * Show Typeclass
 *
 * A type class for converting values to their string representation.
 * Unlike toString(), Show is intended to produce a "programmer-friendly"
 * representation, often valid code that could recreate the value.
 */

// ============================================================================
// Show
// ============================================================================

/**
 * Show typeclass
 */
export interface Show<A> {
  readonly show: (a: A) => string;
}

// ============================================================================
// Common Instances
// ============================================================================

/**
 * Show for strings (with quotes)
 */
export const showString: Show<string> = {
  show: (s) => JSON.stringify(s),
};

/**
 * Show for numbers
 */
export const showNumber: Show<number> = {
  show: (n) => String(n),
};

/**
 * Show for booleans
 */
export const showBoolean: Show<boolean> = {
  show: (b) => String(b),
};

/**
 * Show for bigints
 */
export const showBigInt: Show<bigint> = {
  show: (n) => `${n}n`,
};

/**
 * Show for undefined
 */
export const showUndefined: Show<undefined> = {
  show: () => "undefined",
};

/**
 * Show for null
 */
export const showNull: Show<null> = {
  show: () => "null",
};

/**
 * Show for dates
 */
export const showDate: Show<Date> = {
  show: (d) => `Date(${d.toISOString()})`,
};

/**
 * Show for symbols
 */
export const showSymbol: Show<symbol> = {
  show: (s) => s.toString(),
};

// ============================================================================
// Combinators
// ============================================================================

/**
 * Show for arrays
 */
export function showArray<A>(S: Show<A>): Show<A[]> {
  return {
    show: (arr) => `[${arr.map(S.show).join(", ")}]`,
  };
}

/**
 * Show for tuples (2 elements)
 */
export function showTuple<A, B>(SA: Show<A>, SB: Show<B>): Show<[A, B]> {
  return {
    show: ([a, b]) => `(${SA.show(a)}, ${SB.show(b)})`,
  };
}

/**
 * Show for tuples (3 elements)
 */
export function showTuple3<A, B, C>(
  SA: Show<A>,
  SB: Show<B>,
  SC: Show<C>,
): Show<[A, B, C]> {
  return {
    show: ([a, b, c]) => `(${SA.show(a)}, ${SB.show(b)}, ${SC.show(c)})`,
  };
}

/**
 * Show by mapping to a different type
 */
export function contramap<A, B>(S: Show<B>, f: (a: A) => B): Show<A> {
  return {
    show: (a) => S.show(f(a)),
  };
}

/**
 * Show using a custom function
 */
export function makeShow<A>(show: (a: A) => string): Show<A> {
  return { show };
}

/**
 * Show that uses toString
 */
export function showViaToString<A extends { toString(): string }>(): Show<A> {
  return {
    show: (a) => a.toString(),
  };
}

/**
 * Show for records
 */
export function showRecord<K extends string, V>(
  S: Show<V>,
): Show<Record<K, V>> {
  return {
    show: (record) => {
      const entries = Object.entries(record)
        .map(([k, v]) => `${k}: ${S.show(v as V)}`)
        .join(", ");
      return `{ ${entries} }`;
    },
  };
}

/**
 * Show for readonly arrays
 */
export function showReadonlyArray<A>(S: Show<A>): Show<readonly A[]> {
  return {
    show: (arr) => `[${arr.map(S.show).join(", ")}]`,
  };
}

/**
 * Show for Set
 */
export function showSet<A>(S: Show<A>): Show<Set<A>> {
  return {
    show: (set) => `Set(${[...set].map(S.show).join(", ")})`,
  };
}

/**
 * Show for Map
 */
export function showMap<K, V>(SK: Show<K>, SV: Show<V>): Show<Map<K, V>> {
  return {
    show: (map) => {
      const entries = [...map.entries()]
        .map(([k, v]) => `${SK.show(k)} -> ${SV.show(v)}`)
        .join(", ");
      return `Map(${entries})`;
    },
  };
}

/**
 * Create a struct Show from Shows for each field
 */
export function showStruct<A extends Record<string, unknown>>(shows: {
  [K in keyof A]: Show<A[K]>;
}): Show<A> {
  return {
    show: (a) => {
      const entries = Object.entries(shows)
        .map(([key, show]) => `${key}: ${(show as Show<unknown>).show(a[key])}`)
        .join(", ");
      return `{ ${entries} }`;
    },
  };
}

// ============================================================================
// Interpolation Helper
// ============================================================================

/**
 * Interpolate values into a string template
 */
export function interpolate<A>(
  S: Show<A>,
  strings: TemplateStringsArray,
  ...values: A[]
): string {
  return strings.reduce((acc, str, i) => {
    const value = values[i];
    return acc + str + (value !== undefined ? S.show(value) : "");
  }, "");
}

// ============================================================================
// Pretty Printing
// ============================================================================

/**
 * Options for pretty printing
 */
export interface PrettyOptions {
  readonly indent: number;
  readonly maxWidth: number;
}

/**
 * Default pretty printing options
 */
export const defaultPrettyOptions: PrettyOptions = {
  indent: 2,
  maxWidth: 80,
};

/**
 * Show with pretty printing for nested structures
 */
export function showPretty<A>(
  S: Show<A>,
  options: Partial<PrettyOptions> = {},
): Show<A> {
  const opts = { ...defaultPrettyOptions, ...options };
  return {
    show: (a) => {
      const simple = S.show(a);
      if (simple.length <= opts.maxWidth) {
        return simple;
      }
      // Try to add newlines and indentation for readability
      return simple
        .replace(/\{/g, "{\n" + " ".repeat(opts.indent))
        .replace(/\}/g, "\n}")
        .replace(/\[/g, "[\n" + " ".repeat(opts.indent))
        .replace(/\]/g, "\n]")
        .replace(/, /g, ",\n" + " ".repeat(opts.indent));
    },
  };
}
