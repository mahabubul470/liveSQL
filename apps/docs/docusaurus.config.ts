import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "LiveSQL",
  tagline: "Stream SQL database changes to the browser in real time",
  favicon: "img/favicon.ico",

  url: "https://livesql.dev",
  baseUrl: "/",

  organizationName: "mahabubul470",
  projectName: "liveSQL",

  onBrokenLinks: "throw",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          routeBasePath: "/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: "light",
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "LiveSQL",
      items: [
        {
          type: "docSidebar",
          sidebarId: "docs",
          position: "left",
          label: "Docs",
        },
        {
          href: "https://github.com/mahabubul470/liveSQL",
          label: "GitHub",
          position: "right",
        },
        {
          href: "https://www.npmjs.com/search?q=%40livesql",
          label: "npm",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Quickstart", to: "/" },
            { label: "How Sync Works", to: "/concepts/how-it-works" },
            { label: "Server API", to: "/api/server" },
            { label: "React Hooks", to: "/api/react" },
          ],
        },
        {
          title: "Packages",
          items: [
            {
              label: "@livesql/server",
              href: "https://www.npmjs.com/package/@livesql/server",
            },
            {
              label: "@livesql/client",
              href: "https://www.npmjs.com/package/@livesql/client",
            },
            {
              label: "@livesql/react",
              href: "https://www.npmjs.com/package/@livesql/react",
            },
          ],
        },
        {
          title: "Community",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/mahabubul470/liveSQL",
            },
            {
              label: "Issues",
              href: "https://github.com/mahabubul470/liveSQL/issues",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} LiveSQL Contributors. Apache 2.0.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "sql", "json"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
