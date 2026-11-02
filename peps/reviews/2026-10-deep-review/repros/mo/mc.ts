declare function match<T>(x: T): { with(p: unknown, f: (v: T) => unknown): { otherwise(f: () => unknown): unknown } };
declare const user: { name: string };
export const r = match(user)
  .with({}, (u) => u.nmae.toUpperCase() + undefinedVariable)
  .otherwise(() => 0);
