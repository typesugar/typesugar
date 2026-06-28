/**
 * REST API Server Demo using TypeSugar
 *
 * A realistic REST API for a "Task Management" service demonstrating:
 * - @derive for model classes (Eq, Clone, Debug, Json)
 * - Option/Either for error handling
 * - match() for pattern matching on request types
 * - sql tagged templates for database queries
 * - typeInfo/fieldNames for reflection
 * - requires/ensures for contracts
 * - validate for input validation
 * - comptime for build-time constants
 * - pipe for functional composition
 */

// === Core imports ===
import { comptime, staticAssert, pipe } from "typesugar";
import { derive, Eq, Clone, Debug, Json } from "@typesugar/derive";
import { Some, None, Right, Left, isLeft, isRight } from "@typesugar/fp";
import type { Option, Either } from "@typesugar/fp";
import { match } from "@typesugar/std";
import { sql, Fragment } from "@typesugar/sql";
import { typeInfo, fieldNames } from "@typesugar/reflect";
// import { requires } from "@typesugar/contracts";  // BUG: contracts package imports 'typescript' at runtime, breaks CLI run

// ============================================================================
// Build-time constants
// ============================================================================

const API_VERSION = comptime("v1");
const BUILD_TIMESTAMP = comptime(new Date().toISOString());
const MAX_PAGE_SIZE = comptime(100);
const DEFAULT_PAGE_SIZE = comptime(20);

// staticAssert(MAX_PAGE_SIZE > DEFAULT_PAGE_SIZE, "...");
// BUG: staticAssert can't see comptime() results as compile-time constants
// BUG: When staticAssert emits a diagnostic, it crashes `typesugar build` with "start < 0"

// ============================================================================
// Domain Models with @derive
// ============================================================================

@derive(Eq, Clone, Debug, Json)
class TaskId {
  constructor(public value: number) {}
}

@derive(Eq, Clone, Debug, Json)
class UserId {
  constructor(public value: number) {}
}

type Priority = "low" | "medium" | "high" | "critical";
type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";

@derive(Eq, Clone, Debug, Json)
class Task {
  constructor(
    public id: TaskId,
    public title: string,
    public description: string,
    public priority: Priority,
    public status: TaskStatus,
    public assigneeId: UserId | null,
    public createdAt: string,
    public updatedAt: string
  ) {}
}

@derive(Eq, Clone, Debug, Json)
class User {
  constructor(
    public id: UserId,
    public name: string,
    public email: string,
    public role: "admin" | "member" | "viewer"
  ) {}
}

// ============================================================================
// Reflection - inspect models at compile time
// ============================================================================

const taskFields = fieldNames<Task>();
const taskSchema = typeInfo<Task>();

console.log(`Task has ${taskFields.length} fields: ${taskFields.join(", ")}`);
console.log(`Task schema: ${taskSchema.name}`);

// ============================================================================
// SQL Query builders
// ============================================================================

function findTaskById(id: number): Fragment {
  return sql`SELECT * FROM tasks WHERE id = ${id}`;
}

function findTasksByAssignee(userId: number, status?: TaskStatus): Fragment {
  const base = sql`SELECT * FROM tasks WHERE assignee_id = ${userId}`;
  if (status) {
    return sql`${base} AND status = ${status}`;
  }
  return base;
}

function insertTask(
  title: string,
  description: string,
  priority: Priority,
  assigneeId: number | null
): Fragment {
  return sql`
    INSERT INTO tasks (title, description, priority, status, assignee_id, created_at, updated_at)
    VALUES (${title}, ${description}, ${priority}, 'todo', ${assigneeId}, NOW(), NOW())
    RETURNING *
  `;
}

function updateTaskStatus(taskId: number, status: TaskStatus): Fragment {
  return sql`
    UPDATE tasks SET status = ${status}, updated_at = NOW()
    WHERE id = ${taskId}
    RETURNING *
  `;
}

function searchTasks(query: string, limit: number, offset: number): Fragment {
  return sql`
    SELECT * FROM tasks
    WHERE title ILIKE ${'%' + query + '%'}
       OR description ILIKE ${'%' + query + '%'}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

// ============================================================================
// Request types and pattern matching
// ============================================================================

type ApiRequest =
  | { kind: "list"; page: number; pageSize: number; status?: TaskStatus }
  | { kind: "get"; id: number }
  | { kind: "create"; title: string; description: string; priority: Priority; assigneeId?: number }
  | { kind: "update_status"; id: number; status: TaskStatus }
  | { kind: "search"; query: string; page: number }
  | { kind: "delete"; id: number };

type ApiResponse<T> = Either<ApiError, T>;

interface ApiError {
  code: number;
  message: string;
}

// ============================================================================
// Contract-based validation
// ============================================================================

// Using manual precondition checks since @typesugar/contracts has a runtime bug
// (imports 'typescript' compiler at runtime, which fails in CLI run mode)
function requires(condition: boolean, message?: string): asserts condition {
  if (!condition) throw new Error(`Precondition failed: ${message ?? "unknown"}`);
}

function validatePagination(page: number, pageSize: number): void {
  requires(page >= 1, `Page must be >= 1, got ${page}`);
  requires(pageSize >= 1 && pageSize <= MAX_PAGE_SIZE,
    `Page size must be between 1 and ${MAX_PAGE_SIZE}, got ${pageSize}`);
}

function validateTaskTitle(title: string): Either<string, string> {
  if (title.trim().length === 0) return Left("Title cannot be empty");
  if (title.length > 200) return Left("Title must be 200 characters or less");
  return Right(title.trim());
}

function validatePriority(p: string): Option<Priority> {
  if (p === "low" || p === "medium" || p === "high" || p === "critical") {
    return Some(p);
  }
  return None;
}

// ============================================================================
// Request handler using pattern matching
// ============================================================================

function handleRequest(req: ApiRequest): ApiResponse<string> {
  // Use the runtime handler form of match() for discriminated unions
  const result: string = match(req, {
    list: (r) => {
      validatePagination(r.page, r.pageSize);
      const offset = (r.page - 1) * r.pageSize;
      const query = searchTasks("", r.pageSize, offset);
      return `Listed tasks: ${query.text} with params [${query.params.join(", ")}]`;
    },
    get: (r) => {
      const query = findTaskById(r.id);
      return `Get task: ${query.text} with params [${query.params.join(", ")}]`;
    },
    create: (r) => {
      const titleResult = validateTaskTitle(r.title);
      if (isLeft(titleResult)) {
        return `Validation error: ${titleResult.left}`;
      }
      const query = insertTask(r.title, r.description, r.priority, r.assigneeId ?? null);
      return `Create task: ${query.text}`;
    },
    update_status: (r) => {
      const query = updateTaskStatus(r.id, r.status);
      return `Update status: ${query.text}`;
    },
    search: (r) => {
      const query = searchTasks(r.query, DEFAULT_PAGE_SIZE, (r.page - 1) * DEFAULT_PAGE_SIZE);
      return `Search: ${query.text}`;
    },
    delete: (r) => {
      return `Delete task ${r.id}`;
    },
  });

  return Right(result);
}

// ============================================================================
// Option/Either usage for safe operations
// ============================================================================

function findUser(id: number): Option<User> {
  // Simulate DB lookup
  if (id === 1) {
    return Some(new User(new UserId(1), "Alice", "alice@example.com", "admin"));
  }
  if (id === 2) {
    return Some(new User(new UserId(2), "Bob", "bob@example.com", "member"));
  }
  return None;
}

function assignTask(taskId: number, userId: number): Either<string, string> {
  const user = findUser(userId);
  if (user === None) {
    return Left(`User ${userId} not found`);
  }
  const query = sql`UPDATE tasks SET assignee_id = ${userId} WHERE id = ${taskId}`;
  return Right(`Assigned task ${taskId} to user ${userId}: ${query.text}`);
}

// ============================================================================
// Pipe for functional composition
// ============================================================================

function toUpper(s: string): string { return s.toUpperCase(); }
function addPrefix(s: string): string { return `[API ${API_VERSION}] ${s}`; }
function addTimestamp(s: string): string { return `${s} (built: ${BUILD_TIMESTAMP})`; }

const formatMessage = (msg: string) => pipe(msg, toUpper, addPrefix, addTimestamp);

// ============================================================================
// Main - simulate API requests
// ============================================================================

console.log("\n=== REST API Server Demo ===");
console.log(formatMessage("server starting"));
console.log(`API Version: ${API_VERSION}`);
console.log(`Build: ${BUILD_TIMESTAMP}`);
console.log(`Max page size: ${MAX_PAGE_SIZE}`);

// Test SQL queries
console.log("\n--- SQL Queries ---");
const q1 = findTaskById(42);
console.log(`Find by ID: ${q1.text}`);
console.log(`  Params: [${q1.params.join(", ")}]`);

const q2 = findTasksByAssignee(1, "in_progress");
console.log(`Find by assignee: ${q2.text}`);

const q3 = insertTask("Fix bug", "Fix the login bug", "high", 1);
console.log(`Insert: ${q3.text}`);

// Test request handling via pattern matching
console.log("\n--- Request Handling ---");
const requests: ApiRequest[] = [
  { kind: "get", id: 42 },
  { kind: "create", title: "New feature", description: "Add dark mode", priority: "medium" },
  { kind: "update_status", id: 1, status: "done" },
  { kind: "search", query: "bug", page: 1 },
  { kind: "list", page: 1, pageSize: 10 },
];

for (const req of requests) {
  const resp = handleRequest(req);
  console.log(`${req.kind}: ${JSON.stringify(resp)}`);
}

// Test Option/Either
console.log("\n--- Option/Either ---");
const user1 = findUser(1);
console.log(`User 1: ${user1 === None ? "not found" : "found"}`);

const user3 = findUser(99);
console.log(`User 99: ${user3 === None ? "not found" : "found"}`);

const assign1 = assignTask(1, 1);
console.log(`Assign: ${JSON.stringify(assign1)}`);

const assign2 = assignTask(1, 99);
console.log(`Assign missing: ${JSON.stringify(assign2)}`);

// Test validation
console.log("\n--- Validation ---");
console.log(`Valid title: ${JSON.stringify(validateTaskTitle("Fix bug"))}`);
console.log(`Empty title: ${JSON.stringify(validateTaskTitle(""))}`);
console.log(`Valid priority: ${JSON.stringify(validatePriority("high"))}`);
console.log(`Invalid priority: ${JSON.stringify(validatePriority("urgent"))}`);

// Test contracts
console.log("\n--- Contracts ---");
try {
  validatePagination(1, 20);
  console.log("Valid pagination: OK");
} catch (e: any) {
  console.log(`Pagination error: ${e.message}`);
}

try {
  validatePagination(0, 20);
} catch (e: any) {
  console.log(`Invalid page: ${e.message}`);
}

try {
  validatePagination(1, 200);
} catch (e: any) {
  console.log(`Invalid page size: ${e.message}`);
}

// Test derive
console.log("\n--- Derive ---");
const t1 = new TaskId(1);
const t2 = new TaskId(1);
const t3 = new TaskId(2);
console.log(`TaskId(1) === TaskId(1): ${t1 === t2}`);
console.log(`TaskId(1) === TaskId(2): ${t1 === t3}`);

const task = new Task(
  new TaskId(1), "Demo task", "A test task",
  "high", "todo", null, "2024-01-01", "2024-01-01"
);
console.log(`Task fields: ${taskFields.join(", ")}`);

console.log("\n=== Done ===");
