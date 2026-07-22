"use client";

import { useCallback, useState } from "react";
import type { ManagementApi } from "../api";
import { useApiAction, useApiResource } from "../resource";
import type { JsonValue, SeoSettings } from "../types";
import {
  Button,
  Field,
  InlineError,
  Notice,
  ResourceBoundary,
  StatusPill,
  TextArea,
  TextInput,
  formatDateTime,
  statusTone,
} from "../ui";
import { SaveActions, SettingsCard, SettingsPage } from "./SettingsShared";

export function SeoSettingsPage({
  projectId,
  api,
}: {
  projectId: string;
  api: ManagementApi;
}) {
  const loader = useCallback(
    () => api.getSettings(projectId, "seo"),
    [api, projectId],
  );
  const resource = useApiResource(loader, [projectId]);
  return (
    <SettingsPage
      title="SEO"
      description="Metadata changes create a build-config or source revision that Preview and Publish can verify."
      actions={<Button onClick={() => void resource.reload()}>Refresh</Button>}
    >
      <ResourceBoundary
        resource={resource}
        loadingLabel="Loading SEO settings"
        onRetry={() => void resource.reload()}
      >
        {(settings) => (
          <SeoForm
            key={settings.version}
            projectId={projectId}
            settings={settings}
            api={api}
            onReload={() => resource.reload()}
          />
        )}
      </ResourceBoundary>
    </SettingsPage>
  );
}

function SeoForm({
  projectId,
  settings,
  api,
  onReload,
}: {
  projectId: string;
  settings: SeoSettings;
  api: ManagementApi;
  onReload: () => Promise<SeoSettings | null>;
}) {
  const [titleTemplate, setTitleTemplate] = useState(settings.titleTemplate);
  const [description, setDescription] = useState(settings.description);
  const [faviconUrl, setFaviconUrl] = useState(settings.faviconUrl || "");
  const [openGraphImageUrl, setOpenGraphImageUrl] = useState(
    settings.openGraphImageUrl || "",
  );
  const [canonicalUrl, setCanonicalUrl] = useState(
    settings.canonicalUrl || "",
  );
  const [robots, setRobots] = useState(settings.robots);
  const [sitemapEnabled, setSitemapEnabled] = useState(
    settings.sitemapEnabled,
  );
  const [indexable, setIndexable] = useState(settings.indexable);
  const [structuredData, setStructuredData] = useState(
    settings.structuredData
      ? JSON.stringify(settings.structuredData, null, 2)
      : "",
  );
  const [jsonError, setJsonError] = useState("");
  const [saved, setSaved] = useState(false);
  const save = useApiAction<SeoSettings>();
  const audit = useApiAction<NonNullable<SeoSettings["lastAudit"]>>();

  function reset() {
    setTitleTemplate(settings.titleTemplate);
    setDescription(settings.description);
    setFaviconUrl(settings.faviconUrl || "");
    setOpenGraphImageUrl(settings.openGraphImageUrl || "");
    setCanonicalUrl(settings.canonicalUrl || "");
    setRobots(settings.robots);
    setSitemapEnabled(settings.sitemapEnabled);
    setIndexable(settings.indexable);
    setStructuredData(
      settings.structuredData
        ? JSON.stringify(settings.structuredData, null, 2)
        : "",
    );
    setJsonError("");
    setSaved(false);
    save.clear();
  }

  async function persist() {
    let parsed: JsonValue | null = null;
    if (structuredData.trim()) {
      try {
        parsed = JSON.parse(structuredData) as JsonValue;
      } catch {
        setJsonError("Structured data must be valid JSON.");
        return;
      }
    }
    setJsonError("");
    setSaved(false);
    const result = await save.run(() =>
      api.updateSettings(
        projectId,
        "seo",
        {
          title_template: titleTemplate,
          description,
          favicon_url: faviconUrl.trim() || null,
          open_graph_image_url: openGraphImageUrl.trim() || null,
          canonical_url: canonicalUrl.trim() || null,
          robots,
          sitemap_enabled: sitemapEnabled,
          indexable,
          structured_data: parsed,
        },
        settings.version,
      ),
    );
    if (result) setSaved(Boolean(await onReload()));
  }

  async function runAudit() {
    const result = await audit.run(() => api.runSeoAudit(projectId));
    if (result) await onReload();
  }

  return (
    <div className="space-y-4">
      {!settings.canManage ? (
        <Notice tone="info" title="Read-only SEO access">
          Your project role can inspect metadata and audit results but cannot
          create an SEO revision or run a new audit.
        </Notice>
      ) : null}
      {saved ? (
        <Notice tone="success">
          The SEO revision was persisted and refetched from the project API.
        </Notice>
      ) : null}
      <SettingsCard
        title="Search metadata"
        description="Saving must create a revision; local form state alone is never reported as a project change."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title template" required>
            <TextInput
              value={titleTemplate}
              disabled={!settings.canManage}
              onChange={(event) => {
                setTitleTemplate(event.target.value);
                setSaved(false);
              }}
            />
          </Field>
          <Field label="Canonical URL">
            <TextInput
              type="url"
              value={canonicalUrl}
              disabled={!settings.canManage}
              onChange={(event) => {
                setCanonicalUrl(event.target.value);
                setSaved(false);
              }}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description">
              <TextArea
                value={description}
                disabled={!settings.canManage}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setSaved(false);
                }}
              />
            </Field>
          </div>
          <Field label="Favicon URL">
            <TextInput
              type="url"
              value={faviconUrl}
              disabled={!settings.canManage}
              onChange={(event) => {
                setFaviconUrl(event.target.value);
                setSaved(false);
              }}
            />
          </Field>
          <Field label="Open Graph image URL">
            <TextInput
              type="url"
              value={openGraphImageUrl}
              disabled={!settings.canManage}
              onChange={(event) => {
                setOpenGraphImageUrl(event.target.value);
                setSaved(false);
              }}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Robots directives">
              <TextInput
                value={robots}
                disabled={!settings.canManage}
                onChange={(event) => {
                  setRobots(event.target.value);
                  setSaved(false);
                }}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Structured data (JSON)" error={jsonError}>
              <TextArea
                className="min-h-48 font-mono text-xs"
                value={structuredData}
                disabled={!settings.canManage}
                spellCheck={false}
                onChange={(event) => {
                  setStructuredData(event.target.value);
                  setJsonError("");
                  setSaved(false);
                }}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-600">
            <input
              type="checkbox"
              checked={sitemapEnabled}
              disabled={!settings.canManage}
              onChange={(event) => {
                setSitemapEnabled(event.target.checked);
                setSaved(false);
              }}
            />
            Generate sitemap
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-600">
            <input
              type="checkbox"
              checked={indexable}
              disabled={!settings.canManage}
              onChange={(event) => {
                setIndexable(event.target.checked);
                setSaved(false);
              }}
            />
            Allow indexing
          </label>
        </div>
        <div className="mt-4">
          <SaveActions
            busy={save.running}
            disabled={!settings.canManage || !titleTemplate.trim()}
            error={save.error}
            onReset={reset}
            onSave={() => void persist()}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="SEO audit"
        description="An audit only reports findings. It does not claim to have modified source or metadata."
        actions={
          <Button
            size="sm"
            disabled={audit.running || !settings.canManage}
            onClick={() => void runAudit()}
          >
            {audit.running ? "Auditing…" : "Run audit"}
          </Button>
        }
      >
        {audit.error ? <InlineError error={audit.error} /> : null}
        {settings.lastAudit ? (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                label={settings.lastAudit.statusLabel}
                tone={statusTone(settings.lastAudit.status)}
              />
              <span className="text-xs text-zinc-500">
                {formatDateTime(settings.lastAudit.createdAt)}
              </span>
            </div>
            {settings.lastAudit.findings.length ? (
              <ul className="mt-3 space-y-2">
                {settings.lastAudit.findings.map((finding, index) => (
                  <li
                    key={`${finding.severity}:${index}`}
                    className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-700"
                  >
                    <span className="mr-2 font-medium uppercase text-zinc-400">
                      {finding.severity}
                    </span>
                    {finding.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-zinc-500">
                The audit returned no findings.
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">
            No persisted audit result was returned.
          </p>
        )}
      </SettingsCard>
    </div>
  );
}
