export type CreationSiteKey =
  | "ecommerce"
  | "novel"
  | "script"
  | "design"
  | "make";

export interface CreationCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly engine: string;
  readonly artifactTypes: readonly string[];
}

export interface CreationTemplateProtocol {
  readonly id: string;
  readonly source: string;
  readonly categories: readonly string[];
  readonly documentUrlPattern?: string;
}

export interface CreationEditorProtocol {
  readonly id: string;
  readonly projectSchema: string;
  readonly artifactType: string;
  readonly messages: readonly string[];
}

export interface CreationTenantProtocol {
  readonly siteKey: CreationSiteKey;
  readonly pluginId: string;
  readonly displayName: string;
  readonly sourceRoot: string;
  readonly catalogSource: string;
  readonly catalog: readonly CreationCatalogEntry[];
  readonly artifactTypes: readonly string[];
  readonly contextPattern: string;
  readonly template: CreationTemplateProtocol;
  readonly editor?: CreationEditorProtocol;
  readonly upload?: Readonly<{
    route: "/api/upload";
    maxBytes: number;
    bucket: "media-uploads";
    pathPrefix: "leostudio/";
  }>;
}

const image = Object.freeze(["single_file_image"]);
const document = Object.freeze(["document"]);
const compositeImage = Object.freeze(["composite_image"]);
const workflow = Object.freeze(["workflow"]);

function catalog(
  id: string,
  name: string,
  engine: string,
  artifactTypes: readonly string[],
): CreationCatalogEntry {
  return Object.freeze({ id, name, engine, artifactTypes });
}

const ECOMMERCE_CATALOG = Object.freeze([
  catalog("white-bg", "白底商品图", "product-shot", image),
  catalog("scene-shot", "场景商品图", "product-shot", image),
  catalog("flat-lay", "平铺俯拍图", "product-shot", image),
  catalog("closeup", "细节特写图", "product-shot", image),
  catalog("food-shot", "美食商品图", "product-shot", image),
  catalog("promo-poster", "促销主图海报", "product-shot", image),
  catalog("model-wear", "模特上身图", "ai-model", image),
  catalog("model-accessory", "配饰佩戴图", "ai-model", image),
  catalog("model-beauty", "美妆试色图", "ai-model", image),
  catalog("model-home", "家居使用场景图", "ai-model", image),
  catalog("cutout", "一键抠图去背景", "remove-bg", image),
  catalog("batch-cutout", "批量白底化", "remove-bg", image),
  catalog("title-copy", "商品标题文案", "copy", document),
  catalog("selling-points", "卖点提炼文案", "copy", document),
  catalog("detail-copy", "详情页文案", "copy", document),
  catalog("promo-copy", "带货种草文案", "copy", document),
  catalog("review-copy", "买家秀好评文案", "copy", document),
  catalog("keyword-copy", "关键词/标签文案", "copy", document),
  catalog("brand-copy", "品牌介绍文案", "copy", document),
  catalog("qa-copy", "问大家/客服话术", "copy", document),
]);

const NOVEL_CATALOG = Object.freeze(
  [
    ["outline", "小说大纲"],
    ["character", "人物设定"],
    ["worldbuilding", "世界观设定"],
    ["continue", "剧情续写"],
    ["opening", "开篇黄金三章"],
    ["dialogue", "角色对话"],
    ["short-story", "短篇故事"],
    ["plot-twist", "剧情脑洞"],
    ["name-generator", "起名取名"],
    ["polish", "文笔润色"],
    ["power-system", "金手指设定"],
    ["romance-beats", "感情线设计"],
    ["mystery-case", "案件诡计"],
    ["scifi-concept", "科幻设定"],
    ["urban-drama", "都市剧情"],
    ["history-setting", "古风设定"],
    ["synopsis", "内容简介"],
    ["golden-lines", "金句摘抄"],
    ["chapter-title", "章节起名"],
    ["rewrite-style", "文风改写"],
    ["book-blurb-review", "拆书解析"],
  ].map(([id, name]) => catalog(id!, name!, "novel.write", document)),
);

const SCRIPT_CATALOG = Object.freeze(
  [
    ["logline", "一句话故事"],
    ["synopsis", "故事梗概"],
    ["scene-outline", "分场大纲"],
    ["screenplay", "剧本正文"],
    ["dialogue", "台词对白"],
    ["character", "人物小传"],
    ["storyboard", "分镜脚本"],
    ["beats", "节拍卡片"],
    ["title-gen", "剧名起名"],
    ["doctor", "剧本诊断"],
    ["short-drama", "短剧剧本"],
    ["sketch", "小品相声"],
    ["ad-film", "广告脚本"],
    ["micro-film", "微电影剧本"],
    ["anime-script", "漫剧脚本"],
    ["radio-drama", "广播剧本"],
    ["series-bible", "剧集设定集"],
    ["adaptation", "小说改编"],
    ["monologue", "独白旁白"],
  ].map(([id, name]) => catalog(id!, name!, "script.quick", document)),
);

const DESIGN_CATALOG = Object.freeze([
  catalog("xhs-cover", "小红书封面", "generate", compositeImage),
  catalog("wechat-cover", "公众号封面", "generate", compositeImage),
  catalog("moments-grid", "朋友圈九宫格", "ai-suite", compositeImage),
  catalog("douyin-cover", "视频号/抖音封面", "generate", compositeImage),
  catalog("bilibili-cover", "B站视频封面", "generate", compositeImage),
  catalog("product-main", "电商主图", "generate", compositeImage),
  catalog("detail-page", "详情页长图", "ai-suite", compositeImage),
  catalog("promo-banner", "大促Banner", "generate", compositeImage),
  catalog("coupon-card", "优惠券/红包封面", "generate", compositeImage),
  catalog("poster", "海报设计", "generate", compositeImage),
  catalog("event-poster", "节日热点海报", "generate", compositeImage),
  catalog("flyer", "宣传单页/DM", "generate", compositeImage),
  catalog("cover-art", "书籍/专辑封面", "generate", compositeImage),
  catalog("business-card", "名片设计", "generate", compositeImage),
  catalog("ppt-cover", "PPT封面/内页", "generate", compositeImage),
  catalog("logo-design", "Logo/图标设计", "generate", compositeImage),
  catalog("brand-suite", "品牌套件", "compose", compositeImage),
  catalog("invitation", "邀请函/请柬", "generate", compositeImage),
  catalog("certificate", "证书/奖状", "generate", compositeImage),
  catalog("avatar-banner", "头像/横幅", "generate", compositeImage),
  catalog("emoji-sticker", "表情包/贴纸", "ai-suite", compositeImage),
  catalog("canvas-editor", "画布自由编辑", "editor", compositeImage),
]);

const MAKE_CATALOG = Object.freeze(
  [
    ["tshirt", "定制T恤"],
    ["mug", "定制马克杯"],
    ["tote", "定制帆布包"],
    ["phonecase", "定制手机壳"],
    ["pillow", "定制抱枕"],
    ["postcard", "定制明信片"],
    ["sticker", "定制贴纸"],
    ["badge", "定制徽章"],
    ["canvas-art", "定制装饰画"],
    ["calendar", "定制台历"],
    ["keychain", "定制钥匙扣"],
    ["cap", "定制帽子"],
    ["gift-box", "定制礼盒套装"],
    ["couple-set", "情侣定制套装"],
    ["pet-goods", "萌宠定制好物"],
    ["team-uniform", "团队定制装"],
    ["notebook", "定制笔记本"],
    ["apron", "定制围裙"],
    ["puzzle", "定制拼图"],
    ["fridge-magnet", "定制冰箱贴"],
  ].map(([id, name]) => catalog(id!, name!, "make.make", workflow)),
);

const DESIGN_EDITOR_MESSAGES = Object.freeze([
  "ready",
  "open-asset",
  "dirty",
  "artifact-created",
  "error",
  "save-request",
  "save-result",
  "export-request",
  "export-result",
  "dispose",
  "command-result",
  "history-changed",
]);

export const CREATION_PROTOCOLS: Readonly<
  Record<CreationSiteKey, CreationTenantProtocol>
> = Object.freeze({
  ecommerce: Object.freeze({
    siteKey: "ecommerce",
    pluginId: "ecommerce-asset-studio",
    displayName: "LeoStudio",
    sourceRoot: "/root/projects/ecommerce-assets/frontend",
    catalogSource: "ecommerce-assets:frontend/lib/app-catalog.ts",
    catalog: ECOMMERCE_CATALOG,
    artifactTypes: Object.freeze(["single_file_image", "document"]),
    contextPattern: "olctx:v1:ecommerce:app:<appId>",
    template: Object.freeze({
      id: "goal-app-guide-sections@1",
      source: "ecommerce-assets:frontend/lib/app-catalog.ts",
      categories: Object.freeze([
        "主图爆款",
        "详情页",
        "模特实拍",
        "场景氛围",
        "文案标题",
        "活动大促",
      ]),
    }),
    upload: Object.freeze({
      route: "/api/upload",
      maxBytes: 12 * 1024 * 1024,
      bucket: "media-uploads",
      pathPrefix: "leostudio/",
    }),
  }),
  novel: Object.freeze({
    siteKey: "novel",
    pluginId: "novel-workbench",
    displayName: "LeoNovel",
    sourceRoot: "/root/projects/novel",
    catalogSource: "novel:lib/app-catalog.ts",
    catalog: NOVEL_CATALOG,
    artifactTypes: document,
    contextPattern: "olctx:v1:novel:app:<appId>",
    template: Object.freeze({
      id: "goal-app-guide-sections@1",
      source: "novel:lib/app-catalog.ts",
      categories: Object.freeze([
        "玄幻奇幻",
        "言情甜宠",
        "悬疑推理",
        "科幻脑洞",
        "都市现实",
        "历史古风",
      ]),
    }),
  }),
  script: Object.freeze({
    siteKey: "script",
    pluginId: "script-workbench",
    displayName: "LeoScript",
    sourceRoot: "/root/projects/script",
    catalogSource: "script:lib/app-catalog.ts",
    catalog: SCRIPT_CATALOG,
    artifactTypes: document,
    contextPattern: "olctx:v1:script:app:<appId>",
    template: Object.freeze({
      id: "script.quick-template.v1",
      source: "script:lib/quick-templates.ts",
      categories: Object.freeze([
        "剧本",
        "短视频",
        "广告营销",
        "影视解说",
        "配音有声",
        "直播",
      ]),
    }),
  }),
  design: Object.freeze({
    siteKey: "design",
    pluginId: "design-canvas",
    displayName: "LeoDesign",
    sourceRoot: "/root/projects/design",
    catalogSource: "design:lib/app-catalog.ts",
    catalog: DESIGN_CATALOG,
    artifactTypes: compositeImage,
    contextPattern: "olctx:v1:design:app:<appId>",
    template: Object.freeze({
      id: "asset.design-template-document.v1",
      source: "design:lib/materials.ts",
      categories: Object.freeze([
        "方形海报",
        "竖版海报",
        "名片",
        "LOGO",
        "邀请函",
        "展板",
      ]),
      documentUrlPattern:
        "https://asset.oceanleo.com/design-templates/doc/<templateId>.json",
    }),
    editor: Object.freeze({
      id: "oceanleo.editor.v1",
      projectSchema: "oceanleo.design-document.v1",
      artifactType: "composite_image",
      messages: DESIGN_EDITOR_MESSAGES,
    }),
  }),
  make: Object.freeze({
    siteKey: "make",
    pluginId: "custom-commerce-workbench",
    displayName: "LeoMake",
    sourceRoot: "/root/projects/make",
    catalogSource: "make:lib/app-catalog.ts",
    catalog: MAKE_CATALOG,
    artifactTypes: workflow,
    contextPattern: "olctx:v1:make:app:<appId>",
    template: Object.freeze({
      id: "asset.design-template-document.v1",
      source: "make:lib/materials.ts",
      categories: Object.freeze([
        "定制图案",
        "图形LOGO",
        "头像",
        "趣味贴纸",
      ]),
      documentUrlPattern:
        "https://asset.oceanleo.com/design-templates/doc/<templateId>.json",
    }),
  }),
});

export function creationProtocolFor(
  siteKey: CreationSiteKey,
): CreationTenantProtocol {
  return CREATION_PROTOCOLS[siteKey];
}

export function creationCatalogEntry(
  siteKey: CreationSiteKey,
  appId: string | null | undefined,
): CreationCatalogEntry | null {
  const normalized = String(appId ?? "").trim();
  if (!normalized) return null;
  return (
    CREATION_PROTOCOLS[siteKey].catalog.find(
      (entry) => entry.id === normalized,
    ) ?? null
  );
}
