/**
 * IOApp - Application entry point for IO programs
 *
 * IOApp provides a structured way to build applications
 * that use IO as their effect type.
 */

import { IO, runIO } from "./io";
import { Either, Left, Right } from "../data/either";

// ============================================================================
// Exit Codes
// ============================================================================

/**
 * Exit code for successful program termination
 */
export const ExitSuccess = 0;

/**
 * Exit code for error program termination
 */
export const ExitFailure = 1;

/**
 * Exit code type
 */
export type ExitCode = typeof ExitSuccess | number;

// ============================================================================
// IOApp Abstract Class
// ============================================================================

/**
 * Abstract base class for IO applications
 *
 * Extend this class and implement the `run` method to create
 * a main entry point for your IO program.
 *
 * @example
 * ```typescript
 * class MyApp extends IOApp {
 *   run(args: string[]): IO<ExitCode> {
 *     return IO.flatMap(
 *       Console.putStrLn(`Hello, ${args[0] || 'World'}!`),
 *       () => IO.pure(ExitSuccess)
 *     );
 *   }
 * }
 *
 * new MyApp().main(process.argv.slice(2));
 * ```
 */
export abstract class IOApp {
  /**
   * The main entry point for the application.
   * Implement this method to define your program.
   */
  abstract run(args: string[]): IO<ExitCode>;

  /**
   * Execute the application
   */
  async main(args: string[]): Promise<void> {
    try {
      const exitCode = await runIO(this.run(args));
      if (typeof process !== "undefined" && process.exit) {
        process.exit(exitCode);
      }
    } catch (error) {
      console.error("Unhandled error:", error);
      if (typeof process !== "undefined" && process.exit) {
        process.exit(ExitFailure);
      }
    }
  }

  /**
   * Run without exiting (for testing)
   */
  async runAsync(args: string[]): Promise<ExitCode> {
    return runIO(this.run(args));
  }
}

// ============================================================================
// Simple IOApp - Function-based entry point
// ============================================================================

/**
 * Create and run a simple IO application from a function
 *
 * @example
 * ```typescript
 * runIOApp(() =>
 *   IO.flatMap(
 *     Console.putStrLn("Hello, World!"),
 *     () => IO.pure(ExitSuccess)
 *   )
 * );
 * ```
 */
export function runIOApp(program: () => IO<ExitCode>): void {
  class App extends IOApp {
    run(_args: string[]): IO<ExitCode> {
      return program();
    }
  }

  const args = typeof process !== "undefined" ? process.argv.slice(2) : [];
  new App().main(args);
}

/**
 * Create and run an IO application with access to args
 */
export function runIOAppWithArgs(
  program: (args: string[]) => IO<ExitCode>,
): void {
  class App extends IOApp {
    run(args: string[]): IO<ExitCode> {
      return program(args);
    }
  }

  const args = typeof process !== "undefined" ? process.argv.slice(2) : [];
  new App().main(args);
}

// ============================================================================
// IOApp Builder
// ============================================================================

/**
 * Builder for creating IO applications with lifecycle hooks
 */
export class IOAppBuilder {
  private _beforeAll: IO<void> = IO.unit;
  private _afterAll: IO<void> = IO.unit;
  private _onError: (e: Error) => IO<void> = () => IO.unit;

  /**
   * Run an action before the main program
   */
  beforeAll(action: IO<void>): this {
    this._beforeAll = action;
    return this;
  }

  /**
   * Run an action after the main program
   */
  afterAll(action: IO<void>): this {
    this._afterAll = action;
    return this;
  }

  /**
   * Handle errors
   */
  onError(handler: (e: Error) => IO<void>): this {
    this._onError = handler;
    return this;
  }

  /**
   * Build and run the application
   */
  run(program: IO<ExitCode>): void {
    const fullProgram = IO.flatMap(this._beforeAll, () =>
      IO.guarantee(
        IO.handleError(program, (e) =>
          IO.flatMap(this._onError(e), () => IO.pure(ExitFailure)),
        ),
        this._afterAll,
      ),
    );

    runIOApp(() => fullProgram);
  }
}

/**
 * Create a new IOApp builder
 */
export function ioApp(): IOAppBuilder {
  return new IOAppBuilder();
}

// ============================================================================
// Resource-safe IOApp
// ============================================================================

/**
 * Run an IO application with automatic resource management
 */
export function runIOAppWithResources<R>(
  acquire: IO<R>,
  use: (r: R) => IO<ExitCode>,
  release: (r: R) => IO<void>,
): void {
  const program = IO.bracket(acquire, use, release);
  runIOApp(() => program);
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Application error type
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly exitCode: ExitCode = ExitFailure,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * Create an IO that fails with an AppError
 */
export function fail(
  message: string,
  exitCode: ExitCode = ExitFailure,
): IO<never> {
  return IO.raiseError(new AppError(message, exitCode));
}

/**
 * Exit immediately with a code
 */
export function exit(code: ExitCode): IO<never> {
  return IO.delay(() => {
    if (typeof process !== "undefined" && process.exit) {
      process.exit(code);
    }
    throw new AppError(`Exit with code ${code}`, code);
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get environment variable
 */
export function getEnv(name: string): IO<string | undefined> {
  return IO.delay(() =>
    typeof process !== "undefined" ? process.env[name] : undefined,
  );
}

/**
 * Get required environment variable
 */
export function requireEnv(name: string): IO<string> {
  return IO.flatMap(getEnv(name), (value) => {
    if (value === undefined) {
      return fail(`Missing required environment variable: ${name}`);
    }
    return IO.pure(value);
  });
}

/**
 * Get current working directory
 */
export function getCwd(): IO<string> {
  return IO.delay(() => (typeof process !== "undefined" ? process.cwd() : "/"));
}

/**
 * Get command line arguments
 */
export function getArgs(): IO<string[]> {
  return IO.delay(() =>
    typeof process !== "undefined" ? process.argv.slice(2) : [],
  );
}
