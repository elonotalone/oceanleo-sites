/**
 * Portable website workbench catalog derived from
 * `website:front/lib/app-catalog.ts`. UI chrome stays in the legacy frontend;
 * this module preserves canonical app ids, scenes, and agent wiring for the
 * privileged migration profile.
 */
export const WEBSITE_SITE_KEY = "website" as const;
export const WEBSITE_AGENT_ID = "website.build";
export const WEBSITE_ACCENT = "#ea580c";

export const WEBSITE_SCENES = Object.freeze({
  biz: "企业商务",
  marketing: "营销推广",
  personal: "个人展示",
  ecommerce: "电商零售",
  content: "内容社区",
  app: "应用工具",
} as const);

export interface WebsiteCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly scenes: readonly (typeof WEBSITE_SCENES)[keyof typeof WEBSITE_SCENES][];
}

const entry = (
  id: string,
  name: string,
  tagline: string,
  scenes: readonly WebsiteCatalogEntry["scenes"][number][],
): WebsiteCatalogEntry =>
  Object.freeze({ id, name, tagline, scenes: Object.freeze([...scenes]) });

export const WEBSITE_CATALOG: readonly WebsiteCatalogEntry[] = Object.freeze([
  entry("corp-site", "企业官网", "公司门户：首页 / 产品 / 关于 / 联系", [
    WEBSITE_SCENES.biz,
  ]),
  entry("saas-marketing", "SaaS 官网", "产品站：功能 / 定价 / 注册", [
    WEBSITE_SCENES.biz,
    WEBSITE_SCENES.app,
  ]),
  entry("landing", "落地页", "单页高转化推广页", [WEBSITE_SCENES.marketing]),
  entry("event-page", "活动页", "发布会 / 促销 / 节日专题", [
    WEBSITE_SCENES.marketing,
  ]),
  entry("portfolio", "个人作品集", "展示项目 / 技能 / 联系方式", [
    WEBSITE_SCENES.personal,
  ]),
  entry("resume-site", "在线简历", "一页式个人主页 / 求职名片", [
    WEBSITE_SCENES.personal,
  ]),
  entry("shop", "电商店铺", "商品展示 / 购物车 / 下单", [
    WEBSITE_SCENES.ecommerce,
    WEBSITE_SCENES.app,
  ]),
  entry("menu-site", "餐饮门店站", "菜单 / 门店 / 预订", [
    WEBSITE_SCENES.ecommerce,
    WEBSITE_SCENES.biz,
  ]),
  entry("blog", "博客内容站", "文章列表 / 详情 / 分类", [
    WEBSITE_SCENES.content,
    WEBSITE_SCENES.personal,
  ]),
  entry("docs-site", "文档 / 帮助中心", "产品文档 / FAQ / 侧边导航", [
    WEBSITE_SCENES.content,
    WEBSITE_SCENES.app,
  ]),
  entry("webapp", "带登录的应用", "用户登录 + 数据（Supabase）", [
    WEBSITE_SCENES.app,
  ]),
  entry("dashboard", "后台管理面板", "数据看板 / 表格 / CRUD", [
    WEBSITE_SCENES.app,
    WEBSITE_SCENES.biz,
  ]),
]);

if (WEBSITE_CATALOG.length !== 12) {
  throw new Error("Website catalog must retain all 12 legacy goal apps.");
}

export function websiteCatalogEntry(
  appId: string,
): WebsiteCatalogEntry | undefined {
  const normalized = appId.trim();
  if (!normalized) return undefined;
  return WEBSITE_CATALOG.find((entry) => entry.id === normalized);
}

export function resolveWebsiteAppId(input: Readonly<{
  pathSegments: readonly string[];
  fnQuery: string | null;
}>): string {
  const fromPath = input.pathSegments[0]?.trim() ?? "";
  if (fromPath) return fromPath;
  return input.fnQuery?.trim() ?? "";
}
