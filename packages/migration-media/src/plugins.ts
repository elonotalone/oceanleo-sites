import {
  definePluginBatch,
  type PluginRouteDeclaration,
} from "@oceanleo/plugin-runtime";

import {
  createDirectUploadHandler,
  createFetchImageHandler,
} from "./gateway";
import { createMediaPageHandler } from "./handlers";
import { videoCanvasHandler } from "./video-canvas";

const TEST_EVIDENCE = "packages/migration-media/tests/media.test.ts";
const GATEWAY_EVIDENCE = "packages/migration-media/tests/gateway.test.ts";
const CANVAS_EVIDENCE = "packages/migration-media/tests/video-canvas.test.ts";
const AIHUMAN_FEATURE_SLUGS = [
  "ai-script",
  "smart-edit",
  "photo-talk",
  "batch-gen",
  "script-mimic",
] as const;
const INTERIOR_TOOL_SLUGS = [
  "redesign",
  "lookbook",
  "concept",
  "model",
  "decorate",
  "remove-object",
  "cutout",
  "material",
] as const;

function workspaceRoute(input: Readonly<{
  siteKey: string;
  title: string;
  summary: string;
  source: string;
}>): PluginRouteDeclaration {
  return {
    id: `${input.siteKey}.workspace`,
    kind: "page",
    surface: "page",
    pattern: "/workspace/:path*",
    methods: ["GET", "HEAD"],
    capability: "workbench:advanced",
    parity: {
      status: "verified",
      source: input.source,
      evidence: [TEST_EVIDENCE],
    },
    handler: createMediaPageHandler({
      title: input.title,
      summary: input.summary,
      workspaceHref: "/workspace",
    }),
  };
}

function pageRoute(input: Readonly<{
  id: string;
  pattern: `/${string}`;
  title: string;
  summary: string;
  workspaceHref: `/${string}`;
  source: string;
}>): PluginRouteDeclaration {
  return {
    id: input.id,
    kind: "page",
    surface: "page",
    pattern: input.pattern,
    methods: ["GET", "HEAD"],
    capability: "workbench:advanced",
    parity: {
      status: "verified",
      source: input.source,
      evidence: [TEST_EVIDENCE],
    },
    handler: createMediaPageHandler({
      title: input.title,
      summary: input.summary,
      workspaceHref: input.workspaceHref,
    }),
  };
}

function legacyRedirect(input: Readonly<{
  id: string;
  pattern: `/${string}`;
  destination: `/${string}`;
  source: string;
}>): PluginRouteDeclaration {
  return {
    id: input.id,
    kind: "redirect",
    surface: "page",
    pattern: input.pattern,
    methods: ["GET", "HEAD"],
    capability: "shell:render",
    parity: {
      status: "verified",
      source: input.source,
      evidence: [TEST_EVIDENCE],
    },
    redirect: {
      protocol: "https",
      host: canonicalHostForRouteId(input.id),
      path: { mode: "fixed", value: input.destination },
      status: 307,
    },
  };
}

function canonicalHostForRouteId(routeId: string): string {
  if (routeId.startsWith("aihuman.")) return "aihuman.oceanleo.com";
  if (routeId.startsWith("image.")) return "image.oceanleo.com";
  if (routeId.startsWith("video.")) return "video.oceanleo.com";
  if (routeId.startsWith("logo.")) return "logo.oceanleo.com";
  if (routeId.startsWith("interior.")) return "interior.oceanleo.com";
  if (routeId.startsWith("threed.")) return "3d.oceanleo.com";
  throw new Error(`Unknown media route owner: ${routeId}`);
}

function aliasRedirect(input: Readonly<{
  siteKey: string;
  sourceHost: string;
  destinationHost: string;
}>): PluginRouteDeclaration {
  return {
    id: `${input.siteKey}.alias.${input.sourceHost.replaceAll(".", "-")}`,
    kind: "redirect",
    surface: "both",
    pattern: "/:path*",
    methods: ["*"],
    hosts: [input.sourceHost],
    capability: "shell:render",
    priority: 100,
    parity: {
      status: "verified",
      source: `tenant-registry:${input.siteKey}:domain-alias`,
      evidence: [TEST_EVIDENCE],
    },
    redirect: {
      protocol: "https",
      host: input.destinationHost,
      path: { mode: "preserve" },
      status: 308,
    },
  };
}

function apiRoute(input: Readonly<{
  id: string;
  pattern: `/${string}`;
  methods: PluginRouteDeclaration["methods"];
  capability: PluginRouteDeclaration["capability"];
  source: string;
  handler: NonNullable<PluginRouteDeclaration["handler"]>;
  evidence?: readonly string[];
}>): PluginRouteDeclaration {
  return {
    id: input.id,
    kind: "api",
    surface: "api",
    pattern: input.pattern,
    methods: input.methods,
    capability: input.capability,
    parity: {
      status: "verified",
      source: input.source,
      evidence: input.evidence ?? [GATEWAY_EVIDENCE, TEST_EVIDENCE],
    },
    handler: input.handler,
  };
}

export const MEDIA_PLUGIN_BATCH = definePluginBatch({
  id: "media",
  migrationBatch: 2,
  profile: "standard",
  ownerPath: "packages/migration-media",
  plugins: [
    {
      siteKey: "aihuman",
      id: "digital-human-studio",
      routes: [
        workspaceRoute({
          siteKey: "aihuman",
          title: "Digital human studio",
          summary:
            "The digital-human catalog and workspace route are registered for progressive migration.",
          source: "aihuman-studio:frontend/app/workspace/page.tsx",
        }),
        legacyRedirect({
          id: "aihuman.create",
          pattern: "/create",
          destination: "/workspace?fn=create",
          source: "aihuman-studio:frontend/app/create/page.tsx",
        }),
        legacyRedirect({
          id: "aihuman.quick",
          pattern: "/quick",
          destination: "/workspace?fn=quick",
          source: "aihuman-studio:frontend/app/quick/page.tsx",
        }),
        legacyRedirect({
          id: "aihuman.doc2video",
          pattern: "/doc2video",
          destination: "/workspace?fn=doc2video",
          source: "aihuman-studio:frontend/app/doc2video/page.tsx",
        }),
        legacyRedirect({
          id: "aihuman.customize",
          pattern: "/customize",
          destination: "/workspace?fn=customize",
          source: "aihuman-studio:frontend/app/customize/page.tsx",
        }),
        ...["avatars", "voices", "scenes", "templates", "works"].map(
          (path): PluginRouteDeclaration =>
            legacyRedirect({
              id: `aihuman.${path}`,
              pattern: `/${path}`,
              destination: "/workspace?fn=create",
              source: `aihuman-studio:frontend/app/${path}/page.tsx`,
            }),
        ),
        ...AIHUMAN_FEATURE_SLUGS.map(
          (slug): PluginRouteDeclaration =>
            legacyRedirect({
              id: `aihuman.feature-${slug}`,
              pattern: `/feature/${slug}`,
              destination: `/workspace?fn=${slug}`,
              source:
                "aihuman-studio:frontend/app/feature/[slug]/page.tsx",
            }),
        ),
        apiRoute({
          id: "aihuman.upload",
          pattern: "/api/upload",
          methods: ["POST"],
          capability: "artifact:write",
          source: "aihuman-studio:frontend/app/api/upload/route.ts",
          handler: createDirectUploadHandler({
            siteId: "aihuman",
            mediaKind: "image",
            maxBytes: 12 * 1024 * 1024,
            maxBytesLabel: "12MB",
            registerAsset: false,
          }),
        }),
      ],
    },
    {
      siteKey: "image",
      id: "image-workbench",
      routes: [
        aliasRedirect({
          siteKey: "image",
          sourceHost: "myselfie.oceanleo.com",
          destinationHost: "image.oceanleo.com",
        }),
        aliasRedirect({
          siteKey: "image",
          sourceHost: "remove.oceanleo.com",
          destinationHost: "image.oceanleo.com",
        }),
        workspaceRoute({
          siteKey: "image",
          title: "Image generation and editing workbench",
          summary:
            "Image generation, background removal, selfie, and scene functions share this canonical workspace.",
          source: "image:app/workspace/page.tsx",
        }),
        legacyRedirect({
          id: "image.cutout",
          pattern: "/cutout",
          destination: "/workspace?fn=cutout",
          source: "image:app/cutout/page.tsx",
        }),
        legacyRedirect({
          id: "image.cutout-scenes",
          pattern: "/cutout/scenes",
          destination: "/workspace?fn=cutout",
          source: "image:app/cutout/scenes/page.tsx",
        }),
        legacyRedirect({
          id: "image.selfie",
          pattern: "/selfie",
          destination: "/workspace?fn=selfie",
          source: "image:app/selfie/page.tsx",
        }),
        legacyRedirect({
          id: "image.selfie-styles",
          pattern: "/selfie/styles",
          destination: "/workspace?fn=selfie",
          source: "image:app/selfie/styles/page.tsx",
        }),
        legacyRedirect({
          id: "image.lora",
          pattern: "/lora",
          destination: "/workspace?fn=selfie",
          source: "image:app/lora/page.tsx",
        }),
        legacyRedirect({
          id: "image.scenes",
          pattern: "/scenes",
          destination: "/workspace?fn=studio",
          source: "image:app/scenes/page.tsx",
        }),
        apiRoute({
          id: "image.fetch-image",
          pattern: "/api/fetch-image",
          methods: ["GET"],
          capability: "artifact:read",
          source: "image:app/api/fetch-image/route.ts",
          handler: createFetchImageHandler({ attachment: false }),
        }),
        apiRoute({
          id: "image.upload",
          pattern: "/api/upload",
          methods: ["POST"],
          capability: "artifact:write",
          source: "image:app/api/upload/route.ts",
          handler: createDirectUploadHandler({
            siteId: "image",
            mediaKind: "image",
            maxBytes: 12 * 1024 * 1024,
            maxBytesLabel: "12MB",
            registerAsset: false,
          }),
        }),
      ],
    },
    {
      siteKey: "video",
      id: "video-canvas",
      routes: [
        aliasRedirect({
          siteKey: "video",
          sourceHost: "studio.oceanleo.com",
          destinationHost: "video.oceanleo.com",
        }),
        workspaceRoute({
          siteKey: "video",
          title: "Video generation workbench",
          summary:
            "Video generation, prompt workflows, and canvas workflows share this canonical workspace.",
          source: "video:app/workspace/page.tsx",
        }),
        legacyRedirect({
          id: "video.canvas",
          pattern: "/canvas",
          destination: "/workspace?fn=canvas",
          source: "video:app/canvas/page.tsx",
        }),
        legacyRedirect({
          id: "video.workflows",
          pattern: "/workflows",
          destination: "/workspace?fn=workflows",
          source: "video:app/workflows/page.tsx",
        }),
        legacyRedirect({
          id: "video.studio",
          pattern: "/studio",
          destination: "/studio-editor",
          source: "video:app/studio/page.tsx",
        }),
        pageRoute({
          id: "video.canvas-board",
          pattern: "/canvas-board",
          title: "Video node canvas",
          summary:
            "The node-canvas editor route is registered independently from the canonical video workbench.",
          workspaceHref: "/workspace?fn=canvas",
          source: "video:app/canvas-board/page.tsx",
        }),
        pageRoute({
          id: "video.studio-editor",
          pattern: "/studio-editor",
          title: "Video timeline editor",
          summary:
            "The timeline editing route is registered as the specialized video-canvas editor surface.",
          workspaceHref: "/studio-editor",
          source: "video:app/studio-editor/page.tsx",
        }),
        apiRoute({
          id: "video.canvas-api",
          pattern: "/api/canvas",
          methods: ["POST"],
          capability: "artifact:write",
          source: "video:app/api/canvas/route.ts",
          handler: videoCanvasHandler,
          evidence: [CANVAS_EVIDENCE, GATEWAY_EVIDENCE, TEST_EVIDENCE],
        }),
        apiRoute({
          id: "video.upload",
          pattern: "/api/upload",
          methods: ["POST"],
          capability: "artifact:write",
          source: "video:app/api/upload/route.ts",
          handler: createDirectUploadHandler({
            siteId: "video",
            mediaKind: "image",
            maxBytes: 12 * 1024 * 1024,
            maxBytesLabel: "12MB",
            registerAsset: false,
          }),
        }),
        apiRoute({
          id: "video.upload-video",
          pattern: "/api/upload-video",
          methods: ["POST"],
          capability: "artifact:write",
          source: "video:app/api/upload-video/route.ts",
          handler: createDirectUploadHandler({
            siteId: "video",
            mediaKind: "video",
            maxBytes: 300 * 1024 * 1024,
            maxBytesLabel: "300MB",
            registerAsset: false,
            title: "剪辑成片",
          }),
        }),
      ],
    },
    {
      siteKey: "logo",
      id: "logo-workbench",
      routes: [
        workspaceRoute({
          siteKey: "logo",
          title: "Logo workbench",
          summary:
            "Logo creation, icon generation, and naming modes share this canonical workspace.",
          source: "logo:app/workspace/page.tsx",
        }),
        ...(["create", "icon", "naming"] as const).map(
          (mode): PluginRouteDeclaration =>
            legacyRedirect({
              id: `logo.${mode}`,
              pattern: `/${mode}`,
              destination: `/workspace?mode=${mode}`,
              source: `logo:app/${mode}/page.tsx`,
            }),
        ),
        apiRoute({
          id: "logo.fetch-image",
          pattern: "/api/fetch-image",
          methods: ["GET"],
          capability: "artifact:read",
          source: "logo:app/api/fetch-image/route.ts",
          handler: createFetchImageHandler({ attachment: true }),
        }),
      ],
    },
    {
      siteKey: "interior",
      id: "interior-workbench",
      routes: [
        workspaceRoute({
          siteKey: "interior",
          title: "Interior design workbench",
          summary:
            "Room redesign, inspiration, style, and tool modes share this canonical workspace.",
          source: "interior:app/workspace/page.tsx",
        }),
        ...["inspiration", "styles", "tools"].map(
          (path): PluginRouteDeclaration =>
            legacyRedirect({
              id: `interior.${path}`,
              pattern: `/${path}`,
              destination: "/workspace?fn=redesign",
              source: `interior:app/${path}/page.tsx`,
            }),
        ),
        ...INTERIOR_TOOL_SLUGS.map(
          (slug): PluginRouteDeclaration =>
            legacyRedirect({
              id: `interior.tool-${slug}`,
              pattern: `/tools/${slug}`,
              destination: `/workspace?fn=${slug}`,
              source: "interior:app/tools/[slug]/page.tsx",
            }),
        ),
        legacyRedirect({
          id: "interior.tool-fallback",
          pattern: "/tools/:slug",
          destination: "/workspace?fn=redesign",
          source: "interior:app/tools/[slug]/page.tsx",
        }),
        apiRoute({
          id: "interior.upload",
          pattern: "/api/upload",
          methods: ["POST"],
          capability: "artifact:write",
          source: "interior:app/api/upload/route.ts",
          handler: createDirectUploadHandler({
            siteId: "interior",
            mediaKind: "image",
            maxBytes: 12 * 1024 * 1024,
            maxBytesLabel: "12MB",
            registerAsset: false,
          }),
        }),
      ],
    },
    {
      siteKey: "threed",
      id: "three-dimensional-workbench",
      routes: [
        aliasRedirect({
          siteKey: "threed",
          sourceHost: "threed.oceanleo.com",
          destinationHost: "3d.oceanleo.com",
        }),
        workspaceRoute({
          siteKey: "threed",
          title: "3D generation workbench",
          summary:
            "Text-to-3D and image-to-3D generation share this canonical workspace.",
          source: "threed:app/workspace/page.tsx",
        }),
        legacyRedirect({
          id: "threed.create",
          pattern: "/create",
          destination: "/",
          source: "threed:next.config.ts",
        }),
        apiRoute({
          id: "threed.upload",
          pattern: "/api/upload",
          methods: ["POST"],
          capability: "artifact:write",
          source: "threed:app/api/upload/route.ts",
          handler: createDirectUploadHandler({
            siteId: "threed",
            mediaKind: "image",
            maxBytes: 12 * 1024 * 1024,
            maxBytesLabel: "12MB",
            registerAsset: false,
          }),
        }),
      ],
    },
  ],
});
