import type {
  VirtualSiteConfig,
  VirtualSitePage,
  VirtualSiteSection,
} from "./virtual-site-types";

export function pageById(
  config: VirtualSiteConfig,
  pageId: string | null | undefined,
): VirtualSitePage {
  return config.pages.find((page) => page.id === pageId) ?? config.pages[0];
}

export function sectionsForPage(
  config: VirtualSiteConfig,
  pageId: string | null | undefined,
): VirtualSiteSection[] {
  return pageById(config, pageId).sections;
}

export function withPageSections(
  config: VirtualSiteConfig,
  pageId: string,
  sections: VirtualSiteSection[],
): VirtualSiteConfig {
  const pages = config.pages.map((page) =>
    page.id === pageId ? { ...page, sections } : page,
  );
  return { ...config, sections: pages[0]?.sections ?? sections, pages };
}
