"use client";

import { I18nProvider } from "@oceanleo/ui/i18n";
import { AppShell, type ShellNavItem } from "@oceanleo/ui/shell";
import type { TenantDefinition } from "@oceanleo/tenant-registry";

export interface TenantShellProps {
  readonly tenant: TenantDefinition;
}

export function TenantShell({ tenant }: TenantShellProps) {
  const { manifest } = tenant;
  const nav: ShellNavItem[] = [
    {
      label: "首页",
      href: "/",
      exact: true,
      icon: <span aria-hidden>⌂</span>,
    },
    {
      label: "工作台",
      href: manifest.workspace.canonicalBasePath,
      icon: <span aria-hidden>◇</span>,
    },
    {
      label: "历史记录",
      href: manifest.workspace.historyBasePath,
      icon: <span aria-hidden>◷</span>,
    },
  ];

  return (
    <I18nProvider locale="zh" messages={{}}>
      <AppShell
        accountHref={manifest.shell.accountRoute}
        brand={{
          name: manifest.brand.name,
          accent: manifest.brand.accent,
          logo: (
            <span aria-hidden style={{ color: manifest.brand.accent }}>
              ●
            </span>
          ),
        }}
        collapseKey={`oceanleo_${manifest.siteKey}_sidebar_collapsed`}
        layout={manifest.shell.mode === "utility" ? "topbar" : "sidebar"}
        nav={nav}
        pinnedNavCount={nav.length}
        siteId={String(manifest.siteKey)}
      >
        <main
          data-app-profile={tenant.profile}
          data-plugin-id={tenant.plugin.id}
          data-site-key={manifest.siteKey}
          style={{
            margin: "0 auto",
            maxWidth: "72rem",
            padding: "3rem 2rem",
          }}
        >
          <p
            style={{
              color: manifest.brand.accent,
              fontSize: "0.75rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {manifest.siteKey} · {tenant.profile}
          </p>
          <h1 style={{ fontSize: "2rem", margin: "0.5rem 0" }}>
            {manifest.brand.name}
          </h1>
          <p style={{ color: "#64748b", lineHeight: 1.7 }}>
            Shared OceanLeo shell selected by an exact allowlisted Host. The
            specialized surface is registered as{" "}
            <code>{tenant.plugin.id}</code> contract v
            {tenant.plugin.contractVersion}.
          </p>
        </main>
      </AppShell>
    </I18nProvider>
  );
}
