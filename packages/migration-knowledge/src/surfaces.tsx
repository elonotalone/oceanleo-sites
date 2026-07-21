"use client";

import { I18nProvider } from "@oceanleo/ui/i18n";
import type { OpsSchema } from "@oceanleo/ui/lib";
import {
  AppShell,
  FunctionAgentChat,
  HistoryDetail,
  HistorySubNav,
  WorkspaceSessionProvider,
  useOptionalWorkspaceSession,
  type RestorableAppSession,
  type ShellNavItem,
} from "@oceanleo/ui/shell";
import { useMemo, type ReactNode } from "react";

import {
  knowledgeTenantConfig,
  resolveKnowledgeWorkflow,
  type KnowledgeSiteKey,
  type KnowledgeTenantConfig,
  type KnowledgeWorkflow,
} from "./catalog";
import type {
  KnowledgeHistoryPageProps,
  KnowledgeWorkspacePageProps,
} from "./pages";

function tenantNav(config: KnowledgeTenantConfig): ShellNavItem[] {
  return [
    {
      label: "首页",
      href: "/",
      exact: true,
      icon: <span aria-hidden>⌂</span>,
    },
    {
      label: "工作台",
      href: "/workspace",
      icon: <span aria-hidden>◇</span>,
    },
    {
      label: "历史记录",
      href: "/history",
      icon: <span aria-hidden>◷</span>,
      disclosure: {
        defaultOpen: true,
        render: () => (
          <HistorySubNav siteId={config.siteKey} accent={config.accent} />
        ),
      },
    },
  ];
}

function KnowledgeShell({
  config,
  children,
}: Readonly<{
  config: KnowledgeTenantConfig;
  children: ReactNode;
}>) {
  const nav = useMemo(() => tenantNav(config), [config]);
  return (
    <I18nProvider locale="zh" messages={{}}>
      <AppShell
        accountHref="/account"
        brand={{
          name: config.name,
          accent: config.accent,
          logo: (
            <span aria-hidden style={{ color: config.accent }}>
              ●
            </span>
          ),
        }}
        collapseKey={`${config.siteKey}_sidebar_collapsed`}
        nav={nav}
        pinnedNavCount={3}
        siteId={config.siteKey}
      >
        {children}
      </AppShell>
    </I18nProvider>
  );
}

function workflowSchema(workflow: KnowledgeWorkflow): OpsSchema {
  return {
    agentId: workflow.agentId,
    title: workflow.title,
    fields: [
      {
        key: "prompt",
        label: "需求",
        type: "longtext",
        hint: `向 ${workflow.title} 描述你的目标、材料和输出要求。`,
      },
    ],
    actions: [],
  };
}

function KnowledgeRuntime({
  config,
  workflow,
}: Readonly<{
  config: KnowledgeTenantConfig;
  workflow: KnowledgeWorkflow;
}>) {
  const inherited = useOptionalWorkspaceSession();
  const runtime = (
    <div
      data-agent-id={workflow.agentId}
      data-history-protocol={config.historyProtocol}
      data-site-key={config.siteKey}
      data-streaming-protocol={config.streamingProtocol}
      data-workflow-id={workflow.id}
      style={{ minHeight: "calc(100dvh - 1px)" }}
    >
      <FunctionAgentChat
        accent={config.accent}
        agentId={workflow.agentId}
        appIcon={workflow.icon}
        appLabel={workflow.title}
        defaultTab="agent"
        opsContent={null}
        schema={workflowSchema(workflow)}
        showOps={false}
        siteId={config.siteKey}
      />
    </div>
  );

  if (
    inherited?.siteId === config.siteKey &&
    inherited.appId === workflow.id
  ) {
    return runtime;
  }

  return (
    <WorkspaceSessionProvider
      appId={workflow.id}
      resumeLatest
      siteId={config.siteKey}
      title={workflow.title}
    >
      {runtime}
    </WorkspaceSessionProvider>
  );
}

function KnowledgeCatalog({
  config,
}: Readonly<{ config: KnowledgeTenantConfig }>) {
  return (
    <main
      data-knowledge-catalog={config.siteKey}
      style={{ margin: "0 auto", maxWidth: "72rem", padding: "2.5rem 2rem" }}
    >
      <p
        style={{
          color: config.accent,
          fontSize: "0.75rem",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {config.siteKey} · specialized workflows
      </p>
      <h1 style={{ fontSize: "2rem", margin: "0.5rem 0" }}>
        {config.name} 工作台
      </h1>
      <p style={{ color: "#64748b", lineHeight: 1.7 }}>
        选择一个成品工作流。每条工作流使用共享流式 agent 传输，并绑定可恢复的工作会话。
      </p>
      <div
        style={{
          display: "grid",
          gap: "0.85rem",
          gridTemplateColumns: "repeat(auto-fill, minmax(13rem, 1fr))",
          marginTop: "1.5rem",
        }}
      >
        {config.workflows.map((workflow) => (
          <a
            data-agent-id={workflow.agentId}
            href={`/workspace/${encodeURIComponent(workflow.id)}`}
            key={workflow.id}
            style={{
              background: "white",
              border: "1px solid #e2e8f0",
              borderRadius: "1rem",
              color: "#0f172a",
              padding: "1rem",
              textDecoration: "none",
            }}
          >
            <span aria-hidden style={{ fontSize: "1.35rem" }}>
              {workflow.icon}
            </span>
            <strong style={{ display: "block", marginTop: "0.5rem" }}>
              {workflow.title}
            </strong>
            <small style={{ color: "#64748b" }}>{workflow.agentId}</small>
          </a>
        ))}
      </div>
    </main>
  );
}

function MissingWorkflow({
  config,
  workflowId,
}: Readonly<{ config: KnowledgeTenantConfig; workflowId: string }>) {
  return (
    <main style={{ margin: "0 auto", maxWidth: "42rem", padding: "4rem 2rem" }}>
      <h1>工作流不存在</h1>
      <p style={{ color: "#64748b" }}>
        {config.name} 没有注册工作流 <code>{workflowId}</code>。
      </p>
      <a href="/workspace">返回工作台目录</a>
    </main>
  );
}

export function KnowledgeWorkspaceSurface({
  siteKey,
  requestedWorkflowId,
}: KnowledgeWorkspacePageProps) {
  const config = knowledgeTenantConfig(siteKey);
  const workflow = resolveKnowledgeWorkflow(siteKey, requestedWorkflowId);
  return (
    <KnowledgeShell config={config}>
      {requestedWorkflowId === null ? (
        <KnowledgeCatalog config={config} />
      ) : workflow ? (
        <KnowledgeRuntime config={config} workflow={workflow} />
      ) : (
        <MissingWorkflow
          config={config}
          workflowId={requestedWorkflowId}
        />
      )}
    </KnowledgeShell>
  );
}

function historyWorkspace(
  config: KnowledgeTenantConfig,
  session: RestorableAppSession,
) {
  const workflow =
    resolveKnowledgeWorkflow(config.siteKey, session.app_id) ??
    resolveKnowledgeWorkflow(config.siteKey, config.defaultWorkflowId);
  if (!workflow) {
    return (
      <MissingWorkflow config={config} workflowId={session.app_id || "unknown"} />
    );
  }
  return <KnowledgeRuntime config={config} workflow={workflow} />;
}

export function KnowledgeHistorySurface({
  siteKey,
}: KnowledgeHistoryPageProps) {
  const config = knowledgeTenantConfig(siteKey);
  const appNames = useMemo(
    () =>
      Object.fromEntries(
        config.workflows.map((workflow) => [workflow.id, workflow.title]),
      ),
    [config],
  );
  return (
    <KnowledgeShell config={config}>
      <HistoryDetail
        accent={config.accent}
        appNames={appNames}
        renderWorkspace={(session) => historyWorkspace(config, session)}
        siteId={config.siteKey}
      />
    </KnowledgeShell>
  );
}

export type { KnowledgeSiteKey };
