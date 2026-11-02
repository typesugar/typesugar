import { Schema, Hash, Equal } from "effect";
import { EffectSchema, EffectHash, EffectEqual } from "@typesugar/effect";

/** @derive(EffectSchema, EffectHash) */
export interface Tree {
  value: number;
  label: string;
  children: Tree[];
}
