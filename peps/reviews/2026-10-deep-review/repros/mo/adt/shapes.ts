export interface Circle { radius: number }
export interface Square { side: number }
export interface Empty {}
/** @adt */
export type Shape = Circle | Square | Empty;
