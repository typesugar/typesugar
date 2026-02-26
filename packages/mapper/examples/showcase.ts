/**
 * @typesugar/mapper Showcase
 *
 * Self-documenting examples of zero-cost compile-time object mapping.
 * transformInto<From, To>() is replaced by the typesugar transformer with
 * a direct object literal — no runtime overhead.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()        - A and B are the same type
 *   typeAssert<Extends<A, B>>()      - A is assignable to B
 *   typeAssert<Not<Equal<A, B>>>()   - A and B are DIFFERENT
 *   typeAssert<Not<Extends<A, B>>>() - A is NOT assignable to B
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal } from "@typesugar/testing";
// Note: Extends and Not are available from @typesugar/testing for negative assertions
// but this showcase only demonstrates positive type equality checks
import { transformInto, type TransformConfig } from "../src/index.js";

// ============================================================================
// 1. BASIC MAPPING - Same-shaped types with matching field names
// ============================================================================

interface UserEntity {
  name: string;
  email: string;
  age: number;
}

interface UserDTO {
  name: string;
  email: string;
  age: number;
}

const entity: UserEntity = { name: "Alice", email: "alice@example.com", age: 30 };

// When From and To have identical fields, no config needed
const dto = transformInto<UserEntity, UserDTO>(entity);
typeAssert<Equal<typeof dto, UserDTO>>();
assert(dto.name === "Alice");
assert(dto.email === "alice@example.com");
assert(dto.age === 30);

// ============================================================================
// 2. FIELD RENAMING - Map differently-named fields between types
// ============================================================================

interface DbRecord {
  user_name: string;
  user_email: string;
  user_age: number;
}

interface ApiResponse {
  name: string;
  email: string;
  age: number;
}

const dbRow: DbRecord = { user_name: "Bob", user_email: "bob@x.co", user_age: 25 };

const response = transformInto<DbRecord, ApiResponse>(dbRow, {
  rename: {
    name: "user_name",
    email: "user_email",
    age: "user_age",
  },
});

typeAssert<Equal<typeof response, ApiResponse>>();
assert(response.name === "Bob");
assert(response.email === "bob@x.co");
assert(response.age === 25);

// ============================================================================
// 3. COMPUTED FIELDS - Derive target fields from source data
// ============================================================================

interface FullName {
  firstName: string;
  lastName: string;
}

interface DisplayInfo {
  fullName: string;
  initials: string;
}

const name: FullName = { firstName: "Jane", lastName: "Doe" };

const display = transformInto<FullName, DisplayInfo>(name, {
  compute: {
    fullName: (src) => `${src.firstName} ${src.lastName}`,
    initials: (src) => `${src.firstName[0]}${src.lastName[0]}`,
  },
});

typeAssert<Equal<typeof display, DisplayInfo>>();
assert(display.fullName === "Jane Doe");
assert(display.initials === "JD");

// ============================================================================
// 4. CONSTANT VALUES - Inject fixed values into target fields
// ============================================================================

interface Input {
  value: number;
}

interface Output {
  value: number;
  source: string;
  version: number;
}

const input: Input = { value: 42 };

const output = transformInto<Input, Output>(input, {
  const: {
    source: "manual",
    version: 1,
  },
});

typeAssert<Equal<typeof output, Output>>();
assert(output.value === 42);
assert(output.source === "manual");
assert(output.version === 1);

// ============================================================================
// 5. COMBINED CONFIG - Rename + compute + const together
// ============================================================================

interface OrderRow {
  order_id: number;
  total_cents: number;
  customer_name: string;
}

interface OrderSummary {
  id: number;
  totalFormatted: string;
  customer: string;
  currency: string;
}

const row: OrderRow = { order_id: 1001, total_cents: 4999, customer_name: "Charlie" };

const summary = transformInto<OrderRow, OrderSummary>(row, {
  rename: {
    id: "order_id",
    customer: "customer_name",
  },
  compute: {
    totalFormatted: (src) => `$${(src.total_cents / 100).toFixed(2)}`,
  },
  const: {
    currency: "USD",
  },
});

typeAssert<Equal<typeof summary, OrderSummary>>();
assert(summary.id === 1001);
assert(summary.totalFormatted === "$49.99");
assert(summary.customer === "Charlie");
assert(summary.currency === "USD");

// ============================================================================
// 6. IGNORING FIELDS - Skip unmapped source or target fields
// ============================================================================

interface Verbose {
  id: number;
  name: string;
  internalCode: string;
  debugInfo: string;
}

interface Brief {
  id: number;
  name: string;
}

const verbose: Verbose = { id: 1, name: "Test", internalCode: "X", debugInfo: "..." };

const brief = transformInto<Verbose, Brief>(verbose, {
  ignore: {
    source: ["internalCode", "debugInfo"],
  },
});

typeAssert<Equal<typeof brief, Brief>>();
assert(brief.id === 1);
assert(brief.name === "Test");

// ============================================================================
// 7. TYPE-SAFE CONFIG - TransformConfig enforces field name correctness
// ============================================================================

// TransformConfig is parameterized on From and To — invalid field names
// would be caught by TypeScript at compile time.

type RenameConfig = TransformConfig<DbRecord, ApiResponse>["rename"];
typeAssert<Equal<RenameConfig, { name?: keyof DbRecord; email?: keyof DbRecord; age?: keyof DbRecord } | undefined>>();

type ComputeConfig = TransformConfig<FullName, DisplayInfo>["compute"];
typeAssert<
  Equal<
    ComputeConfig,
    { fullName?: (src: FullName) => string; initials?: (src: FullName) => string } | undefined
  >
>();

// ============================================================================
// 8. REAL-WORLD EXAMPLE - Domain model to API response mapping
// ============================================================================

interface Product {
  sku: string;
  productName: string;
  priceInCents: number;
  stockCount: number;
  isActive: boolean;
}

interface ProductListItem {
  id: string;
  name: string;
  price: string;
  inStock: boolean;
}

const product: Product = {
  sku: "WIDGET-001",
  productName: "Premium Widget",
  priceInCents: 1299,
  stockCount: 47,
  isActive: true,
};

const listItem = transformInto<Product, ProductListItem>(product, {
  rename: {
    id: "sku",
    name: "productName",
  },
  compute: {
    price: (src) => `$${(src.priceInCents / 100).toFixed(2)}`,
    inStock: (src) => src.stockCount > 0 && src.isActive,
  },
});

typeAssert<Equal<typeof listItem, ProductListItem>>();
assert(listItem.id === "WIDGET-001");
assert(listItem.name === "Premium Widget");
assert(listItem.price === "$12.99");
assert(listItem.inStock === true);

console.log("@typesugar/mapper showcase: all assertions passed!");
