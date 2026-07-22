"use client";

import { useCallback, useState } from "react";
import type { ManagementApi } from "../api";
import { useApiAction, useApiResource } from "../resource";
import type { DomainRecord, DomainsSettings } from "../types";
import {
  Button,
  ConfirmDialog,
  CopyButton,
  EmptyState,
  Field,
  InlineError,
  Notice,
  ResourceBoundary,
  StatusPill,
  TextInput,
  statusTone,
} from "../ui";
import { SettingsCard, SettingsPage } from "./SettingsShared";

export function DomainsSettingsPage({
  projectId,
  api,
}: {
  projectId: string;
  api: ManagementApi;
}) {
  const loader = useCallback(
    () => api.getSettings(projectId, "domains"),
    [api, projectId],
  );
  const resource = useApiResource(loader, [projectId]);

  return (
    <SettingsPage
      title="Domains"
      description="Platform and custom domains, DNS ownership, certificates, and the persisted primary-domain binding."
      actions={<Button onClick={() => void resource.reload()}>Refresh</Button>}
    >
      <ResourceBoundary
        resource={resource}
        loadingLabel="Loading project domains"
        onRetry={() => void resource.reload()}
      >
        {(settings) => (
          <DomainsContent
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

function DomainsContent({
  projectId,
  settings,
  api,
  onReload,
}: {
  projectId: string;
  settings: DomainsSettings;
  api: ManagementApi;
  onReload: () => Promise<DomainsSettings | null>;
}) {
  const [hostname, setHostname] = useState("");
  const [removeDomain, setRemoveDomain] = useState<DomainRecord | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [persisted, setPersisted] = useState(false);
  const action = useApiAction<DomainsSettings>();
  const normalizedHostname = hostname.trim().toLowerCase().replace(/\.$/, "");
  const hostnameValid =
    normalizedHostname.length <= 253 &&
    normalizedHostname.includes(".") &&
    !/[\s/:]/.test(normalizedHostname) &&
    normalizedHostname.split(".").every(
      (label) =>
        Boolean(label) &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    );

  async function bind() {
    setPersisted(false);
    const result = await action.run(() =>
      api.addDomain(projectId, normalizedHostname, settings.version),
    );
    if (result) {
      setHostname("");
      setPersisted(Boolean(await onReload()));
    }
  }

  async function run(
    domain: DomainRecord,
    name: "verify" | "set-primary" | "unbind",
  ) {
    setPersisted(false);
    const result = await action.run(() =>
      api.domainAction(projectId, name, domain.id, settings.version),
    );
    if (result) {
      setRemoveDomain(null);
      setConfirmation("");
      setPersisted(Boolean(await onReload()));
    }
  }

  return (
    <div className="space-y-4">
      {!settings.canManage ? (
        <Notice tone="info" title="Read-only domain access">
          Your project role can inspect domain and certificate state but cannot
          change bindings.
        </Notice>
      ) : null}
      {persisted ? (
        <Notice tone="success">
          The domain action was persisted and the project domain list was
          refetched.
        </Notice>
      ) : null}
      <SettingsCard
        title="Bind a custom domain"
        description="Binding creates a tracked provider resource and DNS verification record. Domain purchase is a separate paid transaction."
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field
              label="Hostname"
              required
              error={
                hostname.trim() && !hostnameValid
                  ? "Enter a hostname such as www.example.com, without a scheme or path."
                  : undefined
              }
            >
              <TextInput
                type="text"
                inputMode="url"
                placeholder="www.example.com"
                value={hostname}
                disabled={!settings.canManage}
                onChange={(event) => {
                  setHostname(event.target.value);
                  setPersisted(false);
                }}
              />
            </Field>
          </div>
          <Button
            variant="primary"
            disabled={
              !settings.canManage || !hostnameValid || action.running
            }
            onClick={() => void bind()}
          >
            {action.running ? "Binding…" : "Bind domain"}
          </Button>
        </div>
        {action.error && !removeDomain ? (
          <div className="mt-4">
            <InlineError error={action.error} />
          </div>
        ) : null}
      </SettingsCard>

      <SettingsCard
        title="Project domains"
        description="Only provider-confirmed status and certificate state are shown."
      >
        {settings.domains.length ? (
          <div className="space-y-3">
            {settings.domains.map((domain) => (
              <article
                key={domain.id}
                className="rounded-xl border border-zinc-200 p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-medium text-zinc-900">
                        {domain.hostname}
                      </h3>
                      <StatusPill
                        label={domain.statusLabel}
                        tone={statusTone(domain.status)}
                      />
                      {domain.primary ? (
                        <StatusPill label="Primary" tone="info" />
                      ) : null}
                      {domain.platform ? (
                        <StatusPill label="Platform domain" />
                      ) : null}
                    </div>
                    {domain.certificateStatusLabel ? (
                      <p className="mt-1 text-xs text-zinc-500">
                        Certificate: {domain.certificateStatusLabel}
                      </p>
                    ) : null}
                    {domain.providerResourceId ? (
                      <p className="mt-1 truncate font-mono text-[10px] text-zinc-400">
                        {domain.providerResourceId}
                      </p>
                    ) : null}
                  </div>
                  {settings.canManage ? (
                    <div className="flex flex-wrap gap-2">
                      {domain.verification?.some((item) => !item.verified) ? (
                        <Button
                          size="sm"
                          disabled={action.running}
                          onClick={() => void run(domain, "verify")}
                        >
                          Verify DNS
                        </Button>
                      ) : null}
                      {!domain.primary ? (
                        <Button
                          size="sm"
                          disabled={action.running}
                          onClick={() => void run(domain, "set-primary")}
                        >
                          Make primary
                        </Button>
                      ) : null}
                      {!domain.platform ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={action.running}
                          onClick={() => {
                            action.clear();
                            setConfirmation("");
                            setRemoveDomain(domain);
                          }}
                        >
                          Unbind
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {domain.verification?.length ? (
                  <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-100">
                    <table className="w-full min-w-[600px] text-left text-xs">
                      <caption className="sr-only">
                        DNS verification records for {domain.hostname}
                      </caption>
                      <thead className="bg-zinc-50 text-[10px] uppercase tracking-wide text-zinc-400">
                        <tr>
                          <th className="px-3 py-2 font-medium">Type</th>
                          <th className="px-3 py-2 font-medium">Name</th>
                          <th className="px-3 py-2 font-medium">Value</th>
                          <th className="px-3 py-2 font-medium">State</th>
                        </tr>
                      </thead>
                      <tbody>
                        {domain.verification.map((record) => (
                          <tr
                            key={`${record.type}:${record.name}:${record.value}`}
                            className="border-t border-zinc-100"
                          >
                            <td className="px-3 py-2">{record.type}</td>
                            <td className="px-3 py-2 font-mono">
                              {record.name}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="max-w-72 truncate font-mono">
                                  {record.value}
                                </span>
                                <CopyButton value={record.value} />
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <StatusPill
                                label={
                                  record.verified
                                    ? "Verified by provider"
                                    : "Awaiting provider verification"
                                }
                                tone={record.verified ? "positive" : "warning"}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No domains returned"
            description="The project API returned no platform or custom domain records."
            compact
          />
        )}
      </SettingsCard>

      <ConfirmDialog
        open={Boolean(removeDomain)}
        title="Unbind custom domain"
        description="This removes the persisted provider binding. DNS records outside OceanLeo are not silently changed."
        confirmLabel="Unbind domain"
        confirmationText={removeDomain?.hostname}
        confirmationValue={confirmation}
        onConfirmationValueChange={setConfirmation}
        busy={action.running}
        error={action.error}
        onClose={() => {
          if (action.running) return;
          setRemoveDomain(null);
          setConfirmation("");
          action.clear();
        }}
        onConfirm={() => {
          if (removeDomain) void run(removeDomain, "unbind");
        }}
      />
    </div>
  );
}
