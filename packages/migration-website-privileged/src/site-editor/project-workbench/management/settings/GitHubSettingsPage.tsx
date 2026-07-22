"use client";

import { useCallback, useState } from "react";
import type { ManagementApi } from "../api";
import { useApiAction, useApiResource } from "../resource";
import type { GitHubSettings } from "../types";
import {
  Button,
  ConfirmDialog,
  Field,
  InlineError,
  Notice,
  ResourceBoundary,
  StatusPill,
  TextInput,
  statusTone,
} from "../ui";
import { SettingsCard, SettingsPage } from "./SettingsShared";

export function GitHubSettingsPage({
  projectId,
  api,
}: {
  projectId: string;
  api: ManagementApi;
}) {
  const loader = useCallback(
    () => api.getSettings(projectId, "github"),
    [api, projectId],
  );
  const resource = useApiResource(loader, [projectId]);
  return (
    <SettingsPage
      title="GitHub"
      description="Explicit project-to-repository binding with remote-head conflict checks."
      actions={<Button onClick={() => void resource.reload()}>Refresh</Button>}
    >
      <ResourceBoundary
        resource={resource}
        loadingLabel="Loading GitHub binding"
        onRetry={() => void resource.reload()}
      >
        {(settings) => (
          <GitHubContent
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

function GitHubContent({
  projectId,
  settings,
  api,
  onReload,
}: {
  projectId: string;
  settings: GitHubSettings;
  api: ManagementApi;
  onReload: () => Promise<GitHubSettings | null>;
}) {
  const [repository, setRepository] = useState(settings.repository || "");
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [persisted, setPersisted] = useState(false);
  const action = useApiAction<GitHubSettings>();
  const normalizedRepository = repository.trim();
  const repositoryValid =
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalizedRepository);

  async function bind() {
    setPersisted(false);
    const result = await action.run(() =>
      api.bindGitHub(
        projectId,
        normalizedRepository,
        settings.version,
        normalizedRepository === settings.repository
          ? settings.lastRemoteHead || undefined
          : undefined,
      ),
    );
    if (result) setPersisted(Boolean(await onReload()));
  }

  async function disconnect() {
    setPersisted(false);
    const result = await action.run(() =>
      api.disconnectGitHub(projectId, settings.version),
    );
    if (result) {
      setDisconnectOpen(false);
      setConfirmation("");
      setPersisted(Boolean(await onReload()));
    }
  }

  return (
    <div className="space-y-4">
      {!settings.canManage ? (
        <Notice tone="info" title="Read-only repository access">
          Your project role can inspect repository state but cannot change the
          binding.
        </Notice>
      ) : null}
      {persisted ? (
        <Notice tone="success">
          The repository binding was persisted and refetched.
        </Notice>
      ) : null}
      <SettingsCard
        title="Repository binding"
        description="A repository with a matching name is never used implicitly. Saving creates or updates an explicit project binding."
      >
        {settings.bound ? (
          <div className="mb-4 rounded-xl bg-zinc-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-zinc-900">
                  {settings.repository}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Branch: {settings.branch || "Unavailable"}
                </p>
              </div>
              {settings.syncStatusLabel ? (
                <StatusPill
                  label={settings.syncStatusLabel}
                  tone={statusTone(settings.syncStatus || "")}
                />
              ) : null}
            </div>
            <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-zinc-400">Remote head</dt>
                <dd className="mt-0.5 break-all font-mono text-zinc-700">
                  {settings.lastRemoteHead || "Unavailable"}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-400">Last OceanLeo commit</dt>
                <dd className="mt-0.5 break-all font-mono text-zinc-700">
                  {settings.lastOceanLeoCommit || "Unavailable"}
                </dd>
              </div>
            </dl>
            {settings.conflictReason ? (
              <div className="mt-3">
                <Notice tone="warning" title="Repository conflict">
                  {settings.conflictReason}
                </Notice>
              </div>
            ) : null}
          </div>
        ) : (
          <Notice tone="info">
            The project API reports no repository binding.
          </Notice>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field
              label="Repository (owner/name)"
              required
              error={
                normalizedRepository && !repositoryValid
                  ? "Use the owner/repository format."
                  : undefined
              }
            >
              <TextInput
                value={repository}
                disabled={!settings.canManage}
                placeholder="organization/repository"
                onChange={(event) => {
                  setRepository(event.target.value);
                  setPersisted(false);
                }}
              />
            </Field>
          </div>
          <Button
            variant="primary"
            disabled={
              !settings.canManage || !repositoryValid || action.running
            }
            onClick={() => void bind()}
          >
            {action.running
              ? "Saving…"
              : settings.bound
                ? "Rebind repository"
                : "Bind repository"}
          </Button>
        </div>
        {action.error && !disconnectOpen ? (
          <div className="mt-4">
            <InlineError error={action.error} />
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {settings.repositoryUrl ? (
            <a
              href={settings.repositoryUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-700 outline-none hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Open repository
            </a>
          ) : null}
          {settings.bound && settings.canManage ? (
            <Button
              variant="danger"
              onClick={() => {
                action.clear();
                setConfirmation("");
                setDisconnectOpen(true);
              }}
            >
              Disconnect
            </Button>
          ) : null}
        </div>
      </SettingsCard>

      <ConfirmDialog
        open={disconnectOpen}
        title="Disconnect GitHub repository"
        description="This removes the explicit project binding. It does not delete the remote repository."
        confirmLabel="Disconnect"
        confirmationText={settings.repository || undefined}
        confirmationValue={confirmation}
        onConfirmationValueChange={setConfirmation}
        busy={action.running}
        error={action.error}
        onClose={() => {
          if (action.running) return;
          setDisconnectOpen(false);
          setConfirmation("");
          action.clear();
        }}
        onConfirm={() => void disconnect()}
      />
    </div>
  );
}
