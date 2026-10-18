const s = { kind: "circle", radius: 5 };
const a = (() => {
    const _s = s;
    switch (_s.kind) {
        case "circle":
            const r = _s.radius;
            if (r > 10)
                return "big";
            break;
        case "sq": return "sq";
        default: return "other";
    }
})();
console.log("a =", a);
const b = (() => {
    const __typesugar__s_s1_0__ = s;
    switch (__typesugar__s_s1_0__.kind) {
        case "circle":
            const r = __typesugar__s_s1_0__.radius;
            return r;
        case "ring":
            const r = __typesugar__s_s1_0__.radius;
            return -r;
        default: return 0;
    }
})();
