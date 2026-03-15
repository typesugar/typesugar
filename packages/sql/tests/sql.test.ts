/**
 * @typesugar/sql Package Tests
 *
 * Comprehensive tests for the Doobie-style typed SQL DSL.
 */
import { describe, it, expect, vi } from "vitest";
import {
  // Core types
  Fragment,
  Query,
  Update,
  sql,
  __sql_build,
  // Typeclasses
  Get,
  Put,
  Meta,
  Read,
  Write,
  Codec,
  deriveRead,
  deriveWrite,
  deriveCodec,
  toSnakeCase,
  // TypedFragment
  TypedFragment,
  TypedQuery,
  TypedUpdate,
  emptyTyped,
  andTyped,
  orTyped,
  commasTyped,
  intercalateTyped,
  inListTyped,
  valuesTyped,
  valuesManyTyped,
  setTyped,
  whenTyped,
  whereAndTyped,
  // ConnectionIO
  ConnectionIO,
  Transactor,
  Left,
  Right,
  sequence,
  traverse,
  when,
  whenA,
  type Either,
  type DbConnection,
} from "../src/index.js";

// ============================================================================
// Fragment Tests
// ============================================================================

describe("Fragment", () => {
  describe("construction", () => {
    it("creates empty fragment", () => {
      const frag = Fragment.empty;
      expect(frag.text).toBe("");
      expect(frag.values).toEqual([]);
    });

    it("creates raw SQL fragment", () => {
      const frag = Fragment.raw("SELECT * FROM users");
      expect(frag.text).toBe("SELECT * FROM users");
      expect(frag.values).toEqual([]);
    });

    it("creates single parameter fragment", () => {
      const frag = Fragment.param(42);
      expect(frag.text).toBe("$1");
      expect(frag.values).toEqual([42]);
    });

    it("creates fragment with multiple segments and params", () => {
      const frag = new Fragment(["SELECT * FROM users WHERE id = ", ""], [1]);
      expect(frag.text).toBe("SELECT * FROM users WHERE id = $1");
      expect(frag.values).toEqual([1]);
    });
  });

  describe("composition", () => {
    it("appends fragments with space", () => {
      const base = Fragment.raw("SELECT * FROM users");
      const where = Fragment.raw("WHERE active = true");
      const result = base.append(where);
      expect(result.text).toBe("SELECT * FROM users WHERE active = true");
    });

    it("prepends fragments", () => {
      const where = Fragment.raw("WHERE active = true");
      const base = Fragment.raw("SELECT * FROM users");
      const result = where.prepend(base);
      expect(result.text).toBe("SELECT * FROM users WHERE active = true");
    });

    it("appends without space", () => {
      const col = Fragment.raw("name");
      const suffix = Fragment.raw("_lower");
      const result = col.appendNoSpace(suffix);
      expect(result.text).toBe("name_lower");
    });

    it("wraps in parentheses", () => {
      const inner = Fragment.raw("a OR b");
      const result = inner.parens();
      expect(result.text).toBe("(a OR b)");
    });

    it("preserves parameters through composition", () => {
      const a = new Fragment(["id = ", ""], [1]);
      const b = new Fragment(["name = ", ""], ["Alice"]);
      const result = a.append(b);
      expect(result.values).toEqual([1, "Alice"]);
    });
  });

  describe("combinators", () => {
    it("joins with AND", () => {
      const cond1 = Fragment.raw("active = true");
      const cond2 = Fragment.raw("verified = true");
      const result = Fragment.and([cond1, cond2]);
      expect(result.text).toBe("active = true AND verified = true");
    });

    it("joins with OR and wraps in parens", () => {
      const cond1 = Fragment.raw("role = 'admin'");
      const cond2 = Fragment.raw("role = 'mod'");
      const result = Fragment.or([cond1, cond2]);
      expect(result.text).toBe("(role = 'admin' OR role = 'mod')");
    });

    it("joins with commas", () => {
      const cols = [Fragment.raw("id"), Fragment.raw("name"), Fragment.raw("email")];
      const result = Fragment.commas(cols);
      expect(result.text).toBe("id, name, email");
    });

    it("intercalates with custom separator", () => {
      const items = [Fragment.raw("a"), Fragment.raw("b"), Fragment.raw("c")];
      const sep = Fragment.raw(" | ");
      const result = Fragment.intercalate(sep, items);
      expect(result.text).toBe("a | b | c");
    });

    it("handles empty array in intercalate", () => {
      const result = Fragment.intercalate(Fragment.raw(", "), []);
      expect(result.text).toBe("");
    });
  });

  describe("IN list", () => {
    it("creates IN clause with values", () => {
      const result = Fragment.inList("id", [1, 2, 3]);
      expect(result.text).toBe("id IN ($1, $2, $3)");
      expect(result.values).toEqual([1, 2, 3]);
    });

    it("returns FALSE for empty IN list", () => {
      const result = Fragment.inList("id", []);
      expect(result.text).toBe("FALSE");
      expect(result.values).toEqual([]);
    });
  });

  describe("VALUES clause", () => {
    it("creates VALUES for single row", () => {
      const result = Fragment.values([[1, "Alice", "alice@example.com"]]);
      expect(result.text).toBe("VALUES ($1, $2, $3)");
      expect(result.values).toEqual([1, "Alice", "alice@example.com"]);
    });

    it("creates VALUES for multiple rows", () => {
      const result = Fragment.values([
        [1, "Alice"],
        [2, "Bob"],
      ]);
      expect(result.text).toBe("VALUES ($1, $2), ($3, $4)");
      expect(result.values).toEqual([1, "Alice", 2, "Bob"]);
    });
  });

  describe("SET clause", () => {
    it("creates SET clause from object", () => {
      const result = Fragment.set({ name: "Bob", email: "bob@test.com" });
      expect(result.text).toBe("SET name = $1, email = $2");
      expect(result.values).toEqual(["Bob", "bob@test.com"]);
    });
  });

  describe("conditional fragments", () => {
    it("includes fragment when condition is true", () => {
      const result = Fragment.when(true, () => Fragment.raw("ORDER BY id"));
      expect(result.text).toBe("ORDER BY id");
    });

    it("returns empty fragment when condition is false", () => {
      const result = Fragment.when(false, () => Fragment.raw("ORDER BY id"));
      expect(result.text).toBe("");
    });

    it("builds WHERE clause from conditions", () => {
      const conds = [Fragment.raw("active = true"), Fragment.raw("age > 18")];
      const result = Fragment.whereAnd(conds);
      expect(result.text).toBe("WHERE active = true AND age > 18");
    });

    it("returns empty for whereAnd with no conditions", () => {
      const result = Fragment.whereAnd([]);
      expect(result.text).toBe("");
    });
  });

  describe("rendering", () => {
    it("renders query with positional placeholders", () => {
      const frag = new Fragment(
        ["SELECT * FROM users WHERE id = ", " AND name = ", ""],
        [1, "Alice"]
      );
      const { text, params } = frag.query;
      expect(text).toBe("SELECT * FROM users WHERE id = $1 AND name = $2");
      expect(params).toEqual([1, "Alice"]);
    });

    it("toString provides debug representation", () => {
      const frag = new Fragment(["id = ", ""], [42]);
      expect(frag.toString()).toContain("Fragment");
      expect(frag.toString()).toContain("42");
    });
  });
});

// ============================================================================
// Query & Update Tests
// ============================================================================

describe("Query", () => {
  it("wraps a fragment", () => {
    const frag = Fragment.raw("SELECT * FROM users");
    const query = new Query<{ id: number; name: string }>(frag);
    expect(query._tag).toBe("Query");
    expect(query.text).toBe("SELECT * FROM users");
  });

  it("maps result type", () => {
    const frag = Fragment.raw("SELECT id FROM users");
    const query = new Query<number>(frag);
    const mapped = query.map((n) => n.toString());
    expect(mapped._tag).toBe("Query");
  });

  it("appends fragment", () => {
    const query = new Query<unknown>(Fragment.raw("SELECT * FROM users"));
    const result = query.append(Fragment.raw("WHERE id = 1"));
    expect(result.text).toBe("SELECT * FROM users WHERE id = 1");
  });
});

describe("Update", () => {
  it("wraps a fragment", () => {
    const frag = Fragment.raw("DELETE FROM users WHERE id = 1");
    const update = new Update(frag);
    expect(update._tag).toBe("Update");
    expect(update.text).toBe("DELETE FROM users WHERE id = 1");
  });
});

// ============================================================================
// sql`` Tagged Template Tests
// ============================================================================

describe("sql tagged template", () => {
  it("creates fragment from template literal", () => {
    const name = "Alice";
    const frag = sql`SELECT * FROM users WHERE name = ${name}`;
    expect(frag.text).toBe("SELECT * FROM users WHERE name = $1");
    expect(frag.values).toEqual(["Alice"]);
  });

  it("handles multiple parameters", () => {
    const name = "Alice";
    const age = 30;
    const frag = sql`SELECT * FROM users WHERE name = ${name} AND age > ${age}`;
    expect(frag.text).toBe("SELECT * FROM users WHERE name = $1 AND age > $2");
    expect(frag.values).toEqual(["Alice", 30]);
  });

  it("handles no parameters", () => {
    const frag = sql`SELECT * FROM users`;
    expect(frag.text).toBe("SELECT * FROM users");
    expect(frag.values).toEqual([]);
  });

  it("inlines fragment interpolations", () => {
    const where = sql`WHERE active = ${true}`;
    const full = sql`SELECT * FROM users ${where}`;
    expect(full.values).toEqual([true]);
  });
});

describe("__sql_build helper", () => {
  it("builds fragment from segments and values", () => {
    const result = __sql_build(["SELECT * FROM users WHERE id = ", ""], [42]);
    expect(result.text).toBe("SELECT * FROM users WHERE id = $1");
    expect(result.values).toEqual([42]);
  });

  it("inlines nested fragments", () => {
    const inner = new Fragment(["status = ", ""], ["active"]);
    const result = __sql_build(["SELECT * FROM users WHERE ", ""], [inner]);
    expect(result.values).toEqual(["active"]);
  });
});

// ============================================================================
// Get Typeclass Tests
// ============================================================================

describe("Get typeclass", () => {
  describe("primitive instances", () => {
    it("decodes strings", () => {
      expect(Get.string.get("hello")).toBe("hello");
      expect(Get.string.get(null)).toBe(null);
      expect(Get.string.get(123)).toBe("123");
    });

    it("decodes numbers", () => {
      expect(Get.number.get(42)).toBe(42);
      expect(Get.number.get("42")).toBe(42);
      expect(Get.number.get(null)).toBe(null);
    });

    it("decodes integers", () => {
      expect(Get.int.get(42)).toBe(42);
      expect(Get.int.get(42.7)).toBe(42);
      expect(Get.int.get(null)).toBe(null);
    });

    it("decodes bigints", () => {
      expect(Get.bigint.get(BigInt(42))).toBe(BigInt(42));
      expect(Get.bigint.get(42)).toBe(BigInt(42));
      expect(Get.bigint.get("42")).toBe(BigInt(42));
      expect(Get.bigint.get(null)).toBe(null);
    });

    it("decodes booleans", () => {
      expect(Get.boolean.get(true)).toBe(true);
      expect(Get.boolean.get(false)).toBe(false);
      expect(Get.boolean.get("t")).toBe(true);
      expect(Get.boolean.get("f")).toBe(false);
      expect(Get.boolean.get(1)).toBe(true);
      expect(Get.boolean.get(0)).toBe(false);
      expect(Get.boolean.get(null)).toBe(null);
    });

    it("decodes dates", () => {
      const date = new Date("2024-01-15T10:30:00Z");
      expect(Get.date.get(date)).toEqual(date);
      expect(Get.date.get("2024-01-15T10:30:00Z")).toEqual(date);
      expect(Get.date.get(null)).toBe(null);
    });

    it("decodes date-only", () => {
      expect(Get.dateOnly.get("2024-01-15")).toEqual(new Date("2024-01-15T00:00:00Z"));
      expect(Get.dateOnly.get(null)).toBe(null);
    });

    it("decodes UUIDs", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      expect(Get.uuid.get(uuid)).toBe(uuid);
      expect(Get.uuid.get("not-a-uuid")).toBe(null);
      expect(Get.uuid.get(null)).toBe(null);
    });

    it("decodes JSON", () => {
      expect(Get.json.get({ foo: "bar" })).toEqual({ foo: "bar" });
      expect(Get.json.get('{"foo":"bar"}')).toEqual({ foo: "bar" });
      expect(Get.json.get(null)).toBe(null);
    });

    it("decodes buffers", () => {
      const buf = Buffer.from("hello");
      expect(Get.buffer.get(buf)).toEqual(buf);
      expect(Get.buffer.get(null)).toBe(null);
    });
  });

  describe("combinators", () => {
    it("maps output type", () => {
      const getLength = Get.map(Get.string, (s) => s.length);
      expect(getLength.get("hello")).toBe(5);
      expect(getLength.get(null)).toBe(null);
    });

    it("handles nullable", () => {
      const nullableNum = Get.nullable(Get.number);
      expect(nullableNum.get(42)).toBe(42);
      expect(nullableNum.get(null)).toBe(null);
    });

    it("handles optional (maps null to undefined)", () => {
      const optNum = Get.optional(Get.number);
      expect(optNum.get(42)).toBe(42);
      expect(optNum.get(null)).toBe(undefined);
    });

    it("decodes arrays", () => {
      const arrGet = Get.array(Get.number);
      expect(arrGet.get([1, 2, 3])).toEqual([1, 2, 3]);
      expect(arrGet.get(null)).toBe(null);
    });
  });

  describe("unsafeGet", () => {
    it("returns value when not null", () => {
      expect(Get.string.unsafeGet("hello")).toBe("hello");
    });

    it("throws on null", () => {
      expect(() => Get.string.unsafeGet(null)).toThrow("Unexpected NULL");
    });
  });
});

// ============================================================================
// Put Typeclass Tests
// ============================================================================

describe("Put typeclass", () => {
  describe("primitive instances", () => {
    it("encodes strings", () => {
      expect(Put.string.put("hello")).toBe("hello");
    });

    it("encodes numbers", () => {
      expect(Put.number.put(42)).toBe(42);
    });

    it("encodes integers", () => {
      expect(Put.int.put(42.7)).toBe(42);
    });

    it("encodes bigints as strings", () => {
      expect(Put.bigint.put(BigInt(42))).toBe("42");
    });

    it("encodes booleans", () => {
      expect(Put.boolean.put(true)).toBe(true);
      expect(Put.boolean.put(false)).toBe(false);
    });

    it("encodes dates as ISO strings", () => {
      const date = new Date("2024-01-15T10:30:00Z");
      expect(Put.date.put(date)).toBe("2024-01-15T10:30:00.000Z");
    });

    it("encodes date-only as YYYY-MM-DD", () => {
      const date = new Date("2024-01-15T10:30:00Z");
      expect(Put.dateOnly.put(date)).toBe("2024-01-15");
    });

    it("encodes JSON", () => {
      expect(Put.json.put({ foo: "bar" })).toBe('{"foo":"bar"}');
    });
  });

  describe("combinators", () => {
    it("contramaps input type", () => {
      const putLength = Put.contramap(Put.number, (s: string) => s.length);
      expect(putLength.put("hello")).toBe(5);
    });

    it("handles nullable", () => {
      const nullablePut = Put.nullable(Put.number);
      expect(nullablePut.put(42)).toBe(42);
      expect(nullablePut.put(null)).toBe(null);
    });

    it("handles optional", () => {
      const optPut = Put.optional(Put.number);
      expect(optPut.put(42)).toBe(42);
      expect(optPut.put(undefined)).toBe(null);
    });

    it("encodes arrays", () => {
      const arrPut = Put.array(Put.number);
      expect(arrPut.put([1, 2, 3])).toEqual([1, 2, 3]);
    });
  });
});

// ============================================================================
// Meta Typeclass Tests
// ============================================================================

describe("Meta typeclass", () => {
  it("combines Get and Put", () => {
    expect(Meta.string.get("hello")).toBe("hello");
    expect(Meta.string.put("hello")).toBe("hello");
  });

  it("provides imap for bidirectional transformation", () => {
    type UserId = { readonly __brand: "UserId"; readonly value: string };
    const makeUserId = (s: string): UserId => ({ __brand: "UserId", value: s }) as UserId;

    const userIdMeta = Meta.imap(
      Meta.string,
      (s) => makeUserId(s),
      (id) => id.value
    );

    const decoded = userIdMeta.get("user-123");
    expect(decoded?.value).toBe("user-123");
    expect(userIdMeta.put(makeUserId("user-456"))).toBe("user-456");
  });

  it("handles nullable", () => {
    const nullableMeta = Meta.nullable(Meta.number);
    expect(nullableMeta.get(null)).toBe(null);
    expect(nullableMeta.put(null)).toBe(null);
  });

  it("handles optional", () => {
    const optMeta = Meta.optional(Meta.number);
    expect(optMeta.get(null)).toBe(undefined);
    expect(optMeta.put(undefined)).toBe(null);
  });

  it("handles arrays", () => {
    const arrMeta = Meta.array(Meta.number);
    expect(arrMeta.get([1, 2, 3])).toEqual([1, 2, 3]);
    expect(arrMeta.put([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

// ============================================================================
// Read/Write/Codec Tests
// ============================================================================

describe("Read typeclass", () => {
  it("reads a single column", () => {
    const readId = Read.column("id", Get.number);
    expect(readId.read({ id: 42 })).toBe(42);
    expect(readId.columns).toEqual(["id"]);
  });

  it("maps result", () => {
    const readId = Read.map(Read.column("id", Get.number), (n) => n * 2);
    expect(readId.read({ id: 21 })).toBe(42);
  });

  it("combines with product", () => {
    const readId = Read.column("id", Get.number);
    const readName = Read.column("name", Get.string);
    const readPair = Read.product(readId, readName);

    expect(readPair.read({ id: 1, name: "Alice" })).toEqual([1, "Alice"]);
    expect(readPair.columns).toEqual(["id", "name"]);
  });

  it("combines with tuple", () => {
    const readTuple = Read.tuple(
      Read.column("id", Get.number),
      Read.column("name", Get.string),
      Read.column("active", Get.boolean)
    );

    expect(readTuple.read({ id: 1, name: "Alice", active: true })).toEqual([1, "Alice", true]);
  });

  it("handles optional read", () => {
    const readOpt = Read.optional(Read.column("name", Get.string));
    expect(readOpt.read({ name: "Alice" })).toBe("Alice");
    expect(readOpt.read({ name: null })).toBe(undefined);
  });
});

describe("Write typeclass", () => {
  it("writes a single column", () => {
    const writeId = Write.column("id", Put.number);
    expect(writeId.write(42)).toEqual([42]);
    expect(writeId.columns).toEqual(["id"]);
  });

  it("contramaps input", () => {
    interface User {
      id: number;
    }
    const writeUserId = Write.contramap(Write.column("id", Put.number), (u: User) => u.id);
    expect(writeUserId.write({ id: 42 })).toEqual([42]);
  });

  it("combines with product", () => {
    const writeId = Write.column("id", Put.number);
    const writeName = Write.column("name", Put.string);
    const writePair = Write.product(writeId, writeName);

    expect(writePair.write([42, "Alice"])).toEqual([42, "Alice"]);
    expect(writePair.columns).toEqual(["id", "name"]);
  });
});

describe("Codec typeclass", () => {
  it("combines Read and Write", () => {
    const readId = Read.column("id", Get.number);
    const writeId = Write.column("id", Put.number);
    const codecId = Codec.fromReadWrite(readId, writeId);

    expect(codecId.read({ id: 42 })).toBe(42);
    expect(codecId.write(42)).toEqual([42]);
  });

  it("supports imap transformation", () => {
    const readNum = Read.column("value", Get.number);
    const writeNum = Write.column("value", Put.number);
    const codecNum = Codec.fromReadWrite(readNum, writeNum);

    const codecStr = Codec.imap(
      codecNum,
      (n) => n.toString(),
      (s) => parseInt(s, 10)
    );

    expect(codecStr.read({ value: 42 })).toBe("42");
    expect(codecStr.write("42")).toEqual([42]);
  });
});

// ============================================================================
// Derivation Helpers Tests
// ============================================================================

describe("derivation helpers", () => {
  it("converts camelCase to snake_case", () => {
    expect(toSnakeCase("userId")).toBe("user_id");
    expect(toSnakeCase("createdAt")).toBe("created_at");
    expect(toSnakeCase("firstName")).toBe("first_name");
    expect(toSnakeCase("id")).toBe("id");
  });

  it("derives Read from config", () => {
    interface User {
      id: number;
      name: string;
      createdAt: Date;
    }

    const readUser = deriveRead<User>({
      id: { field: "id", meta: Meta.number },
      name: { field: "name", meta: Meta.string },
      createdAt: { field: "createdAt", meta: Meta.date, column: "created_at" },
    });

    const row = {
      id: 1,
      name: "Alice",
      created_at: new Date("2024-01-15"),
    };

    const user = readUser.read(row);
    expect(user?.id).toBe(1);
    expect(user?.name).toBe("Alice");
    expect(user?.createdAt).toEqual(new Date("2024-01-15"));
  });

  it("derives Write from config", () => {
    interface User {
      id: number;
      name: string;
    }

    const writeUser = deriveWrite<User>({
      id: { field: "id", meta: Meta.number },
      name: { field: "name", meta: Meta.string },
    });

    const params = writeUser.write({ id: 1, name: "Alice" });
    expect(params).toEqual([1, "Alice"]);
    expect(writeUser.columns).toEqual(["id", "name"]);
  });

  it("derives Codec from config", () => {
    interface Point {
      x: number;
      y: number;
    }

    const codecPoint = deriveCodec<Point>({
      x: { field: "x", meta: Meta.number },
      y: { field: "y", meta: Meta.number },
    });

    expect(codecPoint.read({ x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
    expect(codecPoint.write({ x: 10, y: 20 })).toEqual([10, 20]);
  });
});

// ============================================================================
// TypedFragment Tests
// ============================================================================

describe("TypedFragment", () => {
  it("creates typed fragment", () => {
    const frag = new TypedFragment<[number], void>(["id = ", ""], [42]);
    expect(frag.query.text).toBe("id = $1");
    expect(frag.query.params).toEqual([42]);
  });

  it("appends and concatenates parameter types", () => {
    const a = new TypedFragment<[number], void>(["id = ", ""], [1]);
    const b = new TypedFragment<[string], void>(["name = ", ""], ["Alice"]);
    const result = a.append(b);

    expect(result.query.params).toEqual([1, "Alice"]);
  });

  it("prepends fragments", () => {
    const where = new TypedFragment<[number], void>(["WHERE id = ", ""], [1]);
    const select = new TypedFragment<[], void>(["SELECT * FROM users"], []);
    const result = where.prepend(select);

    expect(result.query.text).toContain("SELECT * FROM users");
    expect(result.query.text).toContain("WHERE id =");
  });

  it("wraps in parentheses", () => {
    const frag = new TypedFragment<[], void>(["a OR b"], []);
    const result = frag.parens();
    expect(result.query.text).toBe("(a OR b)");
  });

  it("converts to Fragment", () => {
    const typed = new TypedFragment<[number], void>(["x = ", ""], [42]);
    const frag = typed.toFragment();
    expect(frag).toBeInstanceOf(Fragment);
    expect(frag.text).toBe("x = $1");
  });

  it("converts to TypedQuery", () => {
    const frag = new TypedFragment<[number], { id: number }>(
      ["SELECT id FROM users WHERE id = ", ""],
      [1]
    );
    const query = frag.toQuery();
    expect(query).toBeInstanceOf(TypedQuery);
  });

  it("converts to TypedUpdate", () => {
    const frag = new TypedFragment<[number], void>(["DELETE FROM users WHERE id = ", ""], [1]);
    const update = frag.toUpdate();
    expect(update).toBeInstanceOf(TypedUpdate);
  });
});

describe("TypedFragment combinators", () => {
  it("emptyTyped is empty", () => {
    expect(emptyTyped.query.text).toBe("");
    expect(emptyTyped.query.params).toEqual([]);
  });

  it("andTyped joins with AND", () => {
    const a = new TypedFragment<[number], void>(["id > ", ""], [10]);
    const b = new TypedFragment<[number], void>(["id < ", ""], [100]);
    const result = andTyped(a, b);

    expect(result.query.text).toBe("id > $1 AND id < $2");
    expect(result.query.params).toEqual([10, 100]);
  });

  it("orTyped joins with OR", () => {
    const a = new TypedFragment<[string], void>(["role = ", ""], ["admin"]);
    const b = new TypedFragment<[string], void>(["role = ", ""], ["mod"]);
    const result = orTyped(a, b);

    expect(result.query.text).toBe("role = $1 OR role = $2");
  });

  it("commasTyped joins with commas", () => {
    const a = new TypedFragment<[], void>(["id"], []);
    const b = new TypedFragment<[], void>(["name"], []);
    const c = new TypedFragment<[], void>(["email"], []);
    const result = commasTyped(a, b, c);

    expect(result.query.text).toBe("id, name, email");
  });

  it("inListTyped creates IN clause", () => {
    const result = inListTyped("id", [1, 2, 3]);
    const { sql, params } = result.toQuery().toSql();
    expect(sql).toBe("id IN (?, ?, ?)");
    expect(params).toEqual([1, 2, 3]);
  });

  it("inListTyped handles empty list", () => {
    const result = inListTyped("id", []);
    expect(result.query.text).toBe("1 = 0");
  });

  it("whenTyped conditionally includes fragment", () => {
    const frag = new TypedFragment<[], void>(["ORDER BY id"], []);

    const included = whenTyped(true, frag);
    expect(included.query.text).toBe("ORDER BY id");

    const excluded = whenTyped(false, frag);
    expect(excluded.query.text).toBe("");
  });

  it("whereAndTyped builds WHERE clause", () => {
    const a = new TypedFragment<[number], void>(["active = ", ""], [1]);
    const b = new TypedFragment<[string], void>(["status = ", ""], ["verified"]);
    const result = whereAndTyped(a, b);

    expect(result.query.text).toContain("WHERE");
    expect(result.query.text).toContain("AND");
  });

  it("whereAndTyped filters out falsy values", () => {
    const a = new TypedFragment<[number], void>(["id = ", ""], [1]);
    const result = whereAndTyped(a, null, undefined, false);

    expect(result.query.text).toBe("WHERE id = $1");
  });
});

describe("TypedQuery", () => {
  it("maps result type", () => {
    const frag = new TypedFragment<[], number>(["SELECT COUNT(*) as count FROM users"], []);
    const query = new TypedQuery(frag);
    const mapped = query.map((n) => n > 0);

    expect(mapped).toBeInstanceOf(TypedQuery);
  });

  it("converts to option query", () => {
    const frag = new TypedFragment<[number], { id: number }>(
      ["SELECT * FROM users WHERE id = ", ""],
      [1]
    );
    const query = new TypedQuery(frag);
    const optQuery = query.option();

    expect(optQuery).toBeInstanceOf(TypedQuery);
  });
});

describe("TypedUpdate", () => {
  it("returns generated keys", () => {
    const frag = new TypedFragment<[string], void>(
      ["INSERT INTO users (name) VALUES (", ")"],
      ["Alice"]
    );
    const update = new TypedUpdate(frag);
    const withKeys = update.withGeneratedKeys("id");

    expect(withKeys).toBeInstanceOf(TypedQuery);
  });
});

// ============================================================================
// ConnectionIO Tests
// ============================================================================

describe("ConnectionIO", () => {
  describe("pure operations", () => {
    it("lifts pure value", () => {
      const cio = ConnectionIO.pure(42);
      expect(cio.op._tag).toBe("Pure");
      expect((cio.op as { value: number }).value).toBe(42);
    });

    it("has unit value", () => {
      expect(ConnectionIO.unit.op._tag).toBe("Pure");
    });

    it("delays computation", () => {
      let called = false;
      const cio = ConnectionIO.delay(() => {
        called = true;
        return 42;
      });
      expect(cio.op._tag).toBe("Delay");
      expect(called).toBe(false);
    });
  });

  describe("monad operations", () => {
    it("maps result", () => {
      const cio = ConnectionIO.pure(21).map((n) => n * 2);
      expect(cio).toBeInstanceOf(ConnectionIO);
    });

    it("flatMaps/chains operations", () => {
      const cio = ConnectionIO.pure(1).flatMap((n) => ConnectionIO.pure(n + 1));
      expect(cio).toBeInstanceOf(ConnectionIO);
    });

    it("zips two operations", () => {
      const cio = ConnectionIO.pure(1).zip(ConnectionIO.pure("a"));
      expect(cio).toBeInstanceOf(ConnectionIO);
    });

    it("zipLeft keeps left result", () => {
      const cio = ConnectionIO.pure(1).zipLeft(ConnectionIO.pure("ignored"));
      expect(cio).toBeInstanceOf(ConnectionIO);
    });

    it("zipRight keeps right result", () => {
      const cio = ConnectionIO.pure("ignored").zipRight(ConnectionIO.pure(42));
      expect(cio).toBeInstanceOf(ConnectionIO);
    });

    it("andThen sequences operations", () => {
      const cio = ConnectionIO.pure(1).andThen(ConnectionIO.pure(2));
      expect(cio).toBeInstanceOf(ConnectionIO);
    });
  });

  describe("error handling", () => {
    it("creates attempt operation", () => {
      const cio = ConnectionIO.pure(42).attempt();
      expect(cio.op._tag).toBe("Attempt");
    });

    it("creates handleError operation", () => {
      const cio = ConnectionIO.pure(42).handleError(() => ConnectionIO.pure(0));
      expect(cio.op._tag).toBe("HandleError");
    });

    it("creates orElse fallback", () => {
      const cio = ConnectionIO.pure(42).orElse(ConnectionIO.pure(0));
      expect(cio.op._tag).toBe("HandleError");
    });
  });

  describe("transaction control", () => {
    it("creates transact operation", () => {
      const cio = ConnectionIO.pure(42).transact();
      expect(cio.op._tag).toBe("Transact");
    });
  });

  describe("query operations", () => {
    it("creates raw SQL operation", () => {
      const cio = ConnectionIO.raw("SELECT 1", []);
      expect(cio.op._tag).toBe("Raw");
    });
  });
});

describe("Either type", () => {
  it("creates Left", () => {
    const left = Left<Error, number>(new Error("fail"));
    expect(left._tag).toBe("Left");
    expect(left.left.message).toBe("fail");
  });

  it("creates Right", () => {
    const right = Right<Error, number>(42);
    expect(right._tag).toBe("Right");
    expect(right.right).toBe(42);
  });
});

describe("ConnectionIO combinators", () => {
  it("sequences operations", () => {
    const cios = [ConnectionIO.pure(1), ConnectionIO.pure(2), ConnectionIO.pure(3)];
    const result = sequence(cios);
    expect(result).toBeInstanceOf(ConnectionIO);
  });

  it("traverses with function", () => {
    const result = traverse([1, 2, 3], (n) => ConnectionIO.pure(n * 2));
    expect(result).toBeInstanceOf(ConnectionIO);
  });

  it("conditionally executes with when", () => {
    const cio = ConnectionIO.unit;
    expect(when(true, cio)).toBe(cio);
    expect(when(false, cio)).toBe(ConnectionIO.unit);
  });

  it("conditionally executes with whenA", () => {
    const cio = ConnectionIO.pure(42);
    const result = whenA(true, cio);
    expect(result).toBe(cio);

    const nullResult = whenA(false, cio);
    expect(nullResult.op._tag).toBe("Pure");
  });
});

// ============================================================================
// Transactor Tests
// ============================================================================

describe("Transactor", () => {
  const createMockConnection = (): DbConnection => ({
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(0),
    begin: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  });

  it("runs pure operations", async () => {
    const conn = createMockConnection();
    const transactor = Transactor.fromConnection(conn);

    const result = await transactor.run(ConnectionIO.pure(42));
    expect(result).toBe(42);
  });

  it("runs delay operations", async () => {
    const conn = createMockConnection();
    const transactor = Transactor.fromConnection(conn);

    let called = false;
    const result = await transactor.run(
      ConnectionIO.delay(() => {
        called = true;
        return 42;
      })
    );

    expect(called).toBe(true);
    expect(result).toBe(42);
  });

  it("runs raw SQL", async () => {
    const conn = createMockConnection();
    (conn.query as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1 }]);
    const transactor = Transactor.fromConnection(conn);

    const result = await transactor.run(ConnectionIO.raw("SELECT 1 as id", []));
    expect(result).toEqual([{ id: 1 }]);
    expect(conn.query).toHaveBeenCalledWith("SELECT 1 as id", []);
  });

  it("handles transactions", async () => {
    const conn = createMockConnection();
    const transactor = Transactor.fromConnection(conn);

    await transactor.transact(ConnectionIO.pure(42));

    expect(conn.begin).toHaveBeenCalled();
    expect(conn.commit).toHaveBeenCalled();
  });

  it("rolls back on error", async () => {
    const conn = createMockConnection();
    (conn.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("DB error"));
    const transactor = Transactor.fromConnection(conn);

    await expect(transactor.transact(ConnectionIO.raw("INVALID SQL", []))).rejects.toThrow(
      "DB error"
    );

    expect(conn.begin).toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("handles attempt operations", async () => {
    const conn = createMockConnection();
    const transactor = Transactor.fromConnection(conn);

    const result = await transactor.run(ConnectionIO.pure(42).attempt());
    expect(result).toEqual({ _tag: "Right", right: 42 });
  });

  it("catches errors in attempt", async () => {
    const conn = createMockConnection();
    (conn.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
    const transactor = Transactor.fromConnection(conn);

    const result = await transactor.run(ConnectionIO.raw("SELECT 1", []).attempt());
    expect(result._tag).toBe("Left");
    expect((result as { left: Error }).left.message).toBe("fail");
  });

  it("handles error recovery", async () => {
    const conn = createMockConnection();
    (conn.query as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce([{ recovered: true }]);
    const transactor = Transactor.fromConnection(conn);

    const cio = ConnectionIO.raw("SELECT fail", []).handleError(() =>
      ConnectionIO.raw("SELECT recovered", [])
    );

    const result = await transactor.run(cio);
    expect(result).toEqual([{ recovered: true }]);
  });

  it("creates from pool", () => {
    const pool = {
      connect: vi.fn().mockResolvedValue(createMockConnection()),
      release: vi.fn().mockResolvedValue(undefined),
    };

    const transactor = Transactor.fromPool(pool);
    expect(transactor).toBeInstanceOf(Transactor);
  });
});
