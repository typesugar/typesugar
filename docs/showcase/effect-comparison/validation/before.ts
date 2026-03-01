/**
 * Schema Validation Example — Plain Effect Schema
 *
 * This example shows standard Effect Schema usage for validating API
 * request/response payloads.
 *
 * Notice the runtime overhead:
 * - Schema combinators build a tree structure
 * - Each decode() call walks this tree at runtime
 * - Nested schemas create nested walks
 * - For high-throughput APIs, this overhead adds up
 */

import { Schema } from "effect";
import { pipe } from "effect";

// ============================================================================
// Domain Schemas
// ============================================================================

// User schema with nested address
const AddressSchema = Schema.Struct({
  street: Schema.String,
  city: Schema.String,
  state: Schema.String,
  zipCode: Schema.String.pipe(
    Schema.pattern(/^\d{5}(-\d{4})?$/, {
      message: () => "Invalid ZIP code format",
    })
  ),
  country: Schema.optional(Schema.String),
});

const UserSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.brand("UserId")),
  email: Schema.String.pipe(
    Schema.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
      message: () => "Invalid email format",
    })
  ),
  name: Schema.String.pipe(Schema.minLength(1)),
  age: Schema.Number.pipe(Schema.int(), Schema.between(0, 150)),
  role: Schema.Union(
    Schema.Literal("admin"),
    Schema.Literal("user"),
    Schema.Literal("guest")
  ),
  address: AddressSchema,
  tags: Schema.Array(Schema.String),
  createdAt: Schema.Date,
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

// API request schema
const CreateUserRequestSchema = Schema.Struct({
  email: Schema.String.pipe(
    Schema.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
      message: () => "Invalid email format",
    })
  ),
  name: Schema.String.pipe(Schema.minLength(1)),
  age: Schema.Number.pipe(Schema.int(), Schema.between(0, 150)),
  role: Schema.Union(
    Schema.Literal("admin"),
    Schema.Literal("user"),
    Schema.Literal("guest")
  ),
  address: AddressSchema,
  tags: Schema.optional(Schema.Array(Schema.String)),
});

// API response schema
const ApiResponseSchema = <A, I, R>(dataSchema: Schema.Schema<A, I, R>) =>
  Schema.Struct({
    success: Schema.Boolean,
    data: Schema.optional(dataSchema),
    error: Schema.optional(
      Schema.Struct({
        code: Schema.String,
        message: Schema.String,
        details: Schema.optional(Schema.Array(Schema.String)),
      })
    ),
    meta: Schema.optional(
      Schema.Struct({
        requestId: Schema.String,
        timestamp: Schema.Date,
        version: Schema.String,
      })
    ),
  });

// Paginated response
const PaginatedSchema = <A, I, R>(itemSchema: Schema.Schema<A, I, R>) =>
  Schema.Struct({
    items: Schema.Array(itemSchema),
    pagination: Schema.Struct({
      page: Schema.Number.pipe(Schema.int(), Schema.positive()),
      pageSize: Schema.Number.pipe(Schema.int(), Schema.between(1, 100)),
      totalItems: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      totalPages: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      hasMore: Schema.Boolean,
    }),
  });

// ============================================================================
// Decoders — Runtime Combinator Walk
// ============================================================================

// Each decode call walks the combinator tree at runtime
// For a struct with 10 fields, that's 10+ function calls per decode

const decodeUser = Schema.decodeSync(UserSchema);
const decodeCreateUserRequest = Schema.decodeSync(CreateUserRequestSchema);
const decodeUserResponse = Schema.decodeSync(ApiResponseSchema(UserSchema));
const decodePaginatedUsers = Schema.decodeSync(PaginatedSchema(UserSchema));

// ============================================================================
// Usage in API Handler
// ============================================================================

interface RawRequest {
  body: unknown;
  params: Record<string, string>;
  query: Record<string, string>;
}

interface Response<T> {
  status: number;
  body: T;
}

// Simulated API handler
function createUserHandler(req: RawRequest): Response<unknown> {
  try {
    // This decode walks the entire schema tree at runtime:
    // 1. Check if body is object
    // 2. Check email field → string check → regex match
    // 3. Check name field → string check → minLength check
    // 4. Check age field → number check → int check → range check
    // 5. Check role field → try literal "admin" → try "user" → try "guest"
    // 6. Check address field → recurse into AddressSchema
    //    6a. Check street → string
    //    6b. Check city → string
    //    6c. Check state → string
    //    6d. Check zipCode → string → regex
    //    6e. Check country → optional → string
    // 7. Check tags field → optional → array → each element string
    //
    // That's 15+ function calls for a single validation!

    const userData = decodeCreateUserRequest(req.body);

    // Process the validated data...
    const user = {
      id: `user_${Date.now()}`,
      ...userData,
      tags: userData.tags ?? [],
      createdAt: new Date(),
    };

    return {
      status: 201,
      body: {
        success: true,
        data: user,
        meta: {
          requestId: `req_${Date.now()}`,
          timestamp: new Date(),
          version: "1.0.0",
        },
      },
    };
  } catch (error) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: String(error),
        },
      },
    };
  }
}

// List users handler with pagination validation
function listUsersHandler(req: RawRequest): Response<unknown> {
  try {
    // Validate query params
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);

    if (!Number.isInteger(page) || page < 1) {
      throw new Error("Invalid page parameter");
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new Error("Invalid pageSize parameter");
    }

    // Simulated database fetch
    const users: unknown[] = []; // Would fetch from DB

    // For each user in the response, the paginated decoder walks:
    // - items array (N iterations)
    // - For each item: full UserSchema walk (15+ calls)
    // - pagination struct (5 fields, each with validation)
    //
    // For 20 users: ~300+ function calls just for validation!

    const response = {
      items: users,
      pagination: {
        page,
        pageSize,
        totalItems: 100,
        totalPages: 5,
        hasMore: page < 5,
      },
    };

    // Validate the response (in production you'd decode the DB results)
    // const validatedResponse = decodePaginatedUsers(response);

    return {
      status: 200,
      body: {
        success: true,
        data: response,
      },
    };
  } catch (error) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: String(error),
        },
      },
    };
  }
}

// ============================================================================
// Performance Characteristics
// ============================================================================

// Runtime overhead per validation:
//
// UserSchema decode:
// - Object type check: 1 call
// - 8 required fields: 8 property accesses
// - String validations (email, name): 4 calls (type + pattern/length)
// - Number validation (age): 3 calls (type + int + range)
// - Union validation (role): up to 3 calls (try each variant)
// - Nested AddressSchema: 5+ calls
// - Array validation (tags): 2 + N calls (type + each element)
// - Optional handling: 2 calls per optional field
//
// Total: ~25-30 function calls per UserSchema decode
//
// At 10,000 requests/second:
// - 250,000-300,000 validation function calls per second
// - Significant CPU overhead
// - Potential GC pressure from intermediate objects

// ============================================================================
// Benchmark Helper
// ============================================================================

function benchmarkValidation(iterations: number): void {
  const testData = {
    email: "test@example.com",
    name: "Test User",
    age: 25,
    role: "user" as const,
    address: {
      street: "123 Main St",
      city: "Anytown",
      state: "CA",
      zipCode: "12345",
    },
    tags: ["tag1", "tag2"],
  };

  console.time("Schema.decodeSync");
  for (let i = 0; i < iterations; i++) {
    decodeCreateUserRequest(testData);
  }
  console.timeEnd("Schema.decodeSync");
}

// Run: benchmarkValidation(100000);
// Typical result: ~150-200ms for 100k iterations

export {
  UserSchema,
  AddressSchema,
  CreateUserRequestSchema,
  ApiResponseSchema,
  PaginatedSchema,
  decodeUser,
  decodeCreateUserRequest,
  decodeUserResponse,
  decodePaginatedUsers,
  createUserHandler,
  listUsersHandler,
  benchmarkValidation,
};
