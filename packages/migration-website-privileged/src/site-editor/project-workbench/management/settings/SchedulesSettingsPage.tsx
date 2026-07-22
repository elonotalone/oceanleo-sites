"use client";

import { useCallback, useState } from "react";
import type { ManagementApi } from "../api";
import { useApiAction, useApiResource } from "../resource";
import type {
  ProjectSchedule,
  SchedulesSettings,
} from "../types";
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  InlineError,
  Notice,
  ResourceBoundary,
  SelectInput,
  StatusPill,
  TextInput,
  formatDateTime,
  statusTone,
} from "../ui";
import { SettingsCard, SettingsPage } from "./SettingsShared";

export function SchedulesSettingsPage({
  projectId,
  api,
}: {
  projectId: string;
  api: ManagementApi;
}) {
  const loader = useCallback(
    () => api.getSettings(projectId, "schedules"),
    [api, projectId],
  );
  const resource = useApiResource(loader, [projectId]);
  return (
    <SettingsPage
      title="Schedules"
      description="Idempotent scheduled publication of an immutable source revision, with timezone and run history."
      actions={<Button onClick={() => void resource.reload()}>Refresh</Button>}
    >
      <ResourceBoundary
        resource={resource}
        loadingLabel="Loading project schedules"
        onRetry={() => void resource.reload()}
      >
        {(settings) => (
          <SchedulesContent
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

function SchedulesContent({
  projectId,
  settings,
  api,
  onReload,
}: {
  projectId: string;
  settings: SchedulesSettings;
  api: ManagementApi;
  onReload: () => Promise<SchedulesSettings | null>;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectSchedule | null>(null);
  const [label, setLabel] = useState("");
  const [timezone, setTimezone] = useState(
    settings.availableTimezones[0] || "UTC",
  );
  const [kind, setKind] = useState<"cron" | "one_shot">("cron");
  const [expression, setExpression] = useState("");
  const [revisionId, setRevisionId] = useState("");
  const [deleteSchedule, setDeleteSchedule] =
    useState<ProjectSchedule | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [persisted, setPersisted] = useState(false);
  const [formError, setFormError] = useState("");
  const action = useApiAction<ProjectSchedule | SchedulesSettings>();

  function openEditor(schedule?: ProjectSchedule) {
    action.clear();
    setPersisted(false);
    setFormError("");
    setEditing(schedule || null);
    setLabel(schedule?.label || "");
    setTimezone(
      schedule?.timezone || settings.availableTimezones[0] || "UTC",
    );
    setKind(schedule?.kind || "cron");
    setExpression(schedule?.expression || "");
    setRevisionId(schedule?.revision.id || "");
    setEditorOpen(true);
  }

  async function save() {
    if (
      kind === "one_shot" &&
      Number.isNaN(Date.parse(expression.trim()))
    ) {
      setFormError("Enter a valid ISO date and time for a one-shot run.");
      return;
    }
    if (!timezone) {
      setFormError("Choose a timezone.");
      return;
    }
    setFormError("");
    setPersisted(false);
    const result = await action.run(() =>
      api.saveSchedule(projectId, {
        id: editing?.id,
        version: editing?.version,
        label: label.trim(),
        timezone,
        kind,
        expression: expression.trim(),
        revisionId: revisionId.trim(),
        enabled: editing?.enabled,
      }),
    );
    if (result) {
      setEditorOpen(false);
      setEditing(null);
      setPersisted(Boolean(await onReload()));
    }
  }

  async function run(
    schedule: ProjectSchedule,
    name: "enable" | "disable" | "delete",
  ) {
    setPersisted(false);
    const result = await action.run(() =>
      api.scheduleAction(projectId, name, schedule),
    );
    if (result) {
      setDeleteSchedule(null);
      setConfirmation("");
      setPersisted(Boolean(await onReload()));
    }
  }

  return (
    <div className="space-y-4">
      {!settings.canManage ? (
        <Notice tone="info" title="Read-only schedule access">
          Your project role can inspect immutable publication schedules but
          cannot create or change jobs.
        </Notice>
      ) : null}
      {persisted ? (
        <Notice tone="success">
          The schedule action was persisted and the list was refetched.
        </Notice>
      ) : null}
      {action.error && !editorOpen && !deleteSchedule ? (
        <InlineError error={action.error} />
      ) : null}
      <SettingsCard
        title="Publication schedules"
        description="Each run targets the revision shown on the schedule; it never silently switches to a mutable working head."
        actions={
          settings.canManage ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => openEditor()}
            >
              New schedule
            </Button>
          ) : null
        }
      >
        {settings.schedules.length ? (
          <div className="space-y-3">
            {settings.schedules.map((schedule) => (
              <article
                key={schedule.id}
                className="rounded-xl border border-zinc-200 p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium text-zinc-900">
                        {schedule.label}
                      </h3>
                      <StatusPill
                        label={schedule.enabled ? "Enabled" : "Disabled"}
                        tone={schedule.enabled ? "positive" : "neutral"}
                      />
                    </div>
                    <p className="mt-1 font-mono text-xs text-zinc-600">
                      {schedule.kind}: {schedule.expression}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {schedule.timezone} · revision{" "}
                      <span className="font-mono">{schedule.revision.id}</span>
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Next run: {formatDateTime(schedule.nextRunAt)}
                    </p>
                  </div>
                  {settings.canManage ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={action.running}
                        onClick={() => openEditor(schedule)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        disabled={action.running}
                        onClick={() =>
                          void run(
                            schedule,
                            schedule.enabled ? "disable" : "enable",
                          )
                        }
                      >
                        {schedule.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={action.running}
                        onClick={() => {
                          action.clear();
                          setConfirmation("");
                          setDeleteSchedule(schedule);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </div>
                {schedule.lastRun ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs">
                    <span className="text-zinc-500">Last run</span>
                    <StatusPill
                      label={schedule.lastRun.statusLabel}
                      tone={statusTone(schedule.lastRun.status)}
                    />
                    <span className="text-zinc-500">
                      {formatDateTime(schedule.lastRun.startedAt)}
                    </span>
                    {schedule.lastRun.failureReason ? (
                      <span className="text-red-700">
                        {schedule.lastRun.failureReason}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No schedules"
            description="The project API returned no scheduled publication jobs."
            compact
          />
        )}
      </SettingsCard>

      <Dialog
        open={editorOpen}
        title={editing ? "Edit schedule" : "Create schedule"}
        description="The worker uses a server-generated idempotency key so one run cannot publish twice."
        onClose={() => {
          if (action.running) return;
          setEditorOpen(false);
          action.clear();
        }}
        width="md"
        closeDisabled={action.running}
        footer={
          <>
            <Button
              disabled={action.running}
              onClick={() => {
                setEditorOpen(false);
                action.clear();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={
                action.running ||
                !label.trim() ||
                !expression.trim() ||
                !revisionId.trim()
              }
              onClick={() => void save()}
            >
              {action.running ? "Saving…" : "Save schedule"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Label" required>
            <TextInput
              autoFocus
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
          <Field label="Timezone" required>
            <SelectInput
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            >
              {!settings.availableTimezones.includes("UTC") &&
              timezone === "UTC" ? (
                <option value="UTC">UTC</option>
              ) : null}
              {settings.availableTimezones.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Schedule type" required>
            <SelectInput
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as "cron" | "one_shot");
                setFormError("");
              }}
            >
              <option value="cron">Cron</option>
              <option value="one_shot">One shot</option>
            </SelectInput>
          </Field>
          <Field
            label={kind === "cron" ? "Cron expression" : "Run at (ISO time)"}
            required
          >
            <TextInput
              value={expression}
              onChange={(event) => {
                setExpression(event.target.value);
                setFormError("");
              }}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field
              label="Immutable revision ID"
              required
              hint="This schedule will continue targeting this exact revision until edited."
            >
              <TextInput
                value={revisionId}
                onChange={(event) => setRevisionId(event.target.value)}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Action">
              <TextInput value="Publish revision" disabled />
            </Field>
          </div>
        </div>
        {formError ? (
          <div className="mt-4">
            <Notice tone="danger">{formError}</Notice>
          </div>
        ) : null}
        {action.error ? (
          <div className="mt-4">
            <InlineError error={action.error} />
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteSchedule)}
        title="Delete schedule"
        description="The schedule version is checked and the removal is recorded by the project API."
        confirmLabel="Delete schedule"
        confirmationText={deleteSchedule?.label}
        confirmationValue={confirmation}
        onConfirmationValueChange={setConfirmation}
        busy={action.running}
        error={action.error}
        onClose={() => {
          if (action.running) return;
          setDeleteSchedule(null);
          setConfirmation("");
          action.clear();
        }}
        onConfirm={() => {
          if (deleteSchedule) void run(deleteSchedule, "delete");
        }}
      />
    </div>
  );
}
