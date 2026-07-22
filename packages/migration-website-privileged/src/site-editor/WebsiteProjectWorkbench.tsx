"use client";

import type { ReactNode } from "react";
import {
  DevSiteEditorClient,
  type DevSiteEditorClientProps,
  type WebsiteProjectWorkbenchModuleContext,
  type WebsiteProjectWorkbenchModuleSlot,
} from "./DevSiteEditorClient";
import {
  DashboardWorkspace,
  DatabaseWorkspace,
  SettingsWorkspace,
  StorageWorkspace,
} from "./project-workbench/management";

export type {
  WebsiteProjectWorkbenchModuleContext,
  WebsiteProjectWorkbenchModuleSlot,
} from "./DevSiteEditorClient";

export type WebsiteProjectWorkbenchProps = DevSiteEditorClientProps;

function projectModule(
  render: (projectId: string) => ReactNode,
): WebsiteProjectWorkbenchModuleSlot {
  return (context: WebsiteProjectWorkbenchModuleContext) =>
    context.projectId
      ? { content: render(context.projectId), available: true }
      : {
          available: false,
          unavailableReason:
            "This view requires a canonical Website Project. Attach or create the project first.",
        };
}

const MANAGEMENT_MODULES: NonNullable<
  DevSiteEditorClientProps["modules"]
> = {
  dashboard: projectModule((projectId) => (
    <DashboardWorkspace projectId={projectId} />
  )),
  database: projectModule((projectId) => (
    <DatabaseWorkspace projectId={projectId} />
  )),
  storage: projectModule((projectId) => (
    <StorageWorkspace projectId={projectId} />
  )),
  settings: projectModule((projectId) => (
    <SettingsWorkspace projectId={projectId} />
  )),
};

/**
 * Stable parent seam for the six-view Website Project Workbench.
 *
 * Preview and Code are owned by DevSiteEditorClient. Dashboard, Database,
 * Storage, and Settings are supplied as module slots, so the management
 * package can attach its children without importing or forking editor state.
 */
export function WebsiteProjectWorkbench({
  modules = {},
}: WebsiteProjectWorkbenchProps) {
  return (
    <DevSiteEditorClient modules={{ ...MANAGEMENT_MODULES, ...modules }} />
  );
}

export default WebsiteProjectWorkbench;
