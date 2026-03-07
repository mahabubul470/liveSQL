import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: "doc",
      id: "intro",
      label: "Quickstart",
    },
    {
      type: "category",
      label: "Concepts",
      items: ["concepts/how-it-works"],
    },
    {
      type: "category",
      label: "API Reference",
      items: ["api/server", "api/client", "api/react", "api/vue", "api/svelte"],
    },
    {
      type: "category",
      label: "Guides",
      items: [
        "guides/integration-express-fastify",
        "guides/deployment",
        "guides/postgrest",
        "guides/migration-supabase",
        "guides/migration-firebase",
      ],
    },
  ],
};

export default sidebars;
