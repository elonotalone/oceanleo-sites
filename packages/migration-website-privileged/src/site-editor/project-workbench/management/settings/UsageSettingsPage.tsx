"use client";

import { useCallback } from "react";
import type { ManagementApi } from "../api";
import { useApiResource } from "../resource";
import type { UsageMeter } from "../types";
import {
  Button,
  Notice,
  ResourceBoundary,
  StatusPill,
  formatDateTime,
  formatNumber,
} from "../ui";
import { SettingsCard, SettingsPage } from "./SettingsShared";

export function UsageSettingsPage({
  projectId,
  api,
}: {
  projectId: string;
  api: ManagementApi;
}) {
  const loader = useCallback(
    () => api.getSettings(projectId, "usage"),
    [api, projectId],
  );
  const resource = useApiResource(loader, [projectId], {
    isEmpty: (data) => data.meters.length === 0,
  });

  return (
    <SettingsPage
      title="Usage"
      description="Project-scoped, provider-verified metering for the current billing period. Missing provider data is shown as unavailable."
      actions={<Button onClick={() => void resource.reload()}>Refresh</Button>}
    >
      <ResourceBoundary
        resource={resource}
        loadingLabel="Loading project usage"
        emptyTitle="No usage meters"
        emptyDescription="The project API returned no internal or provider usage meters."
        onRetry={() => void resource.reload()}
      >
        {(usage) => (
          <div className="space-y-4">
            <Notice tone="info">
              {usage.period.label} · {formatDateTime(usage.period.startsAt)} –{" "}
              {formatDateTime(usage.period.endsAt)}
            </Notice>
            <SettingsCard title="Metered resources">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {usage.meters.map((meter) => (
                  <UsageCard key={meter.key} meter={meter} />
                ))}
              </div>
            </SettingsCard>
          </div>
        )}
      </ResourceBoundary>
    </SettingsPage>
  );
}

function UsageCard({ meter }: { meter: UsageMeter }) {
  const measurable =
    typeof meter.value === "number" && Number.isFinite(meter.value);
  const hasQuota =
    measurable &&
    typeof meter.quota === "number" &&
    Number.isFinite(meter.quota) &&
    meter.quota > 0;
  const ratio = hasQuota
    ? Math.max(0, Math.min(1, (meter.value as number) / (meter.quota as number)))
    : null;
  const verifiedValue = measurable && meter.providerVerified;

  return (
    <article className="rounded-xl border border-zinc-200 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-800">{meter.label}</h3>
        <StatusPill
          label={
            verifiedValue
              ? "Provider verified"
              : meter.providerVerified
                ? "Value unavailable"
                : "Unverified"
          }
          tone={verifiedValue ? "positive" : "warning"}
        />
      </div>
      {verifiedValue ? (
        <>
          <p className="mt-3 text-xl font-semibold text-zinc-950">
            {formatNumber(meter.value)}{" "}
            <span className="text-xs font-normal text-zinc-500">
              {meter.unit}
            </span>
          </p>
          {typeof meter.quota === "number" ? (
            <p className="mt-1 text-xs text-zinc-500">
              of {formatNumber(meter.quota)} {meter.unit}
            </p>
          ) : null}
          {ratio !== null ? (
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(ratio * 100)}
              aria-label={`${meter.label} usage`}
            >
              <div
                className="h-full rounded-full bg-blue-600"
                style={{ width: `${ratio * 100}%` }}
              />
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-xs leading-5 text-zinc-500">
          {meter.unavailableReason ||
            "No provider-verified value was returned for this meter."}
        </p>
      )}
    </article>
  );
}
