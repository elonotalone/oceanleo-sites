export type VirtualSectionType =
  | "hero"
  | "stats"
  | "feature-grid"
  | "pricing"
  | "footer";

export interface VirtualNavigationItem {
  label: string;
  href: string;
}

export interface VirtualImageDescriptor {
  keyword: string;
  alt: string;
  /** Explicit image URL (user-provided or uploaded). Wins over `keyword`. */
  url?: string;
}

export type VirtualFontFamily = "sans" | "serif" | "mono";
export type VirtualSectionLayout = "default" | "reverse" | "stacked";
export type VirtualContentWidth = "narrow" | "normal" | "wide" | "full";
export type VirtualTextAlign = "left" | "center";

export interface VirtualElementLayout {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  order?: number;
}

export interface VirtualSiteTypography {
  bodyFont: VirtualFontFamily;
  headingFont: VirtualFontFamily;
  baseSize: number;
  lineHeight: number;
  headingWeight: number;
}

/**
 * Deliberately bounded style vocabulary. The visual editor persists these
 * values instead of accepting arbitrary CSS or mutating a remote document.
 */
export interface VirtualSectionStyle {
  backgroundColor?: string;
  textColor?: string;
  paddingTop: number;
  paddingBottom: number;
  contentWidth: VirtualContentWidth;
  alignment: VirtualTextAlign;
  layout: VirtualSectionLayout;
  cornerRadius: number;
  borderWidth: number;
  borderColor?: string;
}

export interface HeroContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  primaryCtaLabel: string;
  primaryCtaHref: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  image: VirtualImageDescriptor;
}

export interface StatsContent {
  title: string;
  subtitle: string;
  items: Array<{
    label: string;
    value: string;
    description?: string;
  }>;
  image: VirtualImageDescriptor;
}

export interface FeatureGridContent {
  title: string;
  subtitle: string;
  features: Array<{
    icon: string;
    title: string;
    description: string;
  }>;
  image: VirtualImageDescriptor;
}

export interface PricingContent {
  title: string;
  subtitle: string;
  plans: Array<{
    name: string;
    price: string;
    description: string;
    ctaLabel: string;
    highlights: string[];
    featured?: boolean;
  }>;
  image: VirtualImageDescriptor;
}

export interface FooterContent {
  title: string;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
  links: Array<{
    label: string;
    href: string;
  }>;
  image: VirtualImageDescriptor;
}

export interface BaseSection<TType extends VirtualSectionType, TContent> {
  id: string;
  type: TType;
  content: TContent;
  style: VirtualSectionStyle;
  /** Optional bounded geometry used by the deterministic live editor. */
  layout?: VirtualElementLayout;
}

export type HeroSection = BaseSection<"hero", HeroContent>;
export type StatsSection = BaseSection<"stats", StatsContent>;
export type FeatureGridSection = BaseSection<"feature-grid", FeatureGridContent>;
export type PricingSection = BaseSection<"pricing", PricingContent>;
export type FooterSection = BaseSection<"footer", FooterContent>;

export type VirtualSiteSection =
  | HeroSection
  | StatsSection
  | FeatureGridSection
  | PricingSection
  | FooterSection;

export interface VirtualSitePage {
  id: string;
  name: string;
  /** Root-relative pathname. Home is "/"; nested pages use "/about". */
  path: string;
  title: string;
  description: string;
  sections: VirtualSiteSection[];
}

export interface VirtualEditorStyle {
  color?: string;
  backgroundColor?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  textAlign?: string;
  border?: string;
  borderRadius?: number;
  padding?: number;
  margin?: number;
  opacity?: number;
  display?: string;
  gap?: number;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: string;
  position?: "relative";
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  order?: number;
}

export type VirtualEditorBreakpoint =
  | "base"
  | "mobile"
  | "tablet"
  | "desktop";

/**
 * Serializable responsive editor cascade.
 *
 * `base` is shared by every viewport. Each named viewport overlays `base`
 * directly; viewport buckets never inherit from one another. This keeps a
 * desktop-only fixed width out of mobile while preserving ordinary shared
 * typography and color edits.
 */
export interface VirtualEditorBreakpointStyles {
  base?: VirtualEditorStyle;
  mobile?: VirtualEditorStyle;
  tablet?: VirtualEditorStyle;
  desktop?: VirtualEditorStyle;
}

export interface VirtualSiteConfig {
  siteName: string;
  themeColor: string;
  /** Page canvas/background color. */
  backgroundColor: string;
  typography: VirtualSiteTypography;
  navigation: VirtualNavigationItem[];
  /**
   * `sections` remains the home-page source for builder compatibility.
   * `pages[0].sections` is normalized to the same value.
   */
  sections: VirtualSiteSection[];
  pages: VirtualSitePage[];
  /**
   * Deterministic per-data-editor-id responsive overrides. Legacy flat style
   * records are normalized into the `base` bucket when an old site is opened.
   */
  editorStyles?: Record<string, VirtualEditorBreakpointStyles>;
}
