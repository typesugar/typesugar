/**
 * Regression tests for the 2026-10 deep review of @typesugar/sql (SQL-1 … SQL-18).
 *
 * Macro findings are exercised through the REAL transformer (expand-helper.ts):
 * the source imports from "@typesugar/sql", the pipeline expands it, and the
 * output is transpiled and executed.
 */
import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as ts from "typescript";
import {
  Fragment,
  ConnectionIO,
  Transactor,
  SimpleTransactor,
  SimpleConnectionIO,
  sequence,
  traverse,
  unfold,
  TypedFragment,
  inListTyped,
  whereAndTyped,
  andTyped,
  orTyped,
  setTyped,
  valuesManyTyped,
  Get,
  Meta,
  Read,
  Write,
  deriveWrite,
  stringMeta,
  numberMeta,
  arrayMeta,
  nullable,
  select,
  quoteIdent,
  __sql_build,
  sql$,
  type DbConnection,
} from "../src/index.js";
import { sql$Macro } from "../src/infer-macro.js";
import { expand, expandAndRun, execute } from "./expand-helper.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function mockConn(overrides: Partial<DbConnection> = {}): DbConnection & {
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  return {
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(0),
    begin: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as never;
}

// ============================================================================
// SQL-1: ConnectionIO.flatMap
// ============================================================================

describe("SQL-1: ConnectionIO.flatMap and derived combinators", () => {
  it("map/flatMap run the continuation", async () => {
    const xa = Transactor.fromConnection(mockConn());
    expect(await xa.run(ConnectionIO.pure(2).map((x) => x * 10))).toBe(20);
    expect(await xa.run(ConnectionIO.pure(2).flatMap((x) => ConnectionIO.pure(`v${x}`)))).toBe(
      "v2"
    );
  });

  it("execute(...).map runs the write and maps its result", async () => {
    const conn = mockConn({ execute: vi.fn().mockResolvedValue(3) });
    const xa = Transactor.fromConnection(conn);
    const upd = new TypedFragment(["DELETE FROM t WHERE id = ", ""], [1]).toUpdate();
    expect(await xa.run(ConnectionIO.execute(upd).map((n) => n + 1))).toBe(4);
    expect(conn.execute).toHaveBeenCalledWith("DELETE FROM t WHERE id = $1", [1]);
  });

  it("zip / zipLeft / zipRight / ap / andThen / sequence / traverse", async () => {
    const xa = Transactor.fromConnection(mockConn());
    const p = ConnectionIO.pure;
    expect(await xa.run(p(1).zip(p("a")))).toEqual([1, "a"]);
    expect(await xa.run(p(1).zipLeft(p(2)))).toBe(1);
    expect(await xa.run(p(1).zipRight(p(2)))).toBe(2);
    expect(await xa.run(p(3).ap(p((n: number) => n * 2)))).toBe(6);
    expect(await xa.run(p(1).andThen(p(9)))).toBe(9);
    expect(await xa.run(sequence([p(1), p(2), p(3)]))).toEqual([1, 2, 3]);
    expect(await xa.run(traverse([1, 2], (n) => p(n * 10)))).toEqual([10, 20]);
  });

  it("running the same sequence program twice does not share state", async () => {
    const xa = Transactor.fromConnection(mockConn());
    const prog = sequence([ConnectionIO.pure(1), ConnectionIO.pure(2)]);
    expect(await xa.run(prog)).toEqual([1, 2]);
    expect(await xa.run(prog)).toEqual([1, 2]);
  });

  it("is stack-safe for long sequence / unfold / left-nested flatMap chains", async () => {
    const xa = Transactor.fromConnection(mockConn());
    const N = 100_000;

    const seq = sequence(Array.from({ length: N }, (_, i) => ConnectionIO.pure(i)));
    const seqResult = await xa.run(seq);
    expect(seqResult.length).toBe(N);
    expect(seqResult[N - 1]).toBe(N - 1);

    const counted = unfold(0, (n) =>
      ConnectionIO.pure(n >= N ? null : ([n + 1, n] as [number, number]))
    );
    expect((await xa.run(counted)).length).toBe(N);

    let left: ConnectionIO<number> = ConnectionIO.pure(0);
    for (let i = 0; i < N; i++) left = left.flatMap((x) => ConnectionIO.pure(x + 1));
    expect(await xa.run(left)).toBe(N);
  });

  it("errors inside a flatMap chain are caught by attempt/handleError", async () => {
    const xa = Transactor.fromConnection(mockConn());
    const boom = ConnectionIO.pure(1).flatMap((): ConnectionIO<number> => {
      throw new Error("boom");
    });
    const r = await xa.run(boom.attempt());
    expect(r._tag).toBe("Left");
    expect(await xa.run(boom.handleError(() => ConnectionIO.pure(7)))).toBe(7);
  });
});

// ============================================================================
// SQL-2 / SQL-4 / SQL-18: macro output through the real transformer
// ============================================================================

describe("SQL-2: sql$ expansion binds plain params and inlines fragments", () => {
  it("expanded sql$ renders real params, not { value } wrappers", async () => {
    const { exports, expanded } = await expandAndRun(`
      import { sql, sql$ } from "@typesugar/sql";
      const id: number = 5;
      const cond = sql\`x = \${7}\`;
      export const t = sql$\`SELECT id, name FROM users WHERE id = \${id} AND \${cond}\`;
    `);
    expect(expanded.code).not.toContain("value:");
    const t = exports.t as TypedFragment<unknown[], unknown>;
    expect(t).toBeInstanceOf(TypedFragment);
    expect(t.query).toEqual({
      text: "SELECT id, name FROM users WHERE id = $1 AND x = $2",
      params: [5, 7],
    });
    expect(t.toQuery().toSql().params).toEqual([5, 7]);
  });

  it("the runtime sql$ fallback behaves the same", () => {
    const inner = new Fragment(["x = ", ""], [7]);
    expect(sql$`SELECT * FROM t WHERE id = ${5} AND ${inner}`.query).toEqual({
      text: "SELECT * FROM t WHERE id = $1 AND x = $2",
      params: [5, 7],
    });
  });

  it("SelectBuilder.where accepts sql$ / sql fragments", () => {
    const q = select<{ id: number; name: string }>("id", "name")
      .from("users")
      .where(sql$`active = ${true}`)
      .andWhere(new Fragment(["age > ", ""], [21]))
      .build();
    expect(q).toEqual({
      sql: "SELECT id, name FROM users WHERE (active = $1) AND (age > $2)",
      params: [true, 21],
    });
  });
});

describe("SQL-4: macro output imports the runtime names it uses", () => {
  it("sql`` output runs when only `sql` was imported", async () => {
    const { exports, expanded } = await expandAndRun(`
      import { sql } from "@typesugar/sql";
      const id = 3;
      export const q = sql\`SELECT * FROM users WHERE id = \${id}\`;
      export const plain = sql\`SELECT 1\`;
    `);
    expect(expanded.code).toMatch(/import \{[^}]*__sql_build[^}]*\} from "@typesugar\/sql"/);
    expect((exports.q as Fragment).query).toEqual({
      text: "SELECT * FROM users WHERE id = $1",
      params: [3],
    });
    expect((exports.plain as Fragment).text).toBe("SELECT 1");
  });

  it("@derive(Read, Write) output runs when only `Read` was imported", async () => {
    const { exports } = await expandAndRun(`
      import { Read } from "@typesugar/sql";
      /** @derive(Read, Write) */
      interface User { id: number; userName: string }
    `);
    const ReadUser = exports.ReadUser as Read<{ id: number; userName: string }>;
    const WriteUser = exports.WriteUser as Write<{ id: number; userName: string }>;
    expect(ReadUser.read({ id: 1, user_name: "a" })).toEqual({ id: 1, userName: "a" });
    expect(WriteUser.write({ id: 2, userName: "b" })).toEqual([2, "b"]);
  });

  it("@derive(Meta) output runs (no registerInstanceMethods reference)", async () => {
    const { exports, expanded } = await expandAndRun(`
      import { sql } from "@typesugar/sql";
      /** @derive(Meta) */
      interface User { id: number; name: string }
    `);
    expect(expanded.code).not.toContain("registerInstanceMethods");
    const UserMeta = exports.UserMeta as Read<{ id: number; name: string }> &
      Write<{ id: number; name: string }>;
    expect(UserMeta.read({ id: 1, name: "a" })).toEqual({ id: 1, name: "a" });
    expect(UserMeta.write({ id: 1, name: "a" })).toEqual([1, "a"]);
  });
});

describe("SQL-18: sql$ checker guard", () => {
  function fakeCtx(checker: Partial<ts.TypeChecker>) {
    return {
      factory: ts.factory,
      typeChecker: checker as ts.TypeChecker,
      reportError: vi.fn(),
      reportWarning: vi.fn(),
      ensureImport: (name: string) => ts.factory.createIdentifier(name),
    };
  }
  const print = (n: ts.Node) =>
    ts
      .createPrinter()
      .printNode(
        ts.EmitHint.Expression,
        n,
        ts.createSourceFile("x.ts", "", ts.ScriptTarget.Latest)
      );

  it("skips the checker for a synthetic interpolation and warns", () => {
    const getTypeAtLocation = vi.fn(() => {
      throw new Error("start < 0");
    });
    const ctx = fakeCtx({ getTypeAtLocation });
    const template = ts.factory.createTemplateExpression(ts.factory.createTemplateHead("SELECT "), [
      ts.factory.createTemplateSpan(
        ts.factory.createIdentifier("x"),
        ts.factory.createTemplateTail("")
      ),
    ]);
    const tagged = ts.factory.createTaggedTemplateExpression(
      ts.factory.createIdentifier("sql$"),
      undefined,
      template
    );
    const call = ts.factory.createCallExpression(ts.factory.createIdentifier("sql$"), undefined, [
      template,
    ]);
    (call as { parent?: ts.Node }).parent = tagged;
    const out = sql$Macro.expand(ctx as never, call, [template]);
    expect(getTypeAtLocation).not.toHaveBeenCalled();
    expect(ctx.reportWarning).toHaveBeenCalled();
    expect(print(out)).toContain("__typed_sql_build<[\n    unknown\n]");
  });

  it("falls back to unknown when typeToTypeNode returns undefined", () => {
    const sf = ts.createSourceFile("a.ts", "sql$`SELECT ${x}`", ts.ScriptTarget.Latest, true);
    const tagged = (sf.statements[0] as ts.ExpressionStatement)
      .expression as ts.TaggedTemplateExpression;
    const call = ts.factory.createCallExpression(tagged.tag, undefined, [tagged.template]);
    (call as { parent?: ts.Node }).parent = tagged;
    const ctx = fakeCtx({
      getTypeAtLocation: () => ({ getSymbol: () => undefined, flags: 0 }) as unknown as ts.Type,
      typeToTypeNode: () => undefined,
    });
    const out = sql$Macro.expand(ctx as never, call, [tagged.template]);
    expect(() => print(out)).not.toThrow();
    expect(print(out)).toContain("unknown");
  });
});

// ============================================================================
// SQL-3 / SQL-8 / SQL-9: typed combinators
// ============================================================================

describe("SQL-3: typed combinators keep segments.length === params.length + 1", () => {
  it("inListTyped renders every param", () => {
    expect(inListTyped("id", [1, 2, 3]).query).toEqual({
      text: "id IN ($1, $2, $3)",
      params: [1, 2, 3],
    });
  });

  it("composes through whereAndTyped without losing params", () => {
    const eq = new TypedFragment(["name = ", ""], ["bob"]);
    expect(whereAndTyped(inListTyped("id", [1, 2, 3]), eq).query).toEqual({
      text: "WHERE id IN ($1, $2, $3) AND name = $4",
      params: [1, 2, 3, "bob"],
    });
  });

  it("valuesManyTyped composes into sql`` via __sql_build", () => {
    const w = Write.make<{ a: number; b: string }>(["a", "b"], [(v) => v.a, (v) => v.b]);
    const vals = valuesManyTyped(w, [
      { a: 1, b: "x" },
      { a: 2, b: "y" },
    ]);
    expect(__sql_build(["INSERT INTO t (a, b) VALUES ", ""], [vals]).query).toEqual({
      text: "INSERT INTO t (a, b) VALUES ($1, $2), ($3, $4)",
      params: [1, "x", 2, "y"],
    });
  });
});

describe("SQL-8: orTyped parenthesizes", () => {
  it("andTyped(orTyped(a, b), c) keeps OR grouped", () => {
    const a = new TypedFragment(["a = ", ""], [1]);
    const b = new TypedFragment(["b = ", ""], [2]);
    const c = new TypedFragment(["c = ", ""], [3]);
    expect(andTyped(orTyped(a, b), c).query.text).toBe("(a = $1 OR b = $2) AND c = $3");
  });
});

describe("SQL-9: setTyped with partial values", () => {
  interface U {
    name: string;
    createdAt: Date;
    nickname?: string;
  }
  const WriteU = deriveWrite<U>({
    name: { meta: Meta.string },
    createdAt: { meta: Meta.date },
    nickname: { meta: Meta.optional(Meta.string) },
  });

  it("only writes present fields (no crash on omitted Date, no NULL for omitted optional)", () => {
    expect(setTyped(WriteU, { name: "Bob" }).query).toEqual({
      text: "name = $1",
      params: ["Bob"],
    });
  });

  it("throws for a Write without per-field metadata", () => {
    const w = Write.make<U>(["name"], [(u) => u.name]);
    expect(() => setTyped(w, { name: "x" })).toThrow(/per-field metadata/);
  });
});

// ============================================================================
// SQL-5: documented quick start runs
// ============================================================================

describe("SQL-5: README quick start runs verbatim", () => {
  it("expands and executes the README's first code block", async () => {
    const readme = fs.readFileSync(path.join(here, "../README.md"), "utf8");
    const block = /```typescript\n([\s\S]*?)```/.exec(readme)![1];
    const logs: unknown[][] = [];
    const conn = mockConn({ query: vi.fn().mockResolvedValue([{ id: 1, name: "Ann" }]) });
    const { exports } = await expandAndRun(block + "\nexport { userName };", {
      globals: { dbConnection: conn, console: { log: (...a: unknown[]) => logs.push(a) } },
    });
    expect(logs[0][0]).toBe("SELECT * FROM users WHERE name = $1 AND age > $2");
    expect(logs[1][0]).toEqual(["Alice", 30]);
    expect(exports.userName).toBe("Ann");
    expect(conn.query).toHaveBeenCalledWith("SELECT id, name FROM users WHERE id = $1", [1]);
  });

  it("new Transactor(conn) fails loudly with a pointer to fromConnection", () => {
    expect(() => new (Transactor as never as new (c: unknown) => unknown)(mockConn())).toThrow(
      /fromConnection/
    );
  });

  it("the guide no longer references the non-existent sqlKind / static ConnectionIO.flatMap", () => {
    const guide = fs.readFileSync(path.join(here, "../../../docs/guides/sql.md"), "utf8");
    expect(guide).not.toMatch(/sqlKind/);
    expect(guide).not.toMatch(/ConnectionIO\.flatMap\(/);
    expect(guide).not.toMatch(/new Transactor\(dbConnection\)/);
  });
});

// ============================================================================
// SQL-6 / SQL-13 / SQL-14 / SQL-12: derives
// ============================================================================

describe("SQL-6: @column JSDoc forms", () => {
  it("accepts @column(\"x\"), @column 'x' and @column x", async () => {
    const { exports } = await expandAndRun(`
      import { Read } from "@typesugar/sql";
      /** @derive(Read) */
      interface Row {
        /** @column("created_at_x") */
        a: string;
        /** @column 'b_col' */
        b: string;
        /** @column c_col */
        c: string;
      }
    `);
    const ReadRow = exports.ReadRow as Read<unknown>;
    expect(ReadRow.columns).toEqual(["created_at_x", "b_col", "c_col"]);
    expect(ReadRow.read({ created_at_x: "1", b_col: "2", c_col: "3" })).toEqual({
      a: "1",
      b: "2",
      c: "3",
    });
  });
});

describe("SQL-13: derives accept boolean | null, literal unions and enums", () => {
  it("derives Read/Write in strict mode", async () => {
    const { exports } = await expandAndRun(
      `
      import { Read } from "@typesugar/sql";
      enum Color { Red = "red", Blue = "blue" }
      enum Level { Low, High }
      /** @derive(Read, Write) */
      interface U {
        isActive: boolean | null;
        status: "on" | "off";
        color: Color;
        level: Level;
        score: number | null;
        nick?: string;
      }
    `,
      { strict: true }
    );
    const ReadU = exports.ReadU as Read<unknown>;
    expect(
      ReadU.read({ is_active: null, status: "on", color: "red", level: 1, score: null, nick: null })
    ).toEqual({
      isActive: null,
      status: "on",
      color: "red",
      level: 1,
      score: null,
      nick: undefined,
    });
  });
});

describe("SQL-14: @derive(Meta) is a real derive", () => {
  it("expands without an 'Unknown derive' diagnostic, also in a mixed list", async () => {
    const { exports, expanded } = await expandAndRun(`
      import { Read } from "@typesugar/sql";
      /** @derive(Meta, Read) */
      interface P { id: number }
    `);
    expect(expanded.errors).toEqual([]);
    expect(expanded.warnings.join("\n")).not.toMatch(/Unknown derive/);
    expect(exports.PMeta).toBeDefined();
    expect(exports.ReadP).toBeDefined();
  });
});

describe("SQL-12: no string codegen in the sql macros", () => {
  it("no parseExpression/parseStatements call sites and no expression-text identifiers", () => {
    const srcDir = path.join(here, "../src");
    const offenders: string[] = [];
    for (const f of fs.readdirSync(srcDir)) {
      if (!f.endsWith(".ts")) continue;
      const text = fs.readFileSync(path.join(srcDir, f), "utf8");
      if (/\.parse(Expression|Statements)\(/.test(text)) offenders.push(`${f}: parse*`);
      if (/createIdentifier\(`[^`]*\(/.test(text))
        offenders.push(`${f}: identifier with call text`);
    }
    expect(offenders).toEqual([]);
  });

  it("nested instance expressions are built correctly (nullable/array)", async () => {
    const { exports } = await expandAndRun(
      `
      import { Read } from "@typesugar/sql";
      /** @derive(Read) */
      interface R { a: number | null; tags: string[] }
    `,
      { strict: true }
    );
    expect((exports.ReadR as Read<unknown>).read({ a: null, tags: ["x"] })).toEqual({
      a: null,
      tags: ["x"],
    });
  });
});

// ============================================================================
// SQL-7 / SQL-17: decoders
// ============================================================================

describe("SQL-7: missing columns are not decoded as 'undefined' / NaN", () => {
  it("primitive decoders treat undefined as NULL and never return NaN", () => {
    expect(Get.string.get(undefined)).toBeNull();
    expect(Get.number.get(undefined)).toBeNull();
    expect(Get.number.get("abc")).toBeNull();
    expect(stringMeta.get(undefined)).toBeNull();
    expect(numberMeta.get("abc")).toBeNull();
  });

  it("Read.make reports a missing column instead of decoding garbage", () => {
    const R = Read.make<{ createdAt: string }>(
      [{ field: "createdAt", column: "createdAt", get: Get.string, nullable: false }],
      (f) => f as { createdAt: string }
    );
    expect(() => R.read({ created_at: "2020" })).toThrow(/Column "createdAt".*missing/);
    expect(() => R.unsafeRead({ created_at: "2020" })).toThrow(/missing/);
  });
});

describe("SQL-17: arrays keep positions; int8 strings don't lose precision", () => {
  it("Get.array", () => {
    expect(() => Get.array(Get.number).get([1, null, 3])).toThrow(/NULL element at index 1/);
    expect(Get.array(Get.nullable(Get.number)).get([1, null, 3])).toEqual([1, null, 3]);
    expect(arrayMeta(nullable(numberMeta)).get([1, null, 3])).toEqual([1, null, 3]);
  });

  it("Get.number rejects unsafe integer strings; Get.bigint reads them", () => {
    expect(() => Get.number.get("12345678901234567891")).toThrow(/Get.bigint/);
    expect(Get.number.get("42")).toBe(42);
    expect(Get.bigint.get("12345678901234567891")).toBe(12345678901234567891n);
  });
});

// ============================================================================
// SQL-10 / SQL-11: dialects and identifiers
// ============================================================================

describe("SQL-10: one placeholder dialect everywhere", () => {
  const q = new TypedFragment(["SELECT * FROM users WHERE id = ", ""], [1]).toQuery();

  it("defaults to Postgres $n in toSql, query and the Transactor", async () => {
    expect(q.toSql().sql).toBe("SELECT * FROM users WHERE id = $1");
    const conn = mockConn();
    await Transactor.fromConnection(conn).run(ConnectionIO.queryMany(q, Read.unit as never));
    expect(conn.query).toHaveBeenCalledWith("SELECT * FROM users WHERE id = $1", [1]);
  });

  it("renders ? for mysql/sqlite when asked", async () => {
    expect(q.toSql("mysql").sql).toBe("SELECT * FROM users WHERE id = ?");
    expect(new Fragment(["a = ", ""], [1]).render("sqlite").text).toBe("a = ?");
    const conn = mockConn();
    await Transactor.fromConnection(conn, { dialect: "mysql" }).run(
      ConnectionIO.queryMany(q, Read.unit as never)
    );
    expect(conn.query).toHaveBeenCalledWith("SELECT * FROM users WHERE id = ?", [1]);
  });

  it("accepts untyped sql`...`.toQuery() too", async () => {
    const conn = mockConn({ query: vi.fn().mockResolvedValue([{ n: 1 }]) });
    const frag = new Fragment(["SELECT n FROM t WHERE id = ", ""], [9]);
    const r = await Transactor.fromConnection(conn).run(
      ConnectionIO.query(frag.toQuery<{ n: number }>(), Read.column("n", Get.number))
    );
    expect(r).toBe(1);
    expect(conn.query).toHaveBeenCalledWith("SELECT n FROM t WHERE id = $1", [9]);
  });
});

describe("SQL-11: identifiers are validated or quoted", () => {
  it("rejects injection through identifier-taking APIs", () => {
    expect(() => Fragment.set({ "name = 'x' --": 1 })).toThrow(/Unsafe SQL column name/);
    expect(() => Fragment.inList("id) OR (1=1", [1])).toThrow(/Unsafe/);
    expect(() => inListTyped("id; DROP TABLE x", [1])).toThrow(/Unsafe/);
    expect(() => select<{ id: number }>("id").from("users; --")).toThrow(/Unsafe/);
    expect(() => select<{ id: number }>("id").from("u").orderBy("id; DROP")).toThrow(/Unsafe/);
    expect(() =>
      ConnectionIO.executeWithKeys(new TypedFragment(["x"], []).toUpdate(), ["id; --"])
    ).toThrow(/Unsafe/);
  });

  it("plain identifiers pass through unchanged", () => {
    expect(Fragment.set({ name: 1, "t.col": 2 }).query.text).toBe("SET name = $1, t.col = $2");
    expect(select<{ id: number }>("id").from("public.users").orderBy("id DESC").build().sql).toBe(
      "SELECT id FROM public.users ORDER BY id DESC"
    );
  });

  it("Fragment.ident / quoteIdent quote per dialect", () => {
    expect(Fragment.ident('we"ird').text).toBe('"we""ird"');
    expect(quoteIdent("s.t")).toBe('"s"."t"');
    expect(Fragment.ident("we`ird", "mysql").text).toBe("`we``ird`");
  });

  it("RETURNING detection is case-insensitive", async () => {
    const conn = mockConn();
    const upd = new TypedFragment(["INSERT INTO t DEFAULT VALUES returning id"], []).toUpdate();
    await Transactor.fromConnection(conn).run(ConnectionIO.executeWithKeys(upd, ["id"]));
    expect(conn.query).toHaveBeenCalledWith("INSERT INTO t DEFAULT VALUES returning id", []);
  });
});

// ============================================================================
// SQL-15 / SQL-16
// ============================================================================

describe("SQL-15: SimpleTransactor affected-row count", () => {
  it("uses rowCount for UPDATE without RETURNING", async () => {
    const conn = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 7 }) };
    const xa = new SimpleTransactor(conn);
    const upd = new Fragment(["UPDATE t SET a = ", ""], [1]).toUpdate();
    expect(await xa.run(SimpleConnectionIO.update(upd))).toBe(7);
  });
});

describe("SQL-16: nested fragments are renumbered structurally", () => {
  it("does not rewrite $N inside string literals of a nested fragment", () => {
    const inner = new Fragment(["note = 'costs $1' AND b = ", ""], [2]);
    const outer = new Fragment(["a = ", " AND ", ""], [1, inner]);
    expect(outer.query).toEqual({
      text: "a = $1 AND note = 'costs $1' AND b = $2",
      params: [1, 2],
    });
  });

  it("execute helper sanity: plain TS runs", async () => {
    expect((await execute("export const x: number = 1 + 1;")).x).toBe(2);
    expect(expand("const y = 1;").errors).toEqual([]);
  });
});
