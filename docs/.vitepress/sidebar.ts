import type { DefaultTheme } from "vitepress";

/**
 * The docs sidebar — the single source of nav ORDER for the site.
 *
 * Extracted from `config.ts` (PEP-058 Wave 5) so that the llms.txt /
 * llms-full.txt generator (`./llms.ts`) walks exactly the same page order a
 * human sees in the sidebar, instead of maintaining a second, drifting list.
 */
export const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: "Introduction",
    items: [
      { text: "What is typesugar?", link: "/" },
      { text: "Zero-Cost, Seen", link: "/guides/zero-cost" },
      { text: "FAQ", link: "/faq" },
    ],
  },
  {
    text: "Getting Started",
    collapsed: false,
    items: [
      { text: "Overview", link: "/getting-started/" },
      { text: "App Developer", link: "/getting-started/app-developer" },
      { text: "End User", link: "/getting-started/end-user" },
      {
        text: "Extension Author",
        link: "/getting-started/extension-author",
      },
      { text: "Editor Setup", link: "/getting-started/editor-setup" },
      {
        text: "Troubleshooting",
        link: "/getting-started/troubleshooting",
      },
      {
        text: "Environments",
        collapsed: true,
        items: [
          { text: "Vite", link: "/getting-started/environments/vite" },
          {
            text: "esbuild",
            link: "/getting-started/environments/esbuild",
          },
          {
            text: "Webpack",
            link: "/getting-started/environments/webpack",
          },
          { text: "tsc", link: "/getting-started/environments/tsc" },
          { text: "Bun", link: "/getting-started/environments/bun" },
          {
            text: "Vitest",
            link: "/getting-started/environments/vitest",
          },
          { text: "Jest", link: "/getting-started/environments/jest" },
          {
            text: "Monorepo",
            link: "/getting-started/environments/monorepo",
          },
        ],
      },
    ],
  },
  {
    text: "Guides",
    collapsed: false,
    items: [
      { text: "Overview", link: "/guides/" },
      {
        text: "Standard Library",
        collapsed: false,
        items: [
          { text: "Extension Methods", link: "/guides/extension-methods" },
          // The comprehensive guide (fluent API, pattern catalogue,
          // exhaustiveness, extractors). `/guides/match` is the object-form
          // quickstart and is cross-linked from within it.
          { text: "Pattern Matching", link: "/guides/pattern-matching" },
          { text: "Pattern Matching (object form)", link: "/guides/match" },
          { text: "Do-Notation", link: "/guides/do-notation" },
          { text: "Standard Typeclasses", link: "/guides/std-typeclasses" },
        ],
      },
      {
        text: "Typeclasses & Derivation",
        collapsed: false,
        items: [
          { text: "Typeclasses", link: "/guides/typeclasses" },
          { text: "Derive Macros", link: "/guides/derive" },
          { text: "Specialization", link: "/guides/specialize" },
          { text: "Reflection", link: "/guides/reflect" },
        ],
      },
      {
        text: "Syntax Sugar",
        collapsed: false,
        items: [
          { text: "Operators", link: "/guides/operators" },
          { text: "Tagged Templates", link: "/guides/tagged-templates" },
          { text: "String Macros", link: "/guides/strings" },
          { text: "Compile-Time Eval", link: "/guides/comptime" },
          { text: "Conditional Compilation", link: "/guides/conditional-compilation" },
        ],
      },
      {
        text: "Type Safety & Contracts",
        collapsed: true,
        items: [
          { text: "Contracts", link: "/guides/contracts" },
          { text: "Refined Types", link: "/guides/contracts-refined" },
          { text: "Type System", link: "/guides/type-system" },
          { text: "Validation", link: "/guides/validate" },
          { text: "Units of Measure", link: "/guides/units" },
        ],
      },
      {
        text: "Data Structures & Algorithms",
        collapsed: true,
        items: [
          { text: "Functional Programming", link: "/guides/fp" },
          { text: "Type Erasure", link: "/guides/erased" },
          { text: "Loop Fusion", link: "/guides/fusion" },
          { text: "Parser Combinators", link: "/guides/parser" },
          { text: "Graph Algorithms", link: "/guides/graph" },
          { text: "Versioned Codecs", link: "/guides/codec" },
          { text: "Math", link: "/guides/math" },
          { text: "Object Mapping", link: "/guides/mapper" },
        ],
      },
      {
        text: "Ecosystem Integrations",
        collapsed: true,
        items: [
          { text: "Effect-TS", link: "/guides/effect" },
          { text: "SQL", link: "/guides/sql" },
        ],
      },
      {
        text: "Developer Experience",
        collapsed: true,
        items: [
          { text: "Overview", link: "/guides/developer-experience" },
          { text: "AI Assistants", link: "/guides/ai-assistants" },
          { text: "Type Safety (build/IDE/CI)", link: "/guides/type-safety" },
          { text: "JSDoc vs Decorators", link: "/guides/jsdoc-vs-decorators" },
          { text: "Error Messages", link: "/guides/error-messages" },
          { text: "Opt-Out Directives", link: "/guides/opt-out" },
          { text: "Testing", link: "/guides/testing" },
          { text: "Authoring Libraries", link: "/guides/authoring-libraries" },
          { text: "Library Manifest", link: "/guides/library-manifest" },
          { text: "Interactive Playground", link: "/guides/playground" },
        ],
      },
    ],
  },
  {
    text: "Writing Macros",
    collapsed: true,
    items: [
      { text: "Overview", link: "/writing-macros/" },
      {
        text: "Expression Macros",
        link: "/writing-macros/expression-macros",
      },
      {
        text: "Attribute Macros",
        link: "/writing-macros/attribute-macros",
      },
      { text: "Derive Macros", link: "/writing-macros/derive-macros" },
      {
        text: "Tagged Template Macros",
        link: "/writing-macros/tagged-template-macros",
      },
      { text: "Type Macros", link: "/writing-macros/type-macros" },
      {
        text: "Labeled Block Macros",
        link: "/writing-macros/labeled-block-macros",
      },
      { text: "Quasiquoting", link: "/writing-macros/quasiquoting" },
      { text: "Testing Macros", link: "/writing-macros/testing-macros" },
      {
        text: "Publishing Macros",
        link: "/writing-macros/publishing-macros",
      },
    ],
  },
  {
    text: "Reference",
    collapsed: true,
    items: [
      { text: "Overview", link: "/reference/" },
      { text: "MacroContext API", link: "/reference/macro-context" },
      { text: "Configuration", link: "/reference/config" },
      { text: "CLI", link: "/reference/cli" },
      { text: "Packages", link: "/reference/packages" },
    ],
  },
  {
    text: "Migration",
    collapsed: true,
    items: [
      { text: "From Effect", link: "/migration/from-effect" },
      { text: "From Zod", link: "/migration/from-zod" },
      { text: "From ts-macros", link: "/migration/from-ts-macros" },
    ],
  },
  {
    text: "Architecture",
    collapsed: true,
    items: [{ text: "How it Works", link: "/architecture" }],
  },
  {
    text: "Error Reference",
    collapsed: true,
    items: [{ text: "Error Codes", link: "/errors/" }],
  },
];
