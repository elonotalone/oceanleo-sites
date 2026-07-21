import {
  createElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";

import type { PluginRouteParams } from "@oceanleo/plugin-runtime";

import type {
  PlatformPageRouteContract,
  PlatformSiteKey,
  PlatformTenantContract,
} from "./source-parity";

export interface PlatformPageProps {
  readonly tenant: PlatformTenantContract;
  readonly route: PlatformPageRouteContract;
  readonly params: PluginRouteParams;
  readonly requestUrl: string;
}

interface GameDefinition {
  readonly slug: string;
  readonly name: string;
  readonly category: string;
  readonly tagline: string;
}

export const PLATFORM_GAMES: readonly GameDefinition[] = Object.freeze([
  { slug: "metalslug", name: "钢铁小队", category: "街机", tagline: "横版突进，火力全开" },
  { slug: "ski", name: "极速滑雪", category: "街机", tagline: "俯冲雪山，冲下险坡" },
  { slug: "snake", name: "霓虹长蛇", category: "街机", tagline: "吞下光点，避开自己的尾巴" },
  { slug: "runner", name: "无限跑酷", category: "街机", tagline: "越过山峦，一路向前" },
  { slug: "danmaku", name: "弹幕苍穹", category: "射击", tagline: "在弹雨中击碎机兵" },
  { slug: "shooter", name: "几何风暴", category: "射击", tagline: "在几何光弹中生存" },
  { slug: "td", name: "王国防线", category: "策略", tagline: "布防升级，挡住入侵" },
  { slug: "racing", name: "拉力越野", category: "竞速", tagline: "漂移过弯，刷新圈速" },
  { slug: "minigolf", name: "迷你高尔夫", category: "技巧", tagline: "瞄准推杆，精准入洞" },
  { slug: "flappy", name: "扑翼小鸟", category: "技巧", tagline: "轻点振翅，穿过缝隙" },
  { slug: "breakout", name: "光弹破碎", category: "技巧", tagline: "挡住光弹，击碎光砖" },
  { slug: "peggle", name: "幻光弹珠", category: "技巧", tagline: "瞄准发射，撞落光钉" },
  { slug: "stack", name: "平衡叠塔", category: "技巧", tagline: "稳稳落下每一块" },
  { slug: "doodle", name: "跳跃云梯", category: "技巧", tagline: "一路向上，别踩空" },
  { slug: "jumper", name: "一跳到底", category: "技巧", tagline: "蓄力松手，精准落点" },
  { slug: "match3", name: "宝石绽放", category: "解谜", tagline: "三连消除，触发连锁" },
  { slug: "musicbox", name: "机械八音盒", category: "治愈", tagline: "拨动齿轮，让机器奏乐" },
  { slug: "town", name: "彩色小镇", category: "治愈", tagline: "轻点唤醒沉睡小镇" },
]);

const TOOL_CATEGORIES = Object.freeze([
  ["agent", "Agent 与自动化"],
  ["writing", "写作与内容"],
  ["image-gen", "图像生成"],
  ["image-edit", "图像编辑"],
  ["video-gen", "视频生成"],
  ["audio", "音频与音乐"],
  ["office", "办公效率"],
  ["coding", "编程开发"],
  ["design", "设计创意"],
  ["library", "AI 图书馆"],
] as const);

const ASSET_SURFACES = Object.freeze([
  ["/materials", "素材总览", "跨站参考素材与公共资产"],
  ["/templates", "网站模板", "按行业浏览可下载的自包含模板"],
  ["/elements", "风格元素", "可预览的网页背景和动效"],
  ["/design", "设计模板", "设计场景的可复用素材"],
  ["/series", "素材系列", "按主题聚合的素材系列"],
  ["/open", "开源素材", "允许公开读取和复用的素材"],
  ["/licenses", "许可说明", "素材授权与使用范围"],
  ["/collection", "我的素材库", "登录后执行收藏等写操作"],
] as const);

const SURFACE_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  account: "OceanLeo 共享账户入口。页面公开可读，账户操作按需触发 SSO。",
  advanced: "兼容旧高级功能入口；高级编辑能力已并入工作台与素材库。",
  "advanced-feature": "兼容高级功能深链，并保留 feature 路径参数。",
  "ai-models": "共享 AI 模型、价格与余额入口。",
  "api-guide": "OceanLeo 网关与 API 使用指南。",
  cost: "共享账户的模型用量和成本记录。",
  database: "公共页面外壳与登录后的个人数据管理入口。",
  explore: "公开素材发现页；读取无需登录，写入素材库时再请求账户。",
  general: "语言、主题和通用显示设置。",
  history: "会话历史入口；读取个人会话时需要现有账户会话。",
  "history-detail": "可恢复的会话深链。",
  library: "公共资产与个人文件库的统一入口。",
  plugins: "插件、连接器与 MCP 目录。",
  settings: "账户资料与偏好设置。",
  workspace: "站点主工作台，保留查询参数与站点能力上下文。",
  "workspace-detail": "按 app id 打开的工作台深链。",
  "workspace-free": "不绑定专家预设的自由 Agent 会话。",
  "workspace-expert": "绑定指定专家 Agent 的工作台深链。",
  "workspace-team": "绑定指定 Agent 团队的工作台深链。",
  "aitools-all": "公开 AI 工具分类总览，无账户或积分依赖。",
  "aitools-category": "公开 AI 工具分类深链。",
  "asset-collection": "个人收藏入口；浏览公开，收藏写操作按需登录。",
  "asset-design": "公开设计模板目录。",
  "asset-elements": "公开网页风格元素与动效目录。",
  "asset-licenses": "公开素材许可说明。",
  "asset-materials": "OceanLeo 全系列公开参考素材。",
  "asset-open": "公开与开源素材专区。",
  "asset-series": "按主题浏览公开素材系列。",
  "asset-templates": "公开行业网站模板目录。",
  "game-play": "浏览器即玩的免费游戏深链；登录仅用于记录成绩与进度。",
});

const pageStyle: CSSProperties = {
  background: "#f8fafc",
  color: "#172033",
  fontFamily:
    "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  minHeight: "100dvh",
};

const shellStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(13rem, 17rem) minmax(0, 1fr)",
  minHeight: "100dvh",
};

const topbarShellStyle: CSSProperties = {
  display: "block",
  minHeight: "100dvh",
};

const navStyle: CSSProperties = {
  background: "#111827",
  color: "#f8fafc",
  display: "flex",
  flexDirection: "column",
  gap: "0.55rem",
  padding: "1.4rem",
};

const cardStyle: CSSProperties = {
  background: "#ffffff",
  border: "1px solid #dbe4f0",
  borderRadius: "0.9rem",
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.05)",
  padding: "1rem",
};

function scalarParam(
  params: PluginRouteParams,
  key: string,
): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

function navItems(tenant: PlatformTenantContract): readonly [string, string][] {
  if (tenant.siteKey === "aitools") {
    return [
      ["/", "首页"],
      ["/all", "全部分类"],
      ["/category/library", "AI 图书馆"],
    ];
  }
  if (tenant.siteKey === "asset") {
    return [
      ["/", "素材库"],
      ["/materials", "素材总览"],
      ["/templates", "网站模板"],
      ["/elements", "风格元素"],
      ["/collection", "我的收藏"],
    ];
  }
  if (tenant.siteKey === "game") {
    return [
      ["/", "游戏墙"],
      ["/play/metalslug", "钢铁小队"],
      ["/play/match3", "宝石绽放"],
    ];
  }
  return [
    ["/", "首页"],
    ["/workspace", "工作台"],
    ["/library", "文件库"],
    ["/history", "历史记录"],
    ["/explore", "探索"],
  ];
}

function link(
  href: string,
  label: ReactNode,
  key: string = href,
): ReactElement {
  return createElement(
    "a",
    {
      href,
      key,
      style: {
        borderRadius: "0.55rem",
        color: "inherit",
        padding: "0.55rem 0.7rem",
        textDecoration: "none",
      },
    },
    label,
  );
}

function cards(
  values: readonly (readonly [string, string, string?])[],
): ReactElement {
  return createElement(
    "div",
    {
      style: {
        display: "grid",
        gap: "0.8rem",
        gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))",
      },
    },
    ...values.map(([href, title, description]) =>
      createElement(
        "a",
        {
          href,
          key: href,
          style: {
            ...cardStyle,
            color: "inherit",
            display: "block",
            textDecoration: "none",
          },
        },
        createElement(
          "strong",
          { style: { display: "block", marginBottom: "0.35rem" } },
          title,
        ),
        description
          ? createElement(
              "span",
              { style: { color: "#64748b", fontSize: "0.9rem" } },
              description,
            )
          : null,
      ),
    ),
  );
}

function routeSpecificContent(props: PlatformPageProps): ReactNode {
  const { route, tenant, params } = props;
  if (route.view === "aitools-all") {
    return cards(
      TOOL_CATEGORIES.map(([slug, title]) => [
        `/category/${slug}`,
        title,
        "公开浏览",
      ]),
    );
  }
  if (route.view === "aitools-category") {
    const slug = scalarParam(params, "slug") ?? "unknown";
    return cards([
      ["/all", "返回全部分类", "继续浏览其他 AI 工具目录"],
      [`/?q=${encodeURIComponent(slug)}`, `搜索 ${slug}`, "在公开目录中搜索"],
    ]);
  }
  if (route.view.startsWith("asset-")) {
    return cards(ASSET_SURFACES);
  }
  if (route.view === "game-play") {
    const slug = scalarParam(params, "slug") ?? "";
    const game = PLATFORM_GAMES.find((candidate) => candidate.slug === slug);
    if (!game) {
      return createElement(
        "section",
        { style: cardStyle, "data-game-status": "not-found" },
        createElement("h2", null, "Game not found"),
        createElement(
          "p",
          { style: { color: "#64748b" } },
          "这个游戏深链不存在，请返回游戏墙选择可用游戏。",
        ),
      );
    }
    return createElement(
      "section",
      { style: cardStyle, "data-game-slug": game.slug },
      createElement("p", { style: { color: "#b45309", margin: 0 } }, game.category),
      createElement("h2", { style: { marginBottom: "0.35rem" } }, game.name),
      createElement("p", { style: { color: "#64748b" } }, game.tagline),
      createElement(
        "p",
        { style: { fontSize: "0.9rem", marginBottom: 0 } },
        "游戏页面公开可读；OceanLeo SSO 仅用于同步最高分与进度。",
      ),
    );
  }
  if (
    route.view === "workspace" ||
    route.view.startsWith("workspace-")
  ) {
    const context = Object.entries(params)
      .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join("/") : value}`)
      .join(", ");
    return cards([
      ["/library", "打开文件库", "把已有素材带入本次工作"],
      ["/history", "恢复历史会话", "继续之前的工作上下文"],
      ["/developer-api", "选择 AI 模型", "模型、价格和账户余额"],
      [
        `/workspace${context ? `?context=${encodeURIComponent(context)}` : ""}`,
        "开始新会话",
        context || "使用当前站点能力创建工作会话",
      ],
    ]);
  }
  if (route.view === "explore") {
    return cards([
      ["/library", "公共素材库", "浏览可自由使用的素材"],
      ["/workspace", "送入工作台", "在当前站点能力中继续创作"],
    ]);
  }
  if (route.view === "library" || route.view === "database") {
    return cards([
      ["/explore", "公共素材", "无需登录即可浏览"],
      ["/workspace", "工作台", "从素材继续工作"],
    ]);
  }
  if (route.view === "history" || route.view === "history-detail") {
    return cards([
      ["/workspace", "返回工作台", "继续当前站点的工作"],
      ["/library", "查看文件库", "打开会话关联的产物"],
    ]);
  }
  return null;
}

function accessLabel(tenant: PlatformTenantContract): string {
  if (tenant.sso === "none") return "公开读取 · 无 SSO";
  if (tenant.actionAuth === "on-ai-action") {
    return "公开读取 · AI 操作时登录";
  }
  return "公开读取 · 写操作时登录";
}

export function legacyRedirectLocation(
  route: PlatformPageRouteContract,
  requestUrl: string,
): string {
  if (!route.redirect) {
    throw new TypeError(`${route.id} is not a legacy redirect route.`);
  }
  const source = new URL(requestUrl);
  const query = new URLSearchParams();

  if (route.redirect.mode === "search-workspace") {
    const q = source.searchParams.get("q") ?? "";
    if (q) {
      query.set("q", q);
      query.set(
        "depth",
        source.searchParams.get("depth") === "advanced"
          ? "advanced"
          : "basic",
      );
    } else {
      query.set("fn", "search");
    }
  } else {
    if (route.redirect.defaultFn) {
      query.set("fn", route.redirect.defaultFn);
    }
    if (route.redirect.preserveQuery) {
      for (const [key, value] of source.searchParams) {
        query.set(key, value);
      }
    }
  }

  const serialized = query.toString();
  return serialized ? `/workspace?${serialized}` : "/workspace";
}

export function LegacyPlatformRedirect({
  location,
}: Readonly<{ location: string }>): ReactElement {
  const scriptLocation = JSON.stringify(location).replaceAll("<", "\\u003c");
  return createElement(
    "main",
    { "data-legacy-redirect": location },
    createElement("meta", {
      httpEquiv: "refresh",
      content: `0;url=${location}`,
    }),
    createElement("script", {
      dangerouslySetInnerHTML: {
        __html: `window.location.replace(${scriptLocation});`,
      },
    }),
    createElement(
      "p",
      null,
      "正在前往工作台… ",
      createElement("a", { href: location }, "继续"),
    ),
  );
}

export function PlatformRoutePage(props: PlatformPageProps): ReactElement {
  const { tenant, route, params, requestUrl } = props;
  if (route.redirect) {
    return createElement(LegacyPlatformRedirect, {
      location: legacyRedirectLocation(route, requestUrl),
    });
  }

  const routeContext = Object.entries(params);
  const main = createElement(
    "main",
    {
      style: {
        margin: "0 auto",
        maxWidth: "72rem",
        padding: "clamp(1.25rem, 4vw, 3rem)",
      },
    },
    createElement(
      "div",
      {
        style: {
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: "0.6rem",
          justifyContent: "space-between",
        },
      },
      createElement(
        "p",
        {
          style: {
            color: tenant.shellMode === "utility" ? "#059669" : "#4f46e5",
            fontSize: "0.75rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            margin: 0,
            textTransform: "uppercase",
          },
        },
        `${tenant.siteKey} · ${tenant.shellMode}`,
      ),
      createElement(
        "span",
        {
          style: {
            background: "#e2e8f0",
            borderRadius: "999px",
            color: "#475569",
            fontSize: "0.75rem",
            padding: "0.3rem 0.65rem",
          },
        },
        accessLabel(tenant),
      ),
    ),
    createElement(
      "h1",
      { style: { fontSize: "clamp(1.8rem, 4vw, 2.8rem)", marginBottom: "0.5rem" } },
      route.title,
    ),
    createElement(
      "p",
      {
        style: {
          color: "#64748b",
          lineHeight: 1.75,
          marginBottom: "1.5rem",
          maxWidth: "48rem",
        },
      },
      SURFACE_DESCRIPTIONS[route.view] ??
        "OceanLeo 平台迁移后的可路由生产页面。",
    ),
    routeContext.length
      ? createElement(
          "dl",
          {
            style: {
              ...cardStyle,
              display: "grid",
              gap: "0.45rem",
              gridTemplateColumns: "max-content 1fr",
              marginBottom: "1rem",
            },
          },
          ...routeContext.flatMap(([key, value]) => [
            createElement("dt", { key: `${key}:label`, style: { fontWeight: 700 } }, key),
            createElement(
              "dd",
              { key, style: { color: "#64748b", margin: 0 } },
              Array.isArray(value) ? value.join("/") : value,
            ),
          ]),
        )
      : null,
    routeSpecificContent(props),
    createElement(
      "footer",
      {
        style: {
          borderTop: "1px solid #dbe4f0",
          color: "#94a3b8",
          fontSize: "0.75rem",
          marginTop: "2rem",
          paddingTop: "1rem",
        },
      },
      `${route.pattern} · ${route.source}`,
    ),
  );

  const brand = createElement(
    "strong",
    { style: { fontSize: "1.05rem", marginBottom: "0.7rem" } },
    tenant.siteKey,
  );
  const navigation = createElement(
    "nav",
    { "aria-label": `${tenant.siteKey} navigation`, style: navStyle },
    brand,
    ...navItems(tenant).map(([href, label]) => link(href, label)),
    tenant.sso === "optional-refresh"
      ? link("/account", "账户", "account")
      : null,
  );

  if (tenant.shellMode === "utility") {
    return createElement(
      "div",
      {
        "data-action-auth": tenant.actionAuth,
        "data-public-read": "true",
        "data-shell-mode": tenant.shellMode,
        "data-site-key": tenant.siteKey,
        "data-sso": tenant.sso,
        style: { ...pageStyle, ...topbarShellStyle },
      },
      createElement(
        "div",
        {
          style: {
            ...navStyle,
            alignItems: "center",
            flexDirection: "row",
            flexWrap: "wrap",
          },
        },
        brand,
        ...navItems(tenant).map(([href, label]) => link(href, label)),
        tenant.sso === "optional-refresh"
          ? link("/account", "账户", "account")
          : null,
      ),
      main,
    );
  }

  return createElement(
    "div",
    {
      "data-action-auth": tenant.actionAuth,
      "data-public-read": "true",
      "data-shell-mode": tenant.shellMode,
      "data-site-key": tenant.siteKey,
      "data-sso": tenant.sso,
      style: { ...pageStyle, ...shellStyle },
    },
    navigation,
    main,
  );
}

export function createPlatformPageNode(
  props: PlatformPageProps,
): ReactElement {
  return createElement(PlatformRoutePage, props);
}

export function titleForSite(siteKey: PlatformSiteKey): string {
  const names: Record<PlatformSiteKey, string> = {
    agent: "LeoAgent",
    chat: "LeoChat",
    music: "LeoMusic",
    search: "LeoSearch",
    money: "LeoMoney",
    aitools: "AI 工具导航",
    asset: "LeoAsset",
    game: "LeoPlay",
  };
  return names[siteKey];
}
