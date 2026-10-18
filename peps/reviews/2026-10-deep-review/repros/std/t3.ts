import { regex, html, fmt, raw } from "@typesugar/strings";
const r1 = regex`^\d+\.\w$`;
const user = "<b>";
const h = html`<a title='${user}'>${user}</a>`;
const f1 = fmt`${-1.5}%d done %d`;
const f2 = fmt`100%d`;
const rw = raw`C:\Users\${user}`;
