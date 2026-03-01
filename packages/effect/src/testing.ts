/**
 * Effect Testing Utilities
 *
 * Thin wrappers around @typesugar/testing's generic mock system,
 * specialized for Effect services and layers.
 *
 * @example
 * ```typescript
 * import { mockService, testLayer } from "@typesugar/effect/testing";
 *
 * // Create a mock service
 * const mockUserRepo = mockService<UserRepo>({
 *   getUser: (id) => Effect.succeed({ id, name: "Test User" }),
 * });
 *
 * // Use in tests
 * const TestUserRepo = testLayer(UserRepo, mockUserRepo);
 * const program = pipe(
 *   getUser("123"),
 *   Effect.provide(TestUserRepo)
 * );
 * ```
 *
 * @packageDocumentation
 */

import { createMockFn, type MockFn, type MockOf } from "@typesugar/testing";

// ============================================================================
// Effect Mock Service
// ============================================================================

/**
 * Configuration for a mock service method.
 */
export interface MockMethodConfig<A extends any[], R> {
  /** The mock implementation to use */
  impl?: (...args: A) => R;
  /** A fixed return value (wrapped in Effect.succeed) */
  value?: R extends { _tag: "Effect" } ? never : R;
  /** Whether the method should fail with an error */
  error?: unknown;
}

/**
 * Type for a mock service that wraps all methods in MockFn.
 */
export type MockService<T> = MockOf<T> & {
  /** Reset all mocks to their initial state */
  _resetAll: () => void;
  /** Get the mock Layer for this service */
  _layer: unknown;
};

/**
 * Creates a mock Effect service with all methods stubbed.
 *
 * Each method is wrapped in a MockFn from @typesugar/testing, providing
 * call tracking and stubbing capabilities.
 *
 * @param defaults - Optional default implementations for methods
 * @returns A mock service object
 *
 * @example
 * ```typescript
 * interface UserRepo {
 *   readonly _tag: "UserRepo";
 *   getUser(id: string): Effect.Effect<User, NotFound>;
 *   saveUser(user: User): Effect.Effect<void, DbError>;
 * }
 *
 * const mockUserRepo = mockService<UserRepo>({
 *   getUser: (id) => Effect.succeed({ id, name: "Mock User" }),
 *   saveUser: () => Effect.void,
 * });
 *
 * // Override in specific test
 * mockUserRepo.getUser.mockImplementation(() =>
 *   Effect.fail(new NotFound())
 * );
 *
 * // Access call history
 * expect(mockUserRepo._calls.getUser).toHaveLength(1);
 * ```
 */
export function mockService<T extends object>(
  defaults?: Partial<{ [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R : T[K] }>
): MockService<T> {
  const methods: Record<string, MockFn> = {};
  const calls: Record<string, any[][]> = {};

  // Create proxy to intercept property access and create mock functions lazily
  const handler: ProxyHandler<MockService<T>> = {
    get(target, prop, receiver) {
      if (prop === "_calls") {
        return calls;
      }
      if (prop === "_reset" || prop === "_resetAll") {
        return () => {
          for (const key of Object.keys(methods)) {
            methods[key].mockReset();
            calls[key] = [];
          }
        };
      }
      if (prop === "_layer") {
        return target._layer;
      }

      const key = String(prop);

      // Return existing mock function
      if (methods[key]) {
        return methods[key];
      }

      // Create new mock function for this method
      const mockFn = createMockFn();
      methods[key] = mockFn;
      calls[key] = [];

      // Wire up call tracking
      const originalFn = mockFn as any;
      const trackedFn = ((...args: any[]) => {
        calls[key].push(args);
        return originalFn(...args);
      }) as MockFn;

      Object.assign(trackedFn, originalFn);
      methods[key] = trackedFn;

      // Apply default implementation if provided
      if (defaults && key in defaults) {
        const defaultImpl = (defaults as any)[key];
        if (typeof defaultImpl === "function") {
          trackedFn.mockImplementation(defaultImpl);
        }
      }

      return trackedFn;
    },

    has(_target, prop) {
      return prop === "_calls" || prop === "_reset" || prop === "_resetAll" || prop === "_layer";
    },
  };

  const mock = new Proxy({} as MockService<T>, handler);

  // Pre-populate defaults
  if (defaults) {
    for (const key of Object.keys(defaults)) {
      (mock as any)[key]; // Access to trigger lazy initialization
    }
  }

  return mock;
}

// ============================================================================
// Test Layer Helpers
// ============================================================================

/**
 * Options for creating a test layer.
 */
export interface TestLayerOptions {
  /** Whether to enable call tracking (default: true) */
  trackCalls?: boolean;
  /** Custom layer name for debugging */
  name?: string;
}

/**
 * Creates a test Layer from a mock service.
 *
 * This is the primary way to inject mock services into Effect programs
 * for testing.
 *
 * @param _ServiceTag - The service tag (Context.Tag)
 * @param mockImpl - The mock service implementation
 * @param options - Optional configuration
 * @returns A Layer providing the mock service
 *
 * @example
 * ```typescript
 * // Create mock
 * const mockUserRepo = mockService<UserRepo>({
 *   getUser: () => Effect.succeed(testUser),
 * });
 *
 * // Create test layer
 * const TestUserRepo = testLayer(UserRepo, mockUserRepo);
 *
 * // Use in test
 * const result = await Effect.runPromise(
 *   pipe(
 *     program,
 *     Effect.provide(TestUserRepo)
 *   )
 * );
 * ```
 */
export function testLayer<T extends object>(
  _ServiceTag: { readonly _tag: string } | string,
  mockImpl: MockService<T> | T,
  _options?: TestLayerOptions
): unknown {
  // Runtime placeholder - the actual Layer.succeed call requires Effect runtime
  // This will be transformed by the @typesugar/effect transformer
  return {
    _tag: "TestLayer",
    service: mockImpl,
    tag: typeof _ServiceTag === "string" ? _ServiceTag : _ServiceTag._tag,
  };
}

/**
 * Combines multiple test layers into a single layer.
 *
 * @param layers - Array of test layers to combine
 * @returns A combined Layer
 *
 * @example
 * ```typescript
 * const TestEnv = combineLayers(
 *   testLayer(UserRepo, mockUserRepo),
 *   testLayer(Logger, mockLogger),
 *   testLayer(Config, mockConfig)
 * );
 *
 * await Effect.runPromise(
 *   pipe(program, Effect.provide(TestEnv))
 * );
 * ```
 */
export function combineLayers(...layers: unknown[]): unknown {
  // Runtime placeholder
  return {
    _tag: "CombinedTestLayers",
    layers,
  };
}

// ============================================================================
// Effect-Specific Mock Utilities
// ============================================================================

/**
 * Creates a mock that returns Effect.succeed by default.
 *
 * @param value - The value to succeed with
 * @returns A mock function that returns Effect.succeed(value)
 *
 * @example
 * ```typescript
 * const getUser = succeedMock({ id: "1", name: "Alice" });
 * // getUser() returns Effect.succeed({ id: "1", name: "Alice" })
 * ```
 */
export function succeedMock<T>(value: T): MockFn<any[], unknown> {
  const mock = createMockFn<(...args: any[]) => unknown>();
  // Note: Actual Effect.succeed wrapping happens at compile time or requires Effect import
  mock.mockReturnValue({ _tag: "Success", value } as unknown);
  return mock;
}

/**
 * Creates a mock that returns Effect.fail by default.
 *
 * @param error - The error to fail with
 * @returns A mock function that returns Effect.fail(error)
 *
 * @example
 * ```typescript
 * const getUser = failMock(new NotFound("User not found"));
 * // getUser() returns Effect.fail(new NotFound(...))
 * ```
 */
export function failMock<E>(error: E): MockFn<any[], unknown> {
  const mock = createMockFn<(...args: any[]) => unknown>();
  mock.mockReturnValue({ _tag: "Failure", error } as unknown);
  return mock;
}

/**
 * Creates a mock that returns Effect.die by default.
 *
 * @param defect - The defect to die with
 * @returns A mock function that returns Effect.die(defect)
 *
 * @example
 * ```typescript
 * const process = dieMock(new Error("Unexpected error"));
 * // process() returns Effect.die(Error)
 * ```
 */
export function dieMock(defect: unknown): MockFn<any[], unknown> {
  const mock = createMockFn<(...args: any[]) => unknown>();
  mock.mockReturnValue({ _tag: "Die", defect } as unknown);
  return mock;
}

// ============================================================================
// Test Assertion Helpers
// ============================================================================

/**
 * Asserts that a mock method was called with specific arguments.
 *
 * @param mock - The mock service
 * @param method - The method name
 * @param args - Expected arguments
 *
 * @example
 * ```typescript
 * await Effect.runPromise(pipe(
 *   userRepo.getUser("123"),
 *   Effect.provide(TestUserRepo)
 * ));
 *
 * assertCalled(mockUserRepo, "getUser", ["123"]);
 * ```
 */
export function assertCalled<T extends object>(
  mock: MockService<T>,
  method: keyof T,
  args?: unknown[]
): void {
  const calls = (mock._calls as Record<string, unknown[][]>)[String(method)] ?? [];
  if (calls.length === 0) {
    throw new Error(`Expected ${String(method)} to be called, but it was never called`);
  }
  if (args !== undefined) {
    const lastCall = calls[calls.length - 1];
    if (JSON.stringify(lastCall) !== JSON.stringify(args)) {
      throw new Error(
        `Expected ${String(method)} to be called with ${JSON.stringify(args)}, ` +
          `but it was called with ${JSON.stringify(lastCall)}`
      );
    }
  }
}

/**
 * Asserts that a mock method was never called.
 *
 * @param mock - The mock service
 * @param method - The method name
 *
 * @example
 * ```typescript
 * assertNotCalled(mockUserRepo, "deleteUser");
 * ```
 */
export function assertNotCalled<T extends object>(mock: MockService<T>, method: keyof T): void {
  const calls = (mock._calls as Record<string, unknown[][]>)[String(method)] ?? [];
  if (calls.length > 0) {
    throw new Error(
      `Expected ${String(method)} to not be called, but it was called ${calls.length} time(s)`
    );
  }
}

/**
 * Asserts that a mock method was called a specific number of times.
 *
 * @param mock - The mock service
 * @param method - The method name
 * @param times - Expected call count
 *
 * @example
 * ```typescript
 * assertCalledTimes(mockLogger, "info", 3);
 * ```
 */
export function assertCalledTimes<T extends object>(
  mock: MockService<T>,
  method: keyof T,
  times: number
): void {
  const calls = (mock._calls as Record<string, unknown[][]>)[String(method)] ?? [];
  if (calls.length !== times) {
    throw new Error(
      `Expected ${String(method)} to be called ${times} time(s), but it was called ${calls.length} time(s)`
    );
  }
}
