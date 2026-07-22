"use client";

import { useCallback, useEffect, useState } from "react";
import type { ManagementApi } from "../api";
import { useApiResource } from "../resource";
import type {
  DatabaseAuthUser,
  DatabasePolicy,
} from "../types";
import {
  Button,
  EmptyState,
  ResourceBoundary,
  StatusPill,
  TextInput,
  formatDateTime,
  statusTone,
} from "../ui";

export function DatabaseAuthPanel({
  projectId,
  api,
}: {
  projectId: string;
  api: ManagementApi;
}) {
  const [search, setSearch] = useState("");
  const [cursorHistory, setCursorHistory] = useState<
    Array<string | undefined>
  >([undefined]);
  const currentCursor = cursorHistory[cursorHistory.length - 1];
  useEffect(() => {
    setCursorHistory([undefined]);
    setSearch("");
  }, [projectId]);
  const loader = useCallback(
    () => api.getDatabaseAuthUsers(projectId, currentCursor),
    [api, currentCursor, projectId],
  );
  const users = useApiResource(loader, [projectId, currentCursor]);

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Auth users</h3>
          <p className="mt-0.5 text-xs leading-5 text-zinc-500">
            Curated identity fields only. Passwords, tokens, provider secrets,
            and the underlying auth schema are not exposed.
          </p>
        </div>
        <div className="flex gap-2">
          <TextInput
            type="search"
            className="min-h-9 w-56 text-xs"
            placeholder="Filter loaded users"
            aria-label="Filter loaded auth users"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button size="sm" onClick={() => void users.reload()}>
            Refresh
          </Button>
        </div>
      </div>
      <ResourceBoundary
        resource={users}
        loadingLabel="Loading curated auth users"
        emptyTitle="No auth users"
        emptyDescription="The curated auth API returned an empty collection."
        onRetry={() => void users.reload()}
      >
        {(page) => {
          const needle = search.trim().toLowerCase();
          const filtered = page.items.filter((user) =>
            `${user.email || ""} ${user.phone || ""} ${user.id}`
              .toLowerCase()
              .includes(needle),
          );
          return (
            <div className="space-y-3">
              {!filtered.length ? (
                <EmptyState
                  title={
                    page.items.length
                      ? "No loaded users match"
                      : "No auth users"
                  }
                  description={
                    page.items.length
                      ? "Clear the local filter to see the current API page."
                      : "The curated auth API returned an empty collection on this page."
                  }
                  compact
                />
              ) : (
                <AuthUsersTable users={filtered} />
              )}
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  disabled={cursorHistory.length <= 1}
                  onClick={() =>
                    setCursorHistory((current) => current.slice(0, -1))
                  }
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  disabled={!page.nextCursor}
                  onClick={() => {
                    if (page.nextCursor) {
                      setCursorHistory((current) => [
                        ...current,
                        page.nextCursor || undefined,
                      ]);
                    }
                  }}
                >
                  Next
                </Button>
              </div>
            </div>
          );
        }}
      </ResourceBoundary>
    </div>
  );
}

function AuthUsersTable({ users }: { users: DatabaseAuthUser[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200">
      <table className="w-full min-w-[720px] text-left text-xs">
        <caption className="sr-only">Curated project authentication users</caption>
        <thead className="bg-zinc-50 text-[10px] uppercase tracking-wide text-zinc-400">
          <tr>
            <th className="border-b border-zinc-200 px-4 py-2 font-medium">
              Identity
            </th>
            <th className="border-b border-zinc-200 px-4 py-2 font-medium">
              Status
            </th>
            <th className="border-b border-zinc-200 px-4 py-2 font-medium">
              Providers
            </th>
            <th className="border-b border-zinc-200 px-4 py-2 font-medium">
              Created
            </th>
            <th className="border-b border-zinc-200 px-4 py-2 font-medium">
              Last sign-in
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b border-zinc-100 last:border-0">
              <td className="px-4 py-3">
                <span className="block text-zinc-800">
                  {user.email || user.phone || "No public identifier"}
                </span>
                <span className="mt-0.5 block font-mono text-[10px] text-zinc-400">
                  {user.id}
                </span>
              </td>
              <td className="px-4 py-3">
                <StatusPill
                  label={user.status}
                  tone={statusTone(user.status)}
                />
              </td>
              <td className="px-4 py-3 text-zinc-600">
                {user.providers.join(", ") || "—"}
              </td>
              <td className="px-4 py-3 text-zinc-600">
                {formatDateTime(user.createdAt)}
              </td>
              <td className="px-4 py-3 text-zinc-600">
                {formatDateTime(user.lastSignInAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DatabasePoliciesPanel({
  projectId,
  api,
}: {
  projectId: string;
  api: ManagementApi;
}) {
  const loader = useCallback(
    () => api.getDatabasePolicies(projectId),
    [api, projectId],
  );
  const policies = useApiResource(loader, [projectId], {
    isEmpty: (data) => data.items.length === 0,
  });

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">RLS policies</h3>
          <p className="mt-0.5 text-xs leading-5 text-zinc-500">
            Structured policy models from the safe gateway. Arbitrary SQL
            policy bodies are not accepted by this workbench.
          </p>
        </div>
        <Button size="sm" onClick={() => void policies.reload()}>
          Refresh
        </Button>
      </div>
      <ResourceBoundary
        resource={policies}
        loadingLabel="Loading database policies"
        emptyTitle="No structured policies returned"
        emptyDescription="The policy API returned an empty collection. This does not imply that the database is publicly accessible."
        onRetry={() => void policies.reload()}
      >
        {(data) => (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.items.map((policy) => (
              <PolicyCard key={policy.id} policy={policy} />
            ))}
          </div>
        )}
      </ResourceBoundary>
    </div>
  );
}

function PolicyCard({ policy }: { policy: DatabasePolicy }) {
  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-medium text-zinc-900">
            {policy.name}
          </h4>
          <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
            {policy.schema}.{policy.table} · {policy.command}
          </p>
        </div>
        <StatusPill
          label={policy.enabled ? "Enabled" : "Disabled"}
          tone={policy.enabled ? "positive" : "neutral"}
        />
      </div>
      <dl className="mt-3 space-y-2 text-xs">
        <div>
          <dt className="text-zinc-400">Roles</dt>
          <dd className="mt-0.5 text-zinc-700">
            {policy.roles.join(", ") || "None returned"}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-400">Using</dt>
          <dd className="mt-0.5 break-words font-mono text-[11px] text-zinc-700">
            {policy.using?.length
              ? policy.using
                  .map(
                    (item) =>
                      `${item.field} ${item.operator} ${JSON.stringify(item.value)}`,
                  )
                  .join(" AND ")
              : "No structured expression returned"}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-400">Check</dt>
          <dd className="mt-0.5 break-words font-mono text-[11px] text-zinc-700">
            {policy.check?.length
              ? policy.check
                  .map(
                    (item) =>
                      `${item.field} ${item.operator} ${JSON.stringify(item.value)}`,
                  )
                  .join(" AND ")
              : "No structured expression returned"}
          </dd>
        </div>
      </dl>
    </article>
  );
}
