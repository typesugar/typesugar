export type { $, Kind } from "@typesugar/type-system";
// export type { ArrayF, PromiseF } from "@typesugar/fp";

export interface SetF {
  _: Set<this["_"]>;
}

export interface MapF<K> {
  _: Map<K, this["_"]>;
}

export interface ReadonlyArrayF {
  _: ReadonlyArray<this["_"]>;
}

export interface RecordF<K extends string | number | symbol = string> {
  _: Record<K, this["_"]>;
}

export interface StringF {
  _: string;
}

export interface IterableF {
  _: Iterable<this["_"]>;
}

export interface IteratorF {
  _: IterableIterator<this["_"]>;
}

export interface MapEntryF<K> {
  _: [K, this["_"]];
}

export interface Int8ArrayF {
  _: Int8Array;
}
export interface Uint8ArrayF {
  _: Uint8Array;
}
export interface Uint8ClampedArrayF {
  _: Uint8ClampedArray;
}
export interface Int16ArrayF {
  _: Int16Array;
}
export interface Uint16ArrayF {
  _: Uint16Array;
}
export interface Int32ArrayF {
  _: Int32Array;
}
export interface Uint32ArrayF {
  _: Uint32Array;
}
export interface Float32ArrayF {
  _: Float32Array;
}
export interface Float64ArrayF {
  _: Float64Array;
}
export interface BigInt64ArrayF {
  _: BigInt64Array;
}
export interface BigUint64ArrayF {
  _: BigUint64Array;
}
