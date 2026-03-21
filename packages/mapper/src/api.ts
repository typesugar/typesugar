import type { PathOf } from "./path-types.js";

export type { PathOf } from "./path-types.js";

/**
 * Config for array-valued fields. Maps each array field name to the
 * TransformConfig for its element type.
 *
 * @example
 * ```ts
 * interface Source { items: { id: number }[] }
 * interface Target { items: { itemId: number }[] }
 * const config: TransformConfig<Source, Target> = {
 *   collections: { items: { rename: { itemId: "id" } } }
 * };
 * ```
 */
export type CollectionConfig<From, To> = {
  [K in keyof To]?: K extends keyof From
    ? To[K] extends (infer E)[]
      ? From[K] extends (infer S)[]
        ? TransformConfig<S, E>
        : never
      : never
    : never;
};

/**
 * Recursive transform config for nested objects.
 * Used when a target field is an object that needs its own mapping rules.
 */
export type NestedTransformConfig<From, To> = {
  [K in keyof To]?: To[K] extends object
    ? To[K] extends unknown[]
      ? never // Use collections for arrays
      : TransformConfig<unknown, To[K]>
    : never;
};

export interface TransformConfig<From, To> {
  /**
   * Rename fields from the source to the target.
   * Key: the target field name.
   * Value: the source field name.
   */
  rename?: { [K in keyof To]?: keyof From };

  /**
   * Compute target fields dynamically using a function.
   * Key: the target field name.
   * Value: a function that takes the source object and returns the target field value.
   */
  compute?: { [K in keyof To]?: (src: From) => To[K] };

  /**
   * Provide constant values for target fields.
   * Key: the target field name.
   * Value: the constant value.
   */
  const?: { [K in keyof To]?: To[K] };

  /**
   * Ignore unmapped target fields or unused source fields.
   */
  ignore?: {
    source?: (keyof From)[];
    target?: (keyof To)[];
  };

  /**
   * Nested transformation configs for object-valued target fields.
   * Key: target field name (must be an object type in To, not an array).
   * Value: config for transforming the source's corresponding nested value.
   *
   * @experimental Planned for Phase 2 — currently ignored by the macro.
   *
   * @example
   * ```ts
   * interface Source { address: { city: string; zip: string } }
   * interface Target { address: { location: string } }
   * const config: TransformConfig<Source, Target> = {
   *   nested: {
   *     address: { rename: { location: "city" } }
   *   }
   * };
   * ```
   */
  nested?: NestedTransformConfig<From, To>;

  /**
   * Dot-notation renames for nested fields.
   * Key: target path (e.g. "address.location").
   * Value: source path (e.g. "address.city").
   * Accepts PathOf keys for type safety; string for deeper paths (macro validates).
   *
   * @experimental Planned for Phase 2 — currently ignored by the macro.
   *
   * @example
   * ```ts
   * interface Source { address: { city: string; zip: string } }
   * interface Target { address: { location: string } }
   * const config: TransformConfig<Source, Target> = {
   *   renamePaths: { "address.location": "address.city" }
   * };
   * ```
   */
  renamePaths?: Partial<Record<PathOf<To> | string, PathOf<From> | string>>;

  /**
   * Config for array-valued fields. Maps each array field name to the
   * TransformConfig for transforming its elements.
   *
   * @experimental Planned for Phase 2 — currently ignored by the macro.
   *
   * @example
   * ```ts
   * interface Source { items: { id: number; name: string }[] }
   * interface Target { items: { itemId: number; name: string }[] }
   * const config: TransformConfig<Source, Target> = {
   *   collections: { items: { rename: { itemId: "id" } } }
   * };
   * ```
   */
  collections?: CollectionConfig<From, To>;
}

/**
 * Transforms an object of type `From` into an object of type `To` at compile time.
 *
 * This function is evaluated by the typesugar transformer and replaced with a direct
 * object literal, resulting in zero runtime overhead.
 *
 * @param source The source object to transform.
 * @param config Optional configuration for renaming, computing, and providing constants.
 * @returns The transformed object.
 */
export function transformInto<From, To>(source: From, config?: TransformConfig<From, To>): To {
  throw new Error(
    "transformInto() was called at runtime. " +
      "This indicates the typesugar transformer is not configured correctly. " +
      "Please ensure your build tool is configured to use the typesugar transformer."
  );
}

/**
 * Transforms an array of type `From` into an array of type `To` at compile time.
 *
 * Maps each element using the same rules as transformInto. This function is evaluated
 * by the typesugar transformer and replaced with a map expression.
 *
 * @param items The source array to transform.
 * @param config Optional configuration for renaming, computing, and providing constants.
 * @returns The transformed array.
 */
export function transformArrayInto<From, To>(
  items: From[],
  config?: TransformConfig<From, To>
): To[] {
  throw new Error(
    "transformArrayInto() was called at runtime. " +
      "This indicates the typesugar transformer is not configured correctly. " +
      "Please ensure your build tool is configured to use the typesugar transformer."
  );
}
