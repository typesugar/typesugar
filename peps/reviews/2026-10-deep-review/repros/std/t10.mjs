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
