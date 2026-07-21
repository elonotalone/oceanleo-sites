import type {
  FeatureGridSection,
  FooterSection,
  HeroSection,
  PricingSection,
  StatsSection,
  VirtualEditorBreakpointStyles,
  VirtualEditorStyle,
  VirtualElementLayout,
  VirtualImageDescriptor,
  VirtualNavigationItem,
  VirtualSectionStyle,
  VirtualSectionType,
  VirtualSiteConfig,
  VirtualSitePage,
  VirtualSiteSection,
  VirtualSiteTypography,
} from "./virtual-site-types";

const DEFAULT_THEME_COLOR = "#2563eb";
const DEFAULT_BACKGROUND_COLOR = "#fafafa";
const FIRST_PARTY_IMAGE_ROOT =
  "https://oceanleo-assets.oss-cn-guangzhou.aliyuncs.com/assets/image/design-scene";
const FIRST_PARTY_IMAGE_NAMES = [
  "design-scene-tech-01.webp",
  "design-scene-office-01.webp",
  "design-scene-store-01.webp",
  "design-scene-cafe-01.webp",
  "design-scene-mountain-01.webp",
  "design-scene-autumn-01.webp",
  "design-scene-citynight-01.webp",
  "design-scene-classroom-01.webp",
] as const;
const DEFAULT_TYPOGRAPHY: VirtualSiteTypography = {
  bodyFont: "sans",
  headingFont: "sans",
  baseSize: 16,
  lineHeight: 1.6,
  headingWeight: 700,
};
const DEFAULT_SECTION_STYLE: VirtualSectionStyle = {
  paddingTop: 56,
  paddingBottom: 56,
  contentWidth: "normal",
  alignment: "left",
  layout: "default",
  cornerRadius: 24,
  borderWidth: 0,
};

const NAMED_COLORS: Record<string, string> = {
  blue: "#2563eb",
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  orange: "#ea580c",
  purple: "#7c3aed",
  pink: "#db2777",
  teal: "#0d9488",
  indigo: "#4f46e5",
  gray: "#6b7280",
  black: "#111827",
};

const SECTION_TYPE_ALIASES: Record<string, VirtualSectionType> = {
  hero: "hero",
  stats: "stats",
  featuregrid: "feature-grid",
  "feature-grid": "feature-grid",
  features: "feature-grid",
  pricing: "pricing",
  plans: "pricing",
  footer: "footer",
  contact: "footer",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

const LEGACY_SECTION_ANCHORS: Record<string, string> = {
  "#hero": "#hero-1",
  "#features": "#feature-grid-1",
  "#pricing": "#pricing-1",
  "#footer": "#footer-1",
};

/** Allow navigable links while rejecting executable and protocol-relative URLs. */
export function normalizeVirtualHref(
  value: unknown,
  fallback = "#",
): string {
  if (typeof value !== "string") return fallback;
  const input = value.trim();
  if (!input) return fallback;
  if (LEGACY_SECTION_ANCHORS[input]) return LEGACY_SECTION_ANCHORS[input];
  if (input.startsWith("#")) return /^#[a-z0-9_-]+$/i.test(input) ? input : fallback;
  if (input.startsWith("/") && !input.startsWith("//")) return input;
  if (/^(?:mailto:[^\s@]+@[^\s@]+|tel:\+?[0-9() .-]+)$/i.test(input)) {
    return input;
  }
  try {
    const parsed = new URL(input);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : fallback;
  } catch {
    return fallback;
  }
}

function normalizeColor(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  const input = value.trim().toLowerCase();
  if (NAMED_COLORS[input]) {
    return NAMED_COLORS[input];
  }

  const isHex = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(input);
  return isHex ? input : fallback;
}

function normalizeOptionalColor(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = normalizeColor(value, "");
  return normalized || undefined;
}

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function normalizeElementLayout(value: unknown): VirtualElementLayout {
  const raw = asRecord(value) ?? {};
  const layout: VirtualElementLayout = {};
  for (const key of ["x", "y", "w", "h", "order"] as const) {
    const parsed = typeof raw[key] === "number" ? raw[key] : Number(raw[key]);
    if (!Number.isFinite(parsed)) continue;
    if ((key === "w" || key === "h") && parsed <= 0) continue;
    const bounded = Math.min(100_000, Math.max(key === "w" || key === "h" ? 1 : -100_000, parsed));
    layout[key] = key === "order" ? Math.round(bounded) : bounded;
  }
  return layout;
}

function normalizeSectionStyle(value: unknown): VirtualSectionStyle {
  const raw = asRecord(value) ?? {};
  const contentWidth = ["narrow", "normal", "wide", "full"].includes(String(raw.contentWidth))
    ? (raw.contentWidth as VirtualSectionStyle["contentWidth"])
    : DEFAULT_SECTION_STYLE.contentWidth;
  const alignment = raw.alignment === "center" ? "center" : "left";
  const layout = ["default", "reverse", "stacked"].includes(String(raw.layout))
    ? (raw.layout as VirtualSectionStyle["layout"])
    : "default";
  return {
    ...(normalizeOptionalColor(raw.backgroundColor)
      ? { backgroundColor: normalizeOptionalColor(raw.backgroundColor) }
      : {}),
    ...(normalizeOptionalColor(raw.textColor)
      ? { textColor: normalizeOptionalColor(raw.textColor) }
      : {}),
    paddingTop: boundedNumber(raw.paddingTop, 56, 0, 240),
    paddingBottom: boundedNumber(raw.paddingBottom, 56, 0, 240),
    contentWidth,
    alignment,
    layout,
    cornerRadius: boundedNumber(raw.cornerRadius, 24, 0, 64),
    borderWidth: boundedNumber(raw.borderWidth, 0, 0, 16),
    ...(normalizeOptionalColor(raw.borderColor)
      ? { borderColor: normalizeOptionalColor(raw.borderColor) }
      : {}),
  };
}

function normalizeTypography(value: unknown): VirtualSiteTypography {
  const raw = asRecord(value) ?? {};
  const font = (candidate: unknown, fallback: VirtualSiteTypography["bodyFont"]) =>
    ["sans", "serif", "mono"].includes(String(candidate))
      ? (candidate as VirtualSiteTypography["bodyFont"])
      : fallback;
  return {
    bodyFont: font(raw.bodyFont, DEFAULT_TYPOGRAPHY.bodyFont),
    headingFont: font(raw.headingFont, DEFAULT_TYPOGRAPHY.headingFont),
    baseSize: boundedNumber(raw.baseSize, DEFAULT_TYPOGRAPHY.baseSize, 12, 24),
    lineHeight: boundedNumber(raw.lineHeight, DEFAULT_TYPOGRAPHY.lineHeight, 1, 2.2),
    headingWeight: boundedNumber(raw.headingWeight, DEFAULT_TYPOGRAPHY.headingWeight, 400, 900),
  };
}

const EDITOR_STYLE_ID =
  /^(?:field:[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)+|section:[A-Za-z0-9_.-]+|nav:\d+|site-(?:name|header|root))$/;
const EDITOR_STYLE_STRING_KEYS = new Set<keyof VirtualEditorStyle>([
  "color",
  "backgroundColor",
  "fontFamily",
  "fontWeight",
  "textAlign",
  "border",
  "display",
  "borderColor",
  "borderStyle",
]);
const EDITOR_STYLE_NUMBER_BOUNDS: Partial<
  Record<keyof VirtualEditorStyle, readonly [number, number]>
> = {
  fontSize: [1, 512],
  borderRadius: [0, 512],
  padding: [0, 1_000],
  margin: [0, 1_000],
  opacity: [0, 1],
  gap: [0, 1_000],
  borderWidth: [0, 32],
  left: [-100_000, 100_000],
  top: [-100_000, 100_000],
  width: [1, 100_000],
  height: [1, 100_000],
  order: [-100_000, 100_000],
};

const EDITOR_STYLE_BREAKPOINTS = [
  "base",
  "mobile",
  "tablet",
  "desktop",
] as const;

function normalizeEditorStyle(value: unknown): VirtualEditorStyle | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const style: VirtualEditorStyle = {};
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const key = rawKey as keyof VirtualEditorStyle;
    if (key === "position" && rawValue === "relative") {
      style.position = rawValue;
      continue;
    }
    if (
      EDITOR_STYLE_STRING_KEYS.has(key) &&
      typeof rawValue === "string" &&
      rawValue.length <= 200
    ) {
      style[key] = rawValue as never;
      continue;
    }
    const bounds = EDITOR_STYLE_NUMBER_BOUNDS[key];
    if (
      bounds &&
      typeof rawValue === "number" &&
      Number.isFinite(rawValue) &&
      rawValue >= bounds[0] &&
      rawValue <= bounds[1] &&
      (key !== "order" || Number.isInteger(rawValue))
    ) {
      style[key] = rawValue as never;
    }
  }
  return Object.keys(style).length ? style : undefined;
}

function normalizeEditorStyles(
  value: unknown,
): Record<string, VirtualEditorBreakpointStyles> | undefined {
  const source = asRecord(value);
  if (!source) return undefined;
  const result: Record<string, VirtualEditorBreakpointStyles> = {};
  for (const [selectionId, candidate] of Object.entries(source).slice(0, 2_000)) {
    const raw = asRecord(candidate);
    if (selectionId.length > 80 || !EDITOR_STYLE_ID.test(selectionId) || !raw) {
      continue;
    }
    const responsive: VirtualEditorBreakpointStyles = {};
    // v1 stored the style object directly. Keep valid legacy properties in
    // the shared base layer; an explicit base bucket wins on mixed payloads.
    const legacyBase = normalizeEditorStyle(raw);
    const explicitBase = normalizeEditorStyle(raw.base);
    const base =
      legacyBase || explicitBase
        ? { ...(legacyBase ?? {}), ...(explicitBase ?? {}) }
        : undefined;
    if (base && Object.keys(base).length) responsive.base = base;
    for (const breakpoint of EDITOR_STYLE_BREAKPOINTS.slice(1)) {
      const style = normalizeEditorStyle(raw[breakpoint]);
      if (style) responsive[breakpoint] = style;
    }
    if (Object.keys(responsive).length) result[selectionId] = responsive;
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizeSectionType(value: unknown): VirtualSectionType | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "")
    .replace(/_/g, "-");

  return SECTION_TYPE_ALIASES[normalized] ?? null;
}

function normalizeImage(
  value: unknown,
  fallbackKeyword: string,
  fallbackAlt: string,
): VirtualImageDescriptor {
  const directUrl =
    typeof value === "string" && /^https?:\/\//i.test(value.trim())
      ? value.trim()
      : "";
  const raw = asRecord(value);
  const url = typeof raw?.url === "string" && /^https?:\/\//i.test(raw.url.trim())
    ? raw.url.trim()
    : directUrl;
  return {
    keyword: asString(raw?.keyword, fallbackKeyword),
    alt: asString(raw?.alt, fallbackAlt),
    ...(url ? { url } : {}),
  };
}

function normalizeNavigation(value: unknown): VirtualNavigationItem[] {
  if (!Array.isArray(value)) {
    return [
      { label: "Home", href: "#hero-1" },
      { label: "Features", href: "#feature-grid-1" },
      { label: "Pricing", href: "#pricing-1" },
      { label: "Contact", href: "#footer-1" },
    ];
  }

  const nav = value
    .map((item) => {
      const raw = asRecord(item);
      if (!raw) {
        return null;
      }
      return {
        label: asString(raw.label, ""),
        href: normalizeVirtualHref(raw.href),
      };
    })
    .filter((item): item is VirtualNavigationItem => Boolean(item?.label));

  return nav.length
    ? nav
    : [
        { label: "Home", href: "#hero-1" },
        { label: "Features", href: "#feature-grid-1" },
        { label: "Pricing", href: "#pricing-1" },
        { label: "Contact", href: "#footer-1" },
      ];
}

function normalizeHeroSection(raw: Record<string, unknown>, id: string): HeroSection {
  const content = asRecord(raw.content) ?? {};
  return {
    id,
    type: "hero",
    style: normalizeSectionStyle(raw.style),
    layout: normalizeElementLayout(raw.layout),
    content: {
      eyebrow: asString(content.eyebrow, "AI-Powered Experience"),
      title: asString(content.title, "Showcase your product vision fast"),
      subtitle: asString(
        content.subtitle,
        "Generate a demo-ready virtual page in seconds without building a full website.",
      ),
      primaryCtaLabel: asString(content.primaryCtaLabel, "Get Started"),
      primaryCtaHref: normalizeVirtualHref(content.primaryCtaHref, "#pricing-1"),
      secondaryCtaLabel: asString(content.secondaryCtaLabel, "Explore Features"),
      secondaryCtaHref: normalizeVirtualHref(
        content.secondaryCtaHref,
        "#feature-grid-1",
      ),
      image: normalizeImage(content.image, "saas dashboard", "Product dashboard preview"),
    },
  };
}

function normalizeStatsSection(raw: Record<string, unknown>, id: string): StatsSection {
  const content = asRecord(raw.content) ?? {};
  const stats = Array.isArray(content.items)
    ? content.items
        .map((item) => {
          const stat = asRecord(item);
          if (!stat) {
            return null;
          }
          return {
            label: asString(stat.label, ""),
            value: asString(stat.value, ""),
            description: asString(stat.description, ""),
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item?.label && item?.value))
    : [];

  return {
    id,
    type: "stats",
    style: normalizeSectionStyle(raw.style),
    layout: normalizeElementLayout(raw.layout),
    content: {
      title: asString(content.title, "Core Growth Metrics"),
      subtitle: asString(content.subtitle, "Make your demo more convincing"),
      items: stats.length
        ? stats
        : [
            {
              label: "Conversion Uplift",
              value: "42%",
              description: "Optimized with intelligent flows",
            },
            {
              label: "Launch Speed",
              value: "6x",
              description: "From idea to demo, faster",
            },
            {
              label: "Customer Satisfaction",
              value: "4.9/5",
              description: "A clearer product experience",
            },
          ],
      image: normalizeImage(content.image, "analytics dashboard", "Growth analytics chart"),
    },
  };
}

function normalizeFeatureGridSection(
  raw: Record<string, unknown>,
  id: string,
): FeatureGridSection {
  const content = asRecord(raw.content) ?? {};
  const features = Array.isArray(content.features)
    ? content.features
        .map((item) => {
          const feature = asRecord(item);
          if (!feature) {
            return null;
          }
          return {
            icon: asString(feature.icon, "✨"),
            title: asString(feature.title, ""),
            description: asString(feature.description, ""),
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item?.title && item?.description))
    : [];

  return {
    id,
    type: "feature-grid",
    style: normalizeSectionStyle(raw.style),
    layout: normalizeElementLayout(raw.layout),
    content: {
      title: asString(content.title, "What You Get"),
      subtitle: asString(
        content.subtitle,
        "Present your key value propositions with modular sections.",
      ),
      features: features.length
        ? features
        : [
            {
              icon: "⚡",
              title: "Launch in Minutes",
              description:
                "Turn ideas into a shareable virtual website prototype right away.",
            },
            {
              icon: "🧠",
              title: "AI Marketing Copy",
              description:
                "Generate persuasive copy for demos, pitches, and landing pages.",
            },
            {
              icon: "🎨",
              title: "Consistent Visual Style",
              description:
                "Keep branding unified with theme colors and structured section templates.",
            },
          ],
      image: normalizeImage(content.image, "product feature cards", "Feature showcase cards"),
    },
  };
}

function normalizePricingSection(raw: Record<string, unknown>, id: string): PricingSection {
  const content = asRecord(raw.content) ?? {};
  const plans = Array.isArray(content.plans)
    ? content.plans
        .map((item) => {
          const plan = asRecord(item);
          if (!plan) {
            return null;
          }
          return {
            name: asString(plan.name, ""),
            price: asString(plan.price, ""),
            description: asString(plan.description, ""),
            ctaLabel: asString(plan.ctaLabel, "Choose Plan"),
            highlights: asStringArray(plan.highlights),
            featured: Boolean(plan.featured),
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item?.name && item?.price))
    : [];

  return {
    id,
    type: "pricing",
    style: normalizeSectionStyle(raw.style),
    layout: normalizeElementLayout(raw.layout),
    content: {
      title: asString(content.title, "Flexible Plans"),
      subtitle: asString(content.subtitle, "Pick the plan that fits your demo goals"),
      plans: plans.length
        ? plans
        : [
            {
              name: "Starter",
              price: "$0",
              description: "Validate your product direction quickly",
              ctaLabel: "Start Free",
              highlights: ["1 virtual site", "Core section templates", "Standard AI copy"],
              featured: false,
            },
            {
              name: "Pro",
              price: "$99/mo",
              description: "Best for team demos and client pitches",
              ctaLabel: "Upgrade Now",
              highlights: [
                "Unlimited sites",
                "Advanced layouts",
                "Context-aware incremental edits",
              ],
              featured: true,
            },
          ],
      image: normalizeImage(content.image, "pricing table saas", "Pricing plan comparison"),
    },
  };
}

function normalizeFooterSection(raw: Record<string, unknown>, id: string): FooterSection {
  const content = asRecord(raw.content) ?? {};
  const links = Array.isArray(content.links)
    ? content.links
        .map((item) => {
          const link = asRecord(item);
          if (!link) {
            return null;
          }
          return {
            label: asString(link.label, ""),
            href: normalizeVirtualHref(link.href),
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item?.label))
    : [];

  return {
    id,
    type: "footer",
    style: normalizeSectionStyle(raw.style),
    layout: normalizeElementLayout(raw.layout),
    content: {
      title: asString(content.title, "Ready to launch your demo?"),
      description: asString(
        content.description,
        "Validate direction with a virtual site first, then invest in full development.",
      ),
      ctaLabel: asString(content.ctaLabel, "Start Building"),
      ctaHref: normalizeVirtualHref(content.ctaHref, "#hero-1"),
      links: links.length
        ? links
        : [
            { label: "Documentation", href: "#" },
            { label: "Support", href: "#" },
          ],
      image: normalizeImage(content.image, "team collaboration", "Team collaboration session"),
    },
  };
}

function normalizeSection(section: unknown, index: number): VirtualSiteSection | null {
  const raw = asRecord(section);
  if (!raw) {
    return null;
  }

  const type = normalizeSectionType(raw.type);
  if (!type) {
    return null;
  }

  const id =
    asString(raw.id, `${type}-${index + 1}`)
      .trim()
      .replace(/[^A-Za-z0-9_.-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 32) || `${type}-${index + 1}`;
  switch (type) {
    case "hero":
      return normalizeHeroSection(raw, id);
    case "stats":
      return normalizeStatsSection(raw, id);
    case "feature-grid":
      return normalizeFeatureGridSection(raw, id);
    case "pricing":
      return normalizePricingSection(raw, id);
    case "footer":
      return normalizeFooterSection(raw, id);
    default:
      return null;
  }
}

/**
 * Build a section of `type` filled with the same defaults the normalizers
 * use. The visual editor's "add block" uses this so new blocks and
 * AI-generated blocks share one source of truth.
 */
export function createDefaultSection(type: VirtualSectionType): VirtualSiteSection {
  const id = `${type}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const section = normalizeSection({ type, id }, 0);
  if (!section) {
    throw new Error(`Unknown section type: ${type}`);
  }
  return section;
}

const DEFAULT_SECTIONS: VirtualSiteSection[] = [
  normalizeHeroSection({}, "hero-1"),
  normalizeStatsSection({}, "stats-1"),
  normalizeFeatureGridSection({}, "feature-grid-1"),
  normalizePricingSection({}, "pricing-1"),
  normalizeFooterSection({}, "footer-1"),
];

function normalizedPagePath(value: unknown, fallback: string): string {
  const input = typeof value === "string" ? value : fallback;
  const segments = input
    .replace(/^\/+/, "")
    .split("/")
    .map((part) =>
      part
        .replace(/[^a-z0-9_-]+/gi, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 64),
    )
    .filter(Boolean)
    .slice(0, 6);
  return `/${segments.join("/") || fallback.replace(/^\/+/, "")}`;
}

function uniquePagePath(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const segments = base.replace(/^\/+/, "").split("/");
  const leaf = segments.pop() || "page";
  let serial = 2;
  let candidate = base;
  do {
    segments.push(`${leaf.slice(0, 58)}-${serial}`);
    candidate = `/${segments.join("/")}`;
    segments.pop();
    serial += 1;
  } while (used.has(candidate));
  used.add(candidate);
  return candidate;
}

function uniquePageId(value: unknown, fallback: string, used: Set<string>): string {
  const base = asString(value, fallback)
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || fallback;
  let candidate = base;
  let serial = 2;
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 74)}-${serial}`;
    serial += 1;
  }
  used.add(candidate);
  return candidate;
}

export const defaultVirtualSiteConfig: VirtualSiteConfig = {
  siteName: "Virtual Launch Studio",
  themeColor: DEFAULT_THEME_COLOR,
  backgroundColor: DEFAULT_BACKGROUND_COLOR,
  typography: DEFAULT_TYPOGRAPHY,
  navigation: [
    { label: "Home", href: "#hero-1" },
    { label: "Features", href: "#feature-grid-1" },
    { label: "Pricing", href: "#pricing-1" },
    { label: "Contact", href: "#footer-1" },
  ],
  sections: DEFAULT_SECTIONS,
  pages: [
    {
      id: "home",
      name: "Home",
      path: "/",
      title: "Virtual Launch Studio",
      description: "",
      sections: DEFAULT_SECTIONS,
    },
  ],
};

export function normalizeVirtualSiteConfig(value: unknown): VirtualSiteConfig {
  const raw = asRecord(value);
  if (!raw) {
    return defaultVirtualSiteConfig;
  }

  const rawPages = Array.isArray(raw.pages) ? raw.pages : [];
  const rawHome = asRecord(rawPages[0]);
  const sectionInput = Array.isArray(raw.sections)
    ? raw.sections
    : Array.isArray(rawHome?.sections)
      ? rawHome.sections
      : [];
  const sections = sectionInput
    ? sectionInput
        .map((section, index) => normalizeSection(section, index))
        .filter((section): section is VirtualSiteSection => Boolean(section))
    : [];
  const homeSections = sections.length ? sections : DEFAULT_SECTIONS;
  const siteName = asString(raw.siteName, defaultVirtualSiteConfig.siteName);
  const usedPaths = new Set<string>(["/"]);
  const usedPageIds = new Set<string>();
  const homeId = uniquePageId(rawHome?.id, "home", usedPageIds);
  const pages: VirtualSitePage[] = [
    {
      id: homeId,
      name: asString(rawHome?.name, "Home"),
      path: "/",
      title: asString(rawHome?.title, siteName),
      description: asString(rawHome?.description, ""),
      sections: homeSections,
    },
    ...rawPages.slice(1, 50).map((value, index) => {
      const page = asRecord(value) ?? {};
      const pageSections = Array.isArray(page.sections)
        ? page.sections
            .map((section, sectionIndex) => normalizeSection(section, sectionIndex))
            .filter((section): section is VirtualSiteSection => Boolean(section))
        : [];
      const fallback = `page-${index + 2}`;
      const path = uniquePagePath(
        normalizedPagePath(page.path, fallback),
        usedPaths,
      );
      return {
        id: uniquePageId(page.id, fallback, usedPageIds),
        name: asString(page.name, `Page ${index + 2}`),
        path,
        title: asString(page.title, asString(page.name, `Page ${index + 2}`)),
        description: asString(page.description, ""),
        sections: pageSections.length ? pageSections : [createDefaultSection("hero")],
      };
    }),
  ];
  const editorStyles = normalizeEditorStyles(raw.editorStyles);

  return {
    siteName,
    themeColor: normalizeColor(raw.themeColor, DEFAULT_THEME_COLOR),
    backgroundColor: normalizeColor(raw.backgroundColor, DEFAULT_BACKGROUND_COLOR),
    typography: normalizeTypography(raw.typography),
    navigation: normalizeNavigation(raw.navigation),
    sections: homeSections,
    pages,
    ...(editorStyles ? { editorStyles } : {}),
  };
}

/**
 * Resolve keyword-only image descriptors to a deterministic first-party
 * asset. Unsplash's retired source endpoint left every generated site with
 * permanent shimmer placeholders, so editor/runtime fallbacks must stay on
 * OceanLeo-controlled storage.
 */
export function getVirtualImageSource(keyword: string): string {
  let hash = 2166136261;
  for (const character of keyword.trim().toLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  const imageName =
    FIRST_PARTY_IMAGE_NAMES[(hash >>> 0) % FIRST_PARTY_IMAGE_NAMES.length];
  return `${FIRST_PARTY_IMAGE_ROOT}/${imageName}`;
}

/** @deprecated Use getVirtualImageSource; retained for older imports. */
export const getUnsplashSource = getVirtualImageSource;
