/**
 * Mock function and mock object types for @typesugar/testing.
 */

/**
 * Type representing a mock implementation of T with call tracking and stubbing.
 */
export type MockOf<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? MockFn<A, R> & T[K] : T[K];
} & {
  _calls: { [K in keyof T]: T[K] extends (...args: any[]) => any ? Parameters<T[K]>[] : never };
  _reset: () => void;
};

/**
 * Type representing a mock function with call tracking and stubbing.
 */
export interface MockFn<Args extends any[] = any[], Return = any> {
  (...args: Args): Return;
  mockReturnValue(value: Return): this;
  mockReturnValueOnce(value: Return): this;
  mockResolvedValue<T>(value: T): this;
  mockResolvedValueOnce<T>(value: T): this;
  mockRejectedValue(error: unknown): this;
  mockRejectedValueOnce(error: unknown): this;
  mockImplementation(fn: (...args: Args) => Return): this;
  mockImplementationOnce(fn: (...args: Args) => Return): this;
  mockReset(): this;
  mockClear(): this;
  calls: Args[];
}

/**
 * Creates a mock function with vitest/jest-compatible API.
 * This is a runtime helper that works without the transformer.
 *
 * Precedence matches Vitest/Jest: every `*Once` call (`mockReturnValueOnce`,
 * `mockResolvedValueOnce`, `mockRejectedValueOnce`, `mockImplementationOnce`)
 * goes into ONE queue consumed in call order; otherwise the most recent
 * persistent stub (`mockReturnValue`, `mockResolvedValue`,
 * `mockRejectedValue`, `mockImplementation`) wins — each replaces the last.
 *
 * @example
 * ```typescript
 * const mockGetUser = createMockFn<(id: string) => Promise<User>>();
 * mockGetUser.mockResolvedValue({ id: "1", name: "Alice" });
 *
 * await mockGetUser("123");
 * expect(mockGetUser.calls).toEqual([["123"]]);
 * ```
 */
export function createMockFn<T extends (...args: any[]) => any>(): MockFn<
  Parameters<T>,
  ReturnType<T>
> {
  type Args = Parameters<T>;
  type Return = ReturnType<T>;
  type Impl = (...args: Args) => Return;

  let impl: Impl | undefined;
  let onceImpls: Impl[] = [];
  const calls: Args[] = [];

  const mockFn = ((...args: Args): Return => {
    calls.push(args);
    const once = onceImpls.shift();
    if (once) return once(...args);
    if (impl) return impl(...args);
    return undefined as Return;
  }) as MockFn<Args, Return>;

  mockFn.calls = calls;

  const always = (fn: Impl) => {
    impl = fn;
    return mockFn;
  };
  const once = (fn: Impl) => {
    onceImpls.push(fn);
    return mockFn;
  };

  mockFn.mockReturnValue = (value: Return) => always(() => value);
  mockFn.mockReturnValueOnce = (value: Return) => once(() => value);
  mockFn.mockResolvedValue = <V>(value: V) =>
    always((() => Promise.resolve(value)) as unknown as Impl);
  mockFn.mockResolvedValueOnce = <V>(value: V) =>
    once((() => Promise.resolve(value)) as unknown as Impl);
  mockFn.mockRejectedValue = (error: unknown) =>
    always((() => Promise.reject(error)) as unknown as Impl);
  mockFn.mockRejectedValueOnce = (error: unknown) =>
    once((() => Promise.reject(error)) as unknown as Impl);
  mockFn.mockImplementation = (fn: Impl) => always(fn);
  mockFn.mockImplementationOnce = (fn: Impl) => once(fn);

  mockFn.mockReset = () => {
    impl = undefined;
    onceImpls = [];
    calls.length = 0;
    return mockFn;
  };

  mockFn.mockClear = () => {
    calls.length = 0;
    return mockFn;
  };

  return mockFn;
}
