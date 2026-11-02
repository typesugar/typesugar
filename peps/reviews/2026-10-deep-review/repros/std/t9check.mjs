import { MatchError } from "@typesugar/std";
async function f(x) {
    return (() => {
        const _x = x;
        if (_x === 1)
            return await load(1);
        {
            const n = _x;
            return await load(n);
        }
        throw new MatchError(_x);
    })();
}
