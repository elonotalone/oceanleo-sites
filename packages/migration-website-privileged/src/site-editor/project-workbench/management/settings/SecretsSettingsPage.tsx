"use client";

import { useCallback, useState } from "react";
import type { ManagementApi } from "../api";
import { useApiAction, useApiResource } from "../resource";
import type {
  MutationReceipt,
  SecretMetadata,
  SecretsSettings,
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
  TextInput,
  formatDateTime,
} from "../ui";
import { SettingsCard, SettingsPage } from "./SettingsShared";

export function SecretsSettingsPage({
  projectId,
  api,
}: {
  projectId: string;
  api: ManagementApi;
}) {
  const loader = useCallback(
    () => api.getSettings(projectId, "secrets"),
    [api, projectId],
  );
  const resource = useApiResource(loader, [projectId]);
  return (
    <SettingsPage
      title="Secrets"
      description="Write-only deployment secrets. The browser receives fingerprints and metadata, never stored secret values."
      actions={<Button onClick={() => void resource.reload()}>Refresh</Button>}
    >
      <ResourceBoundary
        resource={resource}
        loadingLabel="Loading secret metadata"
        onRetry={() => void resource.reload()}
      >
        {(settings) => (
          <SecretsContent
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

function SecretsContent({
  projectId,
  settings,
  api,
  onReload,
}: {
  projectId: string;
  settings: SecretsSettings;
  api: ManagementApi;
  onReload: () => Promise<SecretsSettings | null>;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState(settings.allowedTargets[0] || "");
  const [environment, setEnvironment] = useState(
    settings.allowedEnvironments[0] || "",
  );
  const [secretValue, setSecretValue] = useState("");
  const [rotateSecret, setRotateSecret] = useState<SecretMetadata | null>(null);
  const [deleteSecret, setDeleteSecret] = useState<SecretMetadata | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [receipt, setReceipt] = useState<MutationReceipt | null>(null);
  const action = useApiAction<MutationReceipt>();
  const secretNameValid = /^[A-Z_][A-Z0-9_]*$/.test(name);

  function clearSensitiveState() {
    setSecretValue("");
    setConfirmation("");
    action.clear();
  }

  function resetCreateState() {
    setName("");
    setTarget(settings.allowedTargets[0] || "");
    setEnvironment(settings.allowedEnvironments[0] || "");
    clearSensitiveState();
  }

  async function create() {
    const result = await action.run(async () => {
      const response = await api.createSecret(projectId, {
        name: name.trim(),
        target,
        environment,
        value: secretValue,
      });
      return response.receipt;
    });
    if (result) {
      setReceipt(result);
      setCreateOpen(false);
      setName("");
      clearSensitiveState();
      await onReload();
    }
  }

  async function rotate() {
    if (!rotateSecret) return;
    const result = await action.run(async () => {
      const response = await api.rotateSecret(
        projectId,
        rotateSecret.id,
        secretValue,
        rotateSecret.version,
      );
      return response.receipt;
    });
    if (result) {
      setReceipt(result);
      setRotateSecret(null);
      clearSensitiveState();
      await onReload();
    }
  }

  async function remove() {
    if (!deleteSecret) return;
    const result = await action.run(() =>
      api.deleteSecret(
        projectId,
        deleteSecret.id,
        deleteSecret.version,
      ),
    );
    if (result) {
      setReceipt(result);
      setDeleteSecret(null);
      clearSensitiveState();
      await onReload();
    }
  }

  return (
    <div className="space-y-4">
      {!settings.canManage ? (
        <Notice tone="info" title="Read-only secret metadata access">
          Your project role can inspect fingerprints and metadata but cannot
          create, rotate, or delete values.
        </Notice>
      ) : null}
      <Notice tone="warning" title="Secret values are write-only">
        Values are cleared from component state after each request and are not
        rendered back into the page, audit log, analytics, or source revision.
      </Notice>
      {receipt ? (
        <Notice tone="success" title="Secret action persisted">
          Audit event: <span className="font-mono">{receipt.auditEventId}</span>
        </Notice>
      ) : null}
      <SettingsCard
        title="Deployment secrets"
        actions={
          settings.canManage ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                resetCreateState();
                setCreateOpen(true);
              }}
            >
              Create secret
            </Button>
          ) : null
        }
      >
        {settings.secrets.length ? (
          <div className="overflow-x-auto rounded-xl border border-zinc-200">
            <table className="w-full min-w-[780px] text-left text-xs">
              <caption className="sr-only">
                Deployment secret metadata
              </caption>
              <thead className="bg-zinc-50 text-[10px] uppercase tracking-wide text-zinc-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Target</th>
                  <th className="px-3 py-2 font-medium">Environment</th>
                  <th className="px-3 py-2 font-medium">Fingerprint</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {settings.secrets.map((secret) => (
                  <tr
                    key={secret.id}
                    className="border-t border-zinc-100"
                  >
                    <td className="px-3 py-3 font-medium text-zinc-800">
                      {secret.name}
                    </td>
                    <td className="px-3 py-3 text-zinc-600">
                      {secret.target}
                    </td>
                    <td className="px-3 py-3 text-zinc-600">
                      {secret.environment}
                    </td>
                    <td className="px-3 py-3 font-mono text-[10px] text-zinc-500">
                      {secret.fingerprint}
                    </td>
                    <td className="px-3 py-3 text-zinc-600">
                      {formatDateTime(secret.updatedAt)}
                    </td>
                    <td className="px-3 py-3">
                      {settings.canManage ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            disabled={action.running}
                            onClick={() => {
                              clearSensitiveState();
                              setRotateSecret(secret);
                            }}
                          >
                            Rotate
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={action.running}
                            onClick={() => {
                              clearSensitiveState();
                              setDeleteSecret(secret);
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No secret metadata"
            description="The project API returned no deployment secrets."
            compact
          />
        )}
      </SettingsCard>

      <Dialog
        open={createOpen}
        title="Create deployment secret"
        description="The value is sent once over the authenticated project API and is never returned."
        onClose={() => {
          if (action.running) return;
          setCreateOpen(false);
          resetCreateState();
        }}
        width="sm"
        closeDisabled={action.running}
        footer={
          <>
            <Button
              disabled={action.running}
              onClick={() => {
                setCreateOpen(false);
                resetCreateState();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={
                action.running ||
                !secretNameValid ||
                !target ||
                !environment ||
                !secretValue
              }
              onClick={() => void create()}
            >
              {action.running ? "Creating…" : "Create secret"}
            </Button>
          </>
        }
      >
        <SecretFields
          name={name}
          target={target}
          environment={environment}
          value={secretValue}
          allowedTargets={settings.allowedTargets}
          allowedEnvironments={settings.allowedEnvironments}
          nameError={
            name && !secretNameValid
              ? "Use uppercase letters, numbers, and underscores; start with a letter or underscore."
              : undefined
          }
          onNameChange={setName}
          onTargetChange={setTarget}
          onEnvironmentChange={setEnvironment}
          onValueChange={setSecretValue}
        />
        {action.error ? (
          <div className="mt-4">
            <InlineError error={action.error} />
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(rotateSecret)}
        title={`Rotate ${rotateSecret?.name || "secret"}`}
        description="Rotation writes a new value and fingerprint. The prior value is not returned."
        onClose={() => {
          if (action.running) return;
          setRotateSecret(null);
          clearSensitiveState();
        }}
        width="sm"
        closeDisabled={action.running}
        footer={
          <>
            <Button
              disabled={action.running}
              onClick={() => {
                setRotateSecret(null);
                clearSensitiveState();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={action.running || !secretValue}
              onClick={() => void rotate()}
            >
              {action.running ? "Rotating…" : "Rotate secret"}
            </Button>
          </>
        }
      >
        <Field label="New secret value" required>
          <TextInput
            autoFocus
            type="password"
            autoComplete="new-password"
            value={secretValue}
            onChange={(event) => setSecretValue(event.target.value)}
          />
        </Field>
        {action.error ? (
          <div className="mt-4">
            <InlineError error={action.error} />
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteSecret)}
        title="Delete deployment secret"
        description="Deletion is version-checked and may require a new deployment. The server records the resulting operation."
        confirmLabel="Delete secret"
        confirmationText={deleteSecret?.name}
        confirmationValue={confirmation}
        onConfirmationValueChange={setConfirmation}
        busy={action.running}
        error={action.error}
        onClose={() => {
          if (action.running) return;
          setDeleteSecret(null);
          clearSensitiveState();
        }}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function SecretFields({
  name,
  target,
  environment,
  value,
  allowedTargets,
  allowedEnvironments,
  nameError,
  onNameChange,
  onTargetChange,
  onEnvironmentChange,
  onValueChange,
}: {
  name: string;
  target: string;
  environment: string;
  value: string;
  allowedTargets: string[];
  allowedEnvironments: string[];
  nameError?: string;
  onNameChange: (value: string) => void;
  onTargetChange: (value: string) => void;
  onEnvironmentChange: (value: string) => void;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <Field label="Name" required error={nameError}>
        <TextInput
          autoFocus
          value={name}
          autoComplete="off"
          onChange={(event) => onNameChange(event.target.value.toUpperCase())}
        />
      </Field>
      <Field label="Target" required>
        <SelectInput
          value={target}
          onChange={(event) => onTargetChange(event.target.value)}
        >
          {allowedTargets.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Environment" required>
        <SelectInput
          value={environment}
          onChange={(event) => onEnvironmentChange(event.target.value)}
        >
          {allowedEnvironments.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Secret value" required>
        <TextInput
          type="password"
          autoComplete="new-password"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
        />
      </Field>
    </div>
  );
}
