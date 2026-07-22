"use client";

import { useState } from "react";
import { managementApi, type ManagementApi } from "./api";
import type { SettingsSection, WorkspaceBaseProps } from "./types";
import { SelectInput, WorkspaceSurface, cx } from "./ui";
import { DomainsSettingsPage } from "./settings/DomainsSettingsPage";
import { GeneralSettingsPage } from "./settings/GeneralSettingsPage";
import { GitHubSettingsPage } from "./settings/GitHubSettingsPage";
import { IntegrationsSettingsPage } from "./settings/IntegrationsSettingsPage";
import { NotificationsSettingsPage } from "./settings/NotificationsSettingsPage";
import { SchedulesSettingsPage } from "./settings/SchedulesSettingsPage";
import { SecretsSettingsPage } from "./settings/SecretsSettingsPage";
import { SeoSettingsPage } from "./settings/SeoSettingsPage";
import { UsageSettingsPage } from "./settings/UsageSettingsPage";

export interface SettingsWorkspaceProps extends WorkspaceBaseProps {
  api?: ManagementApi;
  section?: SettingsSection;
  initialSection?: SettingsSection;
  onSectionChange?: (section: SettingsSection) => void;
  onProjectDuplicated?: (projectId: string) => void;
  onProjectDeleted?: () => void;
}

const SETTINGS_NAV: Array<{
  id: SettingsSection;
  label: string;
  description: string;
}> = [
  { id: "general", label: "General", description: "Identity and lifecycle" },
  { id: "domains", label: "Domains", description: "DNS and certificates" },
  {
    id: "notifications",
    label: "Notifications",
    description: "Events and delivery",
  },
  {
    id: "integrations",
    label: "Integrations",
    description: "Provider bindings",
  },
  { id: "seo", label: "SEO", description: "Metadata and audit" },
  { id: "secrets", label: "Secrets", description: "Write-only values" },
  { id: "github", label: "GitHub", description: "Repository binding" },
  { id: "schedules", label: "Schedules", description: "Revision publishing" },
  { id: "usage", label: "Usage", description: "Verified metering" },
];

export function SettingsWorkspace({
  projectId,
  className,
  api = managementApi,
  section,
  initialSection = "general",
  onSectionChange,
  onProjectDuplicated,
  onProjectDeleted,
}: SettingsWorkspaceProps) {
  const [internalSection, setInternalSection] =
    useState<SettingsSection>(initialSection);
  const active = section ?? internalSection;

  function select(next: SettingsSection) {
    if (section === undefined) setInternalSection(next);
    onSectionChange?.(next);
  }

  return (
    <WorkspaceSurface
      title="Settings"
      description="Project-scoped settings. Every visible action reads or writes the canonical project API and refetches persisted state."
      className={className}
    >
      <div className="mb-4 lg:hidden">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-zinc-600">
            Settings section
          </span>
          <SelectInput
            value={active}
            onChange={(event) =>
              select(event.target.value as SettingsSection)
            }
          >
            {SETTINGS_NAV.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </SelectInput>
        </label>
      </div>

      <div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav
          className="hidden self-start rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm lg:block"
          aria-label="Project settings"
        >
          {SETTINGS_NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={active === item.id ? "page" : undefined}
              onClick={() => select(item.id)}
              className={cx(
                "mb-1 block w-full rounded-xl px-3 py-2.5 text-left outline-none transition last:mb-0 focus-visible:ring-2 focus-visible:ring-blue-500",
                active === item.id
                  ? "bg-zinc-100 text-zinc-950"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
              )}
            >
              <span className="block text-sm font-medium">{item.label}</span>
              <span className="mt-0.5 block text-[11px] text-zinc-400">
                {item.description}
              </span>
            </button>
          ))}
        </nav>

        <main className="min-w-0">
          {active === "general" ? (
            <GeneralSettingsPage
              key={projectId}
              projectId={projectId}
              api={api}
              onProjectDuplicated={onProjectDuplicated}
              onProjectDeleted={onProjectDeleted}
            />
          ) : null}
          {active === "domains" ? (
            <DomainsSettingsPage
              key={projectId}
              projectId={projectId}
              api={api}
            />
          ) : null}
          {active === "notifications" ? (
            <NotificationsSettingsPage
              key={projectId}
              projectId={projectId}
              api={api}
            />
          ) : null}
          {active === "integrations" ? (
            <IntegrationsSettingsPage
              key={projectId}
              projectId={projectId}
              api={api}
            />
          ) : null}
          {active === "seo" ? (
            <SeoSettingsPage
              key={projectId}
              projectId={projectId}
              api={api}
            />
          ) : null}
          {active === "secrets" ? (
            <SecretsSettingsPage
              key={projectId}
              projectId={projectId}
              api={api}
            />
          ) : null}
          {active === "github" ? (
            <GitHubSettingsPage
              key={projectId}
              projectId={projectId}
              api={api}
            />
          ) : null}
          {active === "schedules" ? (
            <SchedulesSettingsPage
              key={projectId}
              projectId={projectId}
              api={api}
            />
          ) : null}
          {active === "usage" ? (
            <UsageSettingsPage
              key={projectId}
              projectId={projectId}
              api={api}
            />
          ) : null}
        </main>
      </div>
    </WorkspaceSurface>
  );
}
