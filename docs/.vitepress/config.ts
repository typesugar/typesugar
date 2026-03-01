import { defineConfig } from "vitepress";

export default defineConfig({
  title: "typesugar",
  description: "Syntactic sugar for TypeScript with zero calories",

  head: [
    ["link", { rel: "icon", type: "image/png", href: "/logo.png" }],
    ["meta", { name: "theme-color", content: "#8b5cf6" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "typesugar" }],
    [
      "meta",
      {
        property: "og:description",
        content: "Syntactic sugar for TypeScript with zero calories",
      },
    ],
  ],

  themeConfig: {
    logo: { src: "/logo.png", alt: "typesugar" },

    nav: [
      { text: "Guide", link: "/getting-started/" },
      { text: "Reference", link: "/reference/" },
      { text: "Writing Macros", link: "/writing-macros/" },
      {
        text: "Packages",
        items: [
          {
            text: "Build Infrastructure",
            items: [
              { text: "typesugar", link: "/reference/packages#typesugar" },
              { text: "@typesugar/transformer", link: "/reference/packages#transformer" },
              { text: "@typesugar/core", link: "/reference/packages#core" },
              { text: "unplugin-typesugar", link: "/reference/packages#unplugin" },
            ],
          },
          {
            text: "Standard Library",
            items: [{ text: "@typesugar/std", link: "/reference/packages#std" }],
          },
          {
            text: "Typeclasses & Derivation",
            items: [
              { text: "@typesugar/typeclass", link: "/reference/packages#typeclass" },
              { text: "@typesugar/derive", link: "/reference/packages#derive" },
              { text: "@typesugar/specialize", link: "/reference/packages#specialize" },
              { text: "@typesugar/reflect", link: "/reference/packages#reflect" },
            ],
          },
          {
            text: "Syntax Sugar",
            items: [
              { text: "@typesugar/strings", link: "/reference/packages#strings" },
              { text: "@typesugar/comptime", link: "/reference/packages#comptime" },
            ],
          },
          {
            text: "Type Safety & Contracts",
            items: [
              { text: "@typesugar/type-system", link: "/reference/packages#type-system" },
              { text: "@typesugar/contracts", link: "/reference/packages#contracts" },
              { text: "@typesugar/validate", link: "/reference/packages#validate" },
              { text: "@typesugar/units", link: "/reference/packages#units" },
            ],
          },
          {
            text: "Data Structures & Algorithms",
            items: [
              { text: "@typesugar/fp", link: "/reference/packages#fp" },
              { text: "@typesugar/hlist", link: "/reference/packages#hlist" },
              { text: "@typesugar/parser", link: "/reference/packages#parser" },
              { text: "@typesugar/fusion", link: "/reference/packages#fusion" },
              { text: "@typesugar/graph", link: "/reference/packages#graph" },
            ],
          },
          {
            text: "Ecosystem Integrations",
            items: [
              { text: "@typesugar/effect", link: "/reference/packages#effect" },
              { text: "@typesugar/react", link: "/reference/packages#react" },
            ],
          },
          {
            text: "Developer Experience",
            items: [
              { text: "@typesugar/vscode", link: "/reference/packages#vscode" },
              { text: "@typesugar/eslint-plugin", link: "/reference/packages#eslint-plugin" },
              { text: "@typesugar/testing", link: "/reference/packages#testing" },
            ],
          },
          {
            text: "",
            items: [{ text: "View all packages →", link: "/reference/packages" }],
          },
        ],
      },
    ],

    sidebar: {
      "/": [
        {
          text: "Introduction",
          items: [
            { text: "What is typesugar?", link: "/" },
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
                { text: "Pattern Matching", link: "/guides/match" },
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
                { text: "HList", link: "/guides/hlist" },
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
                { text: "React", link: "/guides/react" },
                { text: "SQL", link: "/guides/sql" },
              ],
            },
            {
              text: "Developer Experience",
              collapsed: true,
              items: [
                { text: "Overview", link: "/guides/developer-experience" },
                { text: "Error Messages", link: "/guides/error-messages" },
                { text: "Opt-Out Directives", link: "/guides/opt-out" },
                { text: "Testing", link: "/guides/testing" },
                { text: "Library Manifest", link: "/guides/library-manifest" },
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
      ],
    },

    socialLinks: [{ icon: "github", link: "https://github.com/typesugar/typesugar" }],

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/typesugar/typesugar/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2024-present",
    },
  },

  ignoreDeadLinks: true,

  markdown: {
    theme: {
      light: "github-light",
      dark: "github-dark",
    },
    lineNumbers: true,
  },
});
