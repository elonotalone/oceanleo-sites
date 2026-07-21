export type SlotType = "text" | "longtext" | "color" | "image" | "url";

export interface TemplateSlot {
  id: string;
  label_zh: string;
  label_en: string;
  type: SlotType;
  default: string;
  group?: string;
}

export const LANDING_SLOTS: TemplateSlot[] = [
  {
    id: "brand.name",
    label_zh: "品牌名称",
    label_en: "Brand name",
    type: "text",
    default: "Mycreator",
    group: "brand",
  },
  {
    id: "brand.logo",
    label_zh: "品牌 Logo URL",
    label_en: "Brand logo URL",
    type: "image",
    default: "",
    group: "brand",
  },
  {
    id: "hero.title",
    label_zh: "主标题",
    label_en: "Hero title",
    type: "text",
    default: "用自然语言构建你自己的网站",
    group: "hero",
  },
  {
    id: "hero.subtitle",
    label_zh: "副标题",
    label_en: "Hero subtitle",
    type: "longtext",
    default: "代码归你、基础设施归你。描述想要什么，AI 写给你看。",
    group: "hero",
  },
  {
    id: "hero.cta_primary",
    label_zh: "主按钮文案",
    label_en: "Primary CTA",
    type: "text",
    default: "立即开始",
    group: "hero",
  },
  {
    id: "hero.cta_secondary",
    label_zh: "次按钮文案",
    label_en: "Secondary CTA",
    type: "text",
    default: "浏览模板",
    group: "hero",
  },
  {
    id: "hero.image",
    label_zh: "Hero 配图 URL",
    label_en: "Hero image URL",
    type: "image",
    default: "",
    group: "hero",
  },
  {
    id: "hero.bg_color",
    label_zh: "Hero 背景色",
    label_en: "Hero background",
    type: "color",
    default: "#0f172a",
    group: "hero",
  },
  {
    id: "hero.text_color",
    label_zh: "Hero 文字颜色",
    label_en: "Hero text color",
    type: "color",
    default: "#ffffff",
    group: "hero",
  },
  {
    id: "feature1.title",
    label_zh: "功能 1 标题",
    label_en: "Feature 1 title",
    type: "text",
    default: "你拥有代码",
    group: "features",
  },
  {
    id: "feature1.desc",
    label_zh: "功能 1 描述",
    label_en: "Feature 1 description",
    type: "longtext",
    default: "每一行代码都在你自己的 GitHub 仓库里。",
    group: "features",
  },
  {
    id: "feature2.title",
    label_zh: "功能 2 标题",
    label_en: "Feature 2 title",
    type: "text",
    default: "你拥有基础设施",
    group: "features",
  },
  {
    id: "feature2.desc",
    label_zh: "功能 2 描述",
    label_en: "Feature 2 description",
    type: "longtext",
    default: "部署到你自己的 Vercel + Supabase，不锁定。",
    group: "features",
  },
  {
    id: "feature3.title",
    label_zh: "功能 3 标题",
    label_en: "Feature 3 title",
    type: "text",
    default: "自然语言编辑",
    group: "features",
  },
  {
    id: "feature3.desc",
    label_zh: "功能 3 描述",
    label_en: "Feature 3 description",
    type: "longtext",
    default: "描述变更，AI 帮你改代码提 PR。",
    group: "features",
  },
  {
    id: "cta.title",
    label_zh: "底部 CTA 标题",
    label_en: "Footer CTA title",
    type: "text",
    default: "准备好了吗？",
    group: "cta",
  },
  {
    id: "cta.desc",
    label_zh: "底部 CTA 描述",
    label_en: "Footer CTA description",
    type: "longtext",
    default: "几分钟内拥有一个可上线的网站。",
    group: "cta",
  },
  {
    id: "cta.button",
    label_zh: "底部按钮文案",
    label_en: "Footer CTA button",
    type: "text",
    default: "开始部署",
    group: "cta",
  },
  {
    id: "cta.bg_color",
    label_zh: "底部 CTA 背景色",
    label_en: "Footer CTA background",
    type: "color",
    default: "#111827",
    group: "cta",
  },
];

export const BUILTIN_SLOTS: Record<string, TemplateSlot[]> = {
  default: LANDING_SLOTS,
};

export function resolveSlots(
  slug: string,
  templateRow: { slots?: unknown } | null,
): TemplateSlot[] {
  if (
    templateRow &&
    Array.isArray(templateRow.slots) &&
    templateRow.slots.length > 0
  ) {
    return templateRow.slots as TemplateSlot[];
  }
  return BUILTIN_SLOTS[slug] || LANDING_SLOTS;
}

export function buildDefaults(slots: TemplateSlot[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slot of slots) out[slot.id] = slot.default;
  return out;
}

export function mergeOverrides(
  slots: TemplateSlot[],
  overrides: Record<string, string> | null | undefined,
): Record<string, string> {
  const defaults = buildDefaults(slots);
  if (!overrides) return defaults;
  return { ...defaults, ...overrides };
}
