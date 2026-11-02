export const isSN = (value) => {
    const errors = [];
    return errors.length === 0;
};
export const isUnionObj = (value) => {
    const errors = [];
    return errors.length === 0;
};
export const isNullable = (value) => {
    const errors = [];
    if (typeof value !== "object" || value === null) {
        errors.push({ path: "$", message: "expected object" });
    }
    if (typeof value.v !== "string") {
        errors.push({ path: "$" + ".v", message: "expected string" });
    }
    return errors.length === 0;
};
export const isLit = (value) => {
    const errors = [];
    return errors.length === 0;
};
export const isNumLit = (value) => {
    const errors = [];
    return errors.length === 0;
};
export const isBig = (value) => {
    const errors = [];
    return errors.length === 0;
};
export const isNamed = (value) => {
    const errors = [];
    if (typeof value !== "object" || value === null) {
        errors.push({ path: "$", message: "expected object" });
    }
    if (typeof value.name !== "string") {
        errors.push({ path: "$" + ".name", message: "expected string" });
    }
    if (typeof value.greet !== "object" || value.greet === null) {
        errors.push({ path: "$" + ".greet", message: "expected object" });
    }
    return errors.length === 0;
};
export const isAnonArr = (value) => {
    const errors = [];
    if (!Array.isArray(value)) {
        errors.push({ path: "$", message: "expected array" });
    }
    return errors.length === 0;
};
export const isObj = (value) => {
    const errors = [];
    if (typeof value !== "object" || value === null) {
        errors.push({ path: "$", message: "expected object" });
    }
    if (typeof value.name !== "string") {
        errors.push({ path: "$" + ".name", message: "expected string" });
    }
    return errors.length === 0;
};
