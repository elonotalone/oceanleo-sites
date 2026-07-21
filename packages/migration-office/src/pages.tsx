"use client";

import { I18nProvider } from "@oceanleo/ui/i18n";
import {
  AccountPage,
  ApiGuidePage,
  ApiPage,
  CostPage,
  GeneralPage,
  PluginsPage,
  SettingsPage,
} from "@oceanleo/ui/pages";
import {
  AdvancedFeatureCatalog,
  AdvancedFeatureRoute,
  AppShell,
  ExplorePage,
  HistoryDetail,
  LibraryDetail,
  MyLibrary,
  type ExploreConfig,
  type LibraryItem,
  type ShellNavItem,
} from "@oceanleo/ui/shell";
import type { ReactNode } from "react";

import { OFFICE_FILE_POLICIES } from "./contracts";

export type OfficePageKind =
  | "account"
  | "advanced"
  | "advanced-feature"
  | "api"
  | "api-guide"
  | "cost"
  | "explore"
  | "general"
  | "history"
  | "history-session"
  | "library"
  | "plugins"
  | "settings"
  | "workspace";

export interface OfficeRoutePageProps {
  readonly siteKey: "ppt" | "excel" | "word" | "converter" | "resume";
  readonly brandName: string;
  readonly accent: string;
  readonly pluginId: string;
  readonly page: OfficePageKind;
  readonly activeId?: string;
}

const EXPLORE_CONFIG: Readonly<
  Record<OfficeRoutePageProps["siteKey"], ExploreConfig>
> = Object.freeze({
  ppt: {
    type: "ppt",
    title: "探索 · PPT 模板",
    subtitle: "精选演示模板与版式，套用到你的幻灯片里。",
  },
  excel: {
    type: "image",
    title: "探索 · 图表素材",
    subtitle: "各类图表与数据可视化样式，做表格报表找参考。",
  },
  word: {
    type: "image",
    title: "探索 · 文档配图",
    subtitle: "办公、商务、教育等场景配图，给你的文档增色。",
  },
  converter: {
    type: "image",
    title: "探索 · 素材",
    subtitle: "浏览可自由使用的图片素材，转换处理更顺手。",
  },
  resume: {
    type: "image",
    title: "探索 · 求职素材",
    subtitle: "商务、职场、办公场景配图，写简历做作品集找参考。",
  },
});

const WORKSPACE_COPY = Object.freeze({
  ppt: {
    title: "演示文稿工作台",
    engine: "ppt.generate",
    artifactTypes: ["deck", "pdf"],
    libraryKinds: ["ppt", "file"],
  },
  excel: {
    title: "表格工作台",
    engine: "excel.sheet",
    artifactTypes: ["grid", "chart"],
    libraryKinds: ["sheet", "file"],
  },
  word: {
    title: "文档工作台",
    engine: "word.write",
    artifactTypes: ["document", "pdf"],
    libraryKinds: ["document", "file"],
  },
  converter: {
    title: "文件转换工作台",
    engine: "converter.local-tools",
    artifactTypes: ["document", "pdf", "audio", "single_file_image"],
    libraryKinds: ["document", "audio", "image", "file"],
  },
  resume: {
    title: "简历工作台",
    engine: "resume.resume",
    artifactTypes: ["document", "pdf", "single_file_image"],
    libraryKinds: ["document", "image", "file"],
  },
} as const);

function WorkspacePage({
  siteKey,
  accent,
  activeId,
}: Pick<OfficeRoutePageProps, "siteKey" | "accent" | "activeId">) {
  const copy = WORKSPACE_COPY[siteKey];
  const allowedArtifactTypes = new Set<string>(copy.artifactTypes);
  const allowedLibraryKinds = new Set<string>(copy.libraryKinds);
  const acceptsItem = (item: LibraryItem) =>
    (item.artifactType && allowedArtifactTypes.has(item.artifactType)) ||
    allowedLibraryKinds.has(item.kind);

  return (
    <section
      data-active-app={activeId || ""}
      data-editor-contract="oceanleo.typed-artifact/v1"
      data-engine={copy.engine}
      data-site-key={siteKey}
      className="mx-auto flex h-[calc(100dvh-1px)] min-h-0 w-full max-w-6xl flex-col px-6 py-8"
    >
      <header className="shrink-0">
        <p
          className="text-xs font-semibold uppercase tracking-[0.12em]"
          style={{ color: accent }}
        >
          {copy.engine}
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-neutral-900">
          {copy.title}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {OFFICE_FILE_POLICIES[siteKey].summary}
        </p>
      </header>
      <div className="mt-6 min-h-0 flex-1 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        <MyLibrary
          accent={accent}
          itemFilter={acceptsItem}
          openAdvancedOnSelect
          plain
          siteId={siteKey}
        />
      </div>
    </section>
  );
}

function pageContent(props: OfficeRoutePageProps): ReactNode {
  switch (props.page) {
    case "account":
      return <AccountPage />;
    case "advanced":
      return <AdvancedFeatureCatalog />;
    case "advanced-feature":
      return <AdvancedFeatureRoute siteId={props.siteKey} />;
    case "api":
      return <ApiPage />;
    case "api-guide":
      return <ApiGuidePage />;
    case "cost":
      return <CostPage />;
    case "explore":
      return (
        <ExplorePage
          accent={props.accent}
          config={EXPLORE_CONFIG[props.siteKey]}
          siteId={props.siteKey}
        />
      );
    case "general":
      return <GeneralPage />;
    case "history":
    case "history-session":
      return <HistoryDetail accent={props.accent} siteId={props.siteKey} />;
    case "library":
      return (
        <LibraryDetail
          accent={props.accent}
          siteId={props.siteKey}
          siteName={props.brandName}
        />
      );
    case "plugins":
      return <PluginsPage accent={props.accent} />;
    case "settings":
      return <SettingsPage />;
    case "workspace":
      return (
        <WorkspacePage
          accent={props.accent}
          activeId={props.activeId}
          siteKey={props.siteKey}
        />
      );
  }
}

export function OfficeRoutePage(props: OfficeRoutePageProps) {
  const nav: ShellNavItem[] = [
    { label: "首页", href: "/", exact: true, icon: <span aria-hidden>⌂</span> },
    {
      label: "工作台",
      href: "/workspace",
      icon: <span aria-hidden>◇</span>,
    },
    {
      label: "文件库",
      href: "/library",
      icon: <span aria-hidden>▦</span>,
    },
    {
      label: "历史记录",
      href: "/history",
      icon: <span aria-hidden>◷</span>,
    },
    {
      label: "探索",
      href: "/explore",
      icon: <span aria-hidden>✦</span>,
    },
  ];

  return (
    <I18nProvider locale="zh" messages={{}}>
      <AppShell
        accountHref="/account"
        brand={{
          name: props.brandName,
          accent: props.accent,
          logo: (
            <span aria-hidden style={{ color: props.accent }}>
              ●
            </span>
          ),
        }}
        collapseKey={`oceanleo_${props.siteKey}_sidebar_collapsed`}
        nav={nav}
        pinnedNavCount={nav.length}
        siteId={props.siteKey}
      >
        <main
          data-office-page={props.page}
          data-plugin-id={props.pluginId}
          data-site-key={props.siteKey}
        >
          {pageContent(props)}
        </main>
      </AppShell>
    </I18nProvider>
  );
}
