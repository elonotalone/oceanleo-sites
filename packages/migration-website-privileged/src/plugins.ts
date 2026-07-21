import {
  definePluginBatch,
  type PluginRouteDeclaration,
} from "@oceanleo/plugin-runtime";

import {
  WEBSITE_HANDLER_PATHS,
  websiteHandlerCapability,
  websitePluginPattern,
} from "./handlers";

const handlerRoutes = WEBSITE_HANDLER_PATHS.map(
  (route, index): PluginRouteDeclaration => ({
    id: `website.handler.${String(index + 1).padStart(2, "0")}`,
    kind: route.endsWith("/stream") ? "stream" : "api",
    surface: "api",
    pattern: websitePluginPattern(route),
    methods: ["*"],
    capability: websiteHandlerCapability(route),
    parity: {
      status: "pending",
      source: `website:front/app${route}/route.ts`,
      evidence: [],
    },
  }),
);

export const WEBSITE_PRIVILEGED_PLUGIN_BATCH = definePluginBatch({
  id: "website-privileged",
  migrationBatch: 6,
  profile: "website-privileged",
  ownerPath: "packages/migration-website-privileged",
  plugins: [
    {
      id: "website-source-workbench",
      siteKey: "website",
      routes: [
        {
          id: "website.workspace.pending",
          kind: "page",
          surface: "page",
          pattern: "/workspace/:path*",
          methods: ["GET", "HEAD"],
          capability: "website:source-edit",
          parity: {
            status: "pending",
            source: "website:front/app/workspace",
            evidence: [],
          },
        },
        ...handlerRoutes,
      ],
    },
  ],
});
