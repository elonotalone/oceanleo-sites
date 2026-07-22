import type { VirtualSiteConfig } from "../virtual-site-types";

export interface DevSourceFile {
  path: string;
  content: string;
}

export const GENERATED_EDITOR_STYLE_RUNTIME_SOURCE = `import type { CSSProperties } from "react";

export type EditorBreakpoint = "base" | "mobile" | "tablet" | "desktop";
type EditorStyle = CSSProperties & {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  order?: number;
};
type EditorBreakpointStyles = Partial<Record<EditorBreakpoint, EditorStyle>>;

const STABLE_ID = /^(?:field:[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)+|section:[A-Za-z0-9_.-]+|nav:\\d+|site-(?:name|header|root))$/;
const BREAKPOINT_QUERIES: Record<Exclude<EditorBreakpoint, "base">, string> = {
  mobile: "(max-width: 639px)",
  tablet: "(min-width: 640px) and (max-width: 1023px)",
  desktop: "(min-width: 1024px)",
};
const CSS_PROPERTIES: Record<string, string> = {
  color: "color",
  backgroundColor: "background-color",
  fontFamily: "font-family",
  fontSize: "font-size",
  fontWeight: "font-weight",
  textAlign: "text-align",
  border: "border",
  borderRadius: "border-radius",
  padding: "padding",
  margin: "margin",
  opacity: "opacity",
  display: "display",
  gap: "gap",
  borderColor: "border-color",
  borderWidth: "border-width",
  borderStyle: "border-style",
  position: "position",
  left: "left",
  top: "top",
  width: "width",
  height: "height",
  order: "order",
};
const UNITLESS = new Set(["opacity", "order"]);
const BREAKPOINT_KEYS = new Set(["base", "mobile", "tablet", "desktop"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function buckets(value: unknown): EditorBreakpointStyles {
  const source = record(value);
  if (!source) return {};
  const hasBreakpoint = Object.keys(source).some((key) => BREAKPOINT_KEYS.has(key));
  if (!hasBreakpoint) return { base: source as EditorStyle };
  const legacy = Object.fromEntries(
    Object.entries(source).filter(([key]) => !BREAKPOINT_KEYS.has(key)),
  ) as EditorStyle;
  const explicitBase = record(source.base);
  const result: EditorBreakpointStyles = {};
  if (Object.keys(legacy).length || explicitBase) {
    result.base = { ...legacy, ...(explicitBase || {}) } as EditorStyle;
  }
  for (const breakpoint of ["mobile", "tablet", "desktop"] as const) {
    const style = record(source[breakpoint]);
    if (style) result[breakpoint] = style as EditorStyle;
  }
  return result;
}

function cssValue(key: string, value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return UNITLESS.has(key) ? String(value) : String(value) + "px";
  }
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 200 ||
    /[\\u0000-\\u001f;{}<>\\\\]/.test(value)
  ) {
    return null;
  }
  if (key === "position" && value !== "relative") return null;
  return value;
}

function rule(selectionId: string, style: EditorStyle | undefined): string {
  if (!style || !STABLE_ID.test(selectionId)) return "";
  const declarations = Object.entries(style).flatMap(([key, value]) => {
    const property = CSS_PROPERTIES[key];
    const serialized = property ? cssValue(key, value) : null;
    return property && serialized !== null
      ? [property + ":" + serialized + "!important"]
      : [];
  });
  if (!declarations.length) return "";
  const root = '[data-oceanleo-editor-scope="generated-site"]';
  const target = '[data-editor-id="' + selectionId + '"]';
  return root + target + "," + root + " " + target + "{" +
    declarations.join(";") + "}";
}

export function buildEditorStyleCss(value: unknown): string {
  const source = record(value);
  if (!source) return "";
  const base: string[] = [];
  const responsive: Record<Exclude<EditorBreakpoint, "base">, string[]> = {
    mobile: [],
    tablet: [],
    desktop: [],
  };
  for (const [selectionId, rawStyle] of Object.entries(source).slice(0, 2_000)) {
    const styles = buckets(rawStyle);
    const baseRule = rule(selectionId, styles.base);
    if (baseRule) base.push(baseRule);
    for (const breakpoint of ["mobile", "tablet", "desktop"] as const) {
      const responsiveRule = rule(selectionId, styles[breakpoint]);
      if (responsiveRule) responsive[breakpoint].push(responsiveRule);
    }
  }
  return [
    ...base,
    ...(["mobile", "tablet", "desktop"] as const).flatMap((breakpoint) =>
      responsive[breakpoint].length
        ? ["@media " + BREAKPOINT_QUERIES[breakpoint] + "{" +
            responsive[breakpoint].join("") + "}"]
        : [],
    ),
  ].join("");
}
`;

const RENDERER_SOURCE = `import type { CSSProperties } from "react";
import { siteConfig } from "@/lib/site-config";
import { buildEditorStyleCss } from "@/lib/editor-style-runtime";

type Section = (typeof siteConfig.sections)[number] | any;
const widths: Record<string, string> = {
  narrow: "760px",
  normal: "1120px",
  wide: "1320px",
  full: "100%",
};

const editorStyleCss = buildEditorStyleCss((siteConfig as any).editorStyles);

function editStyle(_dataEditorId: string): CSSProperties {
  // Persisted overrides live in scoped CSS so media-query declarations can
  // override the renderer's authored inline defaults at one viewport only.
  return {};
}

function layoutStyle(layout: any): CSSProperties {
  if (!layout || typeof layout !== "object") return {};
  const hasOffset = Number.isFinite(layout.x) || Number.isFinite(layout.y);
  return {
    position: hasOffset ? "relative" : undefined,
    left: Number.isFinite(layout.x) ? layout.x : undefined,
    top: Number.isFinite(layout.y) ? layout.y : undefined,
    width: Number.isFinite(layout.w) ? layout.w : undefined,
    height: Number.isFinite(layout.h) ? layout.h : undefined,
    order: Number.isFinite(layout.order) ? layout.order : undefined,
  };
}

function imageSource(image: any): string {
  return image?.url || "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80";
}

function frame(section: Section): CSSProperties {
  const style = section.style || {};
  return {
    background: style.backgroundColor || "transparent",
    color: style.textColor || "inherit",
    paddingTop: style.paddingTop ?? 72,
    paddingBottom: style.paddingBottom ?? 72,
    border: \`\${style.borderWidth || 0}px solid \${style.borderColor || "transparent"}\`,
    borderRadius: style.cornerRadius || 0,
    textAlign: style.alignment || "left",
    ...layoutStyle(section.layout),
    ...editStyle(\`section:\${section.id}\`),
  };
}

function SectionView({ section }: { section: Section }) {
  const content = section.content || {};
  const inner: CSSProperties = {
    width: "100%",
    maxWidth: widths[section.style?.contentWidth || "normal"],
    margin: "0 auto",
    padding: "0 28px",
  };
  if (section.type === "hero") {
    return <section data-editor-id={\`section:\${section.id}\`} data-editor-structural="true" data-editor-layout="true" style={frame(section)}>
      <div style={{ ...inner, display: "grid", gap: 36, alignItems: "center", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
        <div>
          <p data-editor-id={\`field:\${section.id}:eyebrow\`} style={{ color: siteConfig.themeColor, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", ...editStyle(\`field:\${section.id}:eyebrow\`) }}>{content.eyebrow}</p>
          <h1 data-editor-id={\`field:\${section.id}:title\`} style={{ margin: "14px 0", fontSize: "clamp(42px,7vw,80px)", lineHeight: 1.02, ...editStyle(\`field:\${section.id}:title\`) }}>{content.title}</h1>
          <p data-editor-id={\`field:\${section.id}:subtitle\`} style={{ maxWidth: 680, fontSize: 20, opacity: .72, ...editStyle(\`field:\${section.id}:subtitle\`) }}>{content.subtitle}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 28 }}>
            <a data-editor-id={\`field:\${section.id}:primaryCtaLabel\`} href={content.primaryCtaHref || "#"} style={{ borderRadius: 999, background: siteConfig.themeColor, color: "white", padding: "13px 22px", fontWeight: 700, ...editStyle(\`field:\${section.id}:primaryCtaLabel\`) }}>{content.primaryCtaLabel}</a>
            {content.secondaryCtaLabel && <a data-editor-id={\`field:\${section.id}:secondaryCtaLabel\`} href={content.secondaryCtaHref || "#"} style={{ border: "1px solid currentColor", borderRadius: 999, padding: "13px 22px", ...editStyle(\`field:\${section.id}:secondaryCtaLabel\`) }}>{content.secondaryCtaLabel}</a>}
          </div>
        </div>
        {(content.image?.url || content.image?.keyword) && <img data-editor-id={\`field:\${section.id}:image\`} src={content.image.url || \`https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80\`} alt={content.image?.alt || ""} style={{ width: "100%", maxHeight: 520, objectFit: "cover", borderRadius: 28, ...editStyle(\`field:\${section.id}:image\`) }} />}
      </div>
    </section>;
  }
  if (section.type === "stats") {
    return <section data-editor-id={\`section:\${section.id}\`} data-editor-structural="true" data-editor-layout="true" style={frame(section)}><div style={inner}>
      <h2 data-editor-id={\`field:\${section.id}:title\`} style={{ fontSize: 42, ...editStyle(\`field:\${section.id}:title\`) }}>{content.title}</h2><p data-editor-id={\`field:\${section.id}:subtitle\`} style={{ opacity: .7, ...editStyle(\`field:\${section.id}:subtitle\`) }}>{content.subtitle}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 18, marginTop: 30 }}>
        {(content.items || []).map((item: any, index: number) => <article data-editor-id={\`field:\${section.id}:items:\${index}\`} data-editor-structural="true" key={index} style={{ border: "1px solid #e5e7eb", borderRadius: 20, padding: 24, ...editStyle(\`field:\${section.id}:items:\${index}\`) }}><strong data-editor-id={\`field:\${section.id}:items:\${index}:value\`} style={{ display: "block", fontSize: 36, color: siteConfig.themeColor, ...editStyle(\`field:\${section.id}:items:\${index}:value\`) }}>{item.value}</strong><b data-editor-id={\`field:\${section.id}:items:\${index}:label\`} style={editStyle(\`field:\${section.id}:items:\${index}:label\`)}>{item.label}</b><p data-editor-id={\`field:\${section.id}:items:\${index}:description\`} style={{ opacity: .65, ...editStyle(\`field:\${section.id}:items:\${index}:description\`) }}>{item.description}</p></article>)}
      </div>
      {content.image && <img data-editor-id={\`field:\${section.id}:image\`} src={imageSource(content.image)} alt={content.image.alt || ""} style={{ width: "100%", maxHeight: 420, objectFit: "cover", borderRadius: 24, marginTop: 28, ...editStyle(\`field:\${section.id}:image\`) }} />}
    </div></section>;
  }
  if (section.type === "feature-grid") {
    return <section data-editor-id={\`section:\${section.id}\`} data-editor-structural="true" data-editor-layout="true" style={frame(section)}><div style={inner}>
      <h2 data-editor-id={\`field:\${section.id}:title\`} style={{ fontSize: 42, ...editStyle(\`field:\${section.id}:title\`) }}>{content.title}</h2><p data-editor-id={\`field:\${section.id}:subtitle\`} style={{ opacity: .7, ...editStyle(\`field:\${section.id}:subtitle\`) }}>{content.subtitle}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 18, marginTop: 30 }}>
        {(content.features || []).map((item: any, index: number) => <article data-editor-id={\`field:\${section.id}:features:\${index}\`} data-editor-structural="true" key={index} style={{ background: "rgba(127,127,127,.07)", borderRadius: 20, padding: 24, ...editStyle(\`field:\${section.id}:features:\${index}\`) }}><span data-editor-id={\`field:\${section.id}:features:\${index}:icon\`} style={{ fontSize: 30, ...editStyle(\`field:\${section.id}:features:\${index}:icon\`) }}>{item.icon}</span><h3 data-editor-id={\`field:\${section.id}:features:\${index}:title\`} style={editStyle(\`field:\${section.id}:features:\${index}:title\`)}>{item.title}</h3><p data-editor-id={\`field:\${section.id}:features:\${index}:description\`} style={{ opacity: .7, ...editStyle(\`field:\${section.id}:features:\${index}:description\`) }}>{item.description}</p></article>)}
      </div>
      {content.image && <img data-editor-id={\`field:\${section.id}:image\`} src={imageSource(content.image)} alt={content.image.alt || ""} style={{ width: "100%", maxHeight: 420, objectFit: "cover", borderRadius: 24, marginTop: 28, ...editStyle(\`field:\${section.id}:image\`) }} />}
    </div></section>;
  }
  if (section.type === "pricing") {
    return <section data-editor-id={\`section:\${section.id}\`} data-editor-structural="true" data-editor-layout="true" style={frame(section)}><div style={inner}>
      <h2 data-editor-id={\`field:\${section.id}:title\`} style={{ fontSize: 42, ...editStyle(\`field:\${section.id}:title\`) }}>{content.title}</h2><p data-editor-id={\`field:\${section.id}:subtitle\`} style={{ opacity: .7, ...editStyle(\`field:\${section.id}:subtitle\`) }}>{content.subtitle}</p>
      {content.image && <img data-editor-id={\`field:\${section.id}:image\`} src={imageSource(content.image)} alt={content.image.alt || ""} style={{ width: "100%", maxHeight: 420, objectFit: "cover", borderRadius: 24, marginTop: 28, ...editStyle(\`field:\${section.id}:image\`) }} />}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 18, marginTop: 30 }}>
        {(content.plans || []).map((plan: any, index: number) => <article data-editor-id={\`field:\${section.id}:plans:\${index}\`} data-editor-structural="true" key={index} style={{ border: plan.featured ? \`2px solid \${siteConfig.themeColor}\` : "1px solid #e5e7eb", borderRadius: 22, padding: 26, ...editStyle(\`field:\${section.id}:plans:\${index}\`) }}><h3 data-editor-id={\`field:\${section.id}:plans:\${index}:name\`} style={editStyle(\`field:\${section.id}:plans:\${index}:name\`)}>{plan.name}</h3><strong data-editor-id={\`field:\${section.id}:plans:\${index}:price\`} style={{ fontSize: 38, ...editStyle(\`field:\${section.id}:plans:\${index}:price\`) }}>{plan.price}</strong><p data-editor-id={\`field:\${section.id}:plans:\${index}:description\`} style={editStyle(\`field:\${section.id}:plans:\${index}:description\`)}>{plan.description}</p><ul>{(plan.highlights || []).map((value: string, highlightIndex: number) => <li data-editor-id={\`field:\${section.id}:plans:\${index}:highlights:\${highlightIndex}\`} data-editor-structural="true" key={highlightIndex} style={{ listStyleType: '"✓ "', ...editStyle(\`field:\${section.id}:plans:\${index}:highlights:\${highlightIndex}\`) }}>{value}</li>)}</ul><button data-editor-id={\`field:\${section.id}:plans:\${index}:ctaLabel\`} style={{ marginTop: 18, borderRadius: 999, background: siteConfig.themeColor, color: "white", padding: "11px 18px", ...editStyle(\`field:\${section.id}:plans:\${index}:ctaLabel\`) }}>{plan.ctaLabel}</button></article>)}
      </div>
    </div></section>;
  }
  return <footer data-editor-id={\`section:\${section.id}\`} data-editor-structural="true" data-editor-layout="true" style={frame(section)}><div style={inner}><h2 data-editor-id={\`field:\${section.id}:title\`} style={editStyle(\`field:\${section.id}:title\`)}>{content.title}</h2><p data-editor-id={\`field:\${section.id}:description\`} style={editStyle(\`field:\${section.id}:description\`)}>{content.description}</p>{content.ctaLabel && <a data-editor-id={\`field:\${section.id}:ctaLabel\`} href={content.ctaHref || "#"} style={{ display: "inline-block", marginTop: 18, borderRadius: 999, background: siteConfig.themeColor, color: "white", padding: "11px 18px", ...editStyle(\`field:\${section.id}:ctaLabel\`) }}>{content.ctaLabel}</a>}{content.image && <img data-editor-id={\`field:\${section.id}:image\`} src={imageSource(content.image)} alt={content.image.alt || ""} style={{ width: "100%", maxHeight: 360, objectFit: "cover", borderRadius: 24, marginTop: 24, ...editStyle(\`field:\${section.id}:image\`) }} />}<div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 20 }}>{(content.links || []).map((item: any, index: number) => <span data-editor-id={\`field:\${section.id}:links:\${index}\`} data-editor-structural="true" key={index} style={{ display: "inline-flex", padding: 2, ...editStyle(\`field:\${section.id}:links:\${index}\`) }}><a data-editor-id={\`field:\${section.id}:links:\${index}:href\`} data-editor-text="false" href={item.href} style={editStyle(\`field:\${section.id}:links:\${index}:href\`)}><span data-editor-id={\`field:\${section.id}:links:\${index}:label\`} style={editStyle(\`field:\${section.id}:links:\${index}:label\`)}>{item.label}</span></a></span>)}</div></div></footer>;
}

export function GeneratedSite({ path = "/" }: { path?: string }) {
  const pages = (siteConfig as any).pages || [];
  const page = pages.find((candidate: any) => candidate.path === path) || pages[0];
  const sections = page?.sections || siteConfig.sections;
  const bodyFonts: Record<string, string> = { sans: "system-ui,sans-serif", serif: "Georgia,serif", mono: "ui-monospace,monospace" };
  return <div data-editor-id="site-root" data-oceanleo-editor-scope="generated-site" style={{ minHeight: "100vh", background: siteConfig.backgroundColor, color: "#18181b", fontFamily: bodyFonts[siteConfig.typography.bodyFont] || bodyFonts.sans, fontSize: siteConfig.typography.baseSize, lineHeight: siteConfig.typography.lineHeight, ...editStyle("site-root") }}>
    <style data-oceanleo-editor-styles dangerouslySetInnerHTML={{ __html: editorStyleCss }} />
    <header data-editor-id="site-header" style={{ position: "sticky", top: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 64, padding: "0 28px", borderBottom: "1px solid #e5e7eb", background: "rgba(255,255,255,.92)", backdropFilter: "blur(14px)", ...editStyle("site-header") }}>
      <a href="/" data-editor-id="site-name" style={{ color: siteConfig.themeColor, fontWeight: 800, ...editStyle("site-name") }}>{siteConfig.siteName}</a>
      <nav style={{ display: "flex", gap: 20 }}>{siteConfig.navigation.map((item: any, index: number) => <a data-editor-id={\`nav:\${index}\`} data-editor-structural="true" key={index} href={item.href} style={editStyle(\`nav:\${index}\`)}>{item.label}</a>)}</nav>
    </header>
    <main style={{ display: "flex", flexDirection: "column" }}>{sections.map((section: Section) => <SectionView key={section.id} section={section} />)}</main>
  </div>;
}
`;

export function virtualSiteDevFiles(config: VirtualSiteConfig): DevSourceFile[] {
  const serialized = JSON.stringify(config, null, 2);
  return [
    {
      path: "lib/site-config.ts",
      content: `export const siteConfig = ${serialized} as const;\n`,
    },
    {
      path: "lib/editor-style-runtime.ts",
      content: GENERATED_EDITOR_STYLE_RUNTIME_SOURCE,
    },
    {
      path: "components/generated-site.tsx",
      content: RENDERER_SOURCE,
    },
    {
      path: "app/page.tsx",
      content:
        'import { GeneratedSite } from "@/components/generated-site";\n\n' +
        "export default function Page() {\n" +
        '  return <GeneratedSite path="/" />;\n' +
        "}\n",
    },
    {
      path: "app/[...slug]/page.tsx",
      content:
        'import { GeneratedSite } from "@/components/generated-site";\n\n' +
        "export default async function Page({ params }: { params: Promise<{ slug: string[] }> }) {\n" +
        "  const { slug } = await params;\n" +
        '  return <GeneratedSite path={`/${slug.join("/")}`} />;\n' +
        "}\n",
    },
  ];
}
