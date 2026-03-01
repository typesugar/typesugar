/**
 * HTTP Server Example — Plain Effect-TS
 *
 * This example shows idiomatic Effect-TS patterns for building an HTTP server
 * with multiple services, layers, and dependency injection.
 *
 * Notice the boilerplate:
 * - Every service needs a Context.Tag class with detailed type signatures
 * - Every layer needs manual Layer.succeed/effect wrapping
 * - Layer composition is manual and error-prone
 * - No compile-time validation of missing layers
 */

import { Effect, Context, Layer, pipe } from "effect";

// ============================================================================
// Error Types
// ============================================================================

class HttpError {
  readonly _tag = "HttpError";
  constructor(
    readonly status: number,
    readonly message: string
  ) {}
}

class DbError {
  readonly _tag = "DbError";
  constructor(readonly message: string) {}
}

class NotFoundError {
  readonly _tag = "NotFoundError";
  constructor(
    readonly resource: string,
    readonly id: string
  ) {}
}

// ============================================================================
// Domain Types
// ============================================================================

interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

interface Post {
  id: string;
  authorId: string;
  title: string;
  content: string;
  publishedAt: Date | null;
}

// ============================================================================
// Services — Lots of Boilerplate
// ============================================================================

// Logger Service — Must define Tag class manually
class Logger extends Context.Tag("Logger")<
  Logger,
  {
    readonly info: (message: string) => Effect.Effect<void>;
    readonly error: (message: string, error?: unknown) => Effect.Effect<void>;
    readonly debug: (message: string, data?: unknown) => Effect.Effect<void>;
  }
>() {}

// Database Service — Another Tag class
class Database extends Context.Tag("Database")<
  Database,
  {
    readonly query: <T>(sql: string, params?: unknown[]) => Effect.Effect<T, DbError>;
    readonly transaction: <T, E, R>(
      effect: Effect.Effect<T, E, R>
    ) => Effect.Effect<T, E | DbError, R>;
  }
>() {}

// UserRepo Service — More boilerplate
class UserRepo extends Context.Tag("UserRepo")<
  UserRepo,
  {
    readonly findById: (id: string) => Effect.Effect<User | null, DbError>;
    readonly findByEmail: (email: string) => Effect.Effect<User | null, DbError>;
    readonly save: (user: Omit<User, "id" | "createdAt">) => Effect.Effect<User, DbError>;
    readonly update: (
      id: string,
      data: Partial<User>
    ) => Effect.Effect<User, DbError | NotFoundError>;
  }
>() {}

// PostRepo Service — And another
class PostRepo extends Context.Tag("PostRepo")<
  PostRepo,
  {
    readonly findById: (id: string) => Effect.Effect<Post | null, DbError>;
    readonly findByAuthor: (authorId: string) => Effect.Effect<Post[], DbError>;
    readonly create: (post: Omit<Post, "id">) => Effect.Effect<Post, DbError>;
    readonly publish: (id: string) => Effect.Effect<Post, DbError | NotFoundError>;
  }
>() {}

// HttpClient Service — External API calls
class HttpClient extends Context.Tag("HttpClient")<
  HttpClient,
  {
    readonly get: <T>(url: string) => Effect.Effect<T, HttpError>;
    readonly post: <T>(url: string, body: unknown) => Effect.Effect<T, HttpError>;
  }
>() {}

// ============================================================================
// Layers — Manual Wiring
// ============================================================================

// Logger implementation — must wrap in Layer.succeed manually
const LoggerLive = Layer.succeed(Logger, {
  info: (message) =>
    Effect.sync(() => console.log(`[INFO] ${new Date().toISOString()} ${message}`)),
  error: (message, error) =>
    Effect.sync(() => console.error(`[ERROR] ${new Date().toISOString()} ${message}`, error)),
  debug: (message, data) =>
    Effect.sync(() => console.debug(`[DEBUG] ${new Date().toISOString()} ${message}`, data)),
});

// Database implementation — sync, no dependencies
const DatabaseLive = Layer.succeed(Database, {
  query: <T>(sql: string, params?: unknown[]) =>
    Effect.tryPromise({
      try: async () => {
        // Simulated database query
        console.log(`Executing: ${sql}`, params);
        return {} as T;
      },
      catch: (e) => new DbError(String(e)),
    }),
  transaction: <T, E, R>(effect: Effect.Effect<T, E, R>) =>
    pipe(
      Effect.sync(() => console.log("BEGIN TRANSACTION")),
      Effect.flatMap(() => effect),
      Effect.tap(() => Effect.sync(() => console.log("COMMIT"))),
      Effect.catchAll((e) =>
        pipe(
          Effect.sync(() => console.log("ROLLBACK")),
          Effect.flatMap(() => Effect.fail(e))
        )
      )
    ) as Effect.Effect<T, E | DbError, R>,
});

// UserRepo implementation — depends on Database AND Logger
// Must use Layer.effect and yield* manually
const UserRepoLive = Layer.effect(
  UserRepo,
  Effect.gen(function* () {
    const db = yield* Database;
    const logger = yield* Logger;

    return {
      findById: (id) =>
        pipe(
          logger.debug(`Finding user by id: ${id}`),
          Effect.flatMap(() => db.query<User | null>(`SELECT * FROM users WHERE id = $1`, [id]))
        ),

      findByEmail: (email) =>
        pipe(
          logger.debug(`Finding user by email: ${email}`),
          Effect.flatMap(() =>
            db.query<User | null>(`SELECT * FROM users WHERE email = $1`, [email])
          )
        ),

      save: (user) =>
        pipe(
          logger.info(`Creating new user: ${user.email}`),
          Effect.flatMap(() =>
            db.query<User>(
              `INSERT INTO users (name, email, created_at) VALUES ($1, $2, NOW()) RETURNING *`,
              [user.name, user.email]
            )
          )
        ),

      update: (id, data) =>
        pipe(
          logger.info(`Updating user: ${id}`),
          Effect.flatMap(() =>
            db.query<User | null>(`UPDATE users SET ... WHERE id = $1 RETURNING *`, [id])
          ),
          Effect.flatMap((user) =>
            user ? Effect.succeed(user) : Effect.fail(new NotFoundError("User", id))
          )
        ),
    };
  })
);

// PostRepo implementation — depends on Database and Logger
const PostRepoLive = Layer.effect(
  PostRepo,
  Effect.gen(function* () {
    const db = yield* Database;
    const logger = yield* Logger;

    return {
      findById: (id) =>
        pipe(
          logger.debug(`Finding post by id: ${id}`),
          Effect.flatMap(() => db.query<Post | null>(`SELECT * FROM posts WHERE id = $1`, [id]))
        ),

      findByAuthor: (authorId) =>
        pipe(
          logger.debug(`Finding posts by author: ${authorId}`),
          Effect.flatMap(() =>
            db.query<Post[]>(`SELECT * FROM posts WHERE author_id = $1`, [authorId])
          )
        ),

      create: (post) =>
        pipe(
          logger.info(`Creating post: ${post.title}`),
          Effect.flatMap(() =>
            db.query<Post>(
              `INSERT INTO posts (author_id, title, content) VALUES ($1, $2, $3) RETURNING *`,
              [post.authorId, post.title, post.content]
            )
          )
        ),

      publish: (id) =>
        pipe(
          logger.info(`Publishing post: ${id}`),
          Effect.flatMap(() =>
            db.query<Post | null>(
              `UPDATE posts SET published_at = NOW() WHERE id = $1 RETURNING *`,
              [id]
            )
          ),
          Effect.flatMap((post) =>
            post ? Effect.succeed(post) : Effect.fail(new NotFoundError("Post", id))
          )
        ),
    };
  })
);

// HttpClient implementation — no dependencies
const HttpClientLive = Layer.succeed(HttpClient, {
  get: <T>(url: string) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new HttpError(response.status, response.statusText);
        }
        return response.json() as T;
      },
      catch: (e) => (e instanceof HttpError ? e : new HttpError(500, String(e))),
    }),

  post: <T>(url: string, body: unknown) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          throw new HttpError(response.status, response.statusText);
        }
        return response.json() as T;
      },
      catch: (e) => (e instanceof HttpError ? e : new HttpError(500, String(e))),
    }),
});

// ============================================================================
// Layer Composition — Manual and Error-Prone
// ============================================================================

// Must manually compose layers in the right order
// If you forget a dependency, you get a cryptic type error at runtime
const AppLayer = pipe(
  Layer.mergeAll(UserRepoLive, PostRepoLive, HttpClientLive),
  Layer.provide(DatabaseLive),
  Layer.provide(LoggerLive)
);

// ============================================================================
// Business Logic
// ============================================================================

// Creating a user with their first post — lots of Effect.gen boilerplate
const createUserWithPost = (name: string, email: string, postTitle: string, postContent: string) =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo;
    const postRepo = yield* PostRepo;
    const logger = yield* Logger;

    yield* logger.info(`Creating user ${email} with initial post`);

    // Check if user exists
    const existing = yield* userRepo.findByEmail(email);
    if (existing) {
      yield* logger.error(`User ${email} already exists`);
      return yield* Effect.fail(new DbError(`User ${email} already exists`));
    }

    // Create user
    const user = yield* userRepo.save({ name, email });
    yield* logger.info(`Created user ${user.id}`);

    // Create post
    const post = yield* postRepo.create({
      authorId: user.id,
      title: postTitle,
      content: postContent,
      publishedAt: null,
    });
    yield* logger.info(`Created post ${post.id}`);

    return { user, post };
  });

// Get user profile with posts
const getUserProfile = (userId: string) =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo;
    const postRepo = yield* PostRepo;

    const user = yield* userRepo.findById(userId);
    if (!user) {
      return yield* Effect.fail(new NotFoundError("User", userId));
    }

    const posts = yield* postRepo.findByAuthor(userId);

    return { user, posts };
  });

// ============================================================================
// Running the Program
// ============================================================================

const program = pipe(
  createUserWithPost("Alice", "alice@example.com", "Hello World", "This is my first post!"),
  Effect.tap(({ user, post }) => Effect.sync(() => console.log("Created:", { user, post }))),
  Effect.catchAll((error) => Effect.sync(() => console.error("Error:", error)))
);

// Must provide the composed layer manually
const runnable = pipe(program, Effect.provide(AppLayer));

// If you forgot to add a layer, you'd get:
// Type error: Property 'UserRepo' is missing in type '...'
// But the error message is not helpful — doesn't tell you which layer to add

// Run it
// Effect.runPromise(runnable);

export {
  Logger,
  Database,
  UserRepo,
  PostRepo,
  HttpClient,
  LoggerLive,
  DatabaseLive,
  UserRepoLive,
  PostRepoLive,
  HttpClientLive,
  AppLayer,
  createUserWithPost,
  getUserProfile,
  program,
};
