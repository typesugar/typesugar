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
 */
const GROUP_META: Record<string, { label: string; order: number }> = {
  "getting-started": { label: "Getting Started", order: 0 },
  core: { label: "Core Macros", order: 10 },
  fp: { label: "@typesugar/fp", order: 20 },
  effect: { label: "@typesugar/effect", order: 25 },
  std: { label: "@typesugar/std", order: 30 },
  collections: { label: "@typesugar/collections", order: 40 },
  graph: { label: "@typesugar/graph", order: 45 },
  units: { label: "@typesugar/units", order: 50 },
  math: { label: "@typesugar/math", order: 55 },
  validate: { label: "@typesugar/validate", order: 60 },
  contracts: { label: "@typesugar/contracts", order: 65 },
  codec: { label: "@typesugar/codec", order: 70 },
  parser: { label: "@typesugar/parser", order: 75 },
  sql: { label: "@typesugar/sql", order: 80 },
  symbolic: { label: "@typesugar/symbolic", order: 82 },
  mapper: { label: "@typesugar/mapper", order: 84 },
  testing: { label: "@typesugar/testing", order: 86 },
  preprocessor: { label: "Preprocessor (.sts)", order: 90 },
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

export const EXAMPLE_GROUPS: ExampleGroup[] = (() => {
  const groupMap = new Map<string, ExamplePreset[]>();

  for (const [path, raw] of Object.entries(rawFiles)) {
    const parsed = parseExample(path, raw);
    if (!parsed) continue;

    let presets = groupMap.get(parsed.group);
    if (!presets) {
      presets = [];
      groupMap.set(parsed.group, presets);
    }
    presets.push(parsed.preset);
  }

  // Sort presets alphabetically within each group
  for (const presets of groupMap.values()) {
    presets.sort((a, b) => a.name.localeCompare(b.name));
  }

  return Array.from(groupMap.entries())
    .map(([key, presets]) => ({
      label: GROUP_META[key]?.label ?? key,
      order: GROUP_META[key]?.order ?? 50,
      presets,
    }))
    .sort((a, b) => a.order - b.order)
    .map(({ label, presets }) => ({ label, presets }));
})();

/** The default code shown when the playground first loads. */
export const DEFAULT_CODE = EXAMPLE_GROUPS[0]?.presets[0]?.code ?? "// Welcome to typesugar!\n";
