// ---------------------------------------------------------------------------
// Render a VirtualSiteConfig to a single self-contained static index.html
// (宗旨 v21, 2026-07-09)
// ---------------------------------------------------------------------------
//
// Platform hosting on *.oceanleo.app is static-first (see
// docs/architecture/oceanleo-two-tier-classifier-and-platform-hosting.md §2.5):
// we do NOT run a Node build for each user site on the ECS box. Sites created
// via the OceanLeo builder are data-driven (VirtualSiteConfig), so we can emit
// a standalone HTML document — inline CSS, no JS framework, images via CDN —
// that the wildcard Caddy vhost serves directly. This is the honest artifact
// for the platform's default hosting path.
//
// The output intentionally mirrors the on-site React renderer's visual intent
// (hero / stats / feature-grid / pricing / footer) closely enough to be a
// faithful published version, while staying framework-free.

import type {
  VirtualSiteConfig,
  VirtualSiteSection,
  HeroContent,
  StatsContent,
  FeatureGridContent,
  PricingContent,
  FooterContent,
  VirtualSectionStyle,
  VirtualSitePage,
} from "./virtual-site-types";
import {
  getUnsplashSource,
  normalizeVirtualHref,
} from "./virtual-site-normalize";
import { pageById } from "./virtual-site-pages";

function esc(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function attr(s: string | undefined | null): string {
  return esc(s);
}

function img(descriptor: { keyword: string; alt: string; url?: string } | undefined): string {
  if (!descriptor?.keyword && !descriptor?.url) return "";
  const src = descriptor.url || getUnsplashSource(descriptor.keyword);
  return `<img class="oc-img" loading="lazy" src="${attr(src)}" alt="${attr(descriptor.alt)}">`;
}

const CONTENT_WIDTHS: Record<VirtualSectionStyle["contentWidth"], string> = {
  narrow: "760px",
  normal: "1152px",
  wide: "1440px",
  full: "none",
};

function sectionAttrs(
  style: VirtualSectionStyle,
  baseClass: string,
  id: string,
): string {
  const rules = [
    `padding-top:${style.paddingTop}px`,
    `padding-bottom:${style.paddingBottom}px`,
    `--oc-section-max:${CONTENT_WIDTHS[style.contentWidth]}`,
    `--oc-section-radius:${style.cornerRadius}px`,
    `text-align:${style.alignment}`,
    style.backgroundColor ? `background:${style.backgroundColor}` : "",
    style.textColor ? `color:${style.textColor}` : "",
    style.textColor ? `--oc-section-fg:${style.textColor}` : "",
    style.borderWidth > 0
      ? `border:${style.borderWidth}px solid ${style.borderColor || "#d4d4d8"}`
      : "",
  ].filter(Boolean);
  return `id="${attr(id)}" class="${attr(baseClass)} oc-layout-${attr(
    style.layout,
  )} oc-align-${attr(style.alignment)}${
    style.textColor ? " oc-has-text" : ""
  }" style="${attr(rules.join(";"))}"`;
}

function renderHero(
  c: HeroContent,
  style: VirtualSectionStyle,
  id: string,
): string {
  const secondary =
    c.secondaryCtaLabel && c.secondaryCtaHref
      ? `<a class="oc-btn oc-btn-ghost" href="${attr(normalizeVirtualHref(c.secondaryCtaHref))}">${esc(c.secondaryCtaLabel)}</a>`
      : "";
  return `<section ${sectionAttrs(style, "oc-hero", id)}>
    <div class="oc-section-inner oc-hero-inner">
    <div class="oc-hero-text">
      ${c.eyebrow ? `<p class="oc-eyebrow">${esc(c.eyebrow)}</p>` : ""}
      <h1>${esc(c.title)}</h1>
      <p class="oc-lead">${esc(c.subtitle)}</p>
      <div class="oc-cta-row">
        <a class="oc-btn oc-btn-primary" href="${attr(normalizeVirtualHref(c.primaryCtaHref))}">${esc(c.primaryCtaLabel)}</a>
        ${secondary}
      </div>
    </div>
    <div class="oc-hero-media">${img(c.image)}</div></div>
  </section>`;
}

function renderStats(
  c: StatsContent,
  style: VirtualSectionStyle,
  id: string,
): string {
  const items = c.items
    .map(
      (it) => `<div class="oc-stat">
        <div class="oc-stat-value">${esc(it.value)}</div>
        <div class="oc-stat-label">${esc(it.label)}</div>
        ${it.description ? `<div class="oc-stat-desc">${esc(it.description)}</div>` : ""}
      </div>`,
    )
    .join("");
  return `<section ${sectionAttrs(style, "oc-section oc-stats", id)}>
    <div class="oc-section-inner">
    <div class="oc-section-head"><h2>${esc(c.title)}</h2><p>${esc(c.subtitle)}</p></div>
    ${c.image ? `<div class="oc-section-media">${img(c.image)}</div>` : ""}
    <div class="oc-stat-grid">${items}</div></div>
  </section>`;
}

function renderFeatures(
  c: FeatureGridContent,
  style: VirtualSectionStyle,
  id: string,
): string {
  const cards = c.features
    .map(
      (f) => `<div class="oc-card">
        <div class="oc-card-icon">${esc(f.icon)}</div>
        <h3>${esc(f.title)}</h3>
        <p>${esc(f.description)}</p>
      </div>`,
    )
    .join("");
  return `<section ${sectionAttrs(style, "oc-section", id)}>
    <div class="oc-section-inner">
    <div class="oc-section-head"><h2>${esc(c.title)}</h2><p>${esc(c.subtitle)}</p></div>
    ${c.image ? `<div class="oc-section-media">${img(c.image)}</div>` : ""}
    <div class="oc-card-grid">${cards}</div></div>
  </section>`;
}

function renderPricing(
  c: PricingContent,
  style: VirtualSectionStyle,
  id: string,
): string {
  const plans = c.plans
    .map((p) => {
      const highlights = p.highlights
        .map((h) => `<li>${esc(h)}</li>`)
        .join("");
      return `<div class="oc-plan${p.featured ? " oc-plan-featured" : ""}">
        <h3>${esc(p.name)}</h3>
        <div class="oc-plan-price">${esc(p.price)}</div>
        <p class="oc-plan-desc">${esc(p.description)}</p>
        <ul class="oc-plan-list">${highlights}</ul>
        <a class="oc-btn ${p.featured ? "oc-btn-primary" : "oc-btn-ghost"}" href="#">${esc(p.ctaLabel)}</a>
      </div>`;
    })
    .join("");
  return `<section ${sectionAttrs(style, "oc-section oc-pricing", id)}>
    <div class="oc-section-inner">
    <div class="oc-section-head"><h2>${esc(c.title)}</h2><p>${esc(c.subtitle)}</p></div>
    ${c.image ? `<div class="oc-section-media">${img(c.image)}</div>` : ""}
    <div class="oc-plan-grid">${plans}</div></div>
  </section>`;
}

function renderFooter(
  c: FooterContent,
  style: VirtualSectionStyle,
  id: string,
): string {
  const links = c.links
    .map(
      (l) =>
        `<a href="${attr(normalizeVirtualHref(l.href))}">${esc(l.label)}</a>`,
    )
    .join("");
  const cta =
    c.ctaLabel && c.ctaHref
      ? `<a class="oc-btn oc-btn-primary" href="${attr(normalizeVirtualHref(c.ctaHref))}">${esc(c.ctaLabel)}</a>`
      : "";
  return `<footer ${sectionAttrs(style, "oc-footer", id)}><div class="oc-section-inner oc-footer-inner">
    <div class="oc-footer-main">
      <h2>${esc(c.title)}</h2>
      <p>${esc(c.description)}</p>
      ${cta}
    </div>
    ${c.image ? `<div class="oc-section-media">${img(c.image)}</div>` : ""}
    <nav class="oc-footer-links">${links}</nav></div>
  </footer>`;
}

function renderSection(section: VirtualSiteSection): string {
  switch (section.type) {
    case "hero":
      return renderHero(section.content, section.style, section.id);
    case "stats":
      return renderStats(section.content, section.style, section.id);
    case "feature-grid":
      return renderFeatures(section.content, section.style, section.id);
    case "pricing":
      return renderPricing(section.content, section.style, section.id);
    case "footer":
      return renderFooter(section.content, section.style, section.id);
    default:
      return "";
  }
}

const STATIC_FONT_STACKS = {
  sans: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif',
  serif: 'Georgia,"Noto Serif SC","Songti SC",serif',
  mono: '"SFMono-Regular",Consolas,"Liberation Mono",monospace',
} as const;

function css(config: VirtualSiteConfig): string {
  const theme = config.themeColor || "#2563eb";
  const background = config.backgroundColor || "#fafafa";
  const typography = config.typography;
  return `:root{--oc-accent:${theme};--oc-ink:#0f172a;--oc-muted:#64748b;--oc-bg:${background};--oc-soft:#f8fafc;--oc-line:#e2e8f0;}
*{box-sizing:border-box;}
body{margin:0;font-family:${STATIC_FONT_STACKS[typography.bodyFont]};font-size:${typography.baseSize}px;color:var(--oc-ink);background:var(--oc-bg);line-height:${typography.lineHeight};}
h1,h2,h3,h4{font-family:${STATIC_FONT_STACKS[typography.headingFont]};font-weight:${typography.headingWeight};}
a{color:inherit;text-decoration:none;}
img.oc-img{width:100%;height:100%;object-fit:cover;border-radius:var(--oc-section-radius,16px);display:block;}
.oc-nav{display:flex;align-items:center;justify-content:space-between;padding:20px 6vw;border-bottom:1px solid var(--oc-line);position:sticky;top:0;background:rgba(255,255,255,.9);backdrop-filter:blur(8px);z-index:10;}
.oc-brand{font-weight:800;font-size:1.15rem;}
.oc-nav-links{display:flex;gap:24px;flex-wrap:wrap;}
.oc-nav-links a{color:var(--oc-muted);font-size:.95rem;}
.oc-nav-links a:hover{color:var(--oc-ink);}
.oc-section-inner{width:100%;max-width:var(--oc-section-max,1152px);margin:0 auto;}
.oc-hero{padding:8vh 6vw;}
.oc-hero-inner{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center;}
.oc-hero h1{font-size:clamp(2rem,4vw,3.4rem);line-height:1.1;margin:.2em 0;letter-spacing:-.02em;}
.oc-eyebrow{color:var(--oc-accent);font-weight:700;text-transform:uppercase;letter-spacing:.08em;font-size:.8rem;margin:0;}
.oc-lead{color:var(--oc-muted);font-size:1.15rem;max-width:34ch;}
.oc-hero-media{aspect-ratio:4/3;}
.oc-cta-row{display:flex;gap:14px;margin-top:28px;flex-wrap:wrap;}
.oc-btn{display:inline-block;padding:12px 24px;border-radius:10px;font-weight:600;font-size:.98rem;transition:transform .1s ease,opacity .1s ease;}
.oc-btn:hover{transform:translateY(-1px);}
.oc-btn-primary{background:var(--oc-accent);color:#fff;}
.oc-btn-ghost{border:1px solid var(--oc-line);color:var(--oc-ink);}
.oc-section{padding:8vh 6vw;}
.oc-section-head{text-align:center;max-width:60ch;margin:0 auto 48px;}
.oc-section-head h2{font-size:clamp(1.6rem,3vw,2.4rem);margin:0 0 .3em;letter-spacing:-.01em;}
.oc-section-head p{color:var(--oc-muted);font-size:1.05rem;margin:0;}
.oc-section-media{width:min(100%,900px);aspect-ratio:16/7;margin:0 auto 36px;}
.oc-stats{background:var(--oc-soft);}
.oc-stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:28px;max-width:1000px;margin:0 auto;}
.oc-stat{text-align:center;}
.oc-stat-value{font-size:2.4rem;font-weight:800;color:var(--oc-accent);}
.oc-stat-label{font-weight:600;}
.oc-stat-desc{color:var(--oc-muted);font-size:.9rem;}
.oc-card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px;max-width:1100px;margin:0 auto;}
.oc-card{border:1px solid var(--oc-line);border-radius:var(--oc-section-radius,16px);padding:28px;background:var(--oc-bg);}
.oc-card-icon{font-size:1.8rem;margin-bottom:8px;}
.oc-card h3{margin:.2em 0;}
.oc-card p{color:var(--oc-muted);margin:0;}
.oc-plan-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px;max-width:1100px;margin:0 auto;align-items:start;}
.oc-plan{border:1px solid var(--oc-line);border-radius:var(--oc-section-radius,16px);padding:32px;background:var(--oc-bg);}
.oc-plan-featured{border-color:var(--oc-accent);box-shadow:0 12px 40px -18px var(--oc-accent);transform:scale(1.02);}
.oc-plan-price{font-size:2rem;font-weight:800;margin:.2em 0;}
.oc-plan-desc{color:var(--oc-muted);}
.oc-plan-list{list-style:none;padding:0;margin:20px 0;display:flex;flex-direction:column;gap:8px;}
.oc-plan-list li{padding-left:24px;position:relative;color:var(--oc-ink);}
.oc-plan-list li::before{content:"✓";position:absolute;left:0;color:var(--oc-accent);font-weight:700;}
.oc-footer{background:var(--oc-ink);color:#fff;padding:8vh 6vw;}
.oc-footer-inner{display:grid;grid-template-columns:1fr auto;gap:40px;align-items:center;}
.oc-footer h2{font-size:1.8rem;margin:0 0 .3em;}
.oc-footer p{color:#cbd5e1;max-width:44ch;}
.oc-footer-links{display:flex;flex-direction:column;gap:12px;}
.oc-footer-links a{color:#cbd5e1;}
.oc-footer-links a:hover{color:#fff;}
.oc-layout-reverse .oc-hero-media,.oc-layout-reverse .oc-footer-links{order:-1;}
.oc-layout-stacked .oc-hero-inner,.oc-layout-stacked .oc-footer-inner{grid-template-columns:1fr;}
.oc-align-center :is(.oc-hero-text,.oc-section-head,.oc-footer-main){text-align:center;margin-left:auto;margin-right:auto;}
.oc-align-center .oc-cta-row{justify-content:center;}
.oc-has-text :is(h1,h2,h3,h4,p,a,li,span,.oc-stat-value,.oc-section-head p){color:var(--oc-section-fg)!important;}
.oc-credit{text-align:center;padding:20px;color:var(--oc-muted);font-size:.8rem;border-top:1px solid var(--oc-line);}
@media(max-width:820px){.oc-hero-inner,.oc-footer-inner{grid-template-columns:1fr;}}`;
}

/**
 * Render a VirtualSiteConfig into a single standalone HTML document string.
 * The result is a complete `index.html` (doctype + inline CSS) suitable for
 * static hosting on *.oceanleo.app.
 */
export function renderVirtualSiteToHtml(
  config: VirtualSiteConfig,
  pageId?: string,
): string {
  const page = pageById(config, pageId);
  const nav = (config.navigation || [])
    .map(
      (n) =>
        `<a href="${attr(normalizeVirtualHref(n.href))}">${esc(n.label)}</a>`,
    )
    .join("");
  const body = page.sections.map(renderSection).join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(page.title || config.siteName)}</title>
<meta name="description" content="${attr(page.description || config.siteName)}">
<style>${css(config)}</style>
</head>
<body>
<header class="oc-nav">
  <div class="oc-brand">${esc(config.siteName)}</div>
  <nav class="oc-nav-links">${nav}</nav>
</header>
<main>
${body}
</main>
<div class="oc-credit">Hosted on oceanleo.app</div>
</body>
</html>`;
}

export interface RenderedVirtualSiteFile {
  path: string;
  html: string;
}

/** Render every configured page into static hosting paths. */
export function renderVirtualSiteFiles(
  config: VirtualSiteConfig,
): RenderedVirtualSiteFile[] {
  const used = new Set<string>();
  return config.pages.map((page: VirtualSitePage, index) => {
    const baseRoute = page.path
      .split("/")
      // Keep this alphabet identical to normalizedPagePath(). In particular,
      // underscores are valid published routes and must not collapse into a
      // different path (or collide with a hyphen-free sibling) at deploy time.
      .map((part) => part.replace(/[^a-z0-9_-]/gi, ""))
      .filter(Boolean)
      .join("/");
    const route = baseRoute || `page-${index + 1}`;
    if (route.length > 400 || route.split("/").some((part) => part.length > 64)) {
      throw new Error(`Page path is too long: ${page.path}`);
    }
    if (used.has(route)) {
      throw new Error(`Duplicate page path: ${page.path}`);
    }
    used.add(route);
    return {
      path: index === 0 ? "index.html" : `${route}/index.html`,
      html: renderVirtualSiteToHtml(config, page.id),
    };
  });
}
