import type { CapabilityId } from "@oceanleo/capabilities/server";

export type PlatformSiteKey =
  | "agent"
  | "chat"
  | "music"
  | "search"
  | "money"
  | "aitools"
  | "asset"
  | "game";

export type PlatformShellMode = "standard" | "utility";
export type PlatformSsoMode = "optional-refresh" | "none";
export type PlatformActionAuth =
  | "on-ai-action"
  | "on-mutating-action"
  | "none";

export type PlatformPageView =
  | "account"
  | "advanced"
  | "advanced-feature"
  | "ai-models"
  | "api-guide"
  | "cost"
  | "database"
  | "explore"
  | "general"
  | "history"
  | "history-detail"
  | "library"
  | "plugins"
  | "settings"
  | "workspace"
  | "workspace-detail"
  | "workspace-free"
  | "workspace-expert"
  | "workspace-team"
  | "aitools-all"
  | "aitools-category"
  | "asset-collection"
  | "asset-design"
  | "asset-elements"
  | "asset-licenses"
  | "asset-materials"
  | "asset-open"
  | "asset-series"
  | "asset-templates"
  | "game-play"
  | "legacy-redirect";

export interface LegacyPageRedirect {
  readonly mode: "workspace" | "search-workspace";
  readonly defaultFn?: string;
  readonly preserveQuery: boolean;
}

export interface PlatformPageRouteContract {
  readonly id: string;
  readonly kind: "page";
  readonly surface: "page";
  readonly pattern: `/${string}`;
  readonly methods: readonly ["GET", "HEAD"];
  readonly capability: CapabilityId;
  readonly source: string;
  readonly view: PlatformPageView;
  readonly title: string;
  readonly redirect?: LegacyPageRedirect;
}

export type PlatformApiView =
  | "trial-chat"
  | "favicon-proxy"
  | "element-document"
  | "template-document";

export interface PlatformApiRouteContract {
  readonly id: string;
  readonly kind: "api" | "stream";
  readonly surface: "api";
  readonly pattern: `/${string}`;
  readonly methods: readonly ["GET"] | readonly ["POST"];
  readonly capability: CapabilityId;
  readonly source: string;
  readonly view: PlatformApiView;
}

export type PlatformRouteContract =
  | PlatformPageRouteContract
  | PlatformApiRouteContract;

export interface PlatformTenantContract {
  readonly siteKey: PlatformSiteKey;
  readonly extensionId: string;
  readonly repository: string;
  readonly frontend: ".";
  readonly tsvPush: "git";
  readonly canonicalHost: string;
  readonly legacyRootSource: string;
  readonly rootOwner: "standard-foundation";
  readonly shellMode: PlatformShellMode;
  readonly publicRead: true;
  readonly sso: PlatformSsoMode;
  readonly actionAuth: PlatformActionAuth;
  readonly credits: "shared-account" | "disabled";
  readonly routes: readonly PlatformRouteContract[];
}

export interface PlatformAliasContract {
  readonly id: string;
  readonly siteKey: "agent";
  readonly sourceHost: "skill.oceanleo.com";
  readonly destinationHost: "agent.oceanleo.com";
  readonly source: "agent:middleware/domain-alias";
  readonly evidence: readonly string[];
}

export const PLATFORM_PARITY_EVIDENCE = Object.freeze([
  "packages/migration-platform/src/source-parity.ts",
  "packages/migration-platform/tests/platform.test.ts",
] as const);

function sourcePage(repository: string, path: string): string {
  return `${repository}:app/${path}/page.tsx`;
}

function page(
  siteKey: PlatformSiteKey,
  id: string,
  pattern: `/${string}`,
  sourcePath: string,
  view: PlatformPageView,
  title: string,
  capability: CapabilityId = "shell:render",
  redirect?: LegacyPageRedirect,
): PlatformPageRouteContract {
  return Object.freeze({
    id: `${siteKey}.page.${id}`,
    kind: "page",
    surface: "page",
    pattern,
    methods: ["GET", "HEAD"] as const,
    capability,
    source: sourcePage(siteKey, sourcePath),
    view,
    title,
    redirect,
  });
}

function api(
  siteKey: PlatformSiteKey,
  id: string,
  pattern: `/${string}`,
  sourcePath: string,
  methods: readonly ["GET"] | readonly ["POST"],
  view: PlatformApiView,
  capability: CapabilityId,
  kind: "api" | "stream" = "api",
): PlatformApiRouteContract {
  return Object.freeze({
    id: `${siteKey}.api.${id}`,
    kind,
    surface: "api",
    pattern,
    methods,
    capability,
    source: `${siteKey}:app/${sourcePath}/route.ts`,
    view,
  });
}

function commonStandardPages(
  siteKey: "agent" | "chat" | "music" | "search" | "money",
): readonly PlatformPageRouteContract[] {
  return Object.freeze([
    page(siteKey, "account", "/account", "account", "account", "账户"),
    page(siteKey, "advanced", "/advanced", "advanced", "advanced", "高级功能"),
    page(
      siteKey,
      "advanced-feature",
      "/advanced/:feature",
      "advanced/[feature]",
      "advanced-feature",
      "高级功能",
    ),
    page(siteKey, "api", "/developer-api", "api", "ai-models", "AI 模型"),
    page(
      siteKey,
      "api-guide",
      "/api-guide",
      "api/guide",
      "api-guide",
      "API 指南",
    ),
    page(siteKey, "cost", "/cost", "cost", "cost", "用量与成本"),
    page(
      siteKey,
      "database",
      "/database",
      "database",
      "database",
      "我的数据库",
      "artifact:read",
    ),
    page(
      siteKey,
      "explore",
      "/explore",
      "explore",
      "explore",
      "探索素材",
      "artifact:read",
    ),
    page(siteKey, "general", "/general", "general", "general", "通用设置"),
    page(
      siteKey,
      "history",
      "/history",
      "history",
      "history",
      "历史记录",
      "workspace:session",
    ),
    page(
      siteKey,
      "history-detail",
      "/history/:sessionId",
      "history/[sessionId]",
      "history-detail",
      "历史会话",
      "workspace:session",
    ),
    page(
      siteKey,
      "library",
      "/library",
      "library",
      "library",
      "文件库",
      "artifact:read",
    ),
    page(siteKey, "plugins", "/plugins", "plugins", "plugins", "插件与连接器"),
    page(siteKey, "settings", "/settings", "settings", "settings", "账户设置"),
  ]);
}

const agentRoutes = Object.freeze([
  ...commonStandardPages("agent"),
  page(
    "agent",
    "workspace",
    "/workspace",
    "workspace",
    "workspace",
    "Agent 工作台",
    "workbench:advanced",
  ),
  page(
    "agent",
    "workspace-free",
    "/workspace/free",
    "workspace/free",
    "workspace-free",
    "自由 Agent",
    "workbench:advanced",
  ),
  page(
    "agent",
    "workspace-expert",
    "/workspace/expert/:id",
    "workspace/expert/[id]",
    "workspace-expert",
    "专家 Agent",
    "workbench:advanced",
  ),
  page(
    "agent",
    "workspace-team",
    "/workspace/team/:id",
    "workspace/team/[id]",
    "workspace-team",
    "Agent 团队",
    "workbench:advanced",
  ),
] as const);

const chatRoutes = Object.freeze([
  ...commonStandardPages("chat"),
  page(
    "chat",
    "personas",
    "/personas",
    "personas",
    "legacy-redirect",
    "角色预设",
    "shell:render",
    { mode: "workspace", preserveQuery: true },
  ),
  page(
    "chat",
    "workspace",
    "/workspace",
    "workspace",
    "workspace",
    "多模型聊天",
    "workbench:advanced",
  ),
  page(
    "chat",
    "workspace-app",
    "/workspace/:appId",
    "workspace/[appId]",
    "workspace-detail",
    "聊天应用",
    "workbench:advanced",
  ),
  api(
    "chat",
    "trial-chat",
    "/api/trial-chat",
    "api/trial-chat",
    ["POST"],
    "trial-chat",
    "workbench:advanced",
    "stream",
  ),
] as const);

const musicRoutes = Object.freeze([
  ...commonStandardPages("music"),
  page(
    "music",
    "lyrics",
    "/lyrics",
    "lyrics",
    "legacy-redirect",
    "歌词创作",
    "shell:render",
    {
      mode: "workspace",
      defaultFn: "lyrics",
      preserveQuery: true,
    },
  ),
  page(
    "music",
    "mv",
    "/mv",
    "mv",
    "legacy-redirect",
    "MV 创作",
    "shell:render",
    { mode: "workspace", defaultFn: "mv", preserveQuery: true },
  ),
  page(
    "music",
    "usage",
    "/usage",
    "usage",
    "legacy-redirect",
    "音乐用量",
    "shell:render",
    { mode: "workspace", defaultFn: "usage", preserveQuery: true },
  ),
  page(
    "music",
    "works",
    "/works",
    "works",
    "legacy-redirect",
    "音乐作品",
    "shell:render",
    { mode: "workspace", defaultFn: "works", preserveQuery: true },
  ),
  page(
    "music",
    "workspace",
    "/workspace",
    "workspace",
    "workspace",
    "音乐工作台",
    "workbench:advanced",
  ),
  page(
    "music",
    "workspace-app",
    "/workspace/:appId",
    "workspace/[appId]",
    "workspace-detail",
    "音乐应用",
    "workbench:advanced",
  ),
] as const);

const searchRoutes = Object.freeze([
  ...commonStandardPages("search"),
  page(
    "search",
    "legacy-search",
    "/search",
    "search",
    "legacy-redirect",
    "搜索",
    "shell:render",
    { mode: "search-workspace", preserveQuery: true },
  ),
  page(
    "search",
    "workspace",
    "/workspace",
    "workspace",
    "workspace",
    "搜索工作台",
    "workbench:advanced",
  ),
  page(
    "search",
    "workspace-app",
    "/workspace/:appId",
    "workspace/[appId]",
    "workspace-detail",
    "搜索应用",
    "workbench:advanced",
  ),
] as const);

const moneyRoutes = Object.freeze([
  ...commonStandardPages("money"),
  page(
    "money",
    "tools",
    "/tools",
    "tools",
    "legacy-redirect",
    "理财计算器",
    "shell:render",
    { mode: "workspace", defaultFn: "calc", preserveQuery: false },
  ),
  page(
    "money",
    "workspace",
    "/workspace",
    "workspace",
    "workspace",
    "理财工作台",
    "workbench:advanced",
  ),
  page(
    "money",
    "workspace-app",
    "/workspace/:appId",
    "workspace/[appId]",
    "workspace-detail",
    "理财应用",
    "workbench:advanced",
  ),
] as const);

const aitoolsRoutes = Object.freeze([
  page("aitools", "advanced", "/advanced", "advanced", "advanced", "高级功能"),
  page(
    "aitools",
    "advanced-feature",
    "/advanced/:feature",
    "advanced/[feature]",
    "advanced-feature",
    "高级功能",
  ),
  page(
    "aitools",
    "all",
    "/all",
    "all",
    "aitools-all",
    "全部 AI 工具分类",
    "artifact:read",
  ),
  page(
    "aitools",
    "category",
    "/category/:slug",
    "category/[slug]",
    "aitools-category",
    "AI 工具分类",
    "artifact:read",
  ),
  api(
    "aitools",
    "icon",
    "/api/icon",
    "api/icon",
    ["GET"],
    "favicon-proxy",
    "artifact:read",
  ),
] as const);

const assetRoutes = Object.freeze([
  page("asset", "account", "/account", "account", "account", "账户"),
  page("asset", "advanced", "/advanced", "advanced", "advanced", "高级功能"),
  page(
    "asset",
    "advanced-feature",
    "/advanced/:feature",
    "advanced/[feature]",
    "advanced-feature",
    "高级功能",
  ),
  page("asset", "api", "/developer-api", "api", "ai-models", "AI 模型"),
  page(
    "asset",
    "api-guide",
    "/api-guide",
    "api/guide",
    "api-guide",
    "API 指南",
  ),
  page(
    "asset",
    "collection",
    "/collection",
    "collection",
    "asset-collection",
    "我的素材库",
    "artifact:read",
  ),
  page("asset", "cost", "/cost", "cost", "cost", "用量与成本"),
  page(
    "asset",
    "database",
    "/database",
    "database",
    "database",
    "我的数据库",
    "artifact:read",
  ),
  page(
    "asset",
    "design",
    "/design",
    "design",
    "asset-design",
    "设计模板",
    "artifact:read",
  ),
  page(
    "asset",
    "elements",
    "/elements",
    "elements",
    "asset-elements",
    "网站风格元素",
    "artifact:read",
  ),
  page("asset", "general", "/general", "general", "general", "通用设置"),
  page(
    "asset",
    "licenses",
    "/licenses",
    "licenses",
    "asset-licenses",
    "素材许可",
    "artifact:read",
  ),
  page(
    "asset",
    "materials",
    "/materials",
    "materials",
    "asset-materials",
    "素材总览",
    "artifact:read",
  ),
  page(
    "asset",
    "open",
    "/open",
    "open",
    "asset-open",
    "开源素材",
    "artifact:read",
  ),
  page("asset", "plugins", "/plugins", "plugins", "plugins", "插件与连接器"),
  page(
    "asset",
    "series",
    "/series",
    "series",
    "asset-series",
    "素材系列",
    "artifact:read",
  ),
  page("asset", "settings", "/settings", "settings", "settings", "账户设置"),
  page(
    "asset",
    "templates",
    "/templates",
    "templates",
    "asset-templates",
    "网站模板",
    "artifact:read",
  ),
  api(
    "asset",
    "element-document",
    "/api/elements/:fx",
    "api/elements/[fx]",
    ["GET"],
    "element-document",
    "artifact:read",
  ),
  api(
    "asset",
    "template-document",
    "/api/templates/:slug",
    "api/templates/[slug]",
    ["GET"],
    "template-document",
    "artifact:read",
  ),
] as const);

const gameRoutes = Object.freeze([
  page("game", "advanced", "/advanced", "advanced", "advanced", "高级功能"),
  page(
    "game",
    "advanced-feature",
    "/advanced/:feature",
    "advanced/[feature]",
    "advanced-feature",
    "高级功能",
  ),
  page(
    "game",
    "play",
    "/play/:slug",
    "play/[slug]",
    "game-play",
    "在线游戏",
    "shell:render",
  ),
] as const);

export const PLATFORM_TENANT_CONTRACTS: readonly PlatformTenantContract[] =
  Object.freeze([
    {
      siteKey: "agent",
      extensionId: "agent-orchestration",
      repository: "agent",
      frontend: ".",
      tsvPush: "git",
      canonicalHost: "agent.oceanleo.com",
      legacyRootSource: sourcePage("agent", "page.tsx").replace(
        "/page.tsx/page.tsx",
        "/page.tsx",
      ),
      rootOwner: "standard-foundation",
      shellMode: "standard",
      publicRead: true,
      sso: "optional-refresh",
      actionAuth: "on-ai-action",
      credits: "shared-account",
      routes: agentRoutes,
    },
    {
      siteKey: "chat",
      extensionId: "multi-model-chat",
      repository: "chat",
      frontend: ".",
      tsvPush: "git",
      canonicalHost: "chat.oceanleo.com",
      legacyRootSource: "chat:app/page.tsx",
      rootOwner: "standard-foundation",
      shellMode: "standard",
      publicRead: true,
      sso: "optional-refresh",
      actionAuth: "on-ai-action",
      credits: "shared-account",
      routes: chatRoutes,
    },
    {
      siteKey: "music",
      extensionId: "music-workbench",
      repository: "music",
      frontend: ".",
      tsvPush: "git",
      canonicalHost: "music.oceanleo.com",
      legacyRootSource: "music:app/page.tsx",
      rootOwner: "standard-foundation",
      shellMode: "standard",
      publicRead: true,
      sso: "optional-refresh",
      actionAuth: "on-ai-action",
      credits: "shared-account",
      routes: musicRoutes,
    },
    {
      siteKey: "search",
      extensionId: "search-workbench",
      repository: "search",
      frontend: ".",
      tsvPush: "git",
      canonicalHost: "search.oceanleo.com",
      legacyRootSource: "search:app/page.tsx",
      rootOwner: "standard-foundation",
      shellMode: "standard",
      publicRead: true,
      sso: "optional-refresh",
      actionAuth: "on-ai-action",
      credits: "shared-account",
      routes: searchRoutes,
    },
    {
      siteKey: "money",
      extensionId: "money-workbench",
      repository: "money",
      frontend: ".",
      tsvPush: "git",
      canonicalHost: "money.oceanleo.com",
      legacyRootSource: "money:app/page.tsx",
      rootOwner: "standard-foundation",
      shellMode: "standard",
      publicRead: true,
      sso: "optional-refresh",
      actionAuth: "on-ai-action",
      credits: "shared-account",
      routes: moneyRoutes,
    },
    {
      siteKey: "aitools",
      extensionId: "ai-tools-directory",
      repository: "aitools",
      frontend: ".",
      tsvPush: "git",
      canonicalHost: "aitools.oceanleo.com",
      legacyRootSource: "aitools:app/page.tsx",
      rootOwner: "standard-foundation",
      shellMode: "utility",
      publicRead: true,
      sso: "none",
      actionAuth: "none",
      credits: "disabled",
      routes: aitoolsRoutes,
    },
    {
      siteKey: "asset",
      extensionId: "asset-library",
      repository: "asset",
      frontend: ".",
      tsvPush: "git",
      canonicalHost: "asset.oceanleo.com",
      legacyRootSource: "asset:app/page.tsx",
      rootOwner: "standard-foundation",
      shellMode: "utility",
      publicRead: true,
      sso: "optional-refresh",
      actionAuth: "on-mutating-action",
      credits: "disabled",
      routes: assetRoutes,
    },
    {
      siteKey: "game",
      extensionId: "game-platform",
      repository: "game",
      frontend: ".",
      tsvPush: "git",
      canonicalHost: "game.oceanleo.com",
      legacyRootSource: "game:app/page.tsx",
      rootOwner: "standard-foundation",
      shellMode: "utility",
      publicRead: true,
      sso: "optional-refresh",
      actionAuth: "on-mutating-action",
      credits: "disabled",
      routes: gameRoutes,
    },
  ]);

export const PLATFORM_ALIAS_CONTRACTS: readonly PlatformAliasContract[] =
  Object.freeze([
    {
      id: "agent.alias.skill-oceanleo-com",
      siteKey: "agent",
      sourceHost: "skill.oceanleo.com",
      destinationHost: "agent.oceanleo.com",
      source: "agent:middleware/domain-alias",
      evidence: PLATFORM_PARITY_EVIDENCE,
    },
  ]);

export const PLATFORM_LEGACY_ROOT_COUNT = PLATFORM_TENANT_CONTRACTS.length;
export const PLATFORM_DECLARED_ROUTE_COUNT =
  PLATFORM_TENANT_CONTRACTS.reduce(
    (total, tenant) => total + tenant.routes.length,
    0,
  ) + PLATFORM_ALIAS_CONTRACTS.length;
