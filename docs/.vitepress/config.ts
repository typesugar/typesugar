import { defineConfig } from "vitepress";
import { sidebar } from "./sidebar.js";
import { generateLlmsTxt } from "./llms.js";

export default defineConfig({
  title: "typesugar",
  description: "Syntactic sugar for TypeScript with zero calories",

  sitemap: { hostname: "https://typesugar.org" },

  // Emit llms.txt / llms-full.txt into the build output (PEP-058 Wave 5), so
  // they deploy with the site and stay in lockstep with the docs they describe.
  buildEnd(siteConfig) {
    generateLlmsTxt(siteConfig.srcDir, siteConfig.outDir);
  },

  vite: {
    ssr: {
      // These packages use Node-only APIs (fs, path) transitively via
      // typescript or macro infrastructure.  Exclude them from SSR so
      // vitepress doesn't try to bundle them for the server side.
      noExternal: [],
      external: [
        "typescript",
        "@typesugar/core",
        "@typesugar/macros",
        "@typesugar/transformer",
        "@typesugar/transformer-core",
      ],
    },
  },

  head: [
    ["link", { rel: "icon", type: "image/png", href: "/logo.png" }],
    // Machine-readable docs for AI assistants (llmstxt.org).
    [
      "link",
      {
        rel: "alternate",
        type: "text/plain",
        href: "/llms.txt",
        title: "typesugar documentation for LLMs",
      },
    ],
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
      { text: "Playground", link: "/playground" },
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
              { text: "@typesugar/reflect", link: "/reference/packages#reflect" },
            ],
          },
          {
            text: "Syntax Sugar",
            items: [{ text: "@typesugar/strings", link: "/reference/packages#strings" }],
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
              { text: "@typesugar/parser", link: "/reference/packages#parser" },
              { text: "@typesugar/fusion", link: "/reference/packages#fusion" },
              { text: "@typesugar/graph", link: "/reference/packages#graph" },
            ],
          },
          {
            text: "Ecosystem Integrations",
            items: [
              { text: "@typesugar/effect", link: "/reference/packages#effect" },
              { text: "@typesugar/sql", link: "/reference/packages#sql" },
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

    // Defined in ./sidebar.ts — shared with the llms.txt generator so the
    // machine-readable corpus walks the same page order humans see.
    sidebar: { "/": sidebar },

    socialLinks: [{ icon: "github", link: "https://github.com/typesugar/typesugar" }],

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/typesugar/typesugar/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    footer: {
      message:
        'Released under the MIT License. · <a href="/llms.txt">llms.txt</a> · <a href="/llms-full.txt">llms-full.txt</a>',
      copyright: "Copyright © 2024-present",
    },
  },

  ignoreDeadLinks: true,
  cleanUrls: true,

  markdown: {
    theme: {
      light: "github-light",
      dark: "github-dark",
    },
    lineNumbers: true,
  },
});
