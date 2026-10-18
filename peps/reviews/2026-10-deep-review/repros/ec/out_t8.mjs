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
export const isDate = (value) => {
    const errors = [];
    if (typeof value !== "object" || value === null) {
        errors.push({ path: "$", message: "expected object" });
    }
    if (typeof value.toString !== "object" || value.toString === null) {
        errors.push({ path: "$" + ".toString", message: "expected object" });
    }
    if (typeof value.toDateString !== "object" || value.toDateString === null) {
        errors.push({ path: "$" + ".toDateString", message: "expected object" });
    }
    if (typeof value.toTimeString !== "object" || value.toTimeString === null) {
        errors.push({ path: "$" + ".toTimeString", message: "expected object" });
    }
    if (!Array.isArray(value.toLocaleString)) {
        errors.push({ path: "$" + ".toLocaleString", message: "expected array" });
    }
    if (!Array.isArray(value.toLocaleDateString)) {
        errors.push({ path: "$" + ".toLocaleDateString", message: "expected array" });
    }
    if (!Array.isArray(value.toLocaleTimeString)) {
        errors.push({ path: "$" + ".toLocaleTimeString", message: "expected array" });
    }
    if (typeof value.valueOf !== "object" || value.valueOf === null) {
        errors.push({ path: "$" + ".valueOf", message: "expected object" });
    }
    if (typeof value.getTime !== "object" || value.getTime === null) {
        errors.push({ path: "$" + ".getTime", message: "expected object" });
    }
    if (typeof value.getFullYear !== "object" || value.getFullYear === null) {
        errors.push({ path: "$" + ".getFullYear", message: "expected object" });
    }
    if (typeof value.getUTCFullYear !== "object" || value.getUTCFullYear === null) {
        errors.push({ path: "$" + ".getUTCFullYear", message: "expected object" });
    }
    if (typeof value.getMonth !== "object" || value.getMonth === null) {
        errors.push({ path: "$" + ".getMonth", message: "expected object" });
    }
    if (typeof value.getUTCMonth !== "object" || value.getUTCMonth === null) {
        errors.push({ path: "$" + ".getUTCMonth", message: "expected object" });
    }
    if (typeof value.getDate !== "object" || value.getDate === null) {
        errors.push({ path: "$" + ".getDate", message: "expected object" });
    }
    if (typeof value.getUTCDate !== "object" || value.getUTCDate === null) {
        errors.push({ path: "$" + ".getUTCDate", message: "expected object" });
    }
    if (typeof value.getDay !== "object" || value.getDay === null) {
        errors.push({ path: "$" + ".getDay", message: "expected object" });
    }
    if (typeof value.getUTCDay !== "object" || value.getUTCDay === null) {
        errors.push({ path: "$" + ".getUTCDay", message: "expected object" });
    }
    if (typeof value.getHours !== "object" || value.getHours === null) {
        errors.push({ path: "$" + ".getHours", message: "expected object" });
    }
    if (typeof value.getUTCHours !== "object" || value.getUTCHours === null) {
        errors.push({ path: "$" + ".getUTCHours", message: "expected object" });
    }
    if (typeof value.getMinutes !== "object" || value.getMinutes === null) {
        errors.push({ path: "$" + ".getMinutes", message: "expected object" });
    }
    if (typeof value.getUTCMinutes !== "object" || value.getUTCMinutes === null) {
        errors.push({ path: "$" + ".getUTCMinutes", message: "expected object" });
    }
    if (typeof value.getSeconds !== "object" || value.getSeconds === null) {
        errors.push({ path: "$" + ".getSeconds", message: "expected object" });
    }
    if (typeof value.getUTCSeconds !== "object" || value.getUTCSeconds === null) {
        errors.push({ path: "$" + ".getUTCSeconds", message: "expected object" });
    }
    if (typeof value.getMilliseconds !== "object" || value.getMilliseconds === null) {
        errors.push({ path: "$" + ".getMilliseconds", message: "expected object" });
    }
    if (typeof value.getUTCMilliseconds !== "object" || value.getUTCMilliseconds === null) {
        errors.push({ path: "$" + ".getUTCMilliseconds", message: "expected object" });
    }
    if (typeof value.getTimezoneOffset !== "object" || value.getTimezoneOffset === null) {
        errors.push({ path: "$" + ".getTimezoneOffset", message: "expected object" });
    }
    if (typeof value.setTime !== "object" || value.setTime === null) {
        errors.push({ path: "$" + ".setTime", message: "expected object" });
    }
    if (typeof value.setMilliseconds !== "object" || value.setMilliseconds === null) {
        errors.push({ path: "$" + ".setMilliseconds", message: "expected object" });
    }
    if (typeof value.setUTCMilliseconds !== "object" || value.setUTCMilliseconds === null) {
        errors.push({ path: "$" + ".setUTCMilliseconds", message: "expected object" });
    }
    if (typeof value.setSeconds !== "object" || value.setSeconds === null) {
        errors.push({ path: "$" + ".setSeconds", message: "expected object" });
    }
    if (typeof value.setUTCSeconds !== "object" || value.setUTCSeconds === null) {
        errors.push({ path: "$" + ".setUTCSeconds", message: "expected object" });
    }
    if (typeof value.setMinutes !== "object" || value.setMinutes === null) {
        errors.push({ path: "$" + ".setMinutes", message: "expected object" });
    }
    if (typeof value.setUTCMinutes !== "object" || value.setUTCMinutes === null) {
        errors.push({ path: "$" + ".setUTCMinutes", message: "expected object" });
    }
    if (typeof value.setHours !== "object" || value.setHours === null) {
        errors.push({ path: "$" + ".setHours", message: "expected object" });
    }
    if (typeof value.setUTCHours !== "object" || value.setUTCHours === null) {
        errors.push({ path: "$" + ".setUTCHours", message: "expected object" });
    }
    if (typeof value.setDate !== "object" || value.setDate === null) {
        errors.push({ path: "$" + ".setDate", message: "expected object" });
    }
    if (typeof value.setUTCDate !== "object" || value.setUTCDate === null) {
        errors.push({ path: "$" + ".setUTCDate", message: "expected object" });
    }
    if (typeof value.setMonth !== "object" || value.setMonth === null) {
        errors.push({ path: "$" + ".setMonth", message: "expected object" });
    }
    if (typeof value.setUTCMonth !== "object" || value.setUTCMonth === null) {
        errors.push({ path: "$" + ".setUTCMonth", message: "expected object" });
    }
    if (typeof value.setFullYear !== "object" || value.setFullYear === null) {
        errors.push({ path: "$" + ".setFullYear", message: "expected object" });
    }
    if (typeof value.setUTCFullYear !== "object" || value.setUTCFullYear === null) {
        errors.push({ path: "$" + ".setUTCFullYear", message: "expected object" });
    }
    if (typeof value.toUTCString !== "object" || value.toUTCString === null) {
        errors.push({ path: "$" + ".toUTCString", message: "expected object" });
    }
    if (typeof value.toISOString !== "object" || value.toISOString === null) {
        errors.push({ path: "$" + ".toISOString", message: "expected object" });
    }
    if (typeof value.toJSON !== "object" || value.toJSON === null) {
        errors.push({ path: "$" + ".toJSON", message: "expected object" });
    }
    if (typeof value.getVarDate !== "object" || value.getVarDate === null) {
        errors.push({ path: "$" + ".getVarDate", message: "expected object" });
    }
    if (typeof value.__)
     !== "object" || value.__;
     === null;
    {
        errors.push({ path: "$" + ".__@toPrimitive@19", message: "expected object" });
    }
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
export const isTuple = (value) => {
    const errors = [];
    if (typeof value !== "object" || value === null) {
        errors.push({ path: "$", message: "expected object" });
    }
    if (typeof value)
        .0 !== "string";
    {
        errors.push({ path: "$" + ".0", message: "expected string" });
    }
    if (typeof value)
        .1 !== "number";
    {
        errors.push({ path: "$" + ".1", message: "expected number" });
    }
    if (typeof value.toString !== "object" || value.toString === null) {
        errors.push({ path: "$" + ".toString", message: "expected object" });
    }
    if (!Array.isArray(value.toLocaleString)) {
        errors.push({ path: "$" + ".toLocaleString", message: "expected array" });
    }
    if (typeof value.pop !== "object" || value.pop === null) {
        errors.push({ path: "$" + ".pop", message: "expected object" });
    }
    if (!Array.isArray(value.push)) {
        errors.push({ path: "$" + ".push", message: "expected array" });
    }
    if (!Array.isArray(value.concat)) {
        errors.push({ path: "$" + ".concat", message: "expected array" });
    }
    if (typeof value.join !== "object" || value.join === null) {
        errors.push({ path: "$" + ".join", message: "expected object" });
    }
    if (!Array.isArray(value.reverse)) {
        errors.push({ path: "$" + ".reverse", message: "expected array" });
    }
    if (typeof value.shift !== "object" || value.shift === null) {
        errors.push({ path: "$" + ".shift", message: "expected object" });
    }
    if (!Array.isArray(value.slice)) {
        errors.push({ path: "$" + ".slice", message: "expected array" });
    }
    if (typeof value.sort !== "object" || value.sort === null) {
        errors.push({ path: "$" + ".sort", message: "expected object" });
    }
    if (!Array.isArray(value.splice)) {
        errors.push({ path: "$" + ".splice", message: "expected array" });
    }
    if (!Array.isArray(value.unshift)) {
        errors.push({ path: "$" + ".unshift", message: "expected array" });
    }
    if (typeof value.indexOf !== "object" || value.indexOf === null) {
        errors.push({ path: "$" + ".indexOf", message: "expected object" });
    }
    if (typeof value.lastIndexOf !== "object" || value.lastIndexOf === null) {
        errors.push({ path: "$" + ".lastIndexOf", message: "expected object" });
    }
    if (!Array.isArray(value.every)) {
        errors.push({ path: "$" + ".every", message: "expected array" });
    }
    if (!Array.isArray(value.some)) {
        errors.push({ path: "$" + ".some", message: "expected array" });
    }
    if (!Array.isArray(value.forEach)) {
        errors.push({ path: "$" + ".forEach", message: "expected array" });
    }
    if (!Array.isArray(value.map)) {
        errors.push({ path: "$" + ".map", message: "expected array" });
    }
    if (!Array.isArray(value.filter)) {
        errors.push({ path: "$" + ".filter", message: "expected array" });
    }
    if (!Array.isArray(value.reduce)) {
        errors.push({ path: "$" + ".reduce", message: "expected array" });
    }
    if (!Array.isArray(value.reduceRight)) {
        errors.push({ path: "$" + ".reduceRight", message: "expected array" });
    }
    if (!Array.isArray(value.find)) {
        errors.push({ path: "$" + ".find", message: "expected array" });
    }
    if (!Array.isArray(value.findIndex)) {
        errors.push({ path: "$" + ".findIndex", message: "expected array" });
    }
    if (typeof value.fill !== "object" || value.fill === null) {
        errors.push({ path: "$" + ".fill", message: "expected object" });
    }
    if (typeof value.copyWithin !== "object" || value.copyWithin === null) {
        errors.push({ path: "$" + ".copyWithin", message: "expected object" });
    }
    if (typeof value.entries !== "object" || value.entries === null) {
        errors.push({ path: "$" + ".entries", message: "expected object" });
    }
    if (typeof value.keys !== "object" || value.keys === null) {
        errors.push({ path: "$" + ".keys", message: "expected object" });
    }
    if (typeof value.values !== "object" || value.values === null) {
        errors.push({ path: "$" + ".values", message: "expected object" });
    }
    if (typeof value.includes !== "object" || value.includes === null) {
        errors.push({ path: "$" + ".includes", message: "expected object" });
    }
    if (!Array.isArray(value.flatMap)) {
        errors.push({ path: "$" + ".flatMap", message: "expected array" });
    }
    if (!Array.isArray(value.flat)) {
        errors.push({ path: "$" + ".flat", message: "expected array" });
    }
    if (typeof value.at !== "object" || value.at === null) {
        errors.push({ path: "$" + ".at", message: "expected object" });
    }
    if (!Array.isArray(value.findLast)) {
        errors.push({ path: "$" + ".findLast", message: "expected array" });
    }
    if (!Array.isArray(value.findLastIndex)) {
        errors.push({ path: "$" + ".findLastIndex", message: "expected array" });
    }
    if (!Array.isArray(value.toReversed)) {
        errors.push({ path: "$" + ".toReversed", message: "expected array" });
    }
    if (!Array.isArray(value.toSorted)) {
        errors.push({ path: "$" + ".toSorted", message: "expected array" });
    }
    if (!Array.isArray(value.toSpliced)) {
        errors.push({ path: "$" + ".toSpliced", message: "expected array" });
    }
    if (!Array.isArray(value.with)) {
        errors.push({ path: "$" + ".with", message: "expected array" });
    }
    if (typeof value.__)
     !== "object" || value.__;
     === null;
    {
        errors.push({ path: "$" + ".__@iterator@132", message: "expected object" });
    }
    if (typeof value.__)
     !== "object" || value.__;
     === null;
    {
        errors.push({ path: "$" + ".__@unscopables@134", message: "expected object" });
    }
    if (value.__)
    length !== undefined;
    {
        if (typeof value.__)
        length !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".length", message: "expected boolean" });
        }
    }
    if (value.__)
    toString !== undefined;
    {
        if (typeof value.__)
        toString !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".toString", message: "expected boolean" });
        }
    }
    if (value.__)
    toLocaleString !== undefined;
    {
        if (typeof value.__)
        toLocaleString !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".toLocaleString", message: "expected boolean" });
        }
    }
    if (value.__)
    pop !== undefined;
    {
        if (typeof value.__)
        pop !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".pop", message: "expected boolean" });
        }
    }
    if (value.__)
    push !== undefined;
    {
        if (typeof value.__)
        push !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".push", message: "expected boolean" });
        }
    }
    if (value.__)
    concat !== undefined;
    {
        if (typeof value.__)
        concat !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".concat", message: "expected boolean" });
        }
    }
    if (value.__)
    join !== undefined;
    {
        if (typeof value.__)
        join !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".join", message: "expected boolean" });
        }
    }
    if (value.__)
    reverse !== undefined;
    {
        if (typeof value.__)
        reverse !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".reverse", message: "expected boolean" });
        }
    }
    if (value.__)
    shift !== undefined;
    {
        if (typeof value.__)
        shift !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".shift", message: "expected boolean" });
        }
    }
    if (value.__)
    slice !== undefined;
    {
        if (typeof value.__)
        slice !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".slice", message: "expected boolean" });
        }
    }
    if (value.__)
    sort !== undefined;
    {
        if (typeof value.__)
        sort !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".sort", message: "expected boolean" });
        }
    }
    if (value.__)
    splice !== undefined;
    {
        if (typeof value.__)
        splice !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".splice", message: "expected boolean" });
        }
    }
    if (value.__)
    unshift !== undefined;
    {
        if (typeof value.__)
        unshift !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".unshift", message: "expected boolean" });
        }
    }
    if (value.__)
    indexOf !== undefined;
    {
        if (typeof value.__)
        indexOf !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".indexOf", message: "expected boolean" });
        }
    }
    if (value.__)
    lastIndexOf !== undefined;
    {
        if (typeof value.__)
        lastIndexOf !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".lastIndexOf", message: "expected boolean" });
        }
    }
    if (value.__)
    very !== undefined;
    {
        if (typeof value.__)
        very !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".every", message: "expected boolean" });
        }
    }
    if (value.__)
    some !== undefined;
    {
        if (typeof value.__)
        some !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".some", message: "expected boolean" });
        }
    }
    if (value.__)
    forEach !== undefined;
    {
        if (typeof value.__)
        forEach !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".forEach", message: "expected boolean" });
        }
    }
    if (value.__)
    map !== undefined;
    {
        if (typeof value.__)
        map !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".map", message: "expected boolean" });
        }
    }
    if (value.__)
    filter !== undefined;
    {
        if (typeof value.__)
        filter !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".filter", message: "expected boolean" });
        }
    }
    if (value.__)
    reduce !== undefined;
    {
        if (typeof value.__)
        reduce !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".reduce", message: "expected boolean" });
        }
    }
    if (value.__)
    reduceRight !== undefined;
    {
        if (typeof value.__)
        reduceRight !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".reduceRight", message: "expected boolean" });
        }
    }
    if (value.__)
    find !== undefined;
    {
        if (typeof value.__)
        find !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".find", message: "expected boolean" });
        }
    }
    if (value.__)
    findIndex !== undefined;
    {
        if (typeof value.__)
        findIndex !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".findIndex", message: "expected boolean" });
        }
    }
    if (value.__)
    fill !== undefined;
    {
        if (typeof value.__)
        fill !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".fill", message: "expected boolean" });
        }
    }
    if (value.__)
    copyWithin !== undefined;
    {
        if (typeof value.__)
        copyWithin !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".copyWithin", message: "expected boolean" });
        }
    }
    if (value.__)
    ntries !== undefined;
    {
        if (typeof value.__)
        ntries !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".entries", message: "expected boolean" });
        }
    }
    if (value.__)
    keys !== undefined;
    {
        if (typeof value.__)
        keys !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".keys", message: "expected boolean" });
        }
    }
    if (value.__)
    values !== undefined;
    {
        if (typeof value.__)
        values !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".values", message: "expected boolean" });
        }
    }
    if (value.__)
    includes !== undefined;
    {
        if (typeof value.__)
        includes !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".includes", message: "expected boolean" });
        }
    }
    if (value.__)
    flatMap !== undefined;
    {
        if (typeof value.__)
        flatMap !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".flatMap", message: "expected boolean" });
        }
    }
    if (value.__)
    flat !== undefined;
    {
        if (typeof value.__)
        flat !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".flat", message: "expected boolean" });
        }
    }
    if (value.__)
    at !== undefined;
    {
        if (typeof value.__)
        at !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".at", message: "expected boolean" });
        }
    }
    if (value.__)
    findLast !== undefined;
    {
        if (typeof value.__)
        findLast !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".findLast", message: "expected boolean" });
        }
    }
    if (value.__)
    findLastIndex !== undefined;
    {
        if (typeof value.__)
        findLastIndex !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".findLastIndex", message: "expected boolean" });
        }
    }
    if (value.__)
    toReversed !== undefined;
    {
        if (typeof value.__)
        toReversed !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".toReversed", message: "expected boolean" });
        }
    }
    if (value.__)
    toSorted !== undefined;
    {
        if (typeof value.__)
        toSorted !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".toSorted", message: "expected boolean" });
        }
    }
    if (value.__)
    toSpliced !== undefined;
    {
        if (typeof value.__)
        toSpliced !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".toSpliced", message: "expected boolean" });
        }
    }
    if (value.__)
    with ( !== undefined) {
        if (typeof value.__)
        with ( !== "boolean") {
            errors.push({ path: "$" + ".__@unscopables@134" + ".with", message: "expected boolean" });
        }
    }
    if (value.__)
     !== undefined;
    {
        if (typeof value.__)
         !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".__@iterator@132", message: "expected boolean" });
        }
    }
    if (value.__)
     !== undefined;
    {
        if (typeof value.__)
         !== "boolean";
        {
            errors.push({ path: "$" + ".__@unscopables@134" + ".__@unscopables@134", message: "expected boolean" });
        }
    }
    return errors.length === 0;
};
export const isDash = (value) => {
    const errors = [];
    if (typeof value !== "object" || value === null) {
        errors.push({ path: "$", message: "expected object" });
    }
    if (typeof value.first - name !== "string") {
        errors.push({ path: "$" + ".first-name", message: "expected string" });
    }
    return errors.length === 0;
};
