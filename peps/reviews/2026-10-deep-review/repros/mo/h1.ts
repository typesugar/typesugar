import type { _, TypeFunction } from "@typesugar/type-system";
/** @hkt */ type ROArrF = readonly _[];
/** @hkt */ type GetF = { get(): _ };
/** @hkt */ type KeyedF = { [k: string]: _ };
/** @hkt */ type Box<A extends string> = { v: A };
