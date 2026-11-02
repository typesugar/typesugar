// unrelated module with its own Some/None
const None = { kind: "none" } as const;
function Some(x: number) { return { kind: "some", x }; }
export const a = Some(1);
export const b = None;
