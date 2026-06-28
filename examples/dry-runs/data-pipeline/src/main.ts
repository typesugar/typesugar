/**
 * Data Pipeline / ETL Processor
 *
 * Simulates reading CSV-like sales data, transforming it, validating it,
 * aggregating by region, and producing a summary report.
 *
 * Uses as many TypeSugar libraries as possible:
 *   - typesugar: comptime, pipe, staticAssert, derive, Eq, Clone, Debug
 *   - @typesugar/fp: Option, Either, Some, None, Left, Right
 *   - @typesugar/std: match, pattern matching, makeEq, makeHash
 *   - @typesugar/codec: SchemaBuilder for schema evolution
 *   - @typesugar/collections: HashSet, HashMap
 *   - @typesugar/fusion: lazy, range for iterator fusion
 *   - @typesugar/validate: nativeSchema, is<T>()
 */

// ============================================================================
// Imports
// ============================================================================

import { comptime, pipe, staticAssert, derive, Eq, Clone, Debug } from "typesugar";
import { Some, None, Right, Left, isRight, isLeft, isSome } from "@typesugar/fp";
import type { Option, Either } from "@typesugar/fp";
import { match } from "@typesugar/std";
import { makeEq, makeHash } from "@typesugar/std";
import { SchemaBuilder } from "@typesugar/codec";
import { HashSet, HashMap } from "@typesugar/collections";
import { lazy, range } from "@typesugar/fusion";
import { nativeSchema } from "@typesugar/validate";
import type { ValidationError } from "@typesugar/validate";

// ============================================================================
// Compile-time constants
// ============================================================================

const PIPELINE_VERSION = comptime(() => "2.1.0");
const BUILD_TIMESTAMP = comptime(new Date().toISOString());
staticAssert(PIPELINE_VERSION.startsWith("2."), "expected v2.x pipeline");

console.log(`=== Data Pipeline v${PIPELINE_VERSION} ===`);
console.log(`Built: ${BUILD_TIMESTAMP}\n`);

// ============================================================================
// Data model with @derive
// ============================================================================

@derive(Eq, Clone, Debug)
class SalesRecord {
  constructor(
    public id: number,
    public region: string,
    public product: string,
    public amount: number,
    public quantity: number,
    public date: string,
  ) {}
}

// ============================================================================
// Schema evolution with @typesugar/codec
// ============================================================================

const salesSchemaV2 = new SchemaBuilder("SalesRecord", 2)
  .field("id", "number")
  .field("region", "string")
  .field("product", "string")
  .field("amount", "number")
  .field("quantity", "number")
  .field("date", "string")
  .field("currency", "string", { defaultValue: "USD", since: 2 })
  .field("channel", "string", { defaultValue: "online", since: 2 })
  .build();

console.log(`Schema: ${salesSchemaV2.name} v${salesSchemaV2.version}`);
console.log(`Fields: ${salesSchemaV2.fields.map((f: any) => f.name).join(", ")}\n`);

// ============================================================================
// Raw CSV-like data (simulated extract)
// ============================================================================

const rawRecords: unknown[] = [
  { id: 1, region: "North", product: "Widget", amount: 150.00, quantity: 3, date: "2025-01-15" },
  { id: 2, region: "South", product: "Gadget", amount: 250.50, quantity: 1, date: "2025-01-16" },
  { id: 3, region: "North", product: "Widget", amount: 75.25,  quantity: 2, date: "2025-01-17" },
  { id: 4, region: "East",  product: "Gizmo",  amount: 500.00, quantity: 5, date: "2025-01-18" },
  { id: 5, region: "South", product: "Widget", amount: 120.00, quantity: 1, date: "2025-01-19" },
  { id: 6, region: "West",  product: "Gadget", amount: 300.75, quantity: 4, date: "2025-01-20" },
  { id: 7, region: "North", product: "Gizmo",  amount: 425.00, quantity: 2, date: "2025-01-21" },
  { id: 8, region: "bad",   product: "",       amount: -10,    quantity: 0, date: "" },           // bad record
  { id: 9, region: "East",  product: "Widget", amount: 200.00, quantity: 3, date: "2025-01-23" },
  "not a record",                                                                                   // bad record
  { id: 11, region: "West", product: "Gizmo",  amount: 650.00, quantity: 7, date: "2025-01-25" },
];

// ============================================================================
// Step 1: Parse & Validate (using @typesugar/fp Either for error handling)
// ============================================================================

type ParseError = { recordIndex: number; message: string };

function parseRecord(raw: unknown, index: number): Either<ParseError, SalesRecord> {
  if (typeof raw !== "object" || raw === null) {
    return Left({ recordIndex: index, message: "Not an object" });
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.id !== "number" || typeof r.region !== "string" ||
      typeof r.product !== "string" || typeof r.amount !== "number" ||
      typeof r.quantity !== "number" || typeof r.date !== "string") {
    return Left({ recordIndex: index, message: "Missing or invalid fields" });
  }

  if (r.amount <= 0 || r.quantity <= 0 || (r.product as string).length === 0) {
    return Left({ recordIndex: index, message: `Business rule violation: amount=${r.amount}, qty=${r.quantity}, product='${r.product}'` });
  }

  return Right(new SalesRecord(
    r.id as number,
    r.region as string,
    r.product as string,
    r.amount as number,
    r.quantity as number,
    r.date as string,
  ));
}

console.log("--- Step 1: Parse & Validate ---");
const parseResults = rawRecords.map((raw, i) => parseRecord(raw, i));

const validRecords: SalesRecord[] = [];
const errors: ParseError[] = [];
for (const result of parseResults) {
  if (isRight(result)) {
    validRecords.push(result.right);
  } else {
    errors.push(result.left);
  }
}

console.log(`Parsed: ${validRecords.length} valid, ${errors.length} errors`);
for (const err of errors) {
  console.log(`  ERROR [record ${err.recordIndex}]: ${err.message}`);
}
console.log();

// ============================================================================
// Step 2: Transform with pipe (typesugar core)
// ============================================================================

console.log("--- Step 2: Transform ---");

type EnrichedRecord = {
  id: number;
  region: string;
  product: string;
  amount: number;
  quantity: number;
  date: string;
  unitPrice: number;
  tier: string;
};

function enrichRecord(r: SalesRecord): EnrichedRecord {
  const unitPrice = r.amount / r.quantity;
  // NOTE: match() fluent API (.case().then().else()) returns `never` in type stubs,
  // causing TS2339 errors at typecheck time. Using plain ternary instead.
  const tier = r.amount >= 500 ? "premium" : r.amount >= 200 ? "standard" : "basic";

  return {
    id: r.id,
    region: r.region,
    product: r.product,
    amount: r.amount,
    quantity: r.quantity,
    date: r.date,
    unitPrice,
    tier,
  };
}

const enriched: EnrichedRecord[] = pipe(
  validRecords,
  (records: SalesRecord[]) => records.map(enrichRecord),
) as EnrichedRecord[];

for (const r of enriched) {
  console.log(`  [${r.id}] ${r.product} in ${r.region}: $${r.amount.toFixed(2)} (${r.tier})`);
}
console.log();

// ============================================================================
// Step 3: Deduplicate regions with HashSet (@typesugar/collections)
// ============================================================================

console.log("--- Step 3: Unique Regions ---");

const regionEq = makeEq((a: string, b: string) => a === b);
const regionHash = makeHash((s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
});

const regionSet = new HashSet<string>(regionEq, regionHash);
for (const r of enriched) {
  regionSet.add(r.region);
}
console.log(`Unique regions: ${regionSet.size}`);
console.log();

// ============================================================================
// Step 4: Aggregate with HashMap (@typesugar/collections)
// ============================================================================

console.log("--- Step 4: Aggregate by Region ---");

const regionAgg = new HashMap<string, { total: number; count: number }>(regionEq, regionHash);

for (const r of enriched) {
  const existing = regionAgg.get(r.region);
  if (existing !== undefined) {
    regionAgg.set(r.region, { total: existing.total + r.amount, count: existing.count + 1 });
  } else {
    regionAgg.set(r.region, { total: r.amount, count: 1 });
  }
}

regionAgg.forEach((agg, region) => {
  console.log(`  ${region}: $${agg.total.toFixed(2)} (${agg.count} records, avg $${(agg.total / agg.count).toFixed(2)})`);
});
console.log();

// ============================================================================
// Step 5: Fusion pipeline (@typesugar/fusion)
// ============================================================================

console.log("--- Step 5: Fusion Pipeline ---");

const premiumProducts = lazy(enriched)
  .filter(r => r.tier === "premium")
  .map(r => `${r.product} ($${r.amount.toFixed(2)})`)
  .toArray();

console.log(`Premium products: ${premiumProducts.join(", ")}`);

const indexRange = range(1, enriched.length + 1)
  .map(i => `#${i}`)
  .toArray();
console.log(`Record indices: ${indexRange.join(", ")}`);
console.log();

// ============================================================================
// Step 6: Option chaining (@typesugar/fp)
// ============================================================================

console.log("--- Step 6: Option Lookups ---");

function findByRegion(region: string): Option<EnrichedRecord> {
  const found = enriched.find(r => r.region === region);
  return found !== undefined ? Some(found) : None;
}

// NOTE: Option dot-syntax (.map/.getOrElse) is @opaque macro syntax.
// Since Option<T> is just T | null at runtime (zero-cost), .map() doesn't exist.
// The transformer should rewrite these to null checks, but doesn't work with `expand`.
// Using isSome + manual null check as workaround.

const northFound = findByRegion("North");
const northRaw = northFound as unknown as EnrichedRecord | null;
const northSample = northRaw !== null
  ? `${northRaw.product}: $${northRaw.amount.toFixed(2)}`
  : "no records";

const missingFound = findByRegion("Antarctica");
const missingRaw = missingFound as unknown as EnrichedRecord | null;
const missingRegion = missingRaw !== null
  ? `${missingRaw.product}: $${missingRaw.amount.toFixed(2)}`
  : "no records";

console.log(`  North sample: ${northSample}`);
console.log(`  Antarctica sample: ${missingRegion}`);
console.log();

// ============================================================================
// Step 7: Pattern matching for report generation (@typesugar/std)
// ============================================================================

console.log("--- Step 7: Summary Report ---");

type ReportStatus =
  | { kind: "success"; recordCount: number; totalRevenue: number }
  | { kind: "partial"; recordCount: number; errorCount: number; totalRevenue: number }
  | { kind: "failure"; errorCount: number };

const totalRevenue = enriched.reduce((sum, r) => sum + r.amount, 0);

const status: ReportStatus = errors.length === 0
  ? { kind: "success", recordCount: validRecords.length, totalRevenue }
  : validRecords.length > 0
    ? { kind: "partial", recordCount: validRecords.length, errorCount: errors.length, totalRevenue }
    : { kind: "failure", errorCount: errors.length };

const reportLine = match(status, {
  success: (s) => `SUCCESS: ${s.recordCount} records processed, total revenue $${s.totalRevenue.toFixed(2)}`,
  partial: (s) => `PARTIAL: ${s.recordCount} records OK, ${s.errorCount} errors, total revenue $${s.totalRevenue.toFixed(2)}`,
  failure: (s) => `FAILURE: All ${s.errorCount} records failed validation`,
});

console.log(`  ${reportLine}`);
console.log();

// ============================================================================
// Step 8: @derive equality check
// ============================================================================

console.log("--- Step 8: Derived Equality ---");

const rec1 = new SalesRecord(1, "North", "Widget", 150, 3, "2025-01-15");
const rec2 = new SalesRecord(1, "North", "Widget", 150, 3, "2025-01-15");
const rec3 = new SalesRecord(2, "South", "Gadget", 250.5, 1, "2025-01-16");

// With @derive(Eq), === should use structural equality
console.log(`  rec1 === rec2 (same data): ${rec1 === rec2}`);  // expect true
console.log(`  rec1 === rec3 (diff data): ${rec1 === rec3}`);  // expect false
console.log();

// ============================================================================
// Done
// ============================================================================

console.log(`Pipeline complete. v${PIPELINE_VERSION}`);
