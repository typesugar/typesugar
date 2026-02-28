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
