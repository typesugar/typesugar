/**
 * @derive(Meta) — row-level Read + Write instance for a product type
 *
 * BUILD-TIME ONLY (imports `typescript`).
 *
 * ## Usage
 *
 * ```typescript
 * @derive(Meta)
 * interface User {
 *   id: number;
 *   name: string;
 *   createdAt: Date;
 * }
 *
 * // Expands to:
 * export const UserMeta: Codec<User> = Codec.fromReadWrite(
 *   Read.make([...mappings], (fields) => fields as User),
 *   Write.make(["id", "name", "created_at"], [...extractors], ["id", "name", "createdAt"]),
 * );
 * ```
 *
 * `UserMeta` reads rows (`ConnectionIO.query(q, UserMeta)`) and writes values
 * (`valuesTyped(UserMeta, user)`, `setTyped(UserMeta, patch)`). It is the same
 * instance `@derive(Codec)` builds, under the `<T>Meta` name. (For a
 * single-COLUMN mapping of a newtype, use `Meta.imap(Meta.string, …)` — that is a
 * different thing from this row-level derive.)
 *
 * ## History (SQL-14, SQL-12)
 *
 * This used to be an *attribute* macro named `derive` that inspected its first
 * argument. Since PEP-032 `@derive(X)` dispatches to `globalRegistry.getDerive(X)`,
 * so `Meta` reported "Unknown derive" (and was silently dropped from mixed lists
 * like `@derive(Meta, Eq)`). It is now a real derive macro named `Meta`, built
 * from the same AST builders as Read/Write/Codec (derive-common.ts). The old
 * version also emitted whole expressions through `createIdentifier(...)` and a
 * `.source`-string `registerInstanceMethods(...)` call (a no-op function that
 * was never exported, so the output threw ReferenceError); both are gone.
 *
 * Column names: camelCase → snake_case, overridable with a `@column` JSDoc tag.
 *
 * @module
 */

import * as ts from "typescript";
import { defineDeriveMacro } from "@typesugar/core";
import type { MacroContext, DeriveTypeInfo } from "@typesugar/core";
import {
  buildReadMake,
  buildWriteMake,
  collectMappings,
  exportConst,
  runtimeRef,
} from "./derive-common.js";

export const deriveMetaMacro = defineDeriveMacro({
  name: "Meta",
  description: "Derive a row-level Read + Write (Codec) instance named <Type>Meta",
  expand(
    ctx: MacroContext,
    target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const factory = ctx.factory;
    const typeName = typeInfo.name;

    if (typeInfo.kind !== "product") {
      ctx.reportError(target, `@derive(Meta) only supports product types (interfaces/classes)`);
      return [];
    }
    if (!typeInfo.fields || typeInfo.fields.length === 0) {
      ctx.reportError(target, `@derive(Meta) requires at least one field`);
      return [];
    }

    const mappings = collectMappings(ctx, "Meta", target, typeInfo.fields);
    if (!mappings) return [];

    const init = factory.createCallExpression(
      factory.createPropertyAccessExpression(runtimeRef(ctx, "Codec"), "fromReadWrite"),
      undefined,
      [buildReadMake(ctx, typeName, mappings), buildWriteMake(ctx, typeName, mappings)]
    );

    return [exportConst(ctx, `${typeName}Meta`, "Codec", typeName, init)];
  },
});
