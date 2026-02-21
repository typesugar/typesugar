/**
 * Data Types Index
 *
 * Re-exports all data types for the @typesugar/fp system.
 * Uses namespace imports to avoid naming conflicts between data types.
 */

// Import as namespaces to avoid conflicts (each data type has map, flatMap, etc.)
import * as OptionModule from "./option.js";
import * as EitherModule from "./either.js";
import * as ListModule from "./list.js";
import * as NonEmptyListModule from "./nonempty-list.js";
import * as ValidatedModule from "./validated.js";
import * as StateModule from "./state.js";
import * as ReaderModule from "./reader.js";
import * as WriterModule from "./writer.js";
import * as IdModule from "./id.js";

// Re-export namespaces
export { OptionModule as Option };
export { EitherModule as Either };
export { ListModule as List };
export { NonEmptyListModule as NonEmptyList };
export { ValidatedModule as Validated };
export { StateModule as State };
export { ReaderModule as Reader };
export { WriterModule as Writer };
export { IdModule as Id };

// Export specific constructors and types that are commonly used directly
export { type Option as OptionType, Some, None, isSome, isNone } from "./option.js";

export { type Either as EitherType, Left, Right, isLeft, isRight } from "./either.js";

export { type List as ListType, Cons, Nil } from "./list.js";

export { type NonEmptyList as NonEmptyListType } from "./nonempty-list.js";

export {
  type Validated as ValidatedType,
  type ValidatedNel,
  Valid,
  Invalid,
  valid,
  invalid,
  validNel,
  invalidNel,
  isValid,
  isInvalid,
} from "./validated.js";

export { type State as StateType, IndexedState } from "./state.js";

export { type Reader as ReaderType, Kleisli } from "./reader.js";

export {
  type Writer as WriterType,
  LogWriter,
  LogWriterMonoid,
  SumWriter,
  SumWriterMonoid,
} from "./writer.js";

export { type Id as IdType } from "./id.js";
