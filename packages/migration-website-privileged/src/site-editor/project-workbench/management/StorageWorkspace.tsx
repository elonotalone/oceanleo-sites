"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ManagementApiError,
  managementApi,
  type ManagementApi,
} from "./api";
import { useApiAction, useApiResource } from "./resource";
import type {
  MutationReceipt,
  ProjectPermissions,
  StorageBinding,
  StorageBucket,
  StorageObject,
  StorageSpace,
  WorkspaceBaseProps,
} from "./types";
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
  Tabs,
  TextInput,
  WorkspaceSurface,
  formatBytes,
  formatDateTime,
  statusTone,
} from "./ui";

export interface StorageWorkspaceProps extends WorkspaceBaseProps {
  api?: ManagementApi;
  onOpenStorageSettings?: () => void;
}

interface StorageWorkspaceData {
  binding: StorageBinding;
  buckets: StorageBucket[];
  permissions: ProjectPermissions;
}

export function StorageWorkspace({
  projectId,
  className,
  api = managementApi,
  onOpenStorageSettings,
}: StorageWorkspaceProps) {
  const [space, setSpace] = useState<StorageSpace>("app");
  const [selectedBucket, setSelectedBucket] = useState("");
  const [prefix, setPrefix] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const currentCursor = cursorHistory[cursorHistory.length - 1];
  const [moveObject, setMoveObject] = useState<StorageObject | null>(null);
  const [destinationPath, setDestinationPath] = useState("");
  const [deleteObject, setDeleteObject] = useState<StorageObject | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [receipt, setReceipt] = useState<MutationReceipt | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loader = useCallback(async (): Promise<StorageWorkspaceData> => {
    const [project, binding] = await Promise.all([
      api.getProjectSummary(projectId),
      api.getStorageBinding(projectId),
    ]);
    const buckets =
      binding.status === "ready"
        ? (await api.getStorageBuckets(projectId)).items
        : [];
    return { binding, buckets, permissions: project.permissions };
  }, [api, projectId]);
  const root = useApiResource(loader, [projectId]);

  const bucket =
    root.data?.buckets.find((item) => item.name === selectedBucket)?.name ??
    root.data?.buckets[0]?.name ??
    "";
  const canList =
    root.data?.permissions.canReadStorage === true &&
    (space === "project-assets" ||
      (root.data.binding.status === "ready" && Boolean(bucket)));

  const objectsLoader = useCallback(
    () =>
      api.getStorageObjects(projectId, {
        space,
        bucket: space === "app" ? bucket : undefined,
        prefix,
        search,
        cursor: currentCursor,
        limit: 50,
      }),
    [api, bucket, currentCursor, prefix, projectId, search, space],
  );
  const objects = useApiResource(
    objectsLoader,
    [projectId, space, bucket, prefix, search, currentCursor],
    {
      enabled: canList,
      isEmpty: (value) => value.items.length === 0,
    },
  );
  const action = useApiAction<MutationReceipt>();
  const signedDownload = useApiAction<
    Awaited<ReturnType<ManagementApi["signStorageDownload"]>>
  >();
  const clearAction = action.clear;
  const clearSignedDownload = signedDownload.clear;

  useEffect(() => {
    setSpace("app");
    setSelectedBucket("");
    setPrefix("");
    setSearch("");
    setSearchDraft("");
    setCursorHistory([undefined]);
    setMoveObject(null);
    setDeleteObject(null);
    setReceipt(null);
    setUploadProgress(null);
    clearAction();
    clearSignedDownload();
  }, [clearAction, clearSignedDownload, projectId]);

  function resetLocation(next?: {
    space?: StorageSpace;
    bucket?: string;
    prefix?: string;
  }) {
    if (next?.space) setSpace(next.space);
    if (next?.bucket !== undefined) setSelectedBucket(next.bucket);
    if (next?.prefix !== undefined) setPrefix(next.prefix);
    setCursorHistory([undefined]);
    setSearch("");
    setSearchDraft("");
    setReceipt(null);
  }

  async function uploadFile(file: File) {
    const total = Math.max(file.size, 1);
    setUploadProgress(0);
    const result = await action.run(async () => {
      const binding = root.data?.binding;
      const objectPath = `${prefix}${file.name}`;
      if (!isSafeObjectPath(objectPath)) {
        throw new ManagementApiError(
          "The selected file does not produce a safe relative object path.",
          {
            endpoint: "storage-upload-validation",
            kind: "validation",
          },
        );
      }
      if (
        typeof binding?.maxObjectBytes === "number" &&
        file.size > binding.maxObjectBytes
      ) {
        throw new ManagementApiError(
          `This object exceeds the ${formatBytes(binding.maxObjectBytes)} per-object limit.`,
          {
            endpoint: "storage-upload-validation",
            kind: "validation",
          },
        );
      }
      if (
        typeof binding?.quotaBytes === "number" &&
        typeof binding.usedBytes === "number" &&
        file.size > Math.max(0, binding.quotaBytes - binding.usedBytes)
      ) {
        throw new ManagementApiError(
          "This upload exceeds the remaining project storage quota.",
          {
            endpoint: "storage-upload-validation",
            kind: "validation",
          },
        );
      }
      const response = await api.uploadStorageObject(
        projectId,
        {
          space,
          bucket: space === "app" ? bucket : undefined,
          path: objectPath,
          file,
        },
        (loaded) => setUploadProgress(Math.min(1, loaded / total)),
      );
      return response.receipt;
    });
    setUploadProgress(null);
    if (result) {
      setReceipt(result);
      await objects.reload();
    }
  }

  async function openSignedObject(object: StorageObject, preview: boolean) {
    const previewWindow = preview
      ? window.open("about:blank", "_blank")
      : null;
    if (previewWindow) previewWindow.opener = null;
    const signed = await signedDownload.run(() =>
      api.signStorageDownload(projectId, object),
    );
    if (!signed) {
      previewWindow?.close();
      return;
    }
    if (previewWindow) {
      previewWindow.location.replace(signed.url);
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = signed.url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    if (!preview) anchor.download = object.name;
    anchor.click();
  }

  async function confirmMove() {
    if (
      !moveObject ||
      !isSafeObjectPath(destinationPath.trim()) ||
      destinationPath.trim() === moveObject.path
    ) {
      return;
    }
    const result = await action.run(async () => {
      const response = await api.moveStorageObject(
        projectId,
        moveObject,
        destinationPath.trim(),
      );
      return response.receipt;
    });
    if (result) {
      setReceipt(result);
      setMoveObject(null);
      setDestinationPath("");
      await objects.reload();
    }
  }

  async function confirmDelete() {
    if (!deleteObject) return;
    const result = await action.run(() =>
      api.deleteStorageObject(projectId, deleteObject),
    );
    if (result) {
      setReceipt(result);
      setDeleteObject(null);
      setConfirmation("");
      await objects.reload();
    }
  }

  return (
    <WorkspaceSurface
      title="File storage"
      description="App storage and OceanLeo project assets are separate object spaces with typed, project-scoped access."
      className={className}
      actions={
        <Button
          onClick={() => {
            void root.reload();
            if (canList) void objects.reload();
          }}
        >
          Refresh
        </Button>
      }
    >
      <ResourceBoundary
        resource={root}
        loadingLabel="Loading storage binding"
        onRetry={() => void root.reload()}
      >
        {(data) => {
          if (!data.permissions.canReadStorage) {
            return (
              <EmptyState
                title="Storage permission required"
                description="Your project role does not include storage.read. The gateway independently validates every object path."
              />
            );
          }
          const canWrite = data.permissions.canWriteStorage;
          return (
            <div className="space-y-4">
              <PanelHeader
                binding={data.binding}
                onOpenSettings={onOpenStorageSettings}
              />

              <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="flex flex-wrap items-end gap-2">
                    <Tabs
                      label="Storage space"
                      value={space}
                      onChange={(value) =>
                        resetLocation({ space: value, prefix: "" })
                      }
                      items={[
                        { value: "app", label: "App storage" },
                        {
                          value: "project-assets",
                          label: "Project assets",
                        },
                      ]}
                    />
                    {space === "app" ? (
                      <Field label="Bucket">
                        <SelectInput
                          className="min-h-9 min-w-40 text-xs"
                          value={bucket}
                          disabled={!data.buckets.length}
                          onChange={(event) =>
                            resetLocation({
                              bucket: event.target.value,
                              prefix: "",
                            })
                          }
                        >
                          {data.buckets.map((item) => (
                            <option key={item.id} value={item.name}>
                              {item.name} · {item.visibility}
                            </option>
                          ))}
                        </SelectInput>
                      </Field>
                    ) : null}
                  </div>
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setSearch(searchDraft.trim());
                      setCursorHistory([undefined]);
                    }}
                  >
                    <Field label="Search this path">
                      <TextInput
                        type="search"
                        className="min-h-9 w-52 text-xs"
                        value={searchDraft}
                        onChange={(event) => setSearchDraft(event.target.value)}
                      />
                    </Field>
                    <Button size="sm" type="submit">
                      Search
                    </Button>
                    {canWrite && canList ? (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={action.running}
                          onClick={() => fileInput.current?.click()}
                        >
                          Upload
                        </Button>
                        <input
                          ref={fileInput}
                          type="file"
                          className="hidden"
                          aria-label="Choose a storage object to upload"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void uploadFile(file);
                            event.target.value = "";
                          }}
                        />
                      </>
                    ) : null}
                  </form>
                </div>

                <div className="border-b border-zinc-100 px-4 py-2.5">
                  <StorageBreadcrumbs
                    prefix={prefix}
                    onNavigate={(nextPrefix) =>
                      resetLocation({ prefix: nextPrefix })
                    }
                  />
                </div>

                {receipt ? (
                  <div className="p-4 pb-0" aria-live="polite">
                    <Notice tone="success" title="Storage write persisted">
                      Audit event:{" "}
                      <span className="font-mono">{receipt.auditEventId}</span>
                    </Notice>
                  </div>
                ) : null}
                {uploadProgress !== null ? (
                  <div className="px-4 pt-4" role="status" aria-live="polite">
                    <div className="flex justify-between text-xs text-zinc-500">
                      <span>Uploading signed object</span>
                      <span>{Math.round(uploadProgress * 100)}%</span>
                    </div>
                    <div
                      className="mt-1.5 h-2 overflow-hidden rounded-full bg-zinc-100"
                      role="progressbar"
                      aria-label="Storage upload progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(uploadProgress * 100)}
                    >
                      <div
                        className="h-full rounded-full bg-blue-600 transition-[width]"
                        style={{ width: `${uploadProgress * 100}%` }}
                      />
                    </div>
                  </div>
                ) : null}
                {action.error && !moveObject && !deleteObject ? (
                  <div className="p-4 pb-0">
                    <InlineError error={action.error} />
                  </div>
                ) : null}
                {signedDownload.error ? (
                  <div className="p-4 pb-0">
                    <InlineError error={signedDownload.error} />
                  </div>
                ) : null}

                <div className="p-4">
                  {space === "app" && data.binding.status !== "ready" ? (
                    <EmptyState
                      title={data.binding.label}
                      description={
                        data.binding.reason ||
                        "The project API did not return a usable App storage binding."
                      }
                    />
                  ) : space === "app" && !data.buckets.length ? (
                    <EmptyState
                      title="No storage buckets"
                      description="The typed storage API returned no buckets for this project binding."
                    />
                  ) : (
                    <ResourceBoundary
                      resource={objects}
                      loadingLabel="Loading storage objects"
                      emptyTitle="This location is empty"
                      emptyDescription="The object API returned no folders or files at this path."
                      onRetry={() => void objects.reload()}
                    >
                      {(page) => (
                        <StorageObjectsTable
                          items={page.items}
                          canWrite={canWrite}
                          busy={action.running || signedDownload.running}
                          onOpenFolder={(object) =>
                            resetLocation({
                              prefix: ensureFolderPrefix(object.path),
                            })
                          }
                          onPreview={(object) =>
                            void openSignedObject(object, true)
                          }
                          onDownload={(object) =>
                            void openSignedObject(object, false)
                          }
                          onMove={(object) => {
                            action.clear();
                            setMoveObject(object);
                            setDestinationPath(object.path);
                          }}
                          onDelete={(object) => {
                            action.clear();
                            setConfirmation("");
                            setDeleteObject(object);
                          }}
                        />
                      )}
                    </ResourceBoundary>
                  )}

                  {objects.data ? (
                    <div className="mt-3 flex items-center justify-end gap-2">
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
                        disabled={!objects.data.nextCursor}
                        onClick={() => {
                          const next = objects.data?.nextCursor;
                          if (next) {
                            setCursorHistory((current) => [...current, next]);
                          }
                        }}
                      >
                        Next
                      </Button>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          );
        }}
      </ResourceBoundary>

      <Dialog
        open={Boolean(moveObject)}
        title="Move or rename object"
        description="The destination is validated against the project binding. The current etag and generation prevent overwriting a concurrent change."
        onClose={() => {
          if (action.running) return;
          setMoveObject(null);
          setDestinationPath("");
          action.clear();
        }}
        width="sm"
        closeDisabled={action.running}
        footer={
          <>
            <Button
              disabled={action.running}
              onClick={() => {
                setMoveObject(null);
                setDestinationPath("");
                action.clear();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={
                action.running ||
                !isSafeObjectPath(destinationPath.trim()) ||
                destinationPath.trim() === moveObject?.path
              }
              onClick={() => void confirmMove()}
            >
              {action.running ? "Moving…" : "Move object"}
            </Button>
          </>
        }
      >
        <Field
          label="Destination path"
          required
          error={
            destinationPath.trim() &&
            !isSafeObjectPath(destinationPath.trim())
              ? "Use a relative object path without backslashes, empty segments, “.”, or “..”."
              : destinationPath.trim() === moveObject?.path
                ? "Choose a different object path."
                : undefined
          }
        >
          <TextInput
            autoFocus
            value={destinationPath}
            onChange={(event) => setDestinationPath(event.target.value)}
          />
        </Field>
        {action.error ? (
          <div className="mt-4">
            <InlineError error={action.error} />
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteObject)}
        title="Delete storage object"
        description="Deletion uses the current object etag and generation. A version conflict is reported instead of silently deleting newer content."
        confirmLabel="Delete object"
        confirmationText={deleteObject?.path}
        confirmationValue={confirmation}
        onConfirmationValueChange={setConfirmation}
        busy={action.running}
        error={action.error}
        onClose={() => {
          if (action.running) return;
          setDeleteObject(null);
          setConfirmation("");
          action.clear();
        }}
        onConfirm={() => void confirmDelete()}
      />
    </WorkspaceSurface>
  );
}

function PanelHeader({
  binding,
  onOpenSettings,
}: {
  binding: StorageBinding;
  onOpenSettings?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-900">
            {binding.label}
          </h2>
          <StatusPill
            label={binding.status}
            tone={statusTone(binding.status)}
          />
        </div>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          {binding.reason ||
            "Private objects use short-lived, single-object signed URLs. Provider credentials never reach the browser."}
        </p>
        {typeof binding.usedBytes === "number" ? (
          <p className="mt-1 text-[11px] text-zinc-400">
            {formatBytes(binding.usedBytes)}
            {typeof binding.quotaBytes === "number"
              ? ` of ${formatBytes(binding.quotaBytes)} used`
              : " used"}
          </p>
        ) : null}
      </div>
      {onOpenSettings ? (
        <Button size="sm" onClick={onOpenSettings}>
          Storage settings
        </Button>
      ) : null}
    </div>
  );
}

function StorageBreadcrumbs({
  prefix,
  onNavigate,
}: {
  prefix: string;
  onNavigate: (prefix: string) => void;
}) {
  const parts = prefix.split("/").filter(Boolean);
  return (
    <nav
      className="flex max-w-full items-center gap-1 overflow-x-auto text-xs"
      aria-label="Storage folder path"
    >
      <button
        type="button"
        className="shrink-0 rounded px-1.5 py-1 text-zinc-600 outline-none hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-blue-500"
        onClick={() => onNavigate("")}
      >
        Root
      </button>
      {parts.map((part, index) => {
        const next = `${parts.slice(0, index + 1).join("/")}/`;
        return (
          <span key={next} className="flex items-center gap-1">
            <span className="text-zinc-300">/</span>
            <button
              type="button"
              className="shrink-0 rounded px-1.5 py-1 text-zinc-600 outline-none hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-blue-500"
              onClick={() => onNavigate(next)}
            >
              {part}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

function StorageObjectsTable({
  items,
  canWrite,
  busy,
  onOpenFolder,
  onPreview,
  onDownload,
  onMove,
  onDelete,
}: {
  items: StorageObject[];
  canWrite: boolean;
  busy: boolean;
  onOpenFolder: (object: StorageObject) => void;
  onPreview: (object: StorageObject) => void;
  onDownload: (object: StorageObject) => void;
  onMove: (object: StorageObject) => void;
  onDelete: (object: StorageObject) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200">
      <table className="w-full min-w-[920px] text-left text-xs">
        <caption className="sr-only">Objects in the current storage path</caption>
        <thead className="bg-zinc-50 text-[10px] uppercase tracking-wide text-zinc-400">
          <tr>
            <th className="border-b border-zinc-200 px-4 py-2 font-medium">Name</th>
            <th className="border-b border-zinc-200 px-4 py-2 font-medium">Modified</th>
            <th className="border-b border-zinc-200 px-4 py-2 font-medium">Size</th>
            <th className="border-b border-zinc-200 px-4 py-2 font-medium">MIME</th>
            <th className="border-b border-zinc-200 px-4 py-2 font-medium">Visibility</th>
            <th className="border-b border-zinc-200 px-4 py-2 font-medium">Version</th>
            <th className="border-b border-zinc-200 px-4 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((object) => (
            <tr key={object.id} className="border-b border-zinc-100 last:border-0">
              <td className="max-w-72 px-4 py-3">
                {object.isFolder ? (
                  <button
                    type="button"
                    onClick={() => onOpenFolder(object)}
                    className="max-w-full truncate rounded font-medium text-blue-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    {object.name}/
                  </button>
                ) : (
                  <span className="block truncate font-medium text-zinc-800" title={object.path}>
                    {object.name}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-zinc-600">
                {formatDateTime(object.modifiedAt)}
              </td>
              <td className="px-4 py-3 text-zinc-600">
                {object.isFolder ? "—" : formatBytes(object.size)}
              </td>
              <td className="max-w-48 truncate px-4 py-3 text-zinc-600">
                {object.mimeType || "—"}
              </td>
              <td className="px-4 py-3">
                <StatusPill label={object.visibility} />
              </td>
              <td className="px-4 py-3">
                <span className="block max-w-36 truncate font-mono text-[10px] text-zinc-500" title={object.etag}>
                  {object.version || object.generation || object.etag}
                </span>
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-1">
                  {!object.isFolder && object.previewable ? (
                    <Button size="sm" disabled={busy} onClick={() => onPreview(object)}>
                      Preview
                    </Button>
                  ) : null}
                  {!object.isFolder ? (
                    <Button size="sm" disabled={busy} onClick={() => onDownload(object)}>
                      Download
                    </Button>
                  ) : null}
                  {canWrite ? (
                    <>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onMove(object)}>
                        Move
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDelete(object)}>
                        Delete
                      </Button>
                    </>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ensureFolderPrefix(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

function isSafeObjectPath(path: string): boolean {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("//")
  ) {
    return false;
  }
  return path
    .split("/")
    .filter(Boolean)
    .every((part) => part !== "." && part !== "..");
}
