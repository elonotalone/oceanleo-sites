import type {
  PluginHandlerContext,
  PluginRouteHandler,
} from "@oceanleo/plugin-runtime";
import React, { type ReactNode } from "react";

import {
  creationCatalogEntry,
  creationProtocolFor,
  type CreationSiteKey,
} from "./protocols";

export type CreationSurfaceMode =
  | "catalog"
  | "library"
  | "legacy-editor"
  | "template-catalog"
  | "project-editor"
  | "design-editor"
  | "commerce";

export interface CreationPageHandlerOptions {
  readonly mode: CreationSurfaceMode;
  readonly appParam?: string;
  readonly fixedAppId?: string;
  readonly catchAllParam?: string;
}

function stringParam(
  context: PluginHandlerContext,
  name: string | undefined,
): string {
  if (!name) return "";
  const value = context.params[name];
  if (typeof value === "string") return value;
  return value?.join("/") ?? "";
}

function selectedAppId(
  context: PluginHandlerContext,
  options: CreationPageHandlerOptions,
): string {
  if (options.fixedAppId) return options.fixedAppId;
  const direct = stringParam(context, options.appParam);
  if (direct) return direct;
  const query = new URL(context.request.url).searchParams.get("fn");
  return query?.trim() ?? "";
}

function contextId(siteKey: CreationSiteKey, appId: string): string {
  return appId ? `olctx:v1:${siteKey}:app:${appId}` : "";
}

function protocolDetails(siteKey: CreationSiteKey): ReactNode {
  const protocol = creationProtocolFor(siteKey);
  return (
    <dl
      data-creation-protocol-details
      style={{
        display: "grid",
        gap: "0.5rem",
        gridTemplateColumns: "max-content 1fr",
        margin: 0,
      }}
    >
      <dt>Plugin</dt>
      <dd>{protocol.pluginId}</dd>
      <dt>Artifact types</dt>
      <dd>{protocol.artifactTypes.join(", ")}</dd>
      <dt>Context</dt>
      <dd>{protocol.contextPattern}</dd>
      <dt>Templates</dt>
      <dd>{protocol.template.id}</dd>
      {protocol.editor ? (
        <>
          <dt>Editor</dt>
          <dd>
            {protocol.editor.id} · {protocol.editor.projectSchema}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

function catalogList(siteKey: CreationSiteKey): ReactNode {
  const protocol = creationProtocolFor(siteKey);
  return (
    <ul
      data-creation-catalog
      style={{
        display: "grid",
        gap: "0.75rem",
        gridTemplateColumns: "repeat(auto-fill, minmax(12rem, 1fr))",
        listStyle: "none",
        margin: "1.5rem 0 0",
        padding: 0,
      }}
    >
      {protocol.catalog.map((entry) => (
        <li key={entry.id}>
          <a
            data-app-engine={entry.engine}
            data-app-id={entry.id}
            data-artifact-types={entry.artifactTypes.join(",")}
            href={`/workspace/${encodeURIComponent(entry.id)}`}
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: "0.75rem",
              color: "inherit",
              display: "block",
              padding: "0.875rem",
              textDecoration: "none",
            }}
          >
            <strong>{entry.name}</strong>
            <small style={{ display: "block", marginTop: "0.25rem" }}>
              {entry.engine}
            </small>
          </a>
        </li>
      ))}
    </ul>
  );
}

function renderCreationSurface(input: Readonly<{
  context: PluginHandlerContext;
  siteKey: CreationSiteKey;
  options: CreationPageHandlerOptions;
}>): ReactNode {
  const protocol = creationProtocolFor(input.siteKey);
  const appId = selectedAppId(input.context, input.options);
  const app = creationCatalogEntry(input.siteKey, appId);
  const requestUrl = new URL(input.context.request.url);
  const legacyPath = stringParam(input.context, input.options.catchAllParam);

  return (
    <main
      data-app-known={app ? "true" : "false"}
      data-artifact-types={protocol.artifactTypes.join(",")}
      data-catalog-size={protocol.catalog.length}
      data-context-id={app ? contextId(input.siteKey, app.id) : ""}
      data-creation-surface={input.options.mode}
      data-editor-protocol={protocol.editor?.id ?? ""}
      data-plugin-id={protocol.pluginId}
      data-query={requestUrl.searchParams.toString()}
      data-request-path={input.context.pathname}
      data-selected-app={appId}
      data-site-key={input.siteKey}
      data-template-protocol={protocol.template.id}
      data-unmatched-path={legacyPath}
      style={{
        margin: "0 auto",
        maxWidth: "72rem",
        padding: "2rem",
      }}
    >
      <header>
        <p>{input.siteKey} · creation migration</p>
        <h1>{app?.name ?? protocol.displayName}</h1>
        <p>
          {app
            ? `${app.engine} → ${app.artifactTypes.join(", ")}`
            : `${protocol.catalog.length} catalog applications`}
        </p>
      </header>
      {input.options.mode === "design-editor" && protocol.editor ? (
        <section
          aria-label="Design editor protocol"
          data-editor-artifact-type={protocol.editor.artifactType}
          data-editor-messages={protocol.editor.messages.join(",")}
          data-editor-project-schema={protocol.editor.projectSchema}
        >
          <h2>Canvas editor protocol</h2>
          <p>
            This surface owns the typed load, mutate, save, reopen, and export
            handshake for durable design documents.
          </p>
        </section>
      ) : null}
      <section aria-label="Creation protocol">{protocolDetails(input.siteKey)}</section>
      {input.options.mode === "library" ? (
        <p data-library-contract="shared-artifact-library">
          Durable items are addressed by artifact ID plus pinned revision and
          retain their exact tenant/app context binding.
        </p>
      ) : (
        catalogList(input.siteKey)
      )}
    </main>
  );
}

export function creationPageHandler(
  siteKey: CreationSiteKey,
  options: CreationPageHandlerOptions,
): PluginRouteHandler {
  return (context) => {
    if (context.tenant.manifest.siteKey !== siteKey) {
      throw new Error(
        `${siteKey} handler received tenant ${String(context.tenant.manifest.siteKey)}.`,
      );
    }
    return {
      kind: "page",
      node: renderCreationSurface({ context, siteKey, options }),
    };
  };
}

function resolveGatewayBase(): string {
  const configured = String(
    process.env.NEXT_PUBLIC_OCEANLEO_GATEWAY_URL ?? "",
  ).trim();
  if (!configured) return "https://api.oceanleo.com";
  try {
    const parsed = new URL(configured);
    if (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      (parsed.pathname === "/" || parsed.pathname === "")
    ) {
      return parsed.origin;
    }
  } catch {
    // Fall through to the production gateway.
  }
  return "https://api.oceanleo.com";
}

function incomingBearerAuthorization(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  return /^Bearer\s+\S+$/i.test(authorization) ? authorization : null;
}

async function gatewayJsonPost<T>(
  path: `/${string}`,
  body: unknown,
  authorization: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${resolveGatewayBase()}${path}`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new Error("网络错误：无法连接到 AI 网关。");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      payload &&
      typeof payload === "object" &&
      typeof (payload as { detail?: unknown }).detail === "string"
        ? String((payload as { detail: string }).detail)
        : `网关请求失败（HTTP ${response.status}）`;
    throw new Error(detail);
  }
  return payload as T;
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

async function directGatewayUpload(input: Readonly<{
  authorization: string;
  blob: Blob;
  filename: string;
  contentType: string;
}>): Promise<string> {
  const common = {
    filename: input.filename,
    content_type: input.contentType,
    bytes: input.blob.size,
    site_id: "ecommerce",
    title: input.filename,
    register_asset: false,
  };
  const initialized = await gatewayJsonPost<{
    path?: unknown;
    signed_url?: unknown;
    upload_complete?: unknown;
    already_finalized?: unknown;
    file?: Readonly<{ url?: unknown }>;
  }>("/v1/media/upload/init", common, input.authorization);

  const finalizedUrl = clean(initialized.file?.url);
  if (initialized.already_finalized === true && finalizedUrl) {
    return finalizedUrl;
  }

  const path = clean(initialized.path);
  if (!path) throw new Error("无法创建上传凭证。");
  if (initialized.upload_complete !== true) {
    const signedUrl = clean(initialized.signed_url);
    if (!signedUrl.startsWith("https://")) {
      throw new Error("对象存储未返回安全上传地址。");
    }
    const uploaded = await fetch(signedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": input.contentType,
        "x-upsert": "false",
      },
      body: input.blob,
    });
    if (!uploaded.ok) {
      throw new Error(`上传失败（HTTP ${uploaded.status}）。`);
    }
  }

  const finalized = await gatewayJsonPost<{
    file?: Readonly<{ url?: unknown }>;
  }>("/v1/media/upload/finalize", { ...common, path }, input.authorization);
  const url = clean(finalized.file?.url);
  if (!url) throw new Error("上传完成但未返回文件地址。");
  return url;
}

export const ecommerceUploadHandler: PluginRouteHandler = async (context) => {
  const protocol = creationProtocolFor("ecommerce");
  const upload = protocol.upload;
  if (!upload) throw new Error("Ecommerce upload protocol is missing.");

  const authorization = incomingBearerAuthorization(context.request);
  if (!authorization) {
    return {
      kind: "response",
      response: Response.json(
        { error: "请先登录 OceanLeo 账号后再上传。" },
        { status: 401 },
      ),
    };
  }

  const form = await context.request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return {
      kind: "response",
      response: Response.json({ error: "缺少文件。" }, { status: 400 }),
    };
  }
  if (file.size > upload.maxBytes) {
    return {
      kind: "response",
      response: Response.json(
        { error: "文件过大（上限 12MB）。" },
        { status: 413 },
      ),
    };
  }

  try {
    const url = await directGatewayUpload({
      authorization,
      blob: file,
      filename: file.name,
      contentType: file.type || "image/png",
    });
    return {
      kind: "response",
      response: Response.json({ url }),
    };
  } catch (error) {
    return {
      kind: "response",
      response: Response.json(
        {
          error: error instanceof Error ? error.message : "上传失败。",
        },
        { status: 502 },
      ),
    };
  }
};
