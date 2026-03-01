/**
 * HTTP Server Example — With @typesugar/effect
 *
 * The same HTTP server as before.ts, but using @typesugar/effect macros.
 *
 * Notice the improvements:
 * - @service generates Context.Tag and accessors from a clean interface
 * - @layer declaratively specifies dependencies, auto-wraps in Layer.effect
 * - resolveLayer<R>() automatically composes all required layers
 * - @compiled eliminates generator overhead in hot paths
 * - Rich diagnostics if you forget a layer
 */

import { Effect, Layer, pipe } from "effect";
import {
  service,
  layer,
  resolveLayer,
  compiled,
} from "@typesugar/effect";

// ============================================================================
// Error Types (unchanged)
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
  constructor(readonly resource: string, readonly id: string) {}
}

// ============================================================================
// Domain Types (unchanged)
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
// Services — Clean Interface Definitions
// ============================================================================

// @service generates:
// - LoggerTag class (extends Context.Tag)
// - Logger namespace with accessor functions
// - Registry entry for layer resolution

@service
interface Logger {
  info(message: string): Effect.Effect<void>;
  error(message: string, error?: unknown): Effect.Effect<void>;
  debug(message: string, data?: unknown): Effect.Effect<void>;
}
// Generates:
//   export class LoggerTag extends Context.Tag("Logger")<Logger, {...}>() {}
//   export namespace Logger {
//     export const Tag = LoggerTag
//     export const info = Effect.serviceFunctionEffect(LoggerTag, _ => _.info)
//     export const error = Effect.serviceFunctionEffect(LoggerTag, _ => _.error)
//     export const debug = Effect.serviceFunctionEffect(LoggerTag, _ => _.debug)
//   }

@service
interface Database {
  query<T>(sql: string, params?: unknown[]): Effect.Effect<T, DbError>;
  transaction<T, E, R>(effect: Effect.Effect<T, E, R>): Effect.Effect<T, E | DbError, R>;
}

@service
interface UserRepo {
  findById(id: string): Effect.Effect<User | null, DbError>;
  findByEmail(email: string): Effect.Effect<User | null, DbError>;
  save(user: Omit<User, "id" | "createdAt">): Effect.Effect<User, DbError>;
  update(id: string, data: Partial<User>): Effect.Effect<User, DbError | NotFoundError>;
}

@service
interface PostRepo {
  findById(id: string): Effect.Effect<Post | null, DbError>;
  findByAuthor(authorId: string): Effect.Effect<Post[], DbError>;
  create(post: Omit<Post, "id">): Effect.Effect<Post, DbError>;
  publish(id: string): Effect.Effect<Post, DbError | NotFoundError>;
}

@service
interface HttpClient {
  get<T>(url: string): Effect.Effect<T, HttpError>;
  post<T>(url: string, body: unknown): Effect.Effect<T, HttpError>;
}

// ============================================================================
// Layers — Declarative Dependencies
// ============================================================================

// @layer(Service) wraps in Layer.succeed automatically
@layer(Logger)
const loggerLive = {
  info: (message: string) =>
    Effect.sync(() => console.log(`[INFO] ${new Date().toISOString()} ${message}`)),
  error: (message: string, error?: unknown) =>
    Effect.sync(() => console.error(`[ERROR] ${new Date().toISOString()} ${message}`, error)),
  debug: (message: string, data?: unknown) =>
    Effect.sync(() => console.debug(`[DEBUG] ${new Date().toISOString()} ${message}`, data)),
};
// Compiles to: const loggerLive = Layer.succeed(LoggerTag, { ... })

@layer(Database)
const databaseLive = {
  query: <T>(sql: string, params?: unknown[]) =>
    Effect.tryPromise({
      try: async () => {
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
};

// @layer with requires: declares dependencies
// Uses do-notation (let:/yield:) for clean service access
@layer(UserRepo, { requires: [Database, Logger] })
const userRepoLive =
let: {
  db << Database;
  logger << Logger;
}
yield: ({
  findById: (id) =>
    pipe(
      logger.debug(`Finding user by id: ${id}`),
      Effect.flatMap(() =>
        db.query<User | null>(`SELECT * FROM users WHERE id = $1`, [id])
      )
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
        user
          ? Effect.succeed(user)
          : Effect.fail(new NotFoundError("User", id))
      )
    ),
});
// Compiles to:
//   const userRepoLive = Layer.effect(
//     UserRepoTag,
//     Effect.flatMap(Database, (db) =>
//       Effect.map(Logger, (logger) => ({ ... }))
//     )
//   )
// + registers in layerRegistry: { provides: "UserRepo", requires: ["Database", "Logger"] }

@layer(PostRepo, { requires: [Database, Logger] })
const postRepoLive =
let: {
  db << Database;
  logger << Logger;
}
yield: ({
  findById: (id) =>
    pipe(
      logger.debug(`Finding post by id: ${id}`),
      Effect.flatMap(() =>
        db.query<Post | null>(`SELECT * FROM posts WHERE id = $1`, [id])
      )
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
        post
          ? Effect.succeed(post)
          : Effect.fail(new NotFoundError("Post", id))
      )
    ),
});

@layer(HttpClient)
const httpClientLive = {
  get: <T>(url: string) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new HttpError(response.status, response.statusText);
        }
        return response.json() as T;
      },
      catch: (e) =>
        e instanceof HttpError ? e : new HttpError(500, String(e)),
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
      catch: (e) =>
        e instanceof HttpError ? e : new HttpError(500, String(e)),
    }),
};

// ============================================================================
// Business Logic — With @compiled Optimization
// ============================================================================

// @compiled transforms Effect.gen into direct flatMap chains
// This eliminates generator protocol overhead — important for hot paths
class UserService {
  @compiled
  static createUserWithPost(
    name: string,
    email: string,
    postTitle: string,
    postContent: string
  ) {
    return Effect.gen(function* () {
      const userRepo = yield* UserRepo;
      const postRepo = yield* PostRepo;
      const logger = yield* Logger;

      yield* logger.info(`Creating user ${email} with initial post`);

      const existing = yield* userRepo.findByEmail(email);
      if (existing) {
        yield* logger.error(`User ${email} already exists`);
        return yield* Effect.fail(new DbError(`User ${email} already exists`));
      }

      const user = yield* userRepo.save({ name, email });
      yield* logger.info(`Created user ${user.id}`);

      const post = yield* postRepo.create({
        authorId: user.id,
        title: postTitle,
        content: postContent,
        publishedAt: null,
      });
      yield* logger.info(`Created post ${post.id}`);

      return { user, post };
    });
  }
  // Compiles to:
  //   static createUserWithPost(name, email, postTitle, postContent) {
  //     return Effect.flatMap(UserRepo, (userRepo) =>
  //       Effect.flatMap(PostRepo, (postRepo) =>
  //         Effect.flatMap(Logger, (logger) =>
  //           Effect.flatMap(logger.info(...), () =>
  //             Effect.flatMap(userRepo.findByEmail(email), (existing) =>
  //               existing
  //                 ? Effect.flatMap(logger.error(...), () => Effect.fail(...))
  //                 : Effect.flatMap(userRepo.save(...), (user) =>
  //                     Effect.flatMap(logger.info(...), () =>
  //                       Effect.map(postRepo.create(...), (post) => ({ user, post }))
  //                     )
  //                   )
  //             )
  //           )
  //         )
  //       )
  //     )
  //   }

  @compiled
  static getUserProfile(userId: string) {
    return Effect.gen(function* () {
      const userRepo = yield* UserRepo;
      const postRepo = yield* PostRepo;

      const user = yield* userRepo.findById(userId);
      if (!user) {
        return yield* Effect.fail(new NotFoundError("User", userId));
      }

      const posts = yield* postRepo.findByAuthor(userId);

      return { user, posts };
    });
  }
}

// ============================================================================
// Layer Resolution — Automatic!
// ============================================================================

// resolveLayer<R>() analyzes the dependency graph and composes all layers
// If you're missing a layer, you get a helpful compile-time error

type AppRequirements = UserRepo | PostRepo | HttpClient | Logger;

// This resolves to the full layer graph automatically
const appLayer = resolveLayer<AppRequirements>();
// Compiles to:
//   const appLayer = Layer.mergeAll(
//     userRepoLive.pipe(Layer.provide(Layer.mergeAll(databaseLive, loggerLive))),
//     postRepoLive.pipe(Layer.provide(Layer.mergeAll(databaseLive, loggerLive))),
//     httpClientLive,
//     loggerLive
//   )

// If you forgot to define a layer for UserRepo, you'd get:
//
// error[EFFECT001]: No layer provides `UserRepo`
//   --> http-server/after.ts:250:20
//    |
// 250|   const appLayer = resolveLayer<AppRequirements>()
//    |                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ requires UserRepo
//    |
//    = note: AppRequirements needs:
//            - UserRepo (no layer found)
//            - PostRepo (provided by postRepoLive at line 180)
//            - HttpClient (provided by httpClientLive at line 220)
//            - Logger (provided by loggerLive at line 100)
//    = help: Add a layer:
//            @layer(UserRepo, { requires: [...] })
//            const userRepoLive = ...

// ============================================================================
// Running the Program
// ============================================================================

const program = pipe(
  UserService.createUserWithPost(
    "Alice",
    "alice@example.com",
    "Hello World",
    "This is my first post!"
  ),
  Effect.tap(({ user, post }) =>
    Effect.sync(() => console.log("Created:", { user, post }))
  ),
  Effect.catchAll((error) =>
    Effect.sync(() => console.error("Error:", error))
  )
);

// Layer resolution happens automatically
const runnable = pipe(program, Effect.provide(appLayer));

// Run it
// Effect.runPromise(runnable);

export {
  // Services are now both types AND namespaces with accessors
  Logger,
  Database,
  UserRepo,
  PostRepo,
  HttpClient,
  // Layers
  loggerLive,
  databaseLive,
  userRepoLive,
  postRepoLive,
  httpClientLive,
  appLayer,
  // Business logic
  UserService,
  program,
};

// ============================================================================
// Summary: What Changed?
// ============================================================================
//
// 1. Services:
//    Before: 5 manual Context.Tag class definitions (~60 lines of boilerplate)
//    After:  5 @service interfaces (~25 lines, clean interfaces)
//
// 2. Layers:
//    Before: Manual Layer.succeed/effect wrapping, manual Effect.gen
//    After:  @layer decorators with declarative dependencies, do-notation
//
// 3. Composition:
//    Before: Manual Layer.mergeAll + Layer.provide chain
//    After:  resolveLayer<R>() — automatic dependency graph resolution
//
// 4. Error Messages:
//    Before: Cryptic TypeScript type errors
//    After:  Rich diagnostics pointing to missing layers with suggestions
//
// 5. Performance:
//    Before: Generator protocol overhead in Effect.gen
//    After:  @compiled eliminates generators in hot paths
//
// The compiled output is identical to hand-optimized Effect code.
// typesugar gives you cleaner syntax with zero runtime cost.
