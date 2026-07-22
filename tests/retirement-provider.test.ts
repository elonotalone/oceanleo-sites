import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertSafeLocalClonePath,
  RetirementProviderError,
  VercelRetirementProvider,
} from "../retirement/vercel-provider";

async function writeFakeHelper(
  directory: string,
  script: string,
): Promise<string> {
  const helper = join(directory, "vercel-ops");
  await writeFile(helper, script, { mode: 0o700 });
  await chmod(helper, 0o700);
  return helper;
}

test("assertSafeLocalClonePath accepts only /root/projects/<repo>", () => {
  assert.equal(
    assertSafeLocalClonePath("/root/projects/legacy-asset"),
    "/root/projects/legacy-asset",
  );
  assert.throws(
    () => assertSafeLocalClonePath("/tmp/legacy-asset"),
    (error: unknown) =>
      error instanceof RetirementProviderError &&
      error.code === "path-outside-projects-root",
  );
  assert.throws(
    () => assertSafeLocalClonePath("/root/projects/nested/path"),
    (error: unknown) =>
      error instanceof RetirementProviderError &&
      error.code === "path-not-single-repo",
  );
  assert.throws(
    () => assertSafeLocalClonePath("/root/projects/../etc"),
    (error: unknown) =>
      error instanceof RetirementProviderError &&
      (error.code === "path-refused" ||
        error.code === "path-outside-projects-root"),
  );
});

test("remove-generated-alias is idempotent when host already absent", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "retirement-provider-"));
  const logPath = join(directory, "calls.log");
  const helper = await writeFakeHelper(
    directory,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${logPath}"
case "$1 $2" in
  "api GET")
    printf '%s\\n' '{"domains":[{"name":"other.vercel.app"}]}'
    ;;
  *)
    printf '%s\\n' '{"error":{"code":"unexpected"}}'
    exit 1
    ;;
esac
`,
  );
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const provider = new VercelRetirementProvider({
    protectedHosts: ["asset.oceanleo.com"],
    helperPath: helper,
    teamId: "team_test",
  });
  const receipt = await provider.apply({
    actionId: "soft-retire:generated-alias:alias_1",
    stage: "soft-retire",
    kind: "remove-generated-alias",
    projectId: "prj_legacy",
    aliasId: "alias_1",
    host: "legacy-asset.vercel.app",
  });
  assert.equal(receipt.actionKind, "remove-generated-alias");
  assert.equal(receipt.resourceId, "alias_1");
  assert.match(receipt.providerReceiptId, /^[a-f0-9]{64}$/u);
});

test("remove-generated-alias calls domains rm when host is present", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "retirement-provider-"));
  const logPath = join(directory, "calls.log");
  const helper = await writeFakeHelper(
    directory,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${logPath}"
case "$1 $2" in
  "api GET")
    printf '%s\\n' '{"domains":[{"name":"legacy-asset.vercel.app"}]}'
    ;;
  "domains rm")
    printf '%s\\n' '{"uid":"dom_removed_1","name":"legacy-asset.vercel.app"}'
    ;;
  *)
    printf '%s\\n' '{"error":{"code":"unexpected"}}'
    exit 1
    ;;
esac
`,
  );
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const provider = new VercelRetirementProvider({
    protectedHosts: ["asset.oceanleo.com"],
    helperPath: helper,
    teamId: "team_test",
  });
  const receipt = await provider.apply({
    actionId: "soft-retire:generated-alias:alias_1",
    stage: "soft-retire",
    kind: "remove-generated-alias",
    projectId: "prj_legacy",
    aliasId: "alias_1",
    host: "legacy-asset.vercel.app",
  });
  assert.equal(receipt.providerReceiptId, "dom_removed_1");
  const log = await readFile(logPath, "utf8");
  assert.match(log, /domains rm prj_legacy legacy-asset\.vercel\.app/u);
});

test("delete-legacy-project refuses protected domain overlap", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "retirement-provider-"));
  const helper = await writeFakeHelper(
    directory,
    `#!/bin/sh
case "$1 $2" in
  "api GET")
    if printf '%s' "$3" | grep -q '/domains'; then
      printf '%s\\n' '{"domains":[{"name":"asset.oceanleo.com"},{"name":"x.vercel.app"}]}'
    else
      printf '%s\\n' '{"id":"prj_legacy","name":"legacy"}'
    fi
    ;;
  *)
    printf '%s\\n' '{"error":{"code":"unexpected"}}'
    exit 1
    ;;
esac
`,
  );
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const provider = new VercelRetirementProvider({
    protectedHosts: ["asset.oceanleo.com"],
    helperPath: helper,
    teamId: "team_test",
  });
  await assert.rejects(
    () =>
      provider.apply({
        actionId: "delete-provider-resources:project:prj_legacy",
        stage: "delete-provider-resources",
        kind: "delete-legacy-project",
        projectId: "prj_legacy",
        retainedDeploymentId: "dpl_1",
      }),
    (error: unknown) =>
      error instanceof RetirementProviderError &&
      error.code === "protected-domain-overlap",
  );
});

test("delete-legacy-project deletes via api DELETE when safe", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "retirement-provider-"));
  const logPath = join(directory, "calls.log");
  const helper = await writeFakeHelper(
    directory,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${logPath}"
case "$1 $2" in
  "api GET")
    if printf '%s' "$3" | grep -q '/domains'; then
      printf '%s\\n' '{"domains":[{"name":"legacy.vercel.app"}]}'
    else
      printf '%s\\n' '{"id":"prj_legacy","name":"legacy"}'
    fi
    ;;
  "api DELETE")
    printf '%s\\n' '{"id":"prj_legacy"}'
    ;;
  *)
    printf '%s\\n' '{"error":{"code":"unexpected"}}'
    exit 1
    ;;
esac
`,
  );
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const provider = new VercelRetirementProvider({
    protectedHosts: ["asset.oceanleo.com"],
    helperPath: helper,
    teamId: "team_test",
  });
  const receipt = await provider.apply({
    actionId: "delete-provider-resources:project:prj_legacy",
    stage: "delete-provider-resources",
    kind: "delete-legacy-project",
    projectId: "prj_legacy",
    retainedDeploymentId: "dpl_1",
  });
  assert.equal(receipt.providerReceiptId, "prj_legacy");
  const log = await readFile(logPath, "utf8");
  assert.match(log, /api DELETE .*\/v9\/projects\/prj_legacy/u);
});

test("delete-legacy-project is idempotent when project already gone", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "retirement-provider-"));
  const helper = await writeFakeHelper(
    directory,
    `#!/bin/sh
printf '%s\\n' '{"error":{"code":"not_found"}}'
`,
  );
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const provider = new VercelRetirementProvider({
    protectedHosts: ["asset.oceanleo.com"],
    helperPath: helper,
    teamId: "team_test",
  });
  const receipt = await provider.apply({
    actionId: "delete-provider-resources:project:prj_gone",
    stage: "delete-provider-resources",
    kind: "delete-legacy-project",
    projectId: "prj_gone",
    retainedDeploymentId: "dpl_1",
  });
  assert.match(receipt.providerReceiptId, /^[a-f0-9]{64}$/u);
});

test("delete-verified-local-clone removes only verified path", async () => {
  const removed: string[] = [];
  const existing = new Set(["/root/projects/legacy-asset"]);
  const provider = new VercelRetirementProvider({
    protectedHosts: [],
    helperPath: "/bin/false",
    pathExists: async (path) => existing.has(path),
    removeDirectory: async (path) => {
      removed.push(path);
      existing.delete(path);
    },
  });

  const first = await provider.apply({
    actionId: "delete-provider-resources:local-clone:prj_legacy",
    stage: "delete-provider-resources",
    kind: "delete-verified-local-clone",
    projectId: "prj_legacy",
    path: "/root/projects/legacy-asset",
  });
  assert.deepEqual(removed, ["/root/projects/legacy-asset"]);
  assert.match(first.providerReceiptId, /^[a-f0-9]{64}$/u);

  const second = await provider.apply({
    actionId: "delete-provider-resources:local-clone:prj_legacy",
    stage: "delete-provider-resources",
    kind: "delete-verified-local-clone",
    projectId: "prj_legacy",
    path: "/root/projects/legacy-asset",
  });
  assert.deepEqual(removed, ["/root/projects/legacy-asset"]);
  assert.match(second.providerReceiptId, /^[a-f0-9]{64}$/u);

  await assert.rejects(
    () =>
      provider.apply({
        actionId: "delete-provider-resources:local-clone:bad",
        stage: "delete-provider-resources",
        kind: "delete-verified-local-clone",
        projectId: "prj_legacy",
        path: "/var/tmp/evil",
      }),
    (error: unknown) =>
      error instanceof RetirementProviderError &&
      error.code === "path-outside-projects-root",
  );
});
