"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  managementApi,
  type ManagementApi,
} from "./api";
import { useApiAction, useApiResource } from "./resource";
import type {
  AnalyticsDimension,
  AnalyticsMetric,
  AnalyticsMetricKey,
  AnalyticsQuery,
  AnalyticsTimeseries,
  DeploymentPage,
  ProjectSummary,
  WebsiteDeployment,
  WorkspaceBaseProps,
} from "./types";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  InlineError,
  LoadingState,
  Notice,
  Panel,
  ResourceBoundary,
  SelectInput,
  StatusPill,
  WorkspaceSurface,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  statusTone,
} from "./ui";

export interface DashboardWorkspaceProps extends WorkspaceBaseProps {
  api?: ManagementApi;
  onManageAccess?: () => void;
}

type AnalyticsBundle = {
  summary: Awaited<ReturnType<ManagementApi["getAnalyticsSummary"]>>;
  timeseries: Awaited<ReturnType<ManagementApi["getAnalyticsTimeseries"]>>;
  dimensions: Awaited<ReturnType<ManagementApi["getAnalyticsDimensions"]>>;
};

const RANGE_OPTIONS: Array<{ value: AnalyticsQuery["range"]; label: string }> = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "13m", label: "Last 13 months" },
];

const DIMENSION_OPTIONS: Array<{
  value: AnalyticsDimension | "";
  label: string;
}> = [
  { value: "", label: "No filter" },
  { value: "path", label: "Path" },
  { value: "referrer_class", label: "Referrer class" },
  { value: "device_class", label: "Device class" },
  { value: "deployment_revision", label: "Deployment / revision" },
];

export function DashboardWorkspace({
  projectId,
  className,
  api = managementApi,
  onManageAccess,
}: DashboardWorkspaceProps) {
  const [range, setRange] = useState<AnalyticsQuery["range"]>("7d");
  const [dimension, setDimension] = useState<AnalyticsDimension | "">("");
  const [dimensionValue, setDimensionValue] = useState("");
  const [metric, setMetric] = useState<AnalyticsMetricKey>("page_views");
  const [refreshKey, setRefreshKey] = useState(0);
  const [deploymentCursors, setDeploymentCursors] = useState<
    Array<string | undefined>
  >([undefined]);
  const deploymentCursor =
    deploymentCursors[deploymentCursors.length - 1];

  useEffect(() => {
    setDeploymentCursors([undefined]);
    setDimension("");
    setDimensionValue("");
    setMetric("page_views");
  }, [projectId]);

  const projectLoader = useCallback(
    async () => {
      const [summary, probe] = await Promise.all([
        api.getProjectSummary(projectId),
        api.getCapabilities(projectId),
      ]);
      return { ...summary, capabilities: probe.capabilities };
    },
    [api, projectId],
  );
  const project = useApiResource(projectLoader, [projectId, refreshKey]);

  const analyticsQuery = useMemo<AnalyticsQuery>(
    () => ({
      range,
      filters:
        dimension && dimensionValue
          ? [{ dimension, value: dimensionValue }]
          : undefined,
    }),
    [dimension, dimensionValue, range],
  );
  const canReadAnalytics =
    project.data?.permissions.canReadAnalytics === true;
  const analyticsLoader = useCallback(
    async (): Promise<AnalyticsBundle> => {
      const [summary, timeseries, dimensions] = await Promise.all([
        api.getAnalyticsSummary(projectId, analyticsQuery),
        api.getAnalyticsTimeseries(projectId, analyticsQuery),
        api.getAnalyticsDimensions(projectId, analyticsQuery),
      ]);
      return { summary, timeseries, dimensions };
    },
    [analyticsQuery, api, projectId],
  );
  const analytics = useApiResource(
    analyticsLoader,
    [projectId, analyticsQuery, refreshKey],
    { enabled: canReadAnalytics },
  );

  const deploymentsLoader = useCallback(
    () => api.getDeployments(projectId, deploymentCursor),
    [api, deploymentCursor, projectId],
  );
  const deployments = useApiResource(
    deploymentsLoader,
    [projectId, deploymentCursor, refreshKey],
  );

  const refresh = () => setRefreshKey((current) => current + 1);

  return (
    <WorkspaceSurface
      title="Dashboard"
      description="Project health, access, production analytics, and immutable deployment history."
      className={className}
      actions={<Button onClick={refresh}>Refresh</Button>}
    >
      <div className="space-y-5">
        <ResourceBoundary
          resource={project}
          loadingLabel="Loading project summary"
          onRetry={() => void project.reload()}
        >
          {(summary) => (
            <>
              <ProjectSummaryPanel summary={summary} />
              <AccessPanel
                summary={summary}
                onManageAccess={onManageAccess}
              />
            </>
          )}
        </ResourceBoundary>

        <Panel
          title="Analytics"
          description="Production traffic only. Preview, bot, and replayed events are excluded by the analytics service."
          actions={
            <div className="flex flex-wrap gap-2">
              <SelectInput
                aria-label="Analytics time range"
                className="min-h-8 w-auto py-0 text-xs"
                value={range}
                onChange={(event) => {
                  setRange(event.target.value as AnalyticsQuery["range"]);
                  setDimensionValue("");
                }}
              >
                {RANGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectInput>
              <SelectInput
                aria-label="Analytics filter dimension"
                className="min-h-8 w-auto py-0 text-xs"
                value={dimension}
                onChange={(event) => {
                  setDimension(
                    event.target.value as AnalyticsDimension | "",
                  );
                  setDimensionValue("");
                }}
              >
                {DIMENSION_OPTIONS.map((option) => (
                  <option key={option.value || "none"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectInput>
              {dimension && analytics.data ? (
                <SelectInput
                  aria-label="Analytics filter value"
                  className="min-h-8 w-auto max-w-64 py-0 text-xs"
                  value={dimensionValue}
                  onChange={(event) => setDimensionValue(event.target.value)}
                >
                  <option value="">All values</option>
                  {(analytics.data.dimensions.dimensions[dimension] ?? []).map(
                    (item) => (
                      <option key={item.value} value={item.value}>
                        {item.label || item.value} ({formatNumber(item.count)})
                      </option>
                    ),
                  )}
                </SelectInput>
              ) : null}
            </div>
          }
        >
          <div className="p-4 sm:p-5">
            {!project.data && project.status === "loading" ? (
              <LoadingState label="Loading analytics permission" />
            ) : !project.data ? (
              <EmptyState
                title="Project context unavailable"
                description="Analytics was not requested because the project role and capabilities could not be verified."
              />
            ) : !project.data.permissions.canReadAnalytics ? (
              <EmptyState
                title="Analytics permission required"
                description="Your project role does not include analytics.read. The gateway also enforces this permission."
              />
            ) : (
              <ResourceBoundary
                resource={analytics}
                loadingLabel="Loading production analytics"
                onRetry={() => void analytics.reload()}
              >
                {(bundle) => (
                  <AnalyticsContent
                    bundle={bundle}
                    metric={metric}
                    onMetricChange={setMetric}
                  />
                )}
              </ResourceBoundary>
            )}
          </div>
        </Panel>

        <Panel
          title="Deployments"
          description="Every state below is persisted by the deployment service and tied to an immutable source revision."
        >
          <div className="p-4 sm:p-5">
            <ResourceBoundary
              resource={deployments}
              loadingLabel="Loading deployment history"
              emptyTitle="No deployments recorded"
              emptyDescription="The project API returned no deployment records. No production state is inferred."
              onRetry={() => void deployments.reload()}
            >
              {(page) => (
                <DeploymentsTable
                  key={`${projectId}:${deploymentCursor || "first"}`}
                  projectId={projectId}
                  page={page}
                  api={api}
                  onChanged={() => void deployments.reload()}
                  canGoBack={deploymentCursors.length > 1}
                  onPrevious={() =>
                    setDeploymentCursors((current) => current.slice(0, -1))
                  }
                  onNext={(cursor) =>
                    setDeploymentCursors((current) => [...current, cursor])
                  }
                />
              )}
            </ResourceBoundary>
          </div>
        </Panel>
      </div>
    </WorkspaceSurface>
  );
}

function ProjectSummaryPanel({ summary }: { summary: ProjectSummary }) {
  return (
    <Panel className="mb-5">
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start">
        <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 text-lg font-semibold text-zinc-500">
          {summary.faviconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={summary.faviconUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            summary.displayName.slice(0, 1).toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="truncate text-lg font-semibold text-zinc-950">
                {summary.displayName}
              </h2>
              <p className="mt-0.5 font-mono text-xs text-zinc-500">
                {summary.slug}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {summary.documentationUrl ? (
                <a
                  href={summary.documentationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-9 items-center rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 outline-none hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  Documentation
                </a>
              ) : null}
              {summary.primaryProductionUrl ? (
                <a
                  href={summary.primaryProductionUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-9 items-center rounded-lg border border-zinc-900 bg-zinc-900 px-3 text-sm font-medium text-white outline-none hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  Open website
                </a>
              ) : null}
            </div>
          </div>

          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <SummaryDatum
              label="Production URL"
              value={summary.primaryProductionUrl || "Unavailable"}
            />
            <SummaryDatum
              label="Working revision"
              value={revisionLabel(summary.workingRevision)}
            />
            <SummaryDatum
              label="Published revision"
              value={revisionLabel(summary.publishedRevision)}
            />
          </dl>

          <div className="mt-4 flex flex-wrap gap-2" aria-label="Detected capabilities">
            {summary.capabilities.length ? (
              summary.capabilities.map((capability) => (
                <StatusPill
                  key={capability.id}
                  label={capability.label}
                  tone={statusTone(capability.status)}
                  title={capability.reason || undefined}
                />
              ))
            ) : (
              <span className="text-xs text-zinc-500">
                The capability probe returned no detected features.
              </span>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function SummaryDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-zinc-50 px-3 py-2.5">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm text-zinc-800" title={value}>
        {value}
      </dd>
    </div>
  );
}

function AccessPanel({
  summary,
  onManageAccess,
}: {
  summary: ProjectSummary;
  onManageAccess?: () => void;
}) {
  return (
    <Panel
      title="Access"
      description="Workbench access and production visitor access are separate policies."
      className="mb-5"
      actions={
        onManageAccess && summary.permissions.canManageAccess ? (
          <Button size="sm" onClick={onManageAccess}>
            Manage access
          </Button>
        ) : null
      }
    >
      <div className="grid gap-px bg-zinc-100 sm:grid-cols-2">
        <div className="bg-white p-4 sm:p-5">
          <p className="text-xs font-medium text-zinc-500">Project access</p>
          <div className="mt-2 flex items-center gap-2">
            <StatusPill label={summary.projectAccess.label} />
            {typeof summary.projectAccess.memberCount === "number" ? (
              <span className="text-xs text-zinc-500">
                {formatNumber(summary.projectAccess.memberCount)} members
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            Controls source, project data, and workbench access.
          </p>
        </div>
        <div className="bg-white p-4 sm:p-5">
          <p className="text-xs font-medium text-zinc-500">
            Published site access
          </p>
          <div className="mt-2 flex items-center gap-2">
            <StatusPill
              label={summary.publishedAccess.label}
              tone={
                summary.publishedAccess.enforced
                  ? statusTone(summary.publishedAccess.mode)
                  : "warning"
              }
            />
            {!summary.publishedAccess.enforced ? (
              <span className="text-xs text-amber-700">Not enforced</span>
            ) : null}
          </div>
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            {summary.publishedAccess.reason ||
              "Controls visitor access at the production edge."}
          </p>
        </div>
      </div>
    </Panel>
  );
}

function AnalyticsContent({
  bundle,
  metric,
  onMetricChange,
}: {
  bundle: AnalyticsBundle;
  metric: AnalyticsMetricKey;
  onMetricChange: (value: AnalyticsMetricKey) => void;
}) {
  if (bundle.summary.unavailableReason) {
    return (
      <Notice tone="warning" title="Analytics unavailable">
        {bundle.summary.unavailableReason}
      </Notice>
    );
  }
  const activeMetric =
    bundle.summary.metrics.find((item) => item.key === metric)?.key ??
    bundle.summary.metrics[0]?.key;

  return (
    <div className="space-y-5">
      {activeMetric ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {bundle.summary.metrics.map((item) => (
            <MetricCard
              key={item.key}
              metric={item}
              selected={activeMetric === item.key}
              onClick={() => onMetricChange(item.key)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No analytics metrics"
          description="The analytics API returned no metric definitions for this range."
          compact
        />
      )}
      {bundle.summary.sampled ? (
        <Notice tone="info">
          This range is sampled by the analytics service.
        </Notice>
      ) : null}
      {bundle.timeseries.points.length && activeMetric ? (
        <AnalyticsChart
          timeseries={bundle.timeseries}
          metric={activeMetric}
        />
      ) : (
        <EmptyState
          title="No analytics events in this range"
          description="The analytics API returned no production points for the selected range and filters."
          compact
        />
      )}
      <p className="text-[11px] text-zinc-400">
        {formatDateTime(bundle.summary.from)} –{" "}
        {formatDateTime(bundle.summary.to)} · {bundle.summary.timezone}
      </p>
    </div>
  );
}

function MetricCard({
  metric,
  selected,
  onClick,
}: {
  metric: AnalyticsMetric;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-xl border p-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 ${
        selected
          ? "border-blue-300 bg-blue-50/60"
          : "border-zinc-200 bg-white hover:border-zinc-300"
      }`}
    >
      <span className="text-xs font-medium text-zinc-500">{metric.label}</span>
      <span className="mt-1 block text-xl font-semibold text-zinc-950">
        {metricValue(metric)}
      </span>
      {typeof metric.changeRatio === "number" &&
      Number.isFinite(metric.changeRatio) ? (
        <span
          className={`mt-1 block text-[11px] ${
            metric.changeRatio >= 0 ? "text-emerald-700" : "text-red-700"
          }`}
        >
          {metric.changeRatio >= 0 ? "+" : ""}
          {formatPercent(metric.changeRatio)} vs previous period
        </span>
      ) : null}
    </button>
  );
}

function AnalyticsChart({
  timeseries,
  metric,
}: {
  timeseries: AnalyticsTimeseries;
  metric: AnalyticsMetricKey;
}) {
  const values = timeseries.points.map((point) => point.values[metric] ?? null);
  const numericValues = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (!numericValues.length) {
    return (
      <EmptyState
        title="Metric series unavailable"
        description="The analytics API returned time buckets but no numeric values for this metric."
        compact
      />
    );
  }
  const maximum = Math.max(...numericValues, 0);
  const width = 1000;
  const height = 260;
  const horizontalPadding = 28;
  const verticalPadding = 24;
  const drawableWidth = width - horizontalPadding * 2;
  const drawableHeight = height - verticalPadding * 2;
  const plottedPoints = values.flatMap((value, index) => {
    if (value === null || !Number.isFinite(value)) return [];
    const x =
      horizontalPadding +
      (values.length === 1
        ? drawableWidth / 2
        : (index / (values.length - 1)) * drawableWidth);
    const y =
      verticalPadding +
      (maximum === 0
        ? drawableHeight
        : (1 - value / maximum) * drawableHeight);
    return [
      {
        at: timeseries.points[index]?.at || "",
        value,
        coordinates: `${x},${y}`,
      },
    ];
  });
  const points = plottedPoints.map((point) => point.coordinates).join(" ");

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
        <p className="text-xs font-medium text-zinc-700">
          {metric.replaceAll("_", " ")}
        </p>
        <p className="text-[11px] text-zinc-400">
          {timeseries.interval} · max {formatNumber(maximum)}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-52 w-full"
        role="img"
        aria-label={`${metric.replaceAll("_", " ")} analytics time series with ${plottedPoints.length} available points`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((part) => (
          <line
            key={part}
            x1={horizontalPadding}
            x2={width - horizontalPadding}
            y1={verticalPadding + part * drawableHeight}
            y2={verticalPadding + part * drawableHeight}
            stroke="#e4e4e7"
            strokeWidth="1"
          />
        ))}
        <polyline
          points={points}
          fill="none"
          stroke="#2563eb"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {plottedPoints.map((point, index) => {
          const [cx, cy] = point.coordinates.split(",");
          return (
            <circle
              key={`${point.at}-${index}`}
              cx={cx}
              cy={cy}
              r="4"
              fill="#fff"
              stroke="#2563eb"
              strokeWidth="3"
            >
              <title>
                {formatDateTime(point.at)}: {formatNumber(point.value)}
              </title>
            </circle>
          );
        })}
      </svg>
      <div className="sr-only">
        <table>
          <caption>{metric.replaceAll("_", " ")} values</caption>
          <tbody>
            {timeseries.points.map((point, index) => (
              <tr key={point.at}>
                <th>{formatDateTime(point.at)}</th>
                <td>{formatNumber(values[index])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeploymentsTable({
  projectId,
  page,
  api,
  onChanged,
  canGoBack,
  onPrevious,
  onNext,
}: {
  projectId: string;
  page: DeploymentPage;
  api: ManagementApi;
  onChanged: () => void;
  canGoBack: boolean;
  onPrevious: () => void;
  onNext: (cursor: string) => void;
}) {
  const action = useApiAction<WebsiteDeployment>();
  const [pending, setPending] = useState<{
    deployment: WebsiteDeployment;
    kind: "cancel" | "unpublish";
  } | null>(null);
  const [confirmation, setConfirmation] = useState("");

  async function run(
    deployment: WebsiteDeployment,
    kind: "retry" | "cancel" | "unpublish",
  ) {
    const result = await action.run(() => {
      if (kind === "retry") {
        return api.retryDeployment(
          projectId,
          deployment.id,
          deployment.version,
        );
      }
      if (kind === "cancel") {
        return api.cancelDeployment(
          projectId,
          deployment.id,
          deployment.version,
        );
      }
      return api.unpublish(projectId);
    });
    if (result) {
      setPending(null);
      setConfirmation("");
      onChanged();
    }
  }

  if (!page.items.length) {
    return (
      <EmptyState
        title="No deployments recorded"
        description="The project API returned no deployment records on this page. No production state is inferred."
        action={
          canGoBack ? (
            <Button size="sm" onClick={onPrevious}>
              Previous page
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left">
          <caption className="sr-only">Project deployment history</caption>
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-zinc-400">
              <th className="border-b border-zinc-200 px-3 py-2 font-medium">Status</th>
              <th className="border-b border-zinc-200 px-3 py-2 font-medium">Revision</th>
              <th className="border-b border-zinc-200 px-3 py-2 font-medium">Commit</th>
              <th className="border-b border-zinc-200 px-3 py-2 font-medium">URL / provider</th>
              <th className="border-b border-zinc-200 px-3 py-2 font-medium">Timing</th>
              <th className="border-b border-zinc-200 px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((deployment) => (
              <tr key={deployment.id} className="align-top text-xs text-zinc-700">
                <td className="border-b border-zinc-100 px-3 py-3">
                  <StatusPill
                    label={deployment.statusLabel}
                    tone={statusTone(deployment.status)}
                  />
                  {deployment.failureReason ? (
                    <p className="mt-1.5 max-w-56 text-[11px] leading-4 text-red-700">
                      {deployment.failureReason}
                    </p>
                  ) : null}
                </td>
                <td className="border-b border-zinc-100 px-3 py-3 font-mono">
                  {revisionLabel(deployment.revision)}
                </td>
                <td className="border-b border-zinc-100 px-3 py-3 font-mono">
                  {deployment.commitSha?.slice(0, 10) || "—"}
                </td>
                <td className="border-b border-zinc-100 px-3 py-3">
                  {deployment.url ? (
                    <a
                      href={deployment.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block max-w-64 truncate text-blue-700 hover:underline"
                    >
                      {deployment.url}
                    </a>
                  ) : (
                    "—"
                  )}
                  <span className="mt-1 block max-w-64 truncate font-mono text-[10px] text-zinc-400">
                    {deployment.providerDeploymentId || "No provider ID"}
                  </span>
                </td>
                <td className="border-b border-zinc-100 px-3 py-3">
                  <span className="block">{formatDateTime(deployment.startedAt)}</span>
                  {deployment.readyAt ? (
                    <span className="mt-1 block text-[10px] text-zinc-400">
                      Ready {formatDateTime(deployment.readyAt)}
                    </span>
                  ) : null}
                </td>
                <td className="border-b border-zinc-100 px-3 py-3">
                  <div className="flex justify-end gap-1">
                    {deployment.actions.canRetry ? (
                      <Button
                        size="sm"
                        disabled={action.running}
                        onClick={() => void run(deployment, "retry")}
                      >
                        Retry
                      </Button>
                    ) : null}
                    {deployment.actions.canCancel ? (
                      <Button
                        size="sm"
                        disabled={action.running}
                        onClick={() => {
                          action.clear();
                          setPending({ deployment, kind: "cancel" });
                        }}
                      >
                        Cancel
                      </Button>
                    ) : null}
                    {deployment.actions.canUnpublish ? (
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={action.running}
                        onClick={() => {
                          action.clear();
                          setConfirmation("");
                          setPending({ deployment, kind: "unpublish" });
                        }}
                      >
                        Unpublish
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3" aria-live="polite">
        <InlineError
          error={pending ? null : action.error}
        />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" disabled={!canGoBack} onClick={onPrevious}>
          Previous
        </Button>
        <Button
          size="sm"
          disabled={!page.nextCursor}
          onClick={() => {
            if (page.nextCursor) onNext(page.nextCursor);
          }}
        >
          Next
        </Button>
      </div>
      <ConfirmDialog
        open={Boolean(pending)}
        title={
          pending?.kind === "unpublish"
            ? "Unpublish production website"
            : "Cancel deployment"
        }
        description={
          pending?.kind === "unpublish"
            ? "The project API must confirm that production was removed. The dashboard will then refetch persisted deployment state."
            : "The deployment provider may reject cancellation after a build has reached its final stage."
        }
        confirmLabel={
          pending?.kind === "unpublish" ? "Unpublish" : "Cancel deployment"
        }
        confirmationText={
          pending?.kind === "unpublish"
            ? pending.deployment.revision.id
            : undefined
        }
        confirmationValue={confirmation}
        onConfirmationValueChange={setConfirmation}
        busy={action.running}
        error={action.error}
        onClose={() => {
          if (action.running) return;
          setPending(null);
          setConfirmation("");
          action.clear();
        }}
        onConfirm={() => {
          if (pending) {
            void run(pending.deployment, pending.kind);
          }
        }}
      />
    </div>
  );
}

function metricValue(metric: AnalyticsMetric): string {
  if (metric.unit === "seconds") return formatDuration(metric.value);
  if (metric.unit === "ratio") return formatPercent(metric.value);
  return formatNumber(metric.value);
}

function revisionLabel(
  revision: ProjectSummary["workingRevision"] | WebsiteDeployment["revision"],
): string {
  if (!revision) return "Unavailable";
  if (revision.number !== null && revision.number !== undefined) {
    return `r${revision.number}`;
  }
  return revision.id;
}
