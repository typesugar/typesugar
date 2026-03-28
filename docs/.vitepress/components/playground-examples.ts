import { ref } from "vue";

export interface ExamplePreset {
  name: string;
  description: string;
  fileType: ".ts" | ".sts";
  code: string;
}

export interface ExampleGroup {
  label: string;
  presets: ExamplePreset[];
}

/**
 * Group display names and sort order.
 * Add a new entry here when creating a new example directory.
 * Groups without entries here still appear — keyed by directory name.
 * Order: most compelling/visual categories first.
 */
const GROUP_META: Record<string, { label: string; order: number }> = {
  "getting-started": { label: "Getting Started", order: 0 },
  core: { label: "Core Macros", order: 10 },
  fp: { label: "@typesugar/fp", order: 20 },
  std: { label: "@typesugar/std", order: 25 },
  preprocessor: { label: "Preprocessor (.sts)", order: 28 },
  effect: { label: "@typesugar/effect", order: 30 },
  collections: { label: "@typesugar/collections", order: 35 },
  graph: { label: "@typesugar/graph", order: 40 },
  contracts: { label: "@typesugar/contracts", order: 45 },
  units: { label: "@typesugar/units", order: 50 },
  math: { label: "@typesugar/math", order: 55 },
  symbolic: { label: "@typesugar/symbolic", order: 60 },
  codec: { label: "@typesugar/codec", order: 65 },
  parser: { label: "@typesugar/parser", order: 70 },
  validate: { label: "@typesugar/validate", order: 75 },
  testing: { label: "@typesugar/testing", order: 80 },
};

/**
 * Within-group sort priority. Lower number = shown first.
 * Examples not listed here sort alphabetically after prioritized ones.
 */
const EXAMPLE_ORDER: Record<string, Record<string, number>> = {
  "getting-started": {
    "Welcome to typesugar": 0,
    "Full Stack — Everything Together": 10,
  },
  core: {
    "@derive": 0,
    "Operator Overloading": 5,
    comptime: 10,
    "@typeclass": 15,
    specialize: 20,
    "cfg() — Dead Code Elimination": 25,
    "pipe & compose": 30,
    "Extension Methods": 35,
    "@tailrec": 40,
    "reflect & typeInfo": 45,
    "staticAssert + comptime": 50,
  },
  fp: {
    "Option — Zero-Cost": 0,
    "Either — Typed Errors": 5,
    "Error Accumulation": 10,
    "Persistent Linked List": 20,
  },
  std: {
    "Pattern Matching": 0,
    "Do-Notation": 10,
    "Ranges & Iteration": 20,
  },
  effect: {
    "Service & Layer": 0,
    "Do-Comprehensions (Effect)": 10,
  },
  preprocessor: {
    "Pipeline Operator": 0,
    "Cons Operator ::": 10,
  },
};

const rawFiles = import.meta.glob("../../examples/**/*.{ts,sts}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Parse `//!` metadata from the top of an example file.
 *
 * Format:
 *   //! Example Name
 *   //! Short description
 *   <blank line>
 *   <code>
 */
function parseExample(path: string, raw: string): { group: string; preset: ExamplePreset } | null {
  const match = path.match(/\/examples\/([^/]+)\/.+\.(ts|sts)$/);
  if (!match) return null;

  const [, group, ext] = match;
  const fileType = `.${ext}` as ".ts" | ".sts";

  const lines = raw.split("\n");
  let name = "";
  let description = "";
  let codeStart = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("//! ")) {
      if (!name) name = lines[i].slice(4).trim();
      else if (!description) description = lines[i].slice(4).trim();
      codeStart = i + 1;
    } else {
      break;
    }
  }

  // Skip blank lines between metadata and code
  while (codeStart < lines.length && lines[codeStart].trim() === "") codeStart++;

  const code = lines.slice(codeStart).join("\n");
  return { group, preset: { name: name || path, description, fileType, code } };
}

function buildGroups(files: Record<string, string>): ExampleGroup[] {
  const groupMap = new Map<string, ExamplePreset[]>();

  for (const [path, raw] of Object.entries(files)) {
    const parsed = parseExample(path, raw);
    if (!parsed) continue;

    let presets = groupMap.get(parsed.group);
    if (!presets) {
      presets = [];
      groupMap.set(parsed.group, presets);
    }
    presets.push(parsed.preset);
  }

  // Sort presets by impact within each group (fallback: alphabetical)
  for (const [group, presets] of groupMap.entries()) {
    const order = EXAMPLE_ORDER[group];
    presets.sort((a, b) => {
      const oa = order?.[a.name] ?? 1000;
      const ob = order?.[b.name] ?? 1000;
      if (oa !== ob) return oa - ob;
      return a.name.localeCompare(b.name);
    });
  }

  return Array.from(groupMap.entries())
    .map(([key, presets]) => ({
      label: GROUP_META[key]?.label ?? key,
      order: GROUP_META[key]?.order ?? 50,
      presets,
    }))
    .sort((a, b) => a.order - b.order)
    .map(({ label, presets }) => ({ label, presets }));
}

/** Reactive example groups — updated via HMR when example files change. */
export const EXAMPLE_GROUPS = ref<ExampleGroup[]>(buildGroups(rawFiles));

/** The default code shown when the playground first loads. */
export const DEFAULT_CODE =
  EXAMPLE_GROUPS.value[0]?.presets[0]?.code ?? "// Welcome to typesugar!\n";

// HMR: when example files change, Vite invalidates this module's eager
// glob imports and re-executes it. Accepting here lets the new
// EXAMPLE_GROUPS ref propagate to the component without a full reload.
if (import.meta.hot) {
  import.meta.hot.accept();
}
