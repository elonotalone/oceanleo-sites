import { createElement, type ReactNode } from "react";

import type { KnowledgeSiteKey } from "./catalog";

export interface KnowledgeWorkspacePageProps {
  readonly siteKey: KnowledgeSiteKey;
  readonly requestedWorkflowId: string | null;
}

export interface KnowledgeHistoryPageProps {
  readonly siteKey: KnowledgeSiteKey;
}

/**
 * Keep client-only @oceanleo/ui modules behind the RSC render boundary.
 * Package tests import plugin declarations under the `react-server` condition,
 * while Next turns the dynamically imported module into a client reference.
 */
export async function KnowledgeWorkspacePage(
  props: KnowledgeWorkspacePageProps,
): Promise<ReactNode> {
  const { KnowledgeWorkspaceSurface } = await import("./surfaces");
  return createElement(KnowledgeWorkspaceSurface, props);
}

export async function KnowledgeHistoryPage(
  props: KnowledgeHistoryPageProps,
): Promise<ReactNode> {
  const { KnowledgeHistorySurface } = await import("./surfaces");
  return createElement(KnowledgeHistorySurface, props);
}
