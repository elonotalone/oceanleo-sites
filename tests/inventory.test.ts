import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import {
  ALL_BATCH_INVENTORIES,
  ALL_PLUGIN_BATCHES,
} from "@oceanleo/plugin-registry/inventory";
import type {
  BatchInventoryDeclaration,
  BatchInventoryEntry,
  PluginBatchDefinition,
  PluginMethod,
  PluginRouteDeclaration,
} from "@oceanleo/plugin-runtime";
import { TENANTS } from "@oceanleo/tenant-registry";

import {
  buildInventory,
  serializeInventory,
  type InventoryDocument,
} from "../inventory/build";
import {
  assertEvidenceFiles,
  inspectEvidenceFiles,
  inspectInventoryReconciliation,
  inspectInventorySummary,
  releaseParityStatus,
} from "../inventory/gates";
import {
  FOUNDATION_ROUTES,
  type ParityStatus,
} from "../inventory/source";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const schemaUrl = new URL(
  "../schemas/route-handler-inventory.schema.json",
  import.meta.url,
);

async function inventoryValidator() {
  const schema = JSON.parse(await readFile(schemaUrl, "utf8")) as object;
  return new Ajv({ allErrors: true, strict: true }).compile(schema);
}

function expectedParity(): Record<ParityStatus, number> {
  const parity: Record<ParityStatus, number> = {
    foundation: TENANTS.length * FOUNDATION_ROUTES.length,
    pending: 0,
    partial: 0,
    verified: 0,
    retired: 0,
  };
  for (const entry of ALL_BATCH_INVENTORIES.flatMap(
    (declaration) => declaration.entries,
  )) {
    parity[entry.parity.status] += 1;
  }
  return parity;
}

test("source inventory is deterministic and the strict schema compiles", async () => {
  const first = buildInventory();
  const second = buildInventory();
  assert.equal(serializeInventory(first), serializeInventory(second));

  const validate = await inventoryValidator();
  assert.equal(validate({}), false);
});

test("generated projection matches the reviewed source inventory", async () => {
  const generatedBytes = await readFile(
    new URL("../generated/route-handler-inventory.json", import.meta.url),
    "utf8",
  );
  assert.equal(generatedBytes, serializeInventory(buildInventory()));
});

test("inventory summary derives from tenant and batch outputs", () => {
  const inventory = buildInventory();
  const parity = expectedParity();
  assert.deepEqual(inventory.summary, {
    tenants: TENANTS.length,
    standardTenants: TENANTS.filter(
      (tenant) => tenant.profile === "standard",
    ).length,
    privilegedTenants: TENANTS.filter(
      (tenant) => tenant.profile === "website-privileged",
    ).length,
    domains: TENANTS.reduce(
      (count, tenant) => count + tenant.domains.length,
      0,
    ),
    entries: Object.values(parity).reduce((total, count) => total + count, 0),
    parity,
  });

  const ids = inventory.entries.map((entry) => entry.id);
  assert.deepEqual(ids, [...ids].sort((left, right) => left.localeCompare(right)));
  assert.equal(new Set(ids).size, ids.length);

  assert.equal(
    inventory.entries.some(
      (entry) =>
        entry.appProfile === "standard" &&
        (entry.tenantKey === "website" ||
          entry.capabilities.some(
            (capability) =>
              capability.startsWith("website:") &&
              capability !== "website:launch",
          )),
    ),
    false,
  );

  assert.deepEqual(
    ALL_BATCH_INVENTORIES.map((declaration) => declaration.ownerPath),
    ALL_PLUGIN_BATCHES.map((batch) => batch.ownerPath),
  );
});

test("migration inventory gate accepts six-batch output with website residue", async () => {
  const inventory = buildInventory();
  const validate = await inventoryValidator();
  const schemaValid = validate(inventory);
  const reconciliation = inspectInventoryReconciliation({
    batches: ALL_PLUGIN_BATCHES,
    inventories: ALL_BATCH_INVENTORIES,
    tenants: TENANTS,
    foundationRoutes: FOUNDATION_ROUTES,
  });
  const evidenceIssues = await inspectEvidenceFiles(inventory, repositoryRoot);
  const parity = releaseParityStatus(inventory);
  const reconciliationByCode: Record<string, number> = {};
  for (const issue of reconciliation.issues) {
    reconciliationByCode[issue.code] =
      (reconciliationByCode[issue.code] ?? 0) + 1;
  }
  const standardPending = inventory.entries.filter(
    (entry) =>
      entry.appProfile === "standard" && entry.parity.status === "pending",
  ).length;
  const status = {
    schemaValid,
    schemaViolations: validate.errors?.length ?? 0,
    summaryIssues: inspectInventorySummary(inventory).length,
    reconciliationIssues: reconciliationByCode,
    evidenceIssues: evidenceIssues.length,
    standardPending,
    cutoverReady: parity.ready,
  };
  assert.deepEqual(
    status,
    {
      schemaValid: true,
      schemaViolations: 0,
      summaryIssues: 0,
      reconciliationIssues: {},
      evidenceIssues: 0,
      standardPending: 0,
      cutoverReady: false,
    },
    [
      `schema=${JSON.stringify((validate.errors ?? []).slice(0, 3))}`,
      `reconciliation=${JSON.stringify(reconciliation.issues.slice(0, 3))}`,
      `evidence=${JSON.stringify(evidenceIssues.slice(0, 3))}`,
      `pending=${parity.pending}, partial=${parity.partial}`,
    ].join("\n"),
  );
  assert.ok(parity.pending > 0 || parity.partial > 0);
});

test("every declared evidence path is a repository file", async () => {
  await assertEvidenceFiles(buildInventory(), repositoryRoot);
});

function inventoryFixtureTenant() {
  const tenant = TENANTS.find(
    (candidate) => candidate.manifest.siteKey === "agent",
  );
  if (!tenant) throw new Error("Inventory gate fixture tenant is missing.");
  return tenant;
}

const fixtureTenant = inventoryFixtureTenant();

const fixtureParity = Object.freeze({
  status: "verified" as const,
  source: "legacy:agent:workspace",
  evidence: Object.freeze(["tests/app-profiles.test.ts"]),
});
const fixtureRoute: PluginRouteDeclaration = Object.freeze({
  id: "agent.workspace",
  kind: "page",
  surface: "page",
  pattern: "/workspace/:path*",
  methods: Object.freeze(
    ["GET", "HEAD"] satisfies readonly PluginMethod[],
  ),
  capability: "workbench:advanced",
  parity: fixtureParity,
});
const fixtureExtensionEntry: BatchInventoryEntry = Object.freeze({
  id: "plugin:standard:agent:agent-orchestration",
  tenantKey: "agent",
  route: null,
  kind: "plugin-extension",
  methods: Object.freeze([]),
  capabilities: Object.freeze(["workbench:advanced"]),
  extensionId: "agent-orchestration",
  parity: fixtureParity,
});

function routeEntry(
  route: PluginRouteDeclaration,
  kind: "page" | "route-handler" = route.surface === "api"
    ? "route-handler"
    : "page",
  id = `route:standard:agent:${route.id}`,
): BatchInventoryEntry {
  return Object.freeze({
    id,
    tenantKey: "agent",
    route: route.pattern,
    kind,
    methods: Object.freeze([...route.methods]),
    capabilities: Object.freeze([route.capability]),
    extensionId: "agent-orchestration",
    parity: route.parity,
  });
}

function fixtureInput(
  routes: readonly PluginRouteDeclaration[],
  entries: readonly BatchInventoryEntry[],
) {
  const batch: PluginBatchDefinition = Object.freeze({
    id: "platform",
    migrationBatch: 5,
    profile: "standard",
    ownerPath: "packages/migration-platform",
    plugins: Object.freeze([
      Object.freeze({
        id: "agent-orchestration",
        siteKey: "agent",
        routes: Object.freeze([...routes]),
      }),
    ]),
  });
  const inventory: BatchInventoryDeclaration = Object.freeze({
    batchId: "platform",
    migrationBatch: 5,
    profile: "standard",
    ownerPath: "packages/migration-platform",
    testPath: "packages/migration-platform/tests/platform.test.ts",
    tenantKeys: Object.freeze(["agent"]),
    entries: Object.freeze([...entries]),
  });
  return {
    batches: [batch],
    inventories: [inventory],
    tenants: [fixtureTenant],
    foundationRoutes: FOUNDATION_ROUTES,
  };
}

test("reconciliation rejects missing and orphaned route projections", () => {
  const valid = inspectInventoryReconciliation(
    fixtureInput(
      [fixtureRoute],
      [fixtureExtensionEntry, routeEntry(fixtureRoute)],
    ),
  );
  assert.deepEqual(valid.issues, []);

  const missing = inspectInventoryReconciliation(
    fixtureInput([fixtureRoute], [fixtureExtensionEntry]),
  );
  assert.ok(missing.issues.some((issue) => issue.code === "route-contract"));

  const orphaned = inspectInventoryReconciliation(
    fixtureInput([], [
      fixtureExtensionEntry,
      routeEntry(fixtureRoute),
    ]),
  );
  assert.ok(orphaned.issues.some((issue) => issue.code === "route-contract"));

  const missingExtension = inspectInventoryReconciliation(
    fixtureInput([fixtureRoute], [routeEntry(fixtureRoute)]),
  );
  assert.ok(
    missingExtension.issues.some(
      (issue) => issue.code === "extension-contract",
    ),
  );

  const mismatchedExtensionParity = inspectInventoryReconciliation(
    fixtureInput(
      [fixtureRoute],
      [
        {
          ...fixtureExtensionEntry,
          parity: { ...fixtureExtensionEntry.parity, status: "partial" },
        },
        routeEntry(fixtureRoute),
      ],
    ),
  );
  assert.ok(
    mismatchedExtensionParity.issues.some(
      (issue) =>
        issue.code === "extension-contract" &&
        issue.message.includes("does not summarize route parity"),
    ),
  );
});

test("reconciliation compares the complete route ownership tuple", () => {
  const base = routeEntry(fixtureRoute);
  const mismatches: readonly [string, BatchInventoryEntry][] = [
    ["tenant", { ...base, tenantKey: "website" }],
    ["route", { ...base, route: "/workspace/other/:path*" }],
    ["method", { ...base, methods: ["POST"] }],
    ["capability", { ...base, capabilities: ["artifact:write"] }],
    ["extension", { ...base, extensionId: "different-extension" }],
    [
      "parity",
      {
        ...base,
        parity: { ...base.parity, status: "partial" },
      },
    ],
  ];
  for (const [field, entry] of mismatches) {
    const report = inspectInventoryReconciliation(
      fixtureInput([fixtureRoute], [fixtureExtensionEntry, entry]),
    );
    assert.ok(
      report.issues.some((issue) => issue.code === "route-contract"),
      `${field} mismatch must break one-to-one reconciliation`,
    );
  }

  const profileMismatch = fixtureInput(
    [fixtureRoute],
    [fixtureExtensionEntry, base],
  );
  const declaration = profileMismatch.inventories[0]!;
  const report = inspectInventoryReconciliation({
    ...profileMismatch,
    inventories: [
      {
        ...declaration,
        profile: "website-privileged",
      },
    ],
  });
  assert.ok(report.issues.some((issue) => issue.code === "batch-seam"));
  assert.ok(report.issues.some((issue) => issue.code === "route-contract"));
});

test("reconciliation rejects duplicate runtime ownership", () => {
  const duplicateRoute: PluginRouteDeclaration = Object.freeze({
    ...fixtureRoute,
    id: "agent.workspace.duplicate",
  });
  const report = inspectInventoryReconciliation(
    fixtureInput(
      [fixtureRoute, duplicateRoute],
      [
        fixtureExtensionEntry,
        routeEntry(fixtureRoute),
        routeEntry(
          duplicateRoute,
          "page",
          "route:standard:agent:agent.workspace.duplicate",
        ),
      ],
    ),
  );
  assert.ok(
    report.issues.some(
      (issue) => issue.code === "duplicate-route-ownership",
    ),
  );
});

test("both-surface routes require distinct page and API inventory projections", () => {
  const redirect: PluginRouteDeclaration = Object.freeze({
    ...fixtureRoute,
    id: "agent.legacy-redirect",
    kind: "redirect",
    surface: "both",
    pattern: "/:scope/legacy/:path*",
    methods: Object.freeze(["GET"] satisfies readonly PluginMethod[]),
    capability: "shell:render",
    redirect: Object.freeze({
      protocol: "https",
      host: "agent.oceanleo.com",
      path: Object.freeze({ mode: "preserve" as const }),
      status: 308,
    }),
  });
  const complete = inspectInventoryReconciliation(
    fixtureInput(
      [redirect],
      [
        fixtureExtensionEntry,
        routeEntry(redirect, "page", "route:agent:legacy:page"),
        routeEntry(
          redirect,
          "route-handler",
          "route:agent:legacy:api",
        ),
      ],
    ),
  );
  assert.deepEqual(complete.issues, []);

  const missingApi = inspectInventoryReconciliation(
    fixtureInput(
      [redirect],
      [
        fixtureExtensionEntry,
        routeEntry(redirect, "page", "route:agent:legacy:page"),
      ],
    ),
  );
  assert.ok(
    missingApi.issues.some(
      (issue) =>
        issue.code === "route-contract" &&
        issue.message.includes("route-handler"),
    ),
  );
});

test("reconciliation rejects foundation collisions and unreachable surfaces", () => {
  const foundationCollision: PluginRouteDeclaration = Object.freeze({
    ...fixtureRoute,
    id: "agent.api.catch-all",
    kind: "api",
    surface: "api",
    pattern: "/api/:path*",
    methods: Object.freeze(["GET"] satisfies readonly PluginMethod[]),
  });
  const collisionReport = inspectInventoryReconciliation(
    fixtureInput(
      [foundationCollision],
      [fixtureExtensionEntry, routeEntry(foundationCollision)],
    ),
  );
  assert.ok(
    collisionReport.issues.some(
      (issue) => issue.code === "duplicate-foundation-ownership",
    ),
  );

  const unreachable: PluginRouteDeclaration = Object.freeze({
    ...fixtureRoute,
    id: "agent.unreachable-page",
    surface: "api",
  });
  const unreachableReport = inspectInventoryReconciliation(
    fixtureInput([unreachable], [fixtureExtensionEntry]),
  );
  assert.ok(
    unreachableReport.issues.some(
      (issue) => issue.code === "unreachable-route",
    ),
  );
});

test("schema rejects unknown methods, capabilities, and invalid route shapes", async () => {
  const validate = await inventoryValidator();
  const inventory = buildInventory();
  const entry = inventory.entries.find(
    (candidate) =>
      candidate.kind === "page" &&
      candidate.parity.status === "foundation",
  );
  assert.ok(entry);
  const validDocument = {
    ...inventory,
    summary: {
      ...inventory.summary,
      entries: 1,
      parity: {
        foundation: 1,
        pending: 0,
        partial: 0,
        verified: 0,
        retired: 0,
      },
    },
    entries: [entry],
  } satisfies InventoryDocument;
  assert.equal(validate(validDocument), true, JSON.stringify(validate.errors));

  const invalidEntries = [
    { ...entry, methods: ["TRACE"] },
    { ...entry, capabilities: ["root:all"] },
    { ...entry, route: "relative/path" },
    {
      ...entry,
      kind: "plugin-extension",
      route: "/workspace",
      extensionId: null,
    },
    {
      ...entry,
      parity: { status: "verified", source: "fixture", evidence: [] },
    },
  ];

  for (const invalidEntry of invalidEntries) {
    const candidate = {
      ...validDocument,
      entries: [invalidEntry],
    };
    assert.equal(validate(candidate), false);
  }
});

test("verified and retired evidence must be explicit repository files", async () => {
  const inventory = buildInventory();
  const entry = inventory.entries[0];
  assert.ok(entry);
  const candidate = {
    ...inventory,
    entries: [
      {
        ...entry,
        parity: {
          status: "verified" as const,
          source: "fixture",
          evidence: [],
        },
      },
      {
        ...inventory.entries[1]!,
        parity: {
          status: "retired" as const,
          source: "fixture",
          evidence: ["tests/does-not-exist.inventory-evidence"],
        },
      },
      ...inventory.entries.slice(2),
    ],
  } satisfies InventoryDocument;
  const issues = await inspectEvidenceFiles(candidate, repositoryRoot);
  assert.ok(
    issues.some(
      (issue) =>
        issue.code === "evidence" &&
        issue.message.includes("verified entries require explicit evidence"),
    ),
  );
  assert.ok(
    issues.some(
      (issue) =>
        issue.code === "evidence" &&
        issue.message.includes("does not exist"),
    ),
  );
});
