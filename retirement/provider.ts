import { deepFreeze, invariant, isoMilliseconds } from "./canonical";
import type { RetirementManifest } from "./types";

export const RETIREMENT_MUTATION_RECEIPT_SCHEMA_VERSION =
  "oceanleo.retirement-mutation-receipt/v1" as const;

export type RetirementMutationAction =
  | Readonly<{
      actionId: string;
      stage: "soft-retire";
      kind: "remove-generated-alias";
      projectId: string;
      aliasId: string;
      host: string;
    }>
  | Readonly<{
      actionId: string;
      stage: "delete-provider-resources";
      kind: "delete-legacy-project";
      projectId: string;
      retainedDeploymentId: string;
    }>
  | Readonly<{
      actionId: string;
      stage: "delete-provider-resources";
      kind: "delete-verified-local-clone";
      projectId: string;
      path: string;
    }>;

export interface RetirementMutationReceipt {
  readonly schemaVersion: typeof RETIREMENT_MUTATION_RECEIPT_SCHEMA_VERSION;
  readonly actionId: string;
  readonly actionKind: RetirementMutationAction["kind"];
  readonly resourceId: string;
  readonly providerReceiptId: string;
  readonly completedAt: string;
}

export interface RetirementProvider {
  /**
   * Implementations must treat action.actionId as an idempotency key and return
   * the same completed resource result after a retry.
   */
  apply(action: RetirementMutationAction): Promise<RetirementMutationReceipt>;
}

export class PlanOnlyRetirementProvider implements RetirementProvider {
  async apply(
    action: RetirementMutationAction,
  ): Promise<RetirementMutationReceipt> {
    throw new Error(
      `No mutation provider is configured for ${action.actionId}; the CLI is plan-only.`,
    );
  }
}

function resourceId(action: RetirementMutationAction): string {
  switch (action.kind) {
    case "remove-generated-alias":
      return action.aliasId;
    case "delete-legacy-project":
      return action.projectId;
    case "delete-verified-local-clone":
      return action.path;
  }
}

export function validateMutationReceipt(
  action: RetirementMutationAction,
  receipt: RetirementMutationReceipt,
): RetirementMutationReceipt {
  invariant(
    receipt.schemaVersion === RETIREMENT_MUTATION_RECEIPT_SCHEMA_VERSION,
    `${action.actionId} mutation receipt schema mismatch`,
  );
  invariant(
    receipt.actionId === action.actionId &&
      receipt.actionKind === action.kind &&
      receipt.resourceId === resourceId(action),
    `${action.actionId} mutation receipt targets another resource`,
  );
  invariant(
    receipt.providerReceiptId.length > 0,
    `${action.actionId} has no provider receipt ID`,
  );
  isoMilliseconds(receipt.completedAt, `${action.actionId} completedAt`);
  return deepFreeze(receipt);
}

export function buildSoftRetirementPlan(
  manifest: RetirementManifest,
): readonly RetirementMutationAction[] {
  return deepFreeze(
    manifest.legacyProjects.flatMap((project) =>
      project.generatedAliases.map(
        (alias): RetirementMutationAction => ({
          actionId: `soft-retire:generated-alias:${alias.id}`,
          stage: "soft-retire",
          kind: "remove-generated-alias",
          projectId: project.projectId,
          aliasId: alias.id,
          host: alias.host,
        }),
      ),
    ),
  );
}

export function buildProviderDeletionPlan(
  manifest: RetirementManifest,
): readonly RetirementMutationAction[] {
  return deepFreeze([
    ...manifest.legacyProjects.map(
      (project): RetirementMutationAction => ({
        actionId: `delete-provider-resources:project:${project.projectId}`,
        stage: "delete-provider-resources",
        kind: "delete-legacy-project",
        projectId: project.projectId,
        retainedDeploymentId: project.retainedDeployment.id,
      }),
    ),
    ...manifest.legacyProjects.map(
      (project): RetirementMutationAction => ({
        actionId: `delete-provider-resources:local-clone:${project.projectId}`,
        stage: "delete-provider-resources",
        kind: "delete-verified-local-clone",
        projectId: project.projectId,
        path: project.localClonePath,
      }),
    ),
  ]);
}
