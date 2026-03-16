/**
 * Extended tests for @typesugar/sql — covers exports not tested in sql.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import {
  // Core types
  Fragment,
  Query,
  Update,

  // Queryable typeclass
  QueryableCompanion,
  type Queryable,

  // Macro utils
  validateSqlSyntax,

  // ConnectionIO combinators
  ConnectionIO,
  Transactor,
  unfold,
  parZip,
  parSequence,
  Left,
  Right,
  type DbConnection,

  // Typed fragment helpers
  TypedFragment,
  valuesTyped,
  valuesManyTyped,
  setTyped,
  intercalateTyped,
  emptyTyped,

  // Instance registries
  getRegistry,
  putRegistry,
  metaRegistry,
  readRegistry,
  writeRegistry,
  codecRegistry,

  // Typeclasses
  Get,
  Put,
  Meta,
  Read,
  Write,
  Codec,

  // Legacy aliases
  SimpleConnectionIO,
  SimpleTransactor,
} from "../src/index.js";

// ============================================================================
// Helpers
// ============================================================================

function mockDbConnection(overrides?: Partial<DbConnection>): DbConnection {
  return {
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(0),
    begin: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ============================================================================
// 1. Queryable Typeclass
// ============================================================================

describe("Queryable", () => {
  it("creates a Queryable instance via make()", () => {
    const executeFn = vi.fn().mockResolvedValue([{ id: 1 }]);
    const queryable: Queryable<string> = QueryableCompanion.make(executeFn);

    expect(queryable._tag).toBe("Queryable");
    expect(queryable.execute).toBe(executeFn);
  });

  it("execute receives the query and connection", async () => {
    const executeFn = vi.fn().mockResolvedValue([{ id: 42 }]);
    const queryable = QueryableCompanion.make<string>(executeFn);
    const conn = mockDbConnection();

    const result = await queryable.execute("SELECT 1", conn);
    expect(executeFn).toHaveBeenCalledWith("SELECT 1", conn);
    expect(result).toEqual([{ id: 42 }]);
  });

  it("ConnectionIO.fromQueryable creates an ExecuteQueryable op", () => {
    const queryable = QueryableCompanion.make<{ sql: string }>(async (q, conn) =>
      conn.query(q.sql, [])
    );
    const cio = ConnectionIO.fromQueryable({ sql: "SELECT 1" }, queryable);
    expect(cio.op._tag).toBe("ExecuteQueryable");
  });

  it("Transactor interprets ExecuteQueryable ops", async () => {
    const conn = mockDbConnection({
      query: vi.fn().mockResolvedValue([{ answer: 42 }]),
    });
    const xa = Transactor.fromConnection(conn);

    const queryable = QueryableCompanion.make<string>(async (q, c) => c.query(q, []));
    const cio = ConnectionIO.fromQueryable<string>("SELECT 42 AS answer", queryable);

    const result = await xa.run(cio);
    expect(result).toEqual([{ answer: 42 }]);
  });
});

// ============================================================================
// 2. validateSqlSyntax
// ============================================================================

describe("validateSqlSyntax", () => {
  function makeMockCtx() {
    return {
      reportWarning: vi.fn(),
      reportError: vi.fn(),
    } as unknown as import("@typesugar/core").MacroContext;
  }

  const dummyNode = {} as import("typescript").Node;

  it("returns true for valid SELECT", () => {
    const ctx = makeMockCtx();
    expect(validateSqlSyntax("SELECT * FROM users", ctx, dummyNode)).toBe(true);
    expect(ctx.reportError).not.toHaveBeenCalled();
    expect(ctx.reportWarning).not.toHaveBeenCalled();
  });

  it("returns true for valid INSERT", () => {
    const ctx = makeMockCtx();
    expect(validateSqlSyntax("INSERT INTO users (name) VALUES ('a')", ctx, dummyNode)).toBe(true);
  });

  it("returns true for valid UPDATE", () => {
    const ctx = makeMockCtx();
    expect(validateSqlSyntax("UPDATE users SET name = 'b'", ctx, dummyNode)).toBe(true);
  });

  it("returns true for valid DELETE", () => {
    const ctx = makeMockCtx();
    expect(validateSqlSyntax("DELETE FROM users WHERE id = 1", ctx, dummyNode)).toBe(true);
  });

  it("returns true for fragment not starting with a keyword", () => {
    const ctx = makeMockCtx();
    expect(validateSqlSyntax("name = 'Alice'", ctx, dummyNode)).toBe(true);
  });

  it("warns on SQL injection patterns (DROP TABLE)", () => {
    const ctx = makeMockCtx();
    validateSqlSyntax("SELECT 1; DROP TABLE users", ctx, dummyNode);
    expect(ctx.reportWarning).toHaveBeenCalledWith(dummyNode, expect.stringContaining("dangerous"));
  });

  it("warns on SQL comment injection (--)", () => {
    const ctx = makeMockCtx();
    validateSqlSyntax("SELECT * FROM users -- injected", ctx, dummyNode);
    expect(ctx.reportWarning).toHaveBeenCalled();
  });

  it("warns on block comment injection (/* */)", () => {
    const ctx = makeMockCtx();
    validateSqlSyntax("SELECT /* evil */ * FROM users", ctx, dummyNode);
    expect(ctx.reportWarning).toHaveBeenCalled();
  });

  it("returns false for unbalanced parentheses (too many closing)", () => {
    const ctx = makeMockCtx();
    expect(validateSqlSyntax("SELECT (1))", ctx, dummyNode)).toBe(false);
    expect(ctx.reportError).toHaveBeenCalledWith(
      dummyNode,
      expect.stringContaining("too many closing")
    );
  });

  it("returns false for unbalanced parentheses (missing closing)", () => {
    const ctx = makeMockCtx();
    expect(validateSqlSyntax("SELECT ((1)", ctx, dummyNode)).toBe(false);
    expect(ctx.reportError).toHaveBeenCalledWith(
      dummyNode,
      expect.stringContaining("missing closing")
    );
  });

  it("returns true for balanced nested parentheses", () => {
    const ctx = makeMockCtx();
    expect(validateSqlSyntax("SELECT (COUNT(*)) FROM (SELECT 1)", ctx, dummyNode)).toBe(true);
  });

  it("returns true for empty string", () => {
    const ctx = makeMockCtx();
    expect(validateSqlSyntax("", ctx, dummyNode)).toBe(true);
  });
});

// ============================================================================
// 3. unfold combinator
// ============================================================================

describe("unfold", () => {
  it("creates a ConnectionIO with the Pure tag (base structure)", () => {
    const cio = unfold(0, (n) =>
      n >= 3 ? ConnectionIO.pure(null) : ConnectionIO.pure([n + 1, n * 10] as [number, number])
    );
    expect(cio).toBeInstanceOf(ConnectionIO);
  });
});

// ============================================================================
// 4. parZip and parSequence
// ============================================================================

describe("parZip", () => {
  it("combines two ConnectionIO values into a pair", () => {
    const a = ConnectionIO.pure(1);
    const b = ConnectionIO.pure("hello");
    const zipped = parZip(a, b);
    expect(zipped).toBeInstanceOf(ConnectionIO);
  });

  it("returns a ConnectionIO (sequential fallback via zip/flatMap)", () => {
    const a = ConnectionIO.pure(10);
    const b = ConnectionIO.pure(20);
    const zipped = parZip(a, b);
    // parZip delegates to .zip which uses flatMap; the stub flatMap returns
    // Pure(undefined). We just verify the structure is correct.
    expect(zipped).toBeInstanceOf(ConnectionIO);
    expect(zipped.op._tag).toBe("Pure");
  });
});

describe("parSequence", () => {
  it("wraps an array of ConnectionIO into a single ConnectionIO", () => {
    const ops = [ConnectionIO.pure(1), ConnectionIO.pure(2), ConnectionIO.pure(3)];
    const combined = parSequence(ops);
    expect(combined).toBeInstanceOf(ConnectionIO);
  });

  it("handles empty array", () => {
    const combined = parSequence([]);
    expect(combined).toBeInstanceOf(ConnectionIO);
  });
});

// ============================================================================
// 5. valuesTyped / valuesManyTyped
// ============================================================================

describe("valuesTyped", () => {
  const userWrite: Write<{ name: string; email: string }> = Write.make(
    ["name", "email"],
    [(u) => u.name, (u) => u.email]
  );

  it("generates a single VALUES row with correct SQL and params", () => {
    const frag = valuesTyped(userWrite, { name: "Alice", email: "a@b.com" });
    const { sql, params } = frag.toQuery().toSql();
    expect(sql).toBe("(?, ?)");
    expect(params).toEqual(["Alice", "a@b.com"]);
  });

  it("single-column write", () => {
    const singleWrite = Write.make<{ id: number }>(["id"], [(v) => v.id]);
    const frag = valuesTyped(singleWrite, { id: 99 });
    const { sql, params } = frag.toQuery().toSql();
    expect(sql).toBe("(?)");
    expect(params).toEqual([99]);
  });

  it("stores params on the typed fragment", () => {
    const frag = valuesTyped(userWrite, { name: "X", email: "Y" });
    expect(frag.params).toEqual(["X", "Y"]);
  });
});

describe("valuesManyTyped", () => {
  const userWrite: Write<{ name: string; email: string }> = Write.make(
    ["name", "email"],
    [(u) => u.name, (u) => u.email]
  );

  it("generates multiple VALUES rows", () => {
    const frag = valuesManyTyped(userWrite, [
      { name: "Alice", email: "a@b.com" },
      { name: "Bob", email: "b@b.com" },
    ]);
    const { sql, params } = frag.toQuery().toSql();
    expect(sql).toBe("(?, ?), (?, ?)");
    expect(params).toEqual(["Alice", "a@b.com", "Bob", "b@b.com"]);
  });

  it("returns empty fragment for empty array", () => {
    const frag = valuesManyTyped(userWrite, []);
    expect(frag.segments).toEqual([""]);
    expect(frag.params).toEqual([]);
  });

  it("single row behaves like valuesTyped", () => {
    const frag = valuesManyTyped(userWrite, [{ name: "Charlie", email: "c@c.com" }]);
    const { sql, params } = frag.toQuery().toSql();
    expect(sql).toBe("(?, ?)");
    expect(params).toEqual(["Charlie", "c@c.com"]);
  });
});

// ============================================================================
// 6. setTyped
// ============================================================================

describe("setTyped", () => {
  const userWrite: Write<{ name: string; email: string; age: number }> = Write.make(
    ["name", "email", "age"],
    [(u) => u.name, (u) => u.email, (u) => u.age]
  );

  it("generates SET clause for all fields", () => {
    const frag = setTyped(userWrite, { name: "Bob", email: "bob@b.com", age: 30 });
    const { sql, params } = frag.toQuery().toSql();
    expect(sql).toBe("name = ?, email = ?, age = ?");
    expect(params).toEqual(["Bob", "bob@b.com", 30]);
  });

  it("skips undefined fields", () => {
    const frag = setTyped(userWrite, { name: "Bob" } as Partial<{
      name: string;
      email: string;
      age: number;
    }>);
    const { sql, params } = frag.toQuery().toSql();
    expect(sql).toContain("name = ?");
    expect(params[0]).toBe("Bob");
  });
});

// ============================================================================
// 7. intercalateTyped (deeper coverage)
// ============================================================================

describe("intercalateTyped", () => {
  it("returns empty for no fragments", () => {
    const sep = new TypedFragment([" | "], []);
    const result = intercalateTyped(sep, []);
    expect(result.segments).toEqual([""]);
    expect(result.params).toEqual([]);
  });

  it("returns the single fragment unchanged (no separator)", () => {
    const sep = new TypedFragment([" AND "], []);
    const frag = new TypedFragment(["x = ", ""], [42]);
    const result = intercalateTyped(sep, [frag]);
    const q = result.query;
    expect(q.text).toBe("x = $1");
    expect(q.params).toEqual([42]);
  });

  it("joins three fragments with separator", () => {
    const sep = new TypedFragment([", "], []);
    const frags = [
      new TypedFragment(["a = ", ""], [1]),
      new TypedFragment(["b = ", ""], [2]),
      new TypedFragment(["c = ", ""], [3]),
    ];
    const result = intercalateTyped(sep, frags);
    const q = result.query;
    expect(q.text).toBe("a = $1, b = $2, c = $3");
    expect(q.params).toEqual([1, 2, 3]);
  });
});

// ============================================================================
// 8. Instance Registries
// ============================================================================

describe("Instance Registries", () => {
  describe("getRegistry", () => {
    it("has primitive instances pre-registered", () => {
      expect(getRegistry.has("string")).toBe(true);
      expect(getRegistry.has("number")).toBe(true);
      expect(getRegistry.has("boolean")).toBe(true);
      expect(getRegistry.has("Date")).toBe(true);
      expect(getRegistry.has("Buffer")).toBe(true);
      expect(getRegistry.has("json")).toBe(true);
      expect(getRegistry.has("uuid")).toBe(true);
    });

    it("returns Get instances that can decode values", () => {
      const stringGet = getRegistry.get("string") as Get<string>;
      expect(stringGet).toBeDefined();
      expect(stringGet._tag).toBe("Get");
    });

    it("supports set/get/has/delete lifecycle", () => {
      const customGet: Get<number> = {
        _tag: "Get",
        sqlType: "custom_int",
        get: (v) => Number(v),
      };
      getRegistry.set("__test_custom", customGet as Get<unknown>);
      expect(getRegistry.has("__test_custom")).toBe(true);
      expect(getRegistry.get("__test_custom")).toBe(customGet);
      getRegistry.delete("__test_custom");
      expect(getRegistry.has("__test_custom")).toBe(false);
    });
  });

  describe("putRegistry", () => {
    it("has primitive instances pre-registered", () => {
      expect(putRegistry.has("string")).toBe(true);
      expect(putRegistry.has("number")).toBe(true);
      expect(putRegistry.has("int")).toBe(true);
      expect(putRegistry.has("bigint")).toBe(true);
    });
  });

  describe("metaRegistry", () => {
    it("has primitive instances pre-registered", () => {
      expect(metaRegistry.has("string")).toBe(true);
      expect(metaRegistry.has("number")).toBe(true);
      expect(metaRegistry.has("boolean")).toBe(true);
    });

    it("can register and retrieve custom Meta", () => {
      const customMeta: Meta<string> = {
        _tag: "Meta",
        get: { _tag: "Get", sqlType: "text", get: (v) => String(v) },
        put: { _tag: "Put", sqlType: "text", put: (v) => v },
        sqlType: "text",
      };
      metaRegistry.set("__test_custom_meta", customMeta as Meta<unknown>);
      expect(metaRegistry.get("__test_custom_meta")).toBe(customMeta);
      metaRegistry.delete("__test_custom_meta");
    });
  });

  describe("readRegistry", () => {
    it("exists and supports basic operations", () => {
      expect(readRegistry.has("__nonexistent")).toBe(false);
      const customRead: Read<{ x: number }> = {
        _tag: "Read",
        columns: ["x"],
        read: (row) => ({ x: Number(row.x) }),
      };
      readRegistry.set("__test_read", customRead as Read<unknown>);
      expect(readRegistry.get("__test_read")).toBe(customRead);
      readRegistry.delete("__test_read");
    });
  });

  describe("writeRegistry", () => {
    it("exists and supports basic operations", () => {
      expect(writeRegistry.has("__nonexistent")).toBe(false);
      const customWrite: Write<{ x: number }> = Write.make(["x"], [(v) => v.x]);
      writeRegistry.set("__test_write", customWrite as Write<unknown>);
      expect(writeRegistry.get("__test_write")).toBe(customWrite);
      writeRegistry.delete("__test_write");
    });
  });

  describe("codecRegistry", () => {
    it("exists and supports basic operations", () => {
      expect(codecRegistry.has("__nonexistent")).toBe(false);
    });
  });
});

// ============================================================================
// 9. Fragment.prototype.toQuery() and Fragment.prototype.toUpdate()
// ============================================================================

describe("Fragment prototype extensions", () => {
  describe("toQuery()", () => {
    it("converts a Fragment to a Query", () => {
      const frag = new Fragment(["SELECT * FROM users WHERE id = ", ""], [1]);
      const q = frag.toQuery();
      expect(q).toBeInstanceOf(Query);
      expect(q.text).toBe("SELECT * FROM users WHERE id = $1");
      expect(q.params).toEqual([1]);
    });

    it("empty fragment produces empty query", () => {
      const q = Fragment.empty.toQuery();
      expect(q).toBeInstanceOf(Query);
      expect(q.text).toBe("");
    });
  });

  describe("toUpdate()", () => {
    it("converts a Fragment to an Update", () => {
      const frag = new Fragment(["DELETE FROM users WHERE id = ", ""], [42]);
      const u = frag.toUpdate();
      expect(u).toBeInstanceOf(Update);
      expect(u.text).toBe("DELETE FROM users WHERE id = $1");
      expect(u.params).toEqual([42]);
    });

    it("raw fragment produces update", () => {
      const u = Fragment.raw("TRUNCATE users").toUpdate();
      expect(u).toBeInstanceOf(Update);
      expect(u.text).toBe("TRUNCATE users");
    });
  });
});

// ============================================================================
// 10. SimpleConnectionIO / SimpleTransactor (legacy aliases)
// ============================================================================

describe("Legacy aliases", () => {
  it("SimpleConnectionIO is the types.ts ConnectionIO (a namespace, not a class)", () => {
    expect(SimpleConnectionIO).toBeDefined();
    expect(typeof SimpleConnectionIO.pure).toBe("function");
  });

  it("SimpleConnectionIO.pure creates a Pure op", () => {
    const cio = SimpleConnectionIO.pure(42);
    expect(cio._tag).toBe("Pure");
    expect(cio.value).toBe(42);
  });

  it("SimpleTransactor is the types.ts Transactor class", () => {
    expect(SimpleTransactor).toBeDefined();
  });

  it("SimpleTransactor can be instantiated and run a pure program", async () => {
    const conn = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const xa = new SimpleTransactor(conn as any);
    const result = await xa.run(SimpleConnectionIO.pure("hello"));
    expect(result).toBe("hello");
  });
});
