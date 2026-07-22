"use client";

import { useCallback, useState } from "react";
import type { ManagementApi } from "../api";
import { useApiAction, useApiResource } from "../resource";
import type {
  IntegrationBinding,
  IntegrationsSettings,
} from "../types";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  InlineError,
  Notice,
  ResourceBoundary,
  StatusPill,
  formatDateTime,
  statusTone,
} from "../ui";
import { SettingsCard, SettingsPage } from "./SettingsShared";

export function IntegrationsSettingsPage({
  projectId,
  api,
}: {
  projectId: string;
  api: ManagementApi;
}) {
  const loader = useCallback(
    () => api.getSettings(projectId, "integrations"),
    [api, projectId],
  );
  const resource = useApiResource(loader, [projectId], {
    isEmpty: (data) => data.integrations.length === 0,
  });
  return (
    <SettingsPage
      title="Integrations"
      description="User connectors and project resource bindings remain separate. This page stores only connector references and non-sensitive provider IDs."
      actions={<Button onClick={() => void resource.reload()}>Refresh</Button>}
    >
      <ResourceBoundary
        resource={resource}
        loadingLabel="Loading project integrations"
        emptyTitle="No integrations available"
        emptyDescription="The project API returned no implemented integration providers."
        onRetry={() => void resource.reload()}
      >
        {(settings) => (
          <IntegrationsContent
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

function IntegrationsContent({
  projectId,
  settings,
  api,
  onReload,
}: {
  projectId: string;
  settings: IntegrationsSettings;
  api: ManagementApi;
  onReload: () => Promise<IntegrationsSettings | null>;
}) {
  const [disconnect, setDisconnect] = useState<IntegrationBinding | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [persisted, setPersisted] = useState(false);
  const action = useApiAction<IntegrationBinding>();

  async function run(
    integration: IntegrationBinding,
    name: "reconnect" | "disconnect",
  ) {
    setPersisted(false);
    const result = await action.run(() =>
      api.integrationAction(
        projectId,
        name,
        integration.id,
        integration.version,
      ),
    );
    if (result) {
      setDisconnect(null);
      setConfirmation("");
      setPersisted(Boolean(await onReload()));
    }
  }

  return (
    <div className="space-y-4">
      {!settings.canManage ? (
        <Notice tone="info" title="Read-only integration access">
          Your project role can inspect provider bindings but cannot connect,
          reconnect, or disconnect them.
        </Notice>
      ) : null}
      {persisted ? (
        <Notice tone="success">
          The connector action was persisted and the project binding was
          refetched.
        </Notice>
      ) : null}
      {action.error && !disconnect ? <InlineError error={action.error} /> : null}
      <SettingsCard title="Provider bindings">
        <div className="grid gap-3 lg:grid-cols-2">
          {settings.integrations.map((integration) => (
            <article
              key={integration.id}
              className="rounded-xl border border-zinc-200 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-zinc-900">
                    {integration.label}
                  </h3>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {integration.accountLabel || "No account label returned"}
                  </p>
                </div>
                <StatusPill
                  label={integration.statusLabel}
                  tone={statusTone(integration.status)}
                />
              </div>
              <dl className="mt-4 space-y-2 text-xs">
                <div>
                  <dt className="text-zinc-400">Scopes</dt>
                  <dd className="mt-0.5 break-words text-zinc-700">
                    {integration.scopes.join(", ") ||
                      "No scopes were returned"}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-400">Verified</dt>
                  <dd className="mt-0.5 text-zinc-700">
                    {formatDateTime(integration.verifiedAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-400">Project resource</dt>
                  <dd className="mt-0.5 text-zinc-700">
                    {integration.projectResourceLabel ||
                      "No project resource bound"}
                  </dd>
                  {integration.providerResourceId ? (
                    <dd className="mt-0.5 truncate font-mono text-[10px] text-zinc-400">
                      {integration.providerResourceId}
                    </dd>
                  ) : null}
                </div>
              </dl>
              {settings.canManage ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {integration.canConnect && integration.connectUrl ? (
                    <a
                      href={integration.connectUrl}
                      className="inline-flex min-h-8 items-center rounded-lg border border-zinc-900 bg-zinc-900 px-2.5 text-xs font-medium text-white outline-none hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                    >
                      Connect
                    </a>
                  ) : null}
                  {integration.canReconnect ? (
                    <Button
                      size="sm"
                      disabled={action.running}
                      onClick={() => void run(integration, "reconnect")}
                    >
                      Reconnect
                    </Button>
                  ) : null}
                  {integration.canDisconnect ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={action.running}
                      onClick={() => {
                        action.clear();
                        setConfirmation("");
                        setDisconnect(integration);
                      }}
                    >
                      Disconnect
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </SettingsCard>

      <ConfirmDialog
        open={Boolean(disconnect)}
        title="Disconnect integration"
        description="This removes the project binding through the provider action API. It does not expose or copy connector credentials."
        confirmLabel="Disconnect"
        confirmationText={disconnect?.label}
        confirmationValue={confirmation}
        onConfirmationValueChange={setConfirmation}
        busy={action.running}
        error={action.error}
        onClose={() => {
          if (action.running) return;
          setDisconnect(null);
          setConfirmation("");
          action.clear();
        }}
        onConfirm={() => {
          if (disconnect) void run(disconnect, "disconnect");
        }}
      />
    </div>
  );
}
