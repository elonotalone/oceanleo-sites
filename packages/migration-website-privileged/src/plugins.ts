import {
  definePluginBatch,
  type PluginRouteDeclaration,
} from "@oceanleo/plugin-runtime";

import {
  WEBSITE_HANDLER_DESCRIPTORS,
  websiteHandlerCapability,
  websitePluginPattern,
} from "./handlers";
import {
  WEBSITE_WORKSPACE_PARITY_EVIDENCE,
  websiteWorkspaceHandler,
} from "./workspace";

const handlerRoutes = WEBSITE_HANDLER_DESCRIPTORS.map(
  (descriptor, index): PluginRouteDeclaration => ({
    id: `website.handler.${String(index + 1).padStart(2, "0")}`,
    kind: descriptor.route.endsWith("/stream") ? "stream" : "api",
    surface: "api",
    pattern: websitePluginPattern(descriptor.route),
    methods: descriptor.methods,
    capability: websiteHandlerCapability(descriptor.route),
    parity: descriptor.parity,
    handler: descriptor.handler,
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
          id: "website.workspace",
          kind: "page",
          surface: "page",
          pattern: "/workspace/:path*",
          methods: ["GET", "HEAD"],
          capability: "website:source-edit",
          parity: {
            status: "verified",
            source: "website:front/app/workspace/page.tsx",
            evidence: WEBSITE_WORKSPACE_PARITY_EVIDENCE,
          },
          handler: websiteWorkspaceHandler(),
        },
        ...handlerRoutes,
      ],
    },
  ],
});
