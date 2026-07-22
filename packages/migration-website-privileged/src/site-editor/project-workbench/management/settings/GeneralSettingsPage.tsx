"use client";

import { useCallback, useState } from "react";
import type { ManagementApi } from "../api";
import { useApiAction, useApiResource } from "../resource";
import type { GeneralSettings, ProjectSummary } from "../types";
import {
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  InlineError,
  Notice,
  ResourceBoundary,
  SelectInput,
  StatusPill,
  TextInput,
  statusTone,
} from "../ui";
import { SaveActions, SettingsCard, SettingsPage } from "./SettingsShared";

export function GeneralSettingsPage({
  projectId,
  api,
  onProjectDuplicated,
  onProjectDeleted,
}: {
  projectId: string;
  api: ManagementApi;
  onProjectDuplicated?: (projectId: string) => void;
  onProjectDeleted?: () => void;
}) {
  const loader = useCallback(
    () => api.getSettings(projectId, "general"),
    [api, projectId],
  );
  const resource = useApiResource(loader, [projectId]);

  return (
    <SettingsPage
      title="General"
      description="Project identity, verified publication state, hosting mode, and owner-only lifecycle actions."
      actions={<Button onClick={() => void resource.reload()}>Refresh</Button>}
    >
      <ResourceBoundary
        resource={resource}
        loadingLabel="Loading general settings"
        onRetry={() => void resource.reload()}
      >
        {(settings) => (
          <GeneralSettingsForm
            key={settings.version}
            projectId={projectId}
            settings={settings}
            api={api}
            onReload={() => resource.reload()}
            onProjectDuplicated={onProjectDuplicated}
            onProjectDeleted={onProjectDeleted}
          />
        )}
      </ResourceBoundary>
    </SettingsPage>
  );
}

function GeneralSettingsForm({
  projectId,
  settings,
  api,
  onReload,
  onProjectDuplicated,
  onProjectDeleted,
}: {
  projectId: string;
  settings: GeneralSettings;
  api: ManagementApi;
  onReload: () => Promise<GeneralSettings | null>;
  onProjectDuplicated?: (projectId: string) => void;
  onProjectDeleted?: () => void;
}) {
  const [displayName, setDisplayName] = useState(settings.displayName);
  const [slug, setSlug] = useState(settings.slug);
  const [faviconUrl, setFaviconUrl] = useState(settings.faviconUrl || "");
  const [hostingMode, setHostingMode] = useState(settings.hosting.mode);
  const [saved, setSaved] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateName, setDuplicateName] = useState(
    `${settings.displayName} copy`,
  );
  const [duplicatedProject, setDuplicatedProject] =
    useState<ProjectSummary | null>(null);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleteOperation, setDeleteOperation] = useState<
    Awaited<ReturnType<ManagementApi["deleteProject"]>> | null
  >(null);
  const save = useApiAction<GeneralSettings>();
  const duplicateAction = useApiAction<ProjectSummary>();
  const unpublishAction = useApiAction<
    Awaited<ReturnType<ManagementApi["unpublish"]>>
  >();
  const deleteAction = useApiAction<
    Awaited<ReturnType<ManagementApi["deleteProject"]>>
  >();
  const canEdit =
    settings.permissions.role === "owner" ||
    settings.permissions.role === "edit";
  const slugValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);

  function reset() {
    setDisplayName(settings.displayName);
    setSlug(settings.slug);
    setFaviconUrl(settings.faviconUrl || "");
    setHostingMode(settings.hosting.mode);
    setSaved(false);
    save.clear();
  }

  async function persist() {
    setSaved(false);
    const result = await save.run(() =>
      api.updateSettings(
        projectId,
        "general",
        {
          display_name: displayName.trim(),
          slug: slug.trim(),
          favicon_url: faviconUrl.trim() || null,
          hosting_mode: hostingMode,
        },
        settings.version,
      ),
    );
    if (result) {
      const refreshed = await onReload();
      setSaved(Boolean(refreshed));
    }
  }

  async function duplicate() {
    const result = await duplicateAction.run(() =>
      api.duplicateProject(projectId, duplicateName.trim()),
    );
    if (result) {
      setDuplicatedProject(result);
      setDuplicateOpen(false);
      onProjectDuplicated?.(result.id);
    }
  }

  async function unpublish() {
    const result = await unpublishAction.run(() => api.unpublish(projectId));
    if (result) {
      setUnpublishOpen(false);
      setConfirmation("");
      await onReload();
    }
  }

  async function removeProject() {
    const result = await deleteAction.run(() =>
      api.deleteProject(projectId, settings.version, confirmation),
    );
    if (result) {
      setDeleteOperation(result);
      setDeleteOpen(false);
      setConfirmation("");
      onProjectDeleted?.();
    }
  }

  return (
    <div className="space-y-4">
      {saved ? (
        <Notice tone="success">
          The project API saved and returned the refreshed general settings.
        </Notice>
      ) : null}
      {deleteOperation ? (
        <Notice tone="info" title="Deletion operation recorded">
          <span className="font-mono">{deleteOperation.operationId}</span> ·{" "}
          {deleteOperation.status} · audit{" "}
          <span className="font-mono">{deleteOperation.auditEventId}</span>
        </Notice>
      ) : null}
      {duplicatedProject ? (
        <Notice tone="success" title="Project duplicated">
          {duplicatedProject.displayName} ·{" "}
          <span className="font-mono">{duplicatedProject.id}</span>
        </Notice>
      ) : null}
      {!canEdit ? (
        <Notice tone="info" title="Read-only project role">
          Your current project role can inspect these settings but cannot
          change project identity or hosting.
        </Notice>
      ) : null}
      <SettingsCard
        title="Project identity"
        description="These values are persisted on the canonical website project."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name" required>
            <TextInput
              value={displayName}
              disabled={!canEdit}
              onChange={(event) => {
                setDisplayName(event.target.value);
                setSaved(false);
              }}
            />
          </Field>
          <Field
            label="Slug"
            required
            error={
              slug && !slugValid
                ? "Use lowercase letters, numbers, and single hyphens."
                : undefined
            }
          >
            <TextInput
              value={slug}
              disabled={!canEdit}
              onChange={(event) => {
                setSlug(event.target.value);
                setSaved(false);
              }}
              pattern="[a-z0-9-]+"
            />
          </Field>
          <Field label="Favicon URL">
            <TextInput
              type="url"
              value={faviconUrl}
              disabled={!canEdit}
              onChange={(event) => {
                setFaviconUrl(event.target.value);
                setSaved(false);
              }}
            />
          </Field>
          <Field label="Hosting mode">
            <SelectInput
              value={hostingMode}
              disabled={!canEdit}
              onChange={(event) => {
                setHostingMode(event.target.value);
                setSaved(false);
              }}
            >
              {!settings.hosting.supportedModes.some(
                (mode) => mode.value === hostingMode,
              ) ? (
                <option value={hostingMode}>
                  {settings.hosting.label || hostingMode}
                </option>
              ) : null}
              {settings.hosting.supportedModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {settings.capabilities.map((capability) => (
            <StatusPill
              key={capability.id}
              label={capability.label}
              tone={statusTone(capability.status)}
              title={capability.reason || undefined}
            />
          ))}
        </div>
        <div className="mt-4">
          <SaveActions
            busy={save.running}
            disabled={!canEdit || !displayName.trim() || !slugValid}
            error={save.error}
            onReset={reset}
            onSave={() => void persist()}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Publish and access"
        description="The displayed state comes from persisted deployment and edge-access records."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-zinc-50 p-4">
            <p className="text-xs font-medium text-zinc-500">Publication</p>
            <div className="mt-2">
              <StatusPill
                label={settings.publish.statusLabel}
                tone={statusTone(settings.publish.status)}
              />
            </div>
            {settings.publish.primaryUrl ? (
              <a
                className="mt-2 block truncate rounded text-xs text-blue-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-blue-500"
                href={settings.publish.primaryUrl}
                target="_blank"
                rel="noreferrer"
              >
                {settings.publish.primaryUrl}
              </a>
            ) : (
              <p className="mt-2 text-xs text-zinc-500">
                No production URL was returned.
              </p>
            )}
            {settings.publish.failureReason ? (
              <p className="mt-2 text-xs leading-5 text-red-700">
                {settings.publish.failureReason}
              </p>
            ) : null}
          </div>
          <div className="rounded-xl bg-zinc-50 p-4">
            <p className="text-xs font-medium text-zinc-500">
              Published site access
            </p>
            <div className="mt-2">
              <StatusPill
                label={settings.publishedAccess.label}
                tone={
                  settings.publishedAccess.enforced
                    ? statusTone(settings.publishedAccess.mode)
                    : "warning"
                }
              />
            </div>
            <p className="mt-2 text-xs leading-5 text-zinc-500">
              {settings.publishedAccess.reason ||
                (settings.publishedAccess.enforced
                  ? "The edge reports this policy as enforced."
                  : "The edge has not confirmed that this policy is enforced.")}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {settings.publish.primaryUrl ? (
            <a
              href={settings.publish.primaryUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-700 outline-none hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Open website
            </a>
          ) : null}
          {settings.permissions.canPublish &&
          settings.publish.publishedRevision ? (
            <Button
              variant="danger"
              onClick={() => {
                unpublishAction.clear();
                setConfirmation("");
                setUnpublishOpen(true);
              }}
            >
              Unpublish
            </Button>
          ) : null}
        </div>
      </SettingsCard>

      <SettingsCard
        title="Project actions"
        description="Duplicate excludes domains, members, secrets, analytics, connectors, and provider deployments. Delete is an audited asynchronous soft-delete."
      >
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={settings.permissions.role !== "owner"}
            onClick={() => {
              duplicateAction.clear();
              setDuplicatedProject(null);
              setDuplicateOpen(true);
            }}
          >
            Duplicate project
          </Button>
          <Button
            variant="danger"
            disabled={!settings.permissions.canDeleteProject}
            onClick={() => {
              deleteAction.clear();
              setDeleteOperation(null);
              setConfirmation("");
              setDeleteOpen(true);
            }}
          >
            Delete project
          </Button>
        </div>
      </SettingsCard>

      <Dialog
        open={duplicateOpen}
        title="Duplicate project"
        description="The server copies the current source revision and non-sensitive settings, then returns a new canonical project."
        onClose={() => {
          if (duplicateAction.running) return;
          setDuplicateOpen(false);
          duplicateAction.clear();
        }}
        width="sm"
        closeDisabled={duplicateAction.running}
        footer={
          <>
            <Button
              disabled={duplicateAction.running}
              onClick={() => {
                setDuplicateOpen(false);
                duplicateAction.clear();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={duplicateAction.running || !duplicateName.trim()}
              onClick={() => void duplicate()}
            >
              {duplicateAction.running ? "Duplicating…" : "Duplicate"}
            </Button>
          </>
        }
      >
        <Field label="New project name" required>
          <TextInput
            autoFocus
            value={duplicateName}
            onChange={(event) => setDuplicateName(event.target.value)}
          />
        </Field>
        {duplicateAction.error ? (
          <div className="mt-4">
            <InlineError error={duplicateAction.error} />
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={unpublishOpen}
        title="Unpublish production website"
        description="The provider and edge must both confirm removal. The UI will refetch instead of assuming the operation completed."
        confirmLabel="Unpublish"
        confirmationText={settings.displayName}
        confirmationValue={confirmation}
        onConfirmationValueChange={setConfirmation}
        busy={unpublishAction.running}
        error={unpublishAction.error}
        onClose={() => {
          if (unpublishAction.running) return;
          setUnpublishOpen(false);
          setConfirmation("");
          unpublishAction.clear();
        }}
        onConfirm={() => void unpublish()}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete project"
        description="This starts an idempotent soft-delete and cleanup operation. It does not silently report completion before the server records it."
        confirmLabel="Delete project"
        confirmationText={settings.slug}
        confirmationValue={confirmation}
        onConfirmationValueChange={setConfirmation}
        busy={deleteAction.running}
        error={deleteAction.error}
        onClose={() => {
          if (deleteAction.running) return;
          setDeleteOpen(false);
          setConfirmation("");
          deleteAction.clear();
        }}
        onConfirm={() => void removeProject()}
      />
    </div>
  );
}
