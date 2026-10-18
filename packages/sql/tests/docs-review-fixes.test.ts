/**
 * Regression tests for the 2026-10 docs review of the SQL guide
 * (peps/reviews/2026-10-docs-arch-review/docs-guides-c.md, C#8, C#10, C#11,
 * C#15, C#16, C#27).
 *
 * Each test is the (minimised) doc example, executed through the real
 * transformer and runtime or type-checked with the real compiler.
 */
import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as ts from "typescript";
import {
  sql,
  Query,
  ConnectionIO,
  Transactor,
  TypedFragment,
  TypedQuery,
  TypedUpdate,
  Read,
  Meta,
  deriveRead,
  type DbConnection,
} from "../src/index.js";
import { expand, expandAndRun } from "./expand-helper.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function mockConn(rows: Record<string, unknown>[] = [], affected = 0) {
  return {
    query: vi.fn().mockResolvedValue(rows),
    execute: vi.fn().mockResolvedValue(affected),
    begin: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  } as unknown as DbConnection & {
    query: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
  };
}

/**
 * Type-check `code` as a module in this tests directory and return the
 * diagnostics for that file only (as "TSxxxx: message" strings).
 */
function typecheck(code: string): string[] {
  const file = path.join(here, "__typecheck_input__.ts");
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const origGet = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lang, ...rest) =>
    f === file ? ts.createSourceFile(f, code, lang, true) : origGet(f, lang, ...rest);
  const origExists = host.fileExists.bind(host);
  host.fileExists = (f) => f === file || origExists(f);
  const origRead = host.readFile.bind(host);
  host.readFile = (f) => (f === file ? code : origRead(f));
  const program = ts.createProgram([file], options, host);
  const sf = program.getSourceFile(file)!;
  return [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)].map(
    (d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`
  );
}

// ============================================================================
// C#8: @derive(Read, Write, Codec)
// ============================================================================

describe("C#8: @derive(Read, Write, Codec) does not emit duplicate declarations", () => {
  it("the doc example runs and all three instances work", async () => {
    const { exports, expanded } = await expandAndRun(`
      import { Read } from "@typesugar/sql";
      /** @derive(Read, Write, Codec) */
      export interface Acct { id: number; ownerName: string }
    `);
    // As an ES module, a second \`export const ReadAcct\` is a SyntaxError
    // (the CJS transpile in execute() would hide it), so type-check the output.
    expect(expanded.code.match(/export const ReadAcct\b/g)).toHaveLength(1);
    expect(expanded.code.match(/export const WriteAcct\b/g)).toHaveLength(1);
    expect(typecheck(expanded.code.replace(/"@typesugar\/sql"/g, '"../src/index.js"'))).toEqual([]);
    const row = { id: 1, owner_name: "a" };
    expect((exports.ReadAcct as Read<unknown>).read(row)).toEqual({ id: 1, ownerName: "a" });
    expect(
      (exports.WriteAcct as { write(v: unknown): unknown }).write({ id: 2, ownerName: "b" })
    ).toEqual([2, "b"]);
    const codec = exports.CodecAcct as Read<unknown> & { write(v: unknown): unknown };
    expect(codec.read(row)).toEqual({ id: 1, ownerName: "a" });
    expect(codec.write({ id: 3, ownerName: "c" })).toEqual([3, "c"]);
  });

  it("works whatever order Codec appears in", async () => {
    const { exports, expanded } = await expandAndRun(`
      import { Read } from "@typesugar/sql";
      /** @derive(Codec, Read) */
      interface Acct2 { id: number }
    `);
    expect(expanded.code.match(/export const ReadAcct2\b/g)).toHaveLength(1);
    expect((exports.CodecAcct2 as Read<unknown>).read({ id: 5 })).toEqual({ id: 5 });
    expect((exports.ReadAcct2 as Read<unknown>).read({ id: 6 })).toEqual({ id: 6 });
  });

  it("@derive(Codec) alone still generates ReadX, WriteX and CodecX", async () => {
    const { exports } = await expandAndRun(`
      import { Read } from "@typesugar/sql";
      /** @derive(Codec) */
      interface Acct3 { id: number }
    `);
    expect(exports.ReadAcct3).toBeDefined();
    expect(exports.WriteAcct3).toBeDefined();
    expect((exports.CodecAcct3 as Read<unknown>).read({ id: 7 })).toEqual({ id: 7 });
  });
});

// ============================================================================
// C#11: Fragment.toQuery / toUpdate in the published types
// ============================================================================

describe("C#11: sql`...`.toQuery()/.toUpdate() type-check against the built dist", () => {
  const distDts = path.join(here, "..", "dist", "index.d.ts");

  it("dist/index.d.ts declares toQuery/toUpdate on Fragment for consumers", () => {
    expect(fs.existsSync(distDts)).toBe(true);
    const diags = typecheck(`
      import { sql, type Query, type Update } from "../dist/index.js";
      interface User { id: number; name: string }
      const id = 1;
      export const q: Query<User> = sql\`SELECT id, name FROM users WHERE id = \${id}\`.toQuery<User>();
      export const u: Update = sql\`UPDATE users SET name = \${"x"} WHERE id = \${id}\`.toUpdate();
    `);
    expect(diags).toEqual([]);
  });

  it("works at runtime", () => {
    const q = sql`SELECT 1`.toQuery<{ n: number }>();
    expect(q).toBeInstanceOf(Query);
    expect(sql`DELETE FROM t`.toUpdate().text).toBe("DELETE FROM t");
  });
});

// ============================================================================
// C#15: TypedQuery / TypedUpdate methods do what they say
// ============================================================================

describe("C#15: TypedQuery/TypedUpdate/Query methods are not no-ops", () => {
  const users = [
    { id: 1, user_name: "a" },
    { id: 2, user_name: "b" },
  ];
  const ReadUser = Read.make<{ id: number; userName: string }>(
    [
      { field: "id", column: "id", get: Meta.int, nullable: false },
      { field: "userName", column: "user_name", get: Meta.string, nullable: false },
    ] as never,
    (fields) => fields as { id: number; userName: string }
  );
  const selectFrag = () =>
    new TypedFragment<[], Record<string, unknown>>(["SELECT id, user_name FROM users"], []);

  it("to(read) decodes rows with the Read instance", async () => {
    const xa = Transactor.fromConnection(mockConn(users));
    const q = selectFrag().toQuery().to(ReadUser);
    expect(await xa.run(ConnectionIO.queryMany(q))).toEqual([
      { id: 1, userName: "a" },
      { id: 2, userName: "b" },
    ]);
  });

  it("map(f) applies f to each decoded row", async () => {
    const xa = Transactor.fromConnection(mockConn(users));
    const q = selectFrag()
      .toQuery()
      .to(ReadUser)
      .map((u) => u.userName.toUpperCase());
    expect(await xa.run(ConnectionIO.queryMany(q))).toEqual(["A", "B"]);
    expect(await xa.run(ConnectionIO.query(q))).toBe("A");
  });

  it("map(f) without to() maps the raw row", async () => {
    const xa = Transactor.fromConnection(mockConn([{ count: 3 }]));
    const q = new TypedFragment<[], { count: number }>(["SELECT COUNT(*) AS count FROM t"], [])
      .toQuery()
      .map((r) => r.count > 0);
    expect(await xa.run(ConnectionIO.query(q))).toBe(true);
  });

  it("passing a Read to a query that already decodes is rejected, not silently ignored", () => {
    const q = selectFrag().toQuery().to(ReadUser);
    expect(() => ConnectionIO.queryMany(q, ReadUser)).toThrow(/already/);
  });

  it("unique() fails unless exactly one row comes back", async () => {
    const q = selectFrag().toQuery().to(ReadUser).unique();
    await expect(
      Transactor.fromConnection(mockConn(users)).run(ConnectionIO.query(q))
    ).rejects.toThrow(/exactly one row.*2/);
    await expect(
      Transactor.fromConnection(mockConn([])).run(ConnectionIO.query(q))
    ).rejects.toThrow(/exactly one row.*0/);
    expect(
      await Transactor.fromConnection(mockConn([users[0]])).run(ConnectionIO.query(q))
    ).toEqual({ id: 1, userName: "a" });
  });

  it("option() returns null for no row and fails for more than one", async () => {
    const q = selectFrag().toQuery().to(ReadUser).option();
    expect(await Transactor.fromConnection(mockConn([])).run(ConnectionIO.query(q))).toBeNull();
    await expect(
      Transactor.fromConnection(mockConn(users)).run(ConnectionIO.query(q))
    ).rejects.toThrow(/at most one row.*2/);
  });

  it("TypedUpdate.run() executes and returns the affected count", async () => {
    const conn = mockConn([], 4);
    const upd = new TypedFragment<[number], void>(
      ["DELETE FROM t WHERE id = ", ""],
      [1]
    ).toUpdate();
    const program = upd.run();
    expect(program).toBeInstanceOf(ConnectionIO);
    expect(await Transactor.fromConnection(conn).run(program)).toBe(4);
    expect(conn.execute).toHaveBeenCalledWith("DELETE FROM t WHERE id = $1", [1]);
  });

  it('withGeneratedKeys("id") appends RETURNING', async () => {
    const upd = new TypedUpdate(
      new TypedFragment<[string, string], void>(
        ["INSERT INTO users (name, email) VALUES (", ", ", ")"],
        ["a", "b"]
      )
    );
    const q = upd.withGeneratedKeys("id");
    expect(q).toBeInstanceOf(TypedQuery);
    expect(q.toSql().sql).toBe("INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id");
    expect(q.toSql().params).toEqual(["a", "b"]);
    const conn = mockConn([{ id: 9 }]);
    expect(await Transactor.fromConnection(conn).run(ConnectionIO.queryMany(q))).toEqual([
      { id: 9 },
    ]);
    expect(() => upd.withGeneratedKeys("id; DROP TABLE x" as "id")).toThrow();
  });

  it("withGeneratedKeys does not add a second RETURNING", () => {
    const upd = new TypedUpdate(
      new TypedFragment<[], void>(["INSERT INTO t DEFAULT VALUES RETURNING id"], [])
    );
    expect(upd.withGeneratedKeys("id").toSql().sql).toBe(
      "INSERT INTO t DEFAULT VALUES RETURNING id"
    );
  });

  it("untyped Query.map(f) applies f", async () => {
    const xa = Transactor.fromConnection(mockConn([{ n: 2 }]));
    const q = sql`SELECT 2 AS n`.toQuery<{ n: number }>().map((r) => r.n * 10);
    expect(await xa.run(ConnectionIO.query(q))).toBe(20);
  });
});

// ============================================================================
// C#16: DeriveColumn.field is optional
// ============================================================================

describe("C#16: deriveRead config does not need `field`", () => {
  it("the doc example type-checks", () => {
    const diags = typecheck(`
      import { deriveRead, deriveWrite, deriveCodec, Meta } from "../src/index.js";
      interface User { id: number; name: string; createdAt: Date }
      export const R = deriveRead<User>({
        id: { meta: Meta.int },
        name: { meta: Meta.string },
        createdAt: { meta: Meta.date, column: "created_at" },
      });
      export const W = deriveWrite<User>({
        id: { meta: Meta.int },
        name: { meta: Meta.string },
        createdAt: { meta: Meta.date, column: "created_at" },
      });
      export const C = deriveCodec<User>({
        id: { meta: Meta.int },
        name: { meta: Meta.string },
        createdAt: { meta: Meta.date, column: "created_at" },
      });
    `);
    expect(diags).toEqual([]);
  });

  it("the record key is used as the field", () => {
    const R = deriveRead<{ id: number; userName: string }>({
      id: { meta: Meta.int },
      userName: { meta: Meta.string },
    });
    expect(R.read({ id: 1, user_name: "x" })).toEqual({ id: 1, userName: "x" });
  });
});

// ============================================================================
// C#27: sql$ widens literal parameter types
// ============================================================================

describe("C#27: sql$ infers widened parameter types", () => {
  it("sql$`WHERE id = ${0}` is TypedFragment<[number], void>", () => {
    const { code, errors } = expand(`
      import { sql$, andTyped } from "@typesugar/sql";
      export const byId = sql$\`WHERE id = \${0}\`;
      export const byName = sql$\`name = \${"x"}\`;
      export const flag = sql$\`active = \${true}\`;
    `);
    expect(errors).toEqual([]);
    const out = code.replace(/\s+/g, "");
    expect(out).toContain("__typed_sql_build<[number],void>");
    expect(out).toContain("<[string],void>");
    expect(out).toContain("<[boolean],void>");
    expect(out).not.toMatch(/<\[0\]/);
  });

  it("andTyped over mixed literals type-checks in the output", () => {
    const { code, errors } = expand(`
      import { sql$, andTyped } from "@typesugar/sql";
      export const a = sql$\`id = \${0}\`;
      export const b = sql$\`id = \${1}\`;
      export const both = andTyped(a, b);
    `);
    expect(errors).toEqual([]);
    const diags = typecheck(code.replace(/"@typesugar\/sql"/g, '"../src/index.js"'));
    expect(diags).toEqual([]);
  });
});

// ============================================================================
// C#10: @schema is not silent
// ============================================================================

describe("C#10: @schema warns that schema inference is not implemented", () => {
  it("decorator form", () => {
    const { warnings, errors } = expand(`
      import { sql$ } from "@typesugar/sql";
      @schema("users")
      interface UsersTable { id: number; name: string }
      export const q = sql$\`SELECT * FROM users\`;
    `);
    expect(errors).toEqual([]);
    expect(warnings.join("\n")).toMatch(/@schema.*not implemented/i);
  });
});
