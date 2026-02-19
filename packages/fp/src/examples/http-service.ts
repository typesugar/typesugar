/**
 * HTTP Service Example
 *
 * Demonstrates using IO, Reader, and Either to build
 * a functional HTTP service layer with dependency injection.
 *
 * Features:
 * - Reader for dependency injection (config, clients)
 * - IO for effectful HTTP calls
 * - Either for error handling
 * - Validation with Validated
 * - Resource management
 */

import { IO, runIO } from "../io/io";
import { Reader } from "../data/reader";
import { Either, Left, Right } from "../data/either";
import { Option, Some, None } from "../data/option";
import {
  Validated,
  ValidatedNel,
  validNel,
  invalidNel,
} from "../data/validated";
import { NonEmptyList } from "../data/nonempty-list";
import { pipe, flow } from "../syntax/pipe";

// ============================================================================
// Domain Types
// ============================================================================

/**
 * User entity
 */
interface User {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly createdAt: Date;
}

/**
 * Create user request
 */
interface CreateUserRequest {
  readonly name: string;
  readonly email: string;
}

/**
 * API error types
 */
type ApiError =
  | { type: "NotFound"; message: string }
  | { type: "ValidationError"; errors: string[] }
  | { type: "NetworkError"; message: string }
  | { type: "ServerError"; message: string };

/**
 * API result type
 */
type ApiResult<A> = Either<ApiError, A>;

// ============================================================================
// Configuration & Dependencies
// ============================================================================

/**
 * HTTP client config
 */
interface HttpConfig {
  readonly baseUrl: string;
  readonly timeout: number;
  readonly retries: number;
}

/**
 * Logger interface
 */
interface Logger {
  readonly info: (message: string) => IO<void>;
  readonly error: (message: string) => IO<void>;
  readonly debug: (message: string) => IO<void>;
}

/**
 * HTTP client interface (abstracted for testing)
 */
interface HttpClient {
  readonly get: <A>(path: string) => IO<ApiResult<A>>;
  readonly post: <A, B>(path: string, body: A) => IO<ApiResult<B>>;
  readonly put: <A, B>(path: string, body: A) => IO<ApiResult<B>>;
  readonly delete: (path: string) => IO<ApiResult<void>>;
}

/**
 * Application environment (all dependencies)
 */
interface AppEnv {
  readonly config: HttpConfig;
  readonly logger: Logger;
  readonly httpClient: HttpClient;
}

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Console logger implementation
 */
const consoleLogger: Logger = {
  info: (message) => IO.delay(() => console.log(`[INFO] ${message}`)),
  error: (message) => IO.delay(() => console.error(`[ERROR] ${message}`)),
  debug: (message) => IO.delay(() => console.log(`[DEBUG] ${message}`)),
};

/**
 * Mock user database
 */
const mockUsers: Map<string, User> = new Map([
  [
    "1",
    {
      id: "1",
      name: "Alice",
      email: "alice@example.com",
      createdAt: new Date("2024-01-01"),
    },
  ],
  [
    "2",
    {
      id: "2",
      name: "Bob",
      email: "bob@example.com",
      createdAt: new Date("2024-02-01"),
    },
  ],
]);

let nextId = 3;

/**
 * Mock HTTP client implementation
 */
function createMockHttpClient(_config: HttpConfig): HttpClient {
  return {
    get: <A>(path: string) =>
      IO.delay((): ApiResult<A> => {
        // Simulate network delay
        const match = path.match(/\/users\/(\d+)/);
        if (match) {
          const user = mockUsers.get(match[1]);
          if (!user) {
            return Left({
              type: "NotFound",
              message: `User ${match[1]} not found`,
            });
          }
          return Right(user as unknown as A);
        }

        if (path === "/users") {
          return Right(Array.from(mockUsers.values()) as unknown as A);
        }

        return Left({ type: "NotFound", message: `Path not found: ${path}` });
      }),

    post: <A, B>(path: string, body: A) =>
      IO.delay((): ApiResult<B> => {
        if (path === "/users") {
          const req = body as unknown as CreateUserRequest;
          const id = String(nextId++);
          const user: User = {
            id,
            name: req.name,
            email: req.email,
            createdAt: new Date(),
          };
          mockUsers.set(id, user);
          return Right(user as unknown as B);
        }
        return Left({ type: "NotFound", message: `Path not found: ${path}` });
      }),

    put: <A, B>(path: string, body: A) =>
      IO.delay((): ApiResult<B> => {
        const match = path.match(/\/users\/(\d+)/);
        if (match) {
          const existing = mockUsers.get(match[1]);
          if (!existing) {
            return Left({
              type: "NotFound",
              message: `User ${match[1]} not found`,
            });
          }
          const req = body as unknown as Partial<User>;
          const updated: User = { ...existing, ...req };
          mockUsers.set(match[1], updated);
          return Right(updated as unknown as B);
        }
        return Left({ type: "NotFound", message: `Path not found: ${path}` });
      }),

    delete: (path: string) =>
      IO.delay((): ApiResult<void> => {
        const match = path.match(/\/users\/(\d+)/);
        if (match) {
          if (!mockUsers.has(match[1])) {
            return Left({
              type: "NotFound",
              message: `User ${match[1]} not found`,
            });
          }
          mockUsers.delete(match[1]);
          return Right(undefined);
        }
        return Left({ type: "NotFound", message: `Path not found: ${path}` });
      }),
  };
}

// ============================================================================
// Service Types using Reader
// ============================================================================

/**
 * A service function that needs the environment
 */
type Service<A> = Reader<AppEnv, IO<ApiResult<A>>>;

/**
 * Helper to lift IO<ApiResult<A>> into Service
 */
function service<A>(f: (env: AppEnv) => IO<ApiResult<A>>): Service<A> {
  return Reader.asks(f);
}

/**
 * Helper to log and execute
 */
function withLogging<A>(label: string, action: Service<A>): Service<A> {
  return Reader.asks((env) =>
    IO.flatMap(env.logger.debug(`Starting: ${label}`), () =>
      IO.flatMap(action.run(env), (result) =>
        IO.flatMap(
          result._tag === "Left"
            ? env.logger.error(`Failed: ${label} - ${result.left.message}`)
            : env.logger.debug(`Completed: ${label}`),
          () => IO.pure(result),
        ),
      ),
    ),
  );
}

// ============================================================================
// User Service
// ============================================================================

/**
 * User service operations
 */
const UserService = {
  /**
   * Get all users
   */
  getAll: withLogging(
    "UserService.getAll",
    service((env) => env.httpClient.get<User[]>("/users")),
  ),

  /**
   * Get user by ID
   */
  getById: (id: string): Service<User> =>
    withLogging(
      `UserService.getById(${id})`,
      service((env) => env.httpClient.get<User>(`/users/${id}`)),
    ),

  /**
   * Create a new user
   */
  create: (request: CreateUserRequest): Service<User> =>
    withLogging(
      `UserService.create(${request.email})`,
      service((env) =>
        env.httpClient.post<CreateUserRequest, User>("/users", request),
      ),
    ),

  /**
   * Update a user
   */
  update: (id: string, updates: Partial<User>): Service<User> =>
    withLogging(
      `UserService.update(${id})`,
      service((env) =>
        env.httpClient.put<Partial<User>, User>(`/users/${id}`, updates),
      ),
    ),

  /**
   * Delete a user
   */
  delete: (id: string): Service<void> =>
    withLogging(
      `UserService.delete(${id})`,
      service((env) => env.httpClient.delete(`/users/${id}`)),
    ),
};

// ============================================================================
// Validation
// ============================================================================

type ValidationError = string;

/**
 * Validate create user request
 */
function validateCreateUserRequest(
  request: CreateUserRequest,
): ValidatedNel<ValidationError, CreateUserRequest> {
  const nameV =
    request.name.trim().length >= 2
      ? validNel(request.name.trim())
      : invalidNel("Name must be at least 2 characters");

  const emailV = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.email)
    ? validNel(request.email)
    : invalidNel("Invalid email format");

  return Validated.map2(
    nameV,
    emailV,
    (name, email): CreateUserRequest => ({
      name,
      email,
    }),
  );
}

/**
 * Create user with validation
 */
function createUserValidated(request: CreateUserRequest): Service<User> {
  return Reader.asks((env) => {
    const validation = validateCreateUserRequest(request);

    if (validation._tag === "Invalid") {
      const errors = NonEmptyList.toArray(validation.error);
      const apiError: ApiError = { type: "ValidationError", errors };
      return IO.pure(Left(apiError) as ApiResult<User>);
    }

    return UserService.create(validation.value).run(env);
  });
}

// ============================================================================
// Running Services
// ============================================================================

/**
 * Run a service with the environment
 */
function runService<A>(env: AppEnv, svc: Service<A>): Promise<ApiResult<A>> {
  return runIO(svc.run(env));
}

/**
 * Create the application environment
 */
function createAppEnv(): AppEnv {
  const config: HttpConfig = {
    baseUrl: "http://localhost:3000",
    timeout: 5000,
    retries: 3,
  };

  return {
    config,
    logger: consoleLogger,
    httpClient: createMockHttpClient(config),
  };
}

// ============================================================================
// Example Usage
// ============================================================================

/**
 * Run the HTTP service example
 */
export async function runHttpServiceExample(): Promise<void> {
  console.log("=== HTTP Service Example ===\n");

  const env = createAppEnv();

  // Get all users
  console.log("1. Getting all users:");
  const allUsers = await runService(env, UserService.getAll);
  if (allUsers._tag === "Right") {
    console.log("   Users:", allUsers.right.map((u) => u.name).join(", "));
  } else {
    console.log("   Error:", allUsers.left.message);
  }

  // Get user by ID
  console.log("\n2. Getting user by ID:");
  const user = await runService(env, UserService.getById("1"));
  if (user._tag === "Right") {
    console.log("   User:", user.right.name, user.right.email);
  } else {
    console.log("   Error:", user.left.message);
  }

  // Get non-existent user
  console.log("\n3. Getting non-existent user:");
  const notFound = await runService(env, UserService.getById("999"));
  if (notFound._tag === "Left") {
    console.log("   Expected error:", notFound.left.message);
  }

  // Create user with validation
  console.log("\n4. Creating user with validation:");
  const newUser = await runService(
    env,
    createUserValidated({ name: "Charlie", email: "charlie@example.com" }),
  );
  if (newUser._tag === "Right") {
    console.log("   Created:", newUser.right.name, newUser.right.email);
  }

  // Create user with invalid data
  console.log("\n5. Creating user with invalid data:");
  const invalidUser = await runService(
    env,
    createUserValidated({ name: "C", email: "not-an-email" }),
  );
  if (
    invalidUser._tag === "Left" &&
    invalidUser.left.type === "ValidationError"
  ) {
    console.log("   Validation errors:", invalidUser.left.errors.join(", "));
  }

  // Update user
  console.log("\n6. Updating user:");
  const updated = await runService(
    env,
    UserService.update("1", { name: "Alice Updated" }),
  );
  if (updated._tag === "Right") {
    console.log("   Updated:", updated.right.name);
  }

  // Delete user
  console.log("\n7. Deleting user:");
  const deleted = await runService(env, UserService.delete("2"));
  if (deleted._tag === "Right") {
    console.log("   Deleted successfully");
  }

  // Verify deletion
  console.log("\n8. Verifying deletion:");
  const afterDelete = await runService(env, UserService.getAll);
  if (afterDelete._tag === "Right") {
    console.log(
      "   Remaining users:",
      afterDelete.right.map((u) => u.name).join(", "),
    );
  }

  console.log("\n=== Example Complete ===");
}

// ============================================================================
// Composing Services
// ============================================================================

/**
 * Example of composing multiple services
 */
function getUsersAndCount(): Service<{ users: User[]; count: number }> {
  return Reader.asks((env) =>
    IO.flatMap(UserService.getAll.run(env), (result) => {
      if (result._tag === "Left") {
        return IO.pure(result as ApiResult<{ users: User[]; count: number }>);
      }
      return IO.pure(
        Right({
          users: result.right,
          count: result.right.length,
        }),
      );
    }),
  );
}

/**
 * Pipeline: validate, create, then fetch all
 */
function createAndFetchAll(request: CreateUserRequest): Service<User[]> {
  return Reader.asks((env) =>
    IO.flatMap(createUserValidated(request).run(env), (createResult) => {
      if (createResult._tag === "Left") {
        return IO.pure(createResult as ApiResult<User[]>);
      }
      return UserService.getAll.run(env);
    }),
  );
}
