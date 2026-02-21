/**
 * Tests for the Doobie-like SQL DSL
 */

import { describe, it, expect } from "vitest";
import {
  Fragment,
  Query,
  Update,
  SimpleConnectionIO as ConnectionIO,
  SimpleTransactor as Transactor,
  sql,
  __sql_build,
  type SqlParam,
  type SimpleDbConnection as DbConnection,
} from "../index.js";

// ============================================================================
// Fragment — core building block
// ============================================================================

describe("Fragment", () => {
  describe("construction", () => {
    it("should create an empty fragment", () => {
      const f = Fragment.empty;
      expect(f.text).toBe("");
      expect(f.values).toEqual([]);
    });

    it("should create a raw SQL fragment", () => {
      const f = Fragment.raw("SELECT 1");
      expect(f.text).toBe("SELECT 1");
      expect(f.values).toEqual([]);
    });

    it("should create a single parameter fragment", () => {
      const f = Fragment.param(42);
      expect(f.text).toBe("$1");
      expect(f.values).toEqual([42]);
    });

    it("should create a fragment with segments and params", () => {
      const f = new Fragment(["SELECT * FROM users WHERE id = ", ""], [42]);
      expect(f.text).toBe("SELECT * FROM users WHERE id = $1");
      expect(f.values).toEqual([42]);
    });
  });

  describe("rendering", () => {
    it("should number parameters sequentially", () => {
      const f = new Fragment(
        ["SELECT * FROM users WHERE name = ", " AND age > ", ""],
        ["Alice", 30]
      );
      expect(f.text).toBe("SELECT * FROM users WHERE name = $1 AND age > $2");
      expect(f.values).toEqual(["Alice", 30]);
    });

    it("should handle many parameters", () => {
      const params: SqlParam[] = [1, 2, 3, 4, 5];
      const segments = ["a = ", ", b = ", ", c = ", ", d = ", ", e = ", ""];
      const f = new Fragment(segments, params);
      expect(f.text).toBe("a = $1, b = $2, c = $3, d = $4, e = $5");
      expect(f.values).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe("composition", () => {
    it("should append two fragments with a space", () => {
      const a = Fragment.raw("SELECT * FROM users");
      const b = Fragment.raw("WHERE active = true");
      const result = a.append(b);
      expect(result.text).toBe("SELECT * FROM users WHERE active = true");
    });

    it("should append fragments preserving parameters", () => {
      const a = new Fragment(["SELECT * FROM users WHERE name = ", ""], ["Alice"]);
      const b = new Fragment(["AND age > ", ""], [30]);
      const result = a.append(b);
      expect(result.text).toBe("SELECT * FROM users WHERE name = $1 AND age > $2");
      expect(result.values).toEqual(["Alice", 30]);
    });

    it("should prepend a fragment", () => {
      const a = Fragment.raw("WHERE id = 1");
      const b = Fragment.raw("SELECT * FROM users");
      const result = a.prepend(b);
      expect(result.text).toBe("SELECT * FROM users WHERE id = 1");
    });

    it("should appendNoSpace without adding a space", () => {
      const a = Fragment.raw("(");
      const b = Fragment.raw("SELECT 1");
      const c = Fragment.raw(")");
      const result = a.appendNoSpace(b).appendNoSpace(c);
      expect(result.text).toBe("(SELECT 1)");
    });

    it("should wrap in parentheses", () => {
      const f = Fragment.raw("a = 1 OR b = 2");
      const result = f.parens();
      expect(result.text).toBe("(a = 1 OR b = 2)");
    });
  });

  describe("combinators", () => {
    it("should join with AND", () => {
      const conditions = [
        new Fragment(["name = ", ""], ["Alice"]),
        new Fragment(["age > ", ""], [30]),
        Fragment.raw("active = true"),
      ];
      const result = Fragment.and(conditions);
      expect(result.text).toBe("name = $1 AND age > $2 AND active = true");
      expect(result.values).toEqual(["Alice", 30]);
    });

    it("should join with OR and wrap in parens", () => {
      const conditions = [
        new Fragment(["role = ", ""], ["admin"]),
        new Fragment(["role = ", ""], ["superuser"]),
      ];
      const result = Fragment.or(conditions);
      expect(result.text).toBe("(role = $1 OR role = $2)");
      expect(result.values).toEqual(["admin", "superuser"]);
    });

    it("should handle empty AND", () => {
      const result = Fragment.and([]);
      expect(result.text).toBe("");
    });

    it("should handle single-element AND", () => {
      const result = Fragment.and([Fragment.raw("x = 1")]);
      expect(result.text).toBe("x = 1");
    });

    it("should create comma-separated lists", () => {
      const cols = [Fragment.raw("id"), Fragment.raw("name"), Fragment.raw("email")];
      const result = Fragment.commas(cols);
      expect(result.text).toBe("id, name, email");
    });
  });

  describe("IN list", () => {
    it("should create an IN clause", () => {
      const result = Fragment.inList("id", [1, 2, 3]);
      expect(result.text).toBe("id IN ($1, $2, $3)");
      expect(result.values).toEqual([1, 2, 3]);
    });

    it("should handle single-element IN", () => {
      const result = Fragment.inList("status", ["active"]);
      expect(result.text).toBe("status IN ($1)");
      expect(result.values).toEqual(["active"]);
    });

    it("should return FALSE for empty IN", () => {
      const result = Fragment.inList("id", []);
      expect(result.text).toBe("FALSE");
      expect(result.values).toEqual([]);
    });
  });

  describe("VALUES clause", () => {
    it("should create a VALUES clause for bulk insert", () => {
      const result = Fragment.values([
        ["Alice", 30],
        ["Bob", 25],
      ]);
      expect(result.text).toBe("VALUES ($1, $2), ($3, $4)");
      expect(result.values).toEqual(["Alice", 30, "Bob", 25]);
    });

    it("should handle single row", () => {
      const result = Fragment.values([["Alice", 30, true]]);
      expect(result.text).toBe("VALUES ($1, $2, $3)");
      expect(result.values).toEqual(["Alice", 30, true]);
    });
  });

  describe("SET clause", () => {
    it("should create a SET clause for updates", () => {
      const result = Fragment.set({ name: "Bob", age: 31 });
      expect(result.text).toBe("SET name = $1, age = $2");
      expect(result.values).toEqual(["Bob", 31]);
    });
  });

  describe("conditional fragments", () => {
    it("should include fragment when condition is true", () => {
      const result = Fragment.when(true, () => Fragment.raw("AND active = true"));
      expect(result.text).toBe("AND active = true");
    });

    it("should return empty when condition is false", () => {
      const result = Fragment.when(false, () => Fragment.raw("AND active = true"));
      expect(result.text).toBe("");
    });

    it("should build WHERE clause from optional conditions", () => {
      const nameFilter = "Alice";
      const minAge = 25;
      const isActive = false;

      const result = Fragment.whereAnd([
        Fragment.when(!!nameFilter, () => new Fragment(["name = ", ""], [nameFilter])),
        Fragment.when(minAge > 0, () => new Fragment(["age >= ", ""], [minAge])),
        Fragment.when(isActive, () => Fragment.raw("active = true")),
      ]);

      expect(result.text).toBe("WHERE name = $1 AND age >= $2");
      expect(result.values).toEqual(["Alice", 25]);
    });

    it("should return empty WHERE when no conditions match", () => {
      const result = Fragment.whereAnd([
        Fragment.when(false, () => Fragment.raw("x = 1")),
        Fragment.when(false, () => Fragment.raw("y = 2")),
      ]);
      expect(result.text).toBe("");
    });
  });

  describe("toString", () => {
    it("should produce a debug string", () => {
      const f = new Fragment(["SELECT * FROM users WHERE id = ", ""], [42]);
      expect(f.toString()).toBe("Fragment(SELECT * FROM users WHERE id = $1, [42])");
    });
  });
});

// ============================================================================
// sql`` tagged template (runtime fallback)
// ============================================================================

describe("sql tagged template", () => {
  it("should create a fragment from a simple string", () => {
    const q = sql`SELECT 1`;
    expect(q.text).toBe("SELECT 1");
    expect(q.values).toEqual([]);
  });

  it("should bind interpolated values as parameters", () => {
    const name = "Alice";
    const age = 30;
    const q = sql`SELECT * FROM users WHERE name = ${name} AND age > ${age}`;
    expect(q.text).toBe("SELECT * FROM users WHERE name = $1 AND age > $2");
    expect(q.values).toEqual(["Alice", 30]);
  });

  it("should handle a single parameter", () => {
    const id = 42;
    const q = sql`SELECT * FROM users WHERE id = ${id}`;
    expect(q.text).toBe("SELECT * FROM users WHERE id = $1");
    expect(q.values).toEqual([42]);
  });

  it("should handle null parameters", () => {
    const q = sql`UPDATE users SET deleted_at = ${null} WHERE id = ${1}`;
    expect(q.text).toBe("UPDATE users SET deleted_at = $1 WHERE id = $2");
    expect(q.values).toEqual([null, 1]);
  });

  it("should handle boolean parameters", () => {
    const q = sql`SELECT * FROM users WHERE active = ${true}`;
    expect(q.text).toBe("SELECT * FROM users WHERE active = $1");
    expect(q.values).toEqual([true]);
  });

  it("should compose with Fragment interpolations", () => {
    const cond = sql`WHERE active = ${true}`;
    const q = sql`SELECT * FROM users ${cond}`;
    expect(q.text).toBe("SELECT * FROM users WHERE active = $1");
    expect(q.values).toEqual([true]);
  });

  it("should compose nested fragments with correct param numbering", () => {
    const name = "Alice";
    const age = 30;
    const status = "active";

    const cond = sql`name = ${name} AND age > ${age}`;
    const q = sql`SELECT * FROM users WHERE ${cond} AND status = ${status}`;

    expect(q.text).toBe("SELECT * FROM users WHERE name = $1 AND age > $2 AND status = $3");
    expect(q.values).toEqual(["Alice", 30, "active"]);
  });

  it("should handle deeply nested fragments", () => {
    const inner = sql`x = ${1}`;
    const middle = sql`${inner} AND y = ${2}`;
    const outer = sql`SELECT * FROM t WHERE ${middle} AND z = ${3}`;

    expect(outer.text).toBe("SELECT * FROM t WHERE x = $1 AND y = $2 AND z = $3");
    expect(outer.values).toEqual([1, 2, 3]);
  });
});

// ============================================================================
// __sql_build runtime helper
// ============================================================================

describe("__sql_build", () => {
  it("should build a fragment from segments and plain values", () => {
    const f = __sql_build(["SELECT * FROM users WHERE id = ", ""], [42]);
    expect(f.text).toBe("SELECT * FROM users WHERE id = $1");
    expect(f.values).toEqual([42]);
  });

  it("should handle no interpolations", () => {
    const f = __sql_build(["SELECT 1"], []);
    expect(f.text).toBe("SELECT 1");
    expect(f.values).toEqual([]);
  });

  it("should inline Fragment interpolations", () => {
    const sub = new Fragment(["active = ", ""], [true]);
    const f = __sql_build(["SELECT * FROM users WHERE ", ""], [sub]);
    expect(f.text).toBe("SELECT * FROM users WHERE active = $1");
    expect(f.values).toEqual([true]);
  });

  it("should mix Fragment and plain interpolations", () => {
    const sub = new Fragment(["name = ", ""], ["Alice"]);
    const f = __sql_build(["SELECT * FROM users WHERE ", " AND age > ", ""], [sub, 30]);
    expect(f.text).toBe("SELECT * FROM users WHERE name = $1 AND age > $2");
    expect(f.values).toEqual(["Alice", 30]);
  });
});

// ============================================================================
// Query & Update typed wrappers
// ============================================================================

describe("Query", () => {
  it("should wrap a fragment with a result type", () => {
    const f = sql`SELECT id, name FROM users`;
    const q = f.toQuery<{ id: number; name: string }>();
    expect(q).toBeInstanceOf(Query);
    expect(q.text).toBe("SELECT id, name FROM users");
  });

  it("should expose text and params", () => {
    const f = sql`SELECT * FROM users WHERE id = ${42}`;
    const q = f.toQuery<{ id: number }>();
    expect(q.text).toBe("SELECT * FROM users WHERE id = $1");
    expect(q.params).toEqual([42]);
  });

  it("should append fragments", () => {
    const f = sql`SELECT * FROM users`;
    const q = f.toQuery<{ id: number }>().append(sql`WHERE id = ${1}`);
    expect(q.text).toBe("SELECT * FROM users WHERE id = $1");
  });

  it("should have a toString", () => {
    const q = sql`SELECT 1`.toQuery();
    expect(q.toString()).toBe("Query(SELECT 1)");
  });
});

describe("Update", () => {
  it("should wrap a fragment", () => {
    const f = sql`DELETE FROM users WHERE id = ${42}`;
    const u = f.toUpdate();
    expect(u).toBeInstanceOf(Update);
    expect(u.text).toBe("DELETE FROM users WHERE id = $1");
    expect(u.params).toEqual([42]);
  });

  it("should have a toString", () => {
    const u = sql`DELETE FROM users`.toUpdate();
    expect(u.toString()).toBe("Update(DELETE FROM users)");
  });
});

// ============================================================================
// ConnectionIO
// ============================================================================

describe("ConnectionIO", () => {
  it("should create a pure value", () => {
    const io = ConnectionIO.pure(42);
    expect(io._tag).toBe("Pure");
  });

  it("should create a query operation", () => {
    const q = sql`SELECT * FROM users`.toQuery<{ id: number }>();
    const io = ConnectionIO.query(q, (row) => ({ id: row.id as number }));
    expect(io._tag).toBe("QueryIO");
  });

  it("should create an update operation", () => {
    const u = sql`DELETE FROM users WHERE id = ${1}`.toUpdate();
    const io = ConnectionIO.update(u);
    expect(io._tag).toBe("UpdateIO");
  });

  it("should flatMap operations", () => {
    const io = ConnectionIO.flatMap(ConnectionIO.pure(42), (n) => ConnectionIO.pure(n * 2));
    expect(io._tag).toBe("FlatMap");
  });

  it("should map over results", () => {
    const io = ConnectionIO.map(ConnectionIO.pure(42), (n) => n.toString());
    expect(io._tag).toBe("FlatMap"); // map is implemented via flatMap
  });
});

// ============================================================================
// Transactor
// ============================================================================

describe("Transactor", () => {
  function mockDb(responses: Record<string, unknown>[][]): DbConnection {
    let callIndex = 0;
    return {
      async query(_text: string, _params: readonly SqlParam[]) {
        const rows = responses[callIndex++] ?? [];
        return { rows: rows as Record<string, unknown>[] };
      },
    };
  }

  it("should run a pure value", async () => {
    const xa = new Transactor(mockDb([]));
    const result = await xa.run(ConnectionIO.pure(42));
    expect(result).toBe(42);
  });

  it("should run a query", async () => {
    const db = mockDb([
      [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ],
    ]);
    const xa = new Transactor(db);

    const q = sql`SELECT * FROM users`.toQuery<{ id: number; name: string }>();
    const io = ConnectionIO.query(q, (row) => ({
      id: row.id as number,
      name: row.name as string,
    }));

    const result = await xa.run(io);
    expect(result).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
  });

  it("should run a flatMap chain", async () => {
    const db = mockDb([[{ id: 1, name: "Alice" }], [{ count: 5 }]]);
    const xa = new Transactor(db);

    const program = ConnectionIO.flatMap(
      ConnectionIO.query(
        sql`SELECT * FROM users WHERE id = ${1}`.toQuery<{
          id: number;
          name: string;
        }>(),
        (row) => ({ id: row.id as number, name: row.name as string })
      ),
      (users) =>
        ConnectionIO.query(
          sql`SELECT count(*) as count FROM posts WHERE author_id = ${(users as { id: number }[])[0].id}`.toQuery<{
            count: number;
          }>(),
          (row) => ({ count: row.count as number })
        )
    );

    const result = await xa.run(program);
    expect(result).toEqual([{ count: 5 }]);
  });
});

// ============================================================================
// Real-world composition patterns
// ============================================================================

describe("real-world patterns", () => {
  it("should build a dynamic search query", () => {
    const nameFilter: string | null = "Alice";
    const minAge: number | null = 25;
    const roles: string[] = ["admin", "editor"];

    const base = sql`SELECT * FROM users`;
    const where = Fragment.whereAnd([
      Fragment.when(!!nameFilter, () => sql`name ILIKE ${`%${nameFilter}%`}`),
      Fragment.when(minAge !== null, () => sql`age >= ${minAge}`),
      Fragment.when(roles.length > 0, () => Fragment.inList("role", roles)),
    ]);
    const order = sql`ORDER BY created_at DESC`;
    const limit = sql`LIMIT ${20}`;

    const query = base.append(where).append(order).append(limit);

    expect(query.text).toBe(
      "SELECT * FROM users WHERE name ILIKE $1 AND age >= $2 AND role IN ($3, $4) ORDER BY created_at DESC LIMIT $5"
    );
    expect(query.values).toEqual(["%Alice%", 25, "admin", "editor", 20]);
  });

  it("should build an INSERT with RETURNING", () => {
    const name = "Charlie";
    const email = "charlie@example.com";
    const age = 28;

    const query = sql`INSERT INTO users (name, email, age)`
      .append(Fragment.values([[name, email, age]]))
      .append(sql`RETURNING id, created_at`);

    expect(query.text).toBe(
      "INSERT INTO users (name, email, age) VALUES ($1, $2, $3) RETURNING id, created_at"
    );
    expect(query.values).toEqual(["Charlie", "charlie@example.com", 28]);
  });

  it("should build an UPDATE with SET and WHERE", () => {
    const id = 42;
    const query = sql`UPDATE users`
      .append(Fragment.set({ name: "Bob", age: 31 }))
      .append(sql`WHERE id = ${id}`);

    expect(query.text).toBe("UPDATE users SET name = $1, age = $2 WHERE id = $3");
    expect(query.values).toEqual(["Bob", 31, 42]);
  });

  it("should build a query with subquery", () => {
    const minPosts = 5;
    const subquery = sql`SELECT author_id FROM posts GROUP BY author_id HAVING count(*) > ${minPosts}`;
    const query = sql`SELECT * FROM users WHERE id IN (${subquery})`;

    expect(query.text).toBe(
      "SELECT * FROM users WHERE id IN (SELECT author_id FROM posts GROUP BY author_id HAVING count(*) > $1)"
    );
    expect(query.values).toEqual([5]);
  });

  it("should build a complex JOIN query", () => {
    const status = "active";
    const limit = 10;

    const query = sql`SELECT u.id, u.name, count(p.id) as post_count`
      .append(sql`FROM users u`)
      .append(sql`LEFT JOIN posts p ON p.author_id = u.id`)
      .append(sql`WHERE u.status = ${status}`)
      .append(sql`GROUP BY u.id, u.name`)
      .append(sql`ORDER BY post_count DESC`)
      .append(sql`LIMIT ${limit}`);

    expect(query.text).toBe(
      "SELECT u.id, u.name, count(p.id) as post_count " +
        "FROM users u " +
        "LEFT JOIN posts p ON p.author_id = u.id " +
        "WHERE u.status = $1 " +
        "GROUP BY u.id, u.name " +
        "ORDER BY post_count DESC " +
        "LIMIT $2"
    );
    expect(query.values).toEqual(["active", 10]);
  });

  it("should build a bulk insert", () => {
    const users = [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
      { name: "Charlie", age: 35 },
    ];

    const query = sql`INSERT INTO users (name, age)`.append(
      Fragment.values(users.map((u) => [u.name, u.age]))
    );

    expect(query.text).toBe("INSERT INTO users (name, age) VALUES ($1, $2), ($3, $4), ($5, $6)");
    expect(query.values).toEqual(["Alice", 30, "Bob", 25, "Charlie", 35]);
  });

  it("should compose reusable query fragments", () => {
    // Reusable fragments
    const selectUsers = sql`SELECT * FROM users`;
    const activeOnly = sql`active = true`;
    const recentOnly = sql`created_at > now() - interval '30 days'`;

    // Compose them
    const q1 = selectUsers.append(Fragment.raw("WHERE")).append(activeOnly);
    expect(q1.text).toBe("SELECT * FROM users WHERE active = true");

    const q2 = selectUsers.append(
      Fragment.raw("WHERE ").appendNoSpace(Fragment.and([activeOnly, recentOnly]))
    );
    expect(q2.text).toBe(
      "SELECT * FROM users WHERE active = true AND created_at > now() - interval '30 days'"
    );
  });
});
