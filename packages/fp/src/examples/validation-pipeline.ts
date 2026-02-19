/**
 * Validation Pipeline Example
 *
 * Demonstrates form validation using Validated and ValidatedNel
 * to accumulate multiple validation errors.
 *
 * This is a classic use case for Applicative rather than Monad,
 * because we want to collect ALL errors, not stop at the first one.
 */

import {
  Validated,
  ValidatedNel,
  valid,
  invalid,
  validNel,
  invalidNel,
} from "../data/validated";
import { NonEmptyList } from "../data/nonempty-list";
import { Either, Left, Right } from "../data/either";
import { Option, Some, None } from "../data/option";
import { pipe } from "../syntax/pipe";

// ============================================================================
// Domain Types
// ============================================================================

/**
 * Validation error type
 */
export interface ValidationError {
  readonly field: string;
  readonly message: string;
}

/**
 * Create a validation error
 */
const validationError = (field: string, message: string): ValidationError => ({
  field,
  message,
});

/**
 * Type alias for our validation result
 */
type ValidationResult<A> = ValidatedNel<ValidationError, A>;

/**
 * User registration form input
 */
interface UserFormInput {
  readonly username: string;
  readonly email: string;
  readonly password: string;
  readonly confirmPassword: string;
  readonly age: string;
  readonly termsAccepted: boolean;
}

/**
 * Validated user data
 */
interface ValidatedUser {
  readonly username: string;
  readonly email: string;
  readonly password: string;
  readonly age: number;
}

// ============================================================================
// Individual Field Validators
// ============================================================================

/**
 * Validate username
 * - Must be 3-20 characters
 * - Must be alphanumeric with underscores
 */
function validateUsername(input: string): ValidationResult<string> {
  const errors: ValidationError[] = [];

  if (input.length < 3) {
    errors.push(
      validationError("username", "Username must be at least 3 characters"),
    );
  }

  if (input.length > 20) {
    errors.push(
      validationError("username", "Username must be at most 20 characters"),
    );
  }

  if (!/^[a-zA-Z0-9_]+$/.test(input)) {
    errors.push(
      validationError(
        "username",
        "Username must contain only letters, numbers, and underscores",
      ),
    );
  }

  return errors.length === 0
    ? validNel(input)
    : Validated.invalidNel(NonEmptyList.of(...errors));
}

/**
 * Validate email
 * - Must be a valid email format
 */
function validateEmail(input: string): ValidationResult<string> {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(input)) {
    return invalidNel(validationError("email", "Invalid email format"));
  }

  return validNel(input);
}

/**
 * Validate password
 * - Must be at least 8 characters
 * - Must contain uppercase, lowercase, and number
 */
function validatePassword(password: string): ValidationResult<string> {
  const errors: ValidationError[] = [];

  if (password.length < 8) {
    errors.push(
      validationError("password", "Password must be at least 8 characters"),
    );
  }

  if (!/[A-Z]/.test(password)) {
    errors.push(
      validationError("password", "Password must contain an uppercase letter"),
    );
  }

  if (!/[a-z]/.test(password)) {
    errors.push(
      validationError("password", "Password must contain a lowercase letter"),
    );
  }

  if (!/[0-9]/.test(password)) {
    errors.push(validationError("password", "Password must contain a number"));
  }

  return errors.length === 0
    ? validNel(password)
    : Validated.invalidNel(NonEmptyList.of(...errors));
}

/**
 * Validate password confirmation
 */
function validatePasswordMatch(
  password: string,
  confirmPassword: string,
): ValidationResult<string> {
  if (password !== confirmPassword) {
    return invalidNel(
      validationError("confirmPassword", "Passwords do not match"),
    );
  }
  return validNel(password);
}

/**
 * Validate age
 * - Must be a valid number
 * - Must be 18 or older
 */
function validateAge(input: string): ValidationResult<number> {
  const age = parseInt(input, 10);

  if (isNaN(age)) {
    return invalidNel(validationError("age", "Age must be a valid number"));
  }

  if (age < 18) {
    return invalidNel(
      validationError("age", "You must be at least 18 years old"),
    );
  }

  if (age > 150) {
    return invalidNel(validationError("age", "Please enter a valid age"));
  }

  return validNel(age);
}

/**
 * Validate terms acceptance
 */
function validateTermsAccepted(accepted: boolean): ValidationResult<true> {
  if (!accepted) {
    return invalidNel(
      validationError("termsAccepted", "You must accept the terms of service"),
    );
  }
  return validNel(true);
}

// ============================================================================
// Combined Validation
// ============================================================================

/**
 * Validate the entire user form
 *
 * This uses Validated's Applicative nature to collect ALL errors
 */
export function validateUserForm(
  input: UserFormInput,
): ValidationResult<ValidatedUser> {
  const usernameV = validateUsername(input.username);
  const emailV = validateEmail(input.email);
  const passwordV = validatePassword(input.password);
  const passwordMatchV = validatePasswordMatch(
    input.password,
    input.confirmPassword,
  );
  const ageV = validateAge(input.age);
  const termsV = validateTermsAccepted(input.termsAccepted);

  // First validate password independently, then check match
  const validatedPassword = Validated.map2(
    passwordV,
    passwordMatchV,
    (p, _) => p,
  );

  // Combine all validations using mapN
  return Validated.map5(
    usernameV,
    emailV,
    validatedPassword,
    ageV,
    termsV,
    (username, email, password, age, _terms): ValidatedUser => ({
      username,
      email,
      password,
      age,
    }),
  );
}

// ============================================================================
// Alternative: Using pipe syntax
// ============================================================================

/**
 * A more composable approach using pipe
 */
export function validateUserFormPipe(
  input: UserFormInput,
): ValidationResult<ValidatedUser> {
  // Define all validations
  const validations = {
    username: validateUsername(input.username),
    email: validateEmail(input.email),
    password: pipe(validatePassword(input.password), (passwordV) =>
      Validated.map2(
        passwordV,
        validatePasswordMatch(input.password, input.confirmPassword),
        (p) => p,
      ),
    ),
    age: validateAge(input.age),
    terms: validateTermsAccepted(input.termsAccepted),
  };

  return Validated.map5(
    validations.username,
    validations.email,
    validations.password,
    validations.age,
    validations.terms,
    (username, email, password, age): ValidatedUser => ({
      username,
      email,
      password,
      age,
    }),
  );
}

// ============================================================================
// Error Formatting
// ============================================================================

/**
 * Format validation errors for display
 */
export function formatErrors(
  result: ValidationResult<unknown>,
): string[] | null {
  if (result._tag === "Valid") {
    return null;
  }

  return NonEmptyList.toArray(result.error).map(
    (e) => `${e.field}: ${e.message}`,
  );
}

/**
 * Format errors grouped by field
 */
export function formatErrorsByField(
  result: ValidationResult<unknown>,
): Record<string, string[]> | null {
  if (result._tag === "Valid") {
    return null;
  }

  const errors = NonEmptyList.toArray(result.error);
  const grouped: Record<string, string[]> = {};

  for (const error of errors) {
    if (!grouped[error.field]) {
      grouped[error.field] = [];
    }
    grouped[error.field].push(error.message);
  }

  return grouped;
}

// ============================================================================
// Example Usage
// ============================================================================

export function runValidationExample(): void {
  console.log("=== Validation Pipeline Example ===\n");

  // Valid input
  const validInput: UserFormInput = {
    username: "john_doe",
    email: "john@example.com",
    password: "SecurePass123",
    confirmPassword: "SecurePass123",
    age: "25",
    termsAccepted: true,
  };

  // Invalid input with multiple errors
  const invalidInput: UserFormInput = {
    username: "jo", // Too short
    email: "not-an-email", // Invalid format
    password: "weak", // Too weak
    confirmPassword: "different", // Doesn't match
    age: "sixteen", // Not a number
    termsAccepted: false, // Not accepted
  };

  // Validate and display results
  console.log("Valid input result:");
  const validResult = validateUserForm(validInput);
  if (validResult._tag === "Valid") {
    console.log("  Success:", validResult.value);
  } else {
    console.log("  Errors:", formatErrors(validResult));
  }

  console.log("\nInvalid input result:");
  const invalidResult = validateUserForm(invalidInput);
  if (invalidResult._tag === "Valid") {
    console.log("  Success:", invalidResult.value);
  } else {
    console.log("  All errors:");
    const errors = formatErrors(invalidResult);
    errors?.forEach((e) => console.log(`    - ${e}`));

    console.log("\n  Grouped by field:");
    const grouped = formatErrorsByField(invalidResult);
    if (grouped) {
      for (const [field, messages] of Object.entries(grouped)) {
        console.log(`    ${field}:`);
        messages.forEach((m) => console.log(`      - ${m}`));
      }
    }
  }
}

// ============================================================================
// Chained Validation (using Either for short-circuit)
// ============================================================================

/**
 * Sometimes you want short-circuit validation (stop at first error)
 * For this, use Either instead of Validated
 */
export function validateUserFormShortCircuit(
  input: UserFormInput,
): Either<ValidationError, ValidatedUser> {
  const validateField = <A>(
    result: ValidationResult<A>,
  ): Either<ValidationError, A> => {
    if (result._tag === "Valid") {
      return Right(result.value);
    }
    // Just return the first error
    return Left(result.error.head);
  };

  // Short-circuit at first error
  const usernameE = validateField(validateUsername(input.username));
  if (usernameE._tag === "Left")
    return usernameE as Either<ValidationError, ValidatedUser>;

  const emailE = validateField(validateEmail(input.email));
  if (emailE._tag === "Left")
    return emailE as Either<ValidationError, ValidatedUser>;

  const passwordE = validateField(validatePassword(input.password));
  if (passwordE._tag === "Left")
    return passwordE as Either<ValidationError, ValidatedUser>;

  const passwordMatchE = validateField(
    validatePasswordMatch(input.password, input.confirmPassword),
  );
  if (passwordMatchE._tag === "Left")
    return passwordMatchE as Either<ValidationError, ValidatedUser>;

  const ageE = validateField(validateAge(input.age));
  if (ageE._tag === "Left")
    return ageE as Either<ValidationError, ValidatedUser>;

  const termsE = validateField(validateTermsAccepted(input.termsAccepted));
  if (termsE._tag === "Left")
    return termsE as Either<ValidationError, ValidatedUser>;

  return Right({
    username: usernameE.right,
    email: emailE.right,
    password: passwordE.right,
    age: ageE.right,
  });
}
