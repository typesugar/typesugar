declare const __brand: unique symbol;
type Newtype<Base, Brand extends string> = Base & { readonly [__brand]: Brand };
type UserId = Newtype<number, "UserId">;
type Meters = Newtype<number, "Meters">;
type Feet = Newtype<number, "Feet">;
declare function wrap<T>(x: any): T;
function getUser(id: UserId): void {}
getUser(42);
function area(w: Meters, h: Meters): number { return 0; }
area(wrap<Meters>(10), wrap<Feet>(5));
