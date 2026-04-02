/**
 * E-Commerce Domain Model — TypeSugar Functional Domain Modeling
 *
 * Demonstrates: comptime, pipe, staticAssert, @typeclass, @impl,
 * Option, Either, @derive, HashSet, HashMap, refined types, newtype,
 * typeInfo, fieldNames, contracts, codec
 *
 * NOTE: match() fluent API and @op operator overloading are attempted but
 * documented as broken (see friction log at bottom).
 */

// ============================================================================
// 1. Core Imports
// ============================================================================

import { comptime, staticAssert, pipe, summon, implicit } from "typesugar";
import { derive, Eq, Clone, Debug } from "typesugar";
import { typeInfo, fieldNames } from "typesugar";
import { Some, None, Left, Right, isLeft, isRight } from "@typesugar/fp";
import { map as mapEither, fold as foldEither, getOrElse as getOrElseEither } from "@typesugar/fp/data/either";
import type { Option, Either } from "@typesugar/fp";
import { makeEq, makeHash } from "@typesugar/std";
import { HashSet, HashMap } from "@typesugar/collections";
// NOTE: @typesugar/type-system imports TypeScript compiler at runtime,
// making it unusable from `typesugar run`. Defining Newtype inline instead.
// import { wrap, unwrap } from "@typesugar/type-system";
// import type { Newtype } from "@typesugar/type-system";

type Newtype<T, Brand extends string> = T & { readonly __brand: Brand };
function wrap<N>(value: any): N { return value as N; }
function unwrap<N>(value: N): N extends Newtype<infer T, any> ? T : never { return value as any; }
import { requires } from "@typesugar/contracts";
import { SchemaBuilder } from "@typesugar/codec";

// ============================================================================
// 2. Compile-Time Constants
// ============================================================================

const APP_VERSION = comptime(() => "2.1.0");
const BUILD_DATE = comptime(() => new Date().toISOString());
const MAX_ORDER_ITEMS = comptime(() => 100);
const TAX_RATE = comptime(() => 0.08);

staticAssert(MAX_ORDER_ITEMS > 0, "MAX_ORDER_ITEMS must be positive");
staticAssert(TAX_RATE >= 0 && TAX_RATE < 1, "TAX_RATE must be in [0, 1)");

// ============================================================================
// 3. Newtype Definitions — Zero-Cost Branding
// ============================================================================

type ProductId = Newtype<number, "ProductId">;
type OrderId = Newtype<number, "OrderId">;
type CustomerId = Newtype<number, "CustomerId">;

const ProductId = (n: number): ProductId => wrap<ProductId>(n);
const OrderId = (n: number): OrderId => wrap<OrderId>(n);
const CustomerId = (n: number): CustomerId => wrap<CustomerId>(n);

// ============================================================================
// 4. Money — @typeclass with @impl
// ============================================================================

@derive(Eq, Clone, Debug)
class Money {
  constructor(
    public readonly cents: number,
    public readonly currency: string
  ) {}
}

function formatMoney(m: Money): string {
  return `${(m.cents / 100).toFixed(2)} ${m.currency}`;
}

/** @typeclass */
interface Addable<A> {
  add(a: A, b: A): A;
}

/** @typeclass */
interface Orderable<A> {
  lessThan(a: A, b: A): boolean;
}

/** @impl Addable<Money> */
const addableMoney: Addable<Money> = {
  add: (a, b) => {
    requires(a.currency === b.currency, "Cannot add different currencies");
    return new Money(a.cents + b.cents, a.currency);
  },
};

/** @impl Orderable<Money> */
const orderableMoney: Orderable<Money> = {
  lessThan: (a, b) => a.cents < b.cents,
};

// ============================================================================
// 5. Product — @derive + reflection
// ============================================================================

@derive(Eq, Clone, Debug)
class Product {
  constructor(
    public readonly id: ProductId,
    public readonly name: string,
    public readonly price: Money,
    public readonly stock: number
  ) {}
}

// Compile-time reflection
const productFields = fieldNames<Product>();
const productSchema = typeInfo<Product>();

// ============================================================================
// 6. Order Status ADT — Using switch (match() macro is broken)
// ============================================================================

type OrderStatus =
  | { kind: "pending" }
  | { kind: "confirmed"; confirmedAt: string }
  | { kind: "shipped"; trackingNumber: string }
  | { kind: "delivered"; deliveredAt: string }
  | { kind: "cancelled"; reason: string };

function describeStatus(status: OrderStatus): string {
  switch (status.kind) {
    case "pending": return "Awaiting confirmation";
    case "confirmed": return `Confirmed at ${status.confirmedAt}`;
    case "shipped": return `Shipped: ${status.trackingNumber}`;
    case "delivered": return `Delivered at ${status.deliveredAt}`;
    case "cancelled": return `Cancelled: ${status.reason}`;
  }
}

// ============================================================================
// 7. Payment ADT
// ============================================================================

type PaymentMethod =
  | { kind: "credit_card"; last4: string; expiry: string }
  | { kind: "bank_transfer"; reference: string }
  | { kind: "wallet"; provider: string; balance: Money };

function paymentLabel(method: PaymentMethod): string {
  switch (method.kind) {
    case "credit_card": return `Card ending ${method.last4}`;
    case "bank_transfer": return `Bank ref: ${method.reference}`;
    case "wallet": return `Wallet: ${method.provider}`;
  }
}

// ============================================================================
// 8. Order Line Item
// ============================================================================

@derive(Eq, Clone, Debug)
class LineItem {
  constructor(
    public readonly product: Product,
    public readonly quantity: number
  ) {}
}

function lineItemSubtotal(item: LineItem): Money {
  return new Money(item.product.price.cents * item.quantity, item.product.price.currency);
}

// ============================================================================
// 9. Order — Using Option, Either, contracts
// ============================================================================

class Order {
  constructor(
    public readonly id: OrderId,
    public readonly customerId: CustomerId,
    public readonly items: LineItem[],
    public readonly status: OrderStatus,
    public readonly payment: Option<PaymentMethod>,
    public readonly notes: Option<string>
  ) {}

  subtotal(): Money {
    return this.items.reduce(
      (acc, item) => addableMoney.add(acc, lineItemSubtotal(item)),
      new Money(0, "USD")
    );
  }

  tax(): Money {
    const sub = this.subtotal();
    return new Money(Math.round(sub.cents * TAX_RATE), sub.currency);
  }

  total(): Money {
    return addableMoney.add(this.subtotal(), this.tax());
  }
}

// ============================================================================
// 10. Inventory Management — HashMap + HashSet
// ============================================================================

const productIdEq = makeEq((a: number, b: number) => a === b);
const productIdHash = makeHash((a: number) => a);

// Product catalog using HashMap
const catalog = new HashMap<number, Product>(productIdEq, productIdHash);

// Featured product IDs using HashSet
const featuredIds = new HashSet<number>(productIdEq, productIdHash);

// ============================================================================
// 11. Order Validation — Either for typed errors
// ============================================================================

type OrderError =
  | { kind: "empty_cart" }
  | { kind: "product_not_found"; productId: number }
  | { kind: "insufficient_stock"; productId: number; available: number; requested: number }
  | { kind: "exceeds_max_items"; count: number };

function validateOrder(items: Array<{ productId: number; quantity: number }>): Either<OrderError, LineItem[]> {
  if (items.length === 0) {
    return Left({ kind: "empty_cart" });
  }
  if (items.length > MAX_ORDER_ITEMS) {
    return Left({ kind: "exceeds_max_items", count: items.length });
  }

  const lineItems: LineItem[] = [];
  for (const item of items) {
    const product = catalog.get(item.productId);
    if (product == null) {  // Use == null to avoid @derive(Eq) rewrite of === undefined
      return Left({ kind: "product_not_found", productId: item.productId });
    }
    if (product.stock < item.quantity) {
      return Left({
        kind: "insufficient_stock",
        productId: item.productId,
        available: product.stock,
        requested: item.quantity,
      });
    }
    lineItems.push(new LineItem(product, item.quantity));
  }

  return Right(lineItems);
}

function describeOrderError(err: OrderError): string {
  switch (err.kind) {
    case "empty_cart": return "Cart is empty";
    case "product_not_found": return `Product ${err.productId} not found`;
    case "insufficient_stock": return `Product ${err.productId}: only ${err.available} available, ${err.requested} requested`;
    case "exceeds_max_items": return `Too many items: ${err.count} (max ${MAX_ORDER_ITEMS})`;
  }
}

// ============================================================================
// 12. Codec — Schema for order serialization
// ============================================================================

const orderSchema = new SchemaBuilder("Order", 1)
  .field("id", "number")
  .field("customerId", "number")
  .field("items", "array")
  .field("status", "string")
  .field("total", "number")
  .field("createdAt", "string", { defaultValue: "", since: 1 })
  .build();

// ============================================================================
// 13. Application — Putting it all together
// ============================================================================

function main() {
  console.log(`=== E-Commerce Domain Model (v${APP_VERSION}) ===`);
  console.log(`Built: ${BUILD_DATE}\n`);

  // --- Product catalog ---
  const laptop = new Product(ProductId(1), "Gaming Laptop", new Money(129999, "USD"), 10);
  const mouse = new Product(ProductId(2), "Wireless Mouse", new Money(4999, "USD"), 50);
  const keyboard = new Product(ProductId(3), "Mechanical Keyboard", new Money(14999, "USD"), 25);
  const headset = new Product(ProductId(4), "Noise-Cancel Headset", new Money(29999, "USD"), 15);

  catalog.set(1, laptop).set(2, mouse).set(3, keyboard).set(4, headset);
  featuredIds.add(1).add(4);

  console.log("--- Product Catalog ---");
  console.log(`Products loaded: ${catalog.size}`);
  console.log(`Featured: ${featuredIds.size} products`);
  console.log(`Product fields: [${productFields.join(", ")}]`);
  console.log(`Product schema: ${productSchema.name}, ${productSchema.fields?.length ?? 0} fields\n`);

  // --- Money operations (using typeclass instances directly) ---
  const price1 = new Money(1999, "USD");
  const price2 = new Money(3499, "USD");
  const sum = addableMoney.add(price1, price2);
  console.log("--- Money Arithmetic ---");
  console.log(`${formatMoney(price1)} + ${formatMoney(price2)} = ${formatMoney(sum)}`);
  console.log(`${formatMoney(price1)} < ${formatMoney(price2)}? ${orderableMoney.lessThan(price1, price2)}`);

  // --- Derived Eq: structural equality ---
  const p1 = new Money(1999, "USD");
  const p2 = new Money(1999, "USD");
  const p3 = new Money(3499, "USD");
  console.log(`\n--- Derived Eq ---`);
  console.log(`p1 === p2 (same values): ${p1 === p2}`);    // @derive(Eq) rewrites to structural
  console.log(`p1 === p3 (different): ${p1 === p3}`);

  // --- Option usage ---
  // NOTE: Option dot-syntax (.map, .getOrElse, .fold) does NOT work at runtime.
  // The @opaque rewrite macro that should transform these to null-checks is broken.
  // Workaround: use manual null checks since Some(x) === x and None === null.
  console.log("\n--- Option Handling ---");
  const discount: Option<Money> = Some(new Money(500, "USD"));
  const noDiscount: Option<Money> = None;

  // Manual null-check instead of discount.map(f).getOrElse(g)
  const finalPrice = discount != null
    ? new Money(sum.cents - discount.cents, sum.currency)
    : sum;
  console.log(`With discount: ${formatMoney(finalPrice)}`);

  const noDiscountPrice = noDiscount != null
    ? new Money(sum.cents - noDiscount.cents, sum.currency)
    : sum;
  console.log(`Without discount: ${formatMoney(noDiscountPrice)}`);

  // Manual fold
  const coupon: Option<string> = Some("SAVE20");
  const couponMsg = coupon != null ? `Coupon: ${coupon}` : "No coupon";
  console.log(`Coupon: ${couponMsg}`);

  // --- Order validation (Either) ---
  console.log("\n--- Order Validation ---");

  // Valid order
  const validResult = validateOrder([
    { productId: 1, quantity: 1 },
    { productId: 2, quantity: 2 },
  ]);

  // Either: Left(e) = { left: e }, Right(a) = { right: a }
  if (isRight(validResult)) {
    console.log("Valid order created");
    const order = new Order(
      OrderId(1001),
      CustomerId(42),
      validResult.right,
      { kind: "pending" },
      Some({ kind: "credit_card", last4: "4242", expiry: "12/27" } as PaymentMethod),
      Some("Express shipping please")
    );
    console.log(`Order total: ${formatMoney(order.total())}`);
    // Manual null check for Option instead of .map().getOrElse()
    const pmtLabel = order.payment != null ? paymentLabel(order.payment) : "None";
    console.log(`Payment: ${pmtLabel}`);
    const notes = order.notes != null ? order.notes : "No notes";
    console.log(`Notes: ${notes}`);
  }

  // Invalid order: empty cart
  const emptyResult = validateOrder([]);
  if (isLeft(emptyResult)) {
    console.log(`Error: ${describeOrderError(emptyResult.left)}`);
  }

  // Invalid order: insufficient stock
  const stockResult = validateOrder([{ productId: 1, quantity: 999 }]);
  if (isLeft(stockResult)) {
    console.log(`Error: ${describeOrderError(stockResult.left)}`);
  }

  // --- Pattern matching on order status ---
  console.log("\n--- Order Status ---");
  const statuses: OrderStatus[] = [
    { kind: "pending" },
    { kind: "confirmed", confirmedAt: "2026-04-02T10:00:00Z" },
    { kind: "shipped", trackingNumber: "TRK-12345" },
    { kind: "delivered", deliveredAt: "2026-04-05T14:30:00Z" },
    { kind: "cancelled", reason: "Customer request" },
  ];
  for (const s of statuses) {
    console.log(`  ${s.kind}: ${describeStatus(s)}`);
  }

  // --- Payment methods ---
  console.log("\n--- Payment Methods ---");
  const methods: PaymentMethod[] = [
    { kind: "credit_card", last4: "4242", expiry: "12/27" },
    { kind: "bank_transfer", reference: "BT-98765" },
    { kind: "wallet", provider: "PayPal", balance: new Money(50000, "USD") },
  ];
  for (const m of methods) {
    console.log(`  ${paymentLabel(m)}`);
  }

  // --- Contracts ---
  console.log("\n--- Contracts ---");
  try {
    const safeMoney = addableMoney.add(
      new Money(100, "USD"),
      new Money(200, "USD")
    );
    console.log(`Safe add: ${formatMoney(safeMoney)}`);
  } catch (e: any) {
    console.log(`Contract error: ${e.message}`);
  }

  // Demonstrate contract violation
  try {
    addableMoney.add(new Money(100, "USD"), new Money(200, "EUR"));
  } catch (e: any) {
    console.log(`Contract violation caught: ${e.message}`);
  }

  // --- Codec schema ---
  console.log("\n--- Order Schema ---");
  console.log(`Schema: ${orderSchema.name} v${orderSchema.version}`);
  console.log(`Fields: ${orderSchema.fields.map((f: any) => f.name).join(", ")}`);

  // --- Reflection ---
  console.log("\n--- Reflection ---");
  console.log(`Product fields: ${productFields.join(", ")}`);
  if (productSchema.fields) {
    for (const f of productSchema.fields) {
      console.log(`  ${f.name}: ${f.type}`);
    }
  }

  // --- Pipe ---
  console.log("\n--- Pipe ---");
  const result = pipe(
    new Money(10000, "USD"),
    m => addableMoney.add(m, new Money(2000, "USD")),
    m => new Money(Math.round(m.cents * (1 + TAX_RATE)), m.currency),
    m => `Grand total: ${formatMoney(m)}`
  );
  console.log(result);

  // --- Newtype unwrap ---
  console.log("\n--- Newtypes ---");
  const pid = ProductId(42);
  const raw = unwrap(pid);
  console.log(`ProductId(42) unwraps to: ${raw}`);

  console.log("\n=== All domain operations completed ===");
}

main();
