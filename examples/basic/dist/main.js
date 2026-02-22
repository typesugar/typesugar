var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
/**
 * typemacro Basic Example
 *
 * Demonstrates core macro features:
 * - comptime() for compile-time evaluation
 * - @derive() for auto-generated implementations
 * - Tagged template macros (sql, regex, html)
 * - Operator overloading with @operators and ops()
 * - Reflection with typeInfo() and fieldNames()
 */
// Import from the typemacro umbrella package
// Callable macros are exported directly, namespaces also available
import { comptimeEval as comptime, ops, pipe,
// Namespaces are also available:
// comptime, derive, operators, reflect, typeclass, specialize
 } from "typesugar";
// Alternatively, you can import directly from specific packages:
// import { comptime } from "@typesugar/comptime";
// import { ops, pipe, compose } from "@typesugar/operators";
// ============================================================================
// 1. Compile-Time Evaluation
// ============================================================================
// Compute factorial at compile time -- the result (120) is inlined
const factorial5 = comptime(() => {
    let result = 1;
    for (let i = 1; i <= 5; i++)
        result *= i;
    return result;
});
// Build a lookup table at compile time
const fibTable = comptime(() => {
    const fib = [0, 1];
    for (let i = 2; i <= 10; i++) {
        fib.push(fib[i - 1] + fib[i - 2]);
    }
    return fib;
});
console.log("Factorial of 5:", factorial5); // 120
console.log("First 11 Fibonacci numbers:", fibTable);
// After macro expansion, these functions are available:
// - pointEq(a: Point, b: Point): boolean
// - clonePoint(p: Point): Point
// - debugPoint(p: Point): string
// - hashPoint(p: Point): number
const p1 = { x: 1, y: 2 };
const p2 = { x: 1, y: 2 };
const p3 = { x: 3, y: 4 };
// These would work after macro expansion:
// console.log("p1 == p2:", pointEq(p1, p2));  // true
// console.log("p1 == p3:", pointEq(p1, p3));  // false
// console.log("debug p1:", debugPoint(p1));     // "Point { x: 1, y: 2 }"
// ============================================================================
// 3. Operator Overloading
// ============================================================================
let Vector2D = (() => {
    let _classDecorators = [operators({ "+": "add", "-": "sub", "*": "scale" })];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var Vector2D = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            Vector2D = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        x;
        y;
        constructor(x, y) {
            this.x = x;
            this.y = y;
        }
        add(other) {
            return new Vector2D(this.x + other.x, this.y + other.y);
        }
        sub(other) {
            return new Vector2D(this.x - other.x, this.y - other.y);
        }
        scale(factor) {
            return new Vector2D(this.x * factor, this.y * factor);
        }
        toString() {
            return `Vector2D(${this.x}, ${this.y})`;
        }
    };
    return Vector2D = _classThis;
})();
const a = new Vector2D(1, 2);
const b = new Vector2D(3, 4);
// ops() transforms operators into method calls at compile time:
// ops(a + b) becomes a.add(b)
const sum = ops(a + b);
console.log("Vector sum:", sum.toString()); // Vector2D(4, 6)
// ============================================================================
// 4. Pipe
// ============================================================================
const double = (x) => x * 2;
const addOne = (x) => x + 1;
const toString = (x) => `Result: ${x}`;
// pipe(5, double, addOne, toString) becomes toString(addOne(double(5)))
const result = pipe(5, double, addOne, toString);
console.log(result); // "Result: 11"
// ============================================================================
// 5. Compile-Time Constants
// ============================================================================
// Use comptime to embed build metadata
const buildInfo = comptime(() => ({
    version: "1.0.0",
    builtAt: new Date().toISOString(),
    nodeVersion: process.version,
}));
console.log("Build info:", buildInfo);
//# sourceMappingURL=main.js.map