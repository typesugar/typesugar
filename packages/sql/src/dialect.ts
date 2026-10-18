/**
 * SQL dialects — placeholder style and identifier quoting.
 *
 * ## Decision (2026-10 review, SQL-10 / SQL-11)
 *
 * Every renderer in this package (`Fragment.query`, `TypedFragment.query`,
 * `TypedQuery.toSql()`, `TypedUpdate.toSql()`, `SelectBuilder.build()`, both
 * Transactors) goes through ONE function, {@link renderFragment}, and takes the
 * placeholder style from a {@link SqlDialect}. The default everywhere is
 * **Postgres** (`$1, $2, …`), which is what the docs always showed. MySQL and
 * SQLite use `?`. Pass a dialect (object or name) to the renderer, or set it once
 * on the Transactor: `Transactor.fromPool(pool, { dialect: "mysql" })`.
 *
 * Identifiers are never parameterised (no SQL driver supports that), so:
 *
 * - `Fragment.ident(name, dialect?)` / `quoteIdent` QUOTE an identifier for the
 *   dialect: `"name"` (Postgres, SQLite — ANSI) or `` `name` `` (MySQL), with the
 *   quote character doubled inside the name. Dotted names quote each part.
 *   Quoting is applied when the fragment is built, so pass the dialect you will
 *   render with when it is not Postgres/ANSI.
 * - APIs that take a column/table name as a plain string (`Fragment.inList`,
 *   `Fragment.set`, `inListTyped`, `setTyped`, the `select()` builder,
 *   `executeWithKeys` columns) do NOT quote (quoting would change Postgres
 *   case-folding of existing unquoted names). They VALIDATE instead, via
 *   {@link assertSafeIdentifier}: a plain identifier (optionally dotted) passes
 *   through unchanged; anything else throws. Use `Fragment.ident()` when you
 *   really need an unusual name.
 *
 * @module
 */

/** A SQL dialect: how to render bound-parameter placeholders and quote identifiers. */
export interface SqlDialect {
  readonly name: string;
  /** Placeholder for the parameter at 1-based position `index`. */
  placeholder(index: number): string;
  /** Quote a single identifier part (no dots). */
  quoteIdentPart(part: string): string;
}

/** PostgreSQL — `$1, $2, …` placeholders, `"double quoted"` identifiers. */
export const postgres: SqlDialect = {
  name: "postgres",
  placeholder: (i) => `$${i}`,
  quoteIdentPart: (p) => `"${p.replace(/"/g, '""')}"`,
};

/** MySQL / MariaDB — `?` placeholders, `` `backtick` `` identifiers. */
export const mysql: SqlDialect = {
  name: "mysql",
  placeholder: () => "?",
  quoteIdentPart: (p) => `\`${p.replace(/`/g, "``")}\``,
};

/** SQLite — `?` placeholders, `"double quoted"` identifiers. */
export const sqlite: SqlDialect = {
  name: "sqlite",
  placeholder: () => "?",
  quoteIdentPart: (p) => `"${p.replace(/"/g, '""')}"`,
};

/** Built-in dialects by name. */
export const dialects = { postgres, mysql, sqlite } as const;

/** A dialect object, or the name of a built-in one. */
export type DialectLike = SqlDialect | keyof typeof dialects;

/** The default dialect used when none is given. */
export const defaultDialect: SqlDialect = postgres;

/** Resolve a {@link DialectLike} (or undefined → the default) to a dialect object. */
export function resolveDialect(d: DialectLike | undefined): SqlDialect {
  if (d === undefined) return defaultDialect;
  if (typeof d === "string") {
    const found = dialects[d];
    if (!found) throw new Error(`Unknown SQL dialect: ${String(d)}`);
    return found;
  }
  return d;
}

/**
 * Quote an identifier for a dialect. `schema.table` quotes each part
 * (`"schema"."table"`); quote characters inside a part are doubled.
 */
export function quoteIdent(name: string, dialect?: DialectLike): string {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("SQL identifier must be a non-empty string");
  }
  const d = resolveDialect(dialect);
  return name
    .split(".")
    .map((part) => d.quoteIdentPart(part))
    .join(".");
}

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_$]*(\.[A-Za-z_][A-Za-z0-9_$]*)*$/;
const SAFE_QUOTED_IDENT = /^("(?:[^"]|"")+"|`(?:[^`]|``)+`)(\.("(?:[^"]|"")+"|`(?:[^`]|``)+`))*$/;

/** True if `name` is a plain identifier (letters/digits/_/$, optionally dotted) or an already-quoted one. */
export function isSafeIdentifier(name: string): boolean {
  return typeof name === "string" && (SAFE_IDENT.test(name) || SAFE_QUOTED_IDENT.test(name));
}

/**
 * Throw unless `name` is a plain or already-quoted identifier. Used by every
 * API that splices a caller-supplied column/table name into SQL text, so a
 * request-controlled key like `"name = 'x' --"` can't inject SQL.
 */
export function assertSafeIdentifier(name: string, what = "identifier"): string {
  if (!isSafeIdentifier(name)) {
    throw new Error(
      `Unsafe SQL ${what}: ${JSON.stringify(name)}. Identifiers are not parameterised; ` +
        `use a plain name (letters, digits, _, optionally dotted) or quote it with Fragment.ident().`
    );
  }
  return name;
}

/**
 * Anything with the segments/params shape (`Fragment`, `TypedFragment`).
 * `segments.length === params.length + 1`; a param that is itself fragment-like
 * is inlined (its SQL spliced in, its params renumbered) when rendered.
 */
export interface FragmentLike {
  readonly segments: readonly string[];
  readonly params: readonly unknown[];
}

/** Brand set on Fragment / TypedFragment prototypes so the renderer can recognise them. */
export const FRAGMENT_BRAND: unique symbol = Symbol.for("@typesugar/sql/fragment");

export function isFragmentLike(v: unknown): v is FragmentLike {
  return (
    typeof v === "object" && v !== null && (v as Record<symbol, unknown>)[FRAGMENT_BRAND] === true
  );
}

/**
 * Render segments + params to `{ text, params }` for a dialect.
 *
 * Nested fragment params are rendered recursively with a running parameter
 * index (no regex renumbering of already-rendered text — SQL-16), so a `$1`
 * inside a string literal or comment is never touched.
 */
export function renderFragment(
  frag: FragmentLike,
  dialect?: DialectLike
): { text: string; params: unknown[] } {
  const d = resolveDialect(dialect);
  const out: string[] = [];
  const params: unknown[] = [];
  renderInto(frag, d, out, params);
  return { text: out.join(""), params };
}

function renderInto(frag: FragmentLike, d: SqlDialect, out: string[], params: unknown[]): void {
  const { segments, params: ps } = frag;
  if (segments.length !== ps.length + 1) {
    throw new Error(
      `Malformed SQL fragment: ${segments.length} segments for ${ps.length} params ` +
        `(expected segments.length === params.length + 1)`
    );
  }
  for (let i = 0; i < segments.length; i++) {
    out.push(segments[i]);
    if (i < ps.length) {
      const p = ps[i];
      if (isFragmentLike(p)) {
        renderInto(p, d, out, params);
      } else {
        params.push(p);
        out.push(d.placeholder(params.length));
      }
    }
  }
}
