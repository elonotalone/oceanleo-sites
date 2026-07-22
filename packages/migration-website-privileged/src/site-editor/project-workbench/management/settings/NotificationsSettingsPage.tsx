"use client";

import { useCallback, useState } from "react";
import type { ManagementApi } from "../api";
import { useApiAction, useApiResource } from "../resource";
import type {
  NotificationChannel,
  NotificationsSettings,
} from "../types";
import {
  Button,
  EmptyState,
  Field,
  InlineError,
  Notice,
  ResourceBoundary,
  StatusPill,
  TextInput,
  formatDateTime,
  statusTone,
} from "../ui";
import { SaveActions, SettingsCard, SettingsPage } from "./SettingsShared";

export function NotificationsSettingsPage({
  projectId,
  api,
}: {
  projectId: string;
  api: ManagementApi;
}) {
  const loader = useCallback(
    () => api.getSettings(projectId, "notifications"),
    [api, projectId],
  );
  const resource = useApiResource(loader, [projectId]);
  return (
    <SettingsPage
      title="Notifications"
      description="Persisted project event rules, verified delivery channels, test delivery, and delivery history."
      actions={<Button onClick={() => void resource.reload()}>Refresh</Button>}
    >
      <ResourceBoundary
        resource={resource}
        loadingLabel="Loading notification settings"
        onRetry={() => void resource.reload()}
      >
        {(settings) => (
          <NotificationsForm
            key={settings.version}
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

function NotificationsForm({
  projectId,
  settings,
  api,
  onReload,
}: {
  projectId: string;
  settings: NotificationsSettings;
  api: ManagementApi;
  onReload: () => Promise<NotificationsSettings | null>;
}) {
  const [channels, setChannels] = useState(settings.channels);
  const [rules, setRules] = useState(settings.rules);
  const [saved, setSaved] = useState(false);
  const [validationError, setValidationError] = useState("");
  const save = useApiAction<NotificationsSettings>();
  const test = useApiAction<{ deliveryId: string; status: string }>();

  async function persist() {
    const invalidChannel = channels.find(
      (channel) => channel.enabled && !channel.recipient.trim(),
    );
    if (invalidChannel) {
      setValidationError(
        `${invalidChannel.label} needs a recipient before it can be enabled.`,
      );
      return;
    }
    const invalidRule = rules.find((rule) => {
      if (!rule.enabled) return false;
      if (!rule.channelIds.length) return true;
      if (
        rule.event === "usage_threshold" &&
        (typeof rule.threshold !== "number" ||
          !Number.isFinite(rule.threshold) ||
          rule.threshold < 1 ||
          rule.threshold > 100)
      ) {
        return true;
      }
      return rule.channelIds.some((channelId) => {
        const channel = channels.find((item) => item.id === channelId);
        return !channel?.verified || !channel.enabled;
      });
    });
    if (invalidRule) {
      setValidationError(
        `${invalidRule.label} needs valid values and at least one verified, enabled channel.`,
      );
      return;
    }
    setValidationError("");
    setSaved(false);
    const result = await save.run(() =>
      api.updateSettings(
        projectId,
        "notifications",
        {
          channels: channels.map((channel) => ({
            id: channel.id,
            recipient: channel.recipient,
            enabled: channel.enabled,
          })),
          rules: rules.map((rule) => ({
            event: rule.event,
            enabled: rule.enabled,
            channel_ids: rule.channelIds,
            threshold: rule.threshold,
          })),
        },
        settings.version,
      ),
    );
    if (result) setSaved(Boolean(await onReload()));
  }

  return (
    <div className="space-y-4">
      {!settings.canManage ? (
        <Notice tone="info" title="Read-only notification access">
          Your project role can inspect rules and deliveries but cannot change
          channels or rules.
        </Notice>
      ) : null}
      {!settings.workerAvailable ? (
        <Notice tone="warning" title="Delivery worker unavailable">
          {settings.unavailableReason ||
            "Rules can be inspected, but the API has not confirmed a delivery worker. The UI will not claim that notifications are active."}
        </Notice>
      ) : null}
      {saved ? (
        <Notice tone="success">
          Notification settings were saved and refetched from the project API.
        </Notice>
      ) : null}

      <SettingsCard
        title="Delivery channels"
        description="Recipients and channel state are stored server-side. A channel is not treated as usable until verified."
      >
        {channels.length ? (
          <div className="space-y-3">
            {channels.map((channel, index) => (
              <ChannelEditor
                key={channel.id}
                channel={channel}
                disabled={!settings.canManage || !settings.workerAvailable}
                testing={test.running}
                onChange={(next) => {
                  setSaved(false);
                  setChannels((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? next : item,
                    ),
                  );
                }}
                onTest={() =>
                  void test.run(() =>
                    api.testNotification(projectId, channel.id),
                  )
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No delivery channels"
            description="The notification API returned no configured channels."
            compact
          />
        )}
        {test.result ? (
          <div className="mt-3">
            <Notice tone="info" title="Test delivery recorded">
              <span className="mr-2 font-mono">
                {test.result.deliveryId}
              </span>
              <StatusPill
                label={test.result.status}
                tone={statusTone(test.result.status)}
              />{" "}
              Refresh for the final provider delivery state.
            </Notice>
          </div>
        ) : null}
        {test.error ? (
          <div className="mt-3">
            <InlineError error={test.error} />
          </div>
        ) : null}
      </SettingsCard>

      <SettingsCard
        title="Event rules"
        description="Rules are persisted only when the delivery worker and selected channels are available."
      >
        {validationError ? (
          <div className="mb-4">
            <Notice tone="danger">{validationError}</Notice>
          </div>
        ) : null}
        {rules.length ? (
          <div className="space-y-3">
            {rules.map((rule, index) => (
              <article
                key={rule.event}
                className="rounded-xl border border-zinc-200 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium text-zinc-900">
                      {rule.label}
                    </h3>
                    <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                      {rule.event}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-zinc-600">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      disabled={
                        !settings.canManage || !settings.workerAvailable
                      }
                      onChange={(event) => {
                        setSaved(false);
                        setRules((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, enabled: event.target.checked }
                              : item,
                          ),
                        );
                      }}
                    />
                    Enabled
                  </label>
                </div>
                <fieldset className="mt-3">
                  <legend className="text-xs font-medium text-zinc-500">
                    Channels
                  </legend>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {channels.map((channel) => (
                      <label
                        key={channel.id}
                        className="flex items-center gap-2 text-xs text-zinc-600"
                      >
                        <input
                          type="checkbox"
                          checked={rule.channelIds.includes(channel.id)}
                          disabled={
                            !settings.canManage ||
                            !settings.workerAvailable ||
                            !channel.verified
                          }
                          onChange={(event) => {
                            setSaved(false);
                            setRules((current) =>
                              current.map((item, itemIndex) => {
                                if (itemIndex !== index) return item;
                                return {
                                  ...item,
                                  channelIds: event.target.checked
                                    ? [...item.channelIds, channel.id]
                                    : item.channelIds.filter(
                                        (id) => id !== channel.id,
                                      ),
                                };
                              }),
                            );
                          }}
                        />
                        {channel.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {rule.event === "usage_threshold" ? (
                  <div className="mt-3 max-w-52">
                    <Field
                      label="Usage threshold (%)"
                      error={
                        rule.enabled &&
                        (typeof rule.threshold !== "number" ||
                          !Number.isFinite(rule.threshold) ||
                          rule.threshold < 1 ||
                          rule.threshold > 100)
                          ? "Enter a percentage from 1 to 100."
                          : undefined
                      }
                    >
                      <TextInput
                        type="number"
                        min={1}
                        max={100}
                        value={rule.threshold ?? ""}
                        disabled={!settings.canManage}
                        onChange={(event) => {
                          setSaved(false);
                          setRules((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    threshold: Number(event.target.value),
                                  }
                                : item,
                            ),
                          );
                        }}
                      />
                    </Field>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No notification rules"
            description="The project API returned no event-rule definitions."
            compact
          />
        )}
        <div className="mt-4">
          <SaveActions
            busy={save.running}
            disabled={!settings.canManage || !settings.workerAvailable}
            error={save.error}
            onReset={() => {
              setChannels(settings.channels);
              setRules(settings.rules);
              setSaved(false);
              setValidationError("");
              save.clear();
            }}
            onSave={() => void persist()}
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Delivery history">
        {settings.deliveries.length ? (
          <div className="overflow-x-auto rounded-xl border border-zinc-200">
            <table className="w-full min-w-[680px] text-left text-xs">
              <caption className="sr-only">
                Notification delivery history
              </caption>
              <thead className="bg-zinc-50 text-[10px] uppercase tracking-wide text-zinc-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Channel</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Attempted</th>
                  <th className="px-3 py-2 font-medium">Failure</th>
                </tr>
              </thead>
              <tbody>
                {settings.deliveries.map((delivery) => (
                  <tr
                    key={delivery.id}
                    className="border-t border-zinc-100"
                  >
                    <td className="px-3 py-2.5">{delivery.event}</td>
                    <td className="px-3 py-2.5">{delivery.channelLabel}</td>
                    <td className="px-3 py-2.5">
                      <StatusPill
                        label={delivery.statusLabel}
                        tone={statusTone(delivery.status)}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      {formatDateTime(delivery.attemptedAt)}
                    </td>
                    <td className="max-w-64 px-3 py-2.5 text-red-700">
                      {delivery.failureReason || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No delivery attempts"
            description="The notification API returned no delivery records."
            compact
          />
        )}
      </SettingsCard>
    </div>
  );
}

function ChannelEditor({
  channel,
  disabled,
  testing,
  onChange,
  onTest,
}: {
  channel: NotificationChannel;
  disabled: boolean;
  testing: boolean;
  onChange: (channel: NotificationChannel) => void;
  onTest: () => void;
}) {
  return (
    <article className="rounded-xl border border-zinc-200 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field label={channel.label}>
            <TextInput
              value={channel.recipient}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...channel, recipient: event.target.value })
              }
            />
          </Field>
        </div>
        <label className="flex min-h-10 items-center gap-2 text-xs text-zinc-600">
          <input
            type="checkbox"
            checked={channel.enabled}
            disabled={disabled || !channel.verified}
            onChange={(event) =>
              onChange({ ...channel, enabled: event.target.checked })
            }
          />
          Enabled
        </label>
        <StatusPill
          label={channel.verified ? "Verified" : "Unverified"}
          tone={channel.verified ? "positive" : "warning"}
        />
        <Button
          size="sm"
          disabled={disabled || testing || !channel.verified}
          onClick={onTest}
        >
          Test delivery
        </Button>
      </div>
    </article>
  );
}
