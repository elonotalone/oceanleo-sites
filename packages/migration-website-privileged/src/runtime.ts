import crypto from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  PluginHandlerContext,
  PluginHandlerResult,
  PluginRouteHandler,
} from "@oceanleo/plugin-runtime";

/**
 * Untyped client: website privileged tables are not generated into a Database
 * schema here. Prefer `any` over Supabase's default `never` row/update types.
 */
export type WebsiteSupabaseClient = SupabaseClient<any, "public", any>;
export type WebsiteRouteParams = PluginHandlerContext["params"];
export type WebsiteMethodHandler = (
  request: Request,
  params: WebsiteRouteParams,
) => Response | Promise<Response>;

export function json(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return Response.json(body, { status, headers });
}

export function responseHandler(
  methods: Readonly<Partial<Record<string, WebsiteMethodHandler>>>,
): PluginRouteHandler {
  return async ({ request, params }): Promise<PluginHandlerResult> => {
    const method = request.method.toUpperCase();
    const handler = methods[method] ?? (method === "HEAD" ? methods.GET : undefined);
    if (!handler) {
      return {
        kind: "response",
        response: json(
          { error: "Method not allowed" },
          405,
          { Allow: Object.keys(methods).join(", ") },
        ),
      };
    }
    return { kind: "response", response: await handler(request, params) };
  };
}

export function supabaseFor(request: Request): WebsiteSupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: request.headers.get("Authorization") || "",
        },
      },
    },
  ) as WebsiteSupabaseClient;
}

export async function authenticated(
  request: Request,
): Promise<
  | Readonly<{
      ok: true;
      supabase: WebsiteSupabaseClient;
      user: { id: string };
    }>
  | Readonly<{ ok: false; response: Response }>
> {
  const supabase = supabaseFor(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }
  return { ok: true, supabase, user };
}

function vaultKey(): Buffer {
  const hex = process.env.VAULT_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64 || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(
      "VAULT_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)",
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptVaultValue(
  plaintext: string,
): Readonly<{ ciphertext: string; iv: string; tag: string }> {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", vaultKey(), iv);
  let ciphertext = cipher.update(plaintext, "utf8", "hex");
  ciphertext += cipher.final("hex");
  return {
    ciphertext,
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
  };
}

export function decryptVaultValue(
  ciphertext: string,
  iv: string,
  tag: string,
): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    vaultKey(),
    Buffer.from(iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  let plaintext = decipher.update(ciphertext, "hex", "utf8");
  plaintext += decipher.final("utf8");
  return plaintext;
}

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseRecord(value: string): Record<string, unknown> | null {
  try {
    return record(JSON.parse(value));
  } catch {
    return null;
  }
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error
    ? error.message
    : typeof error === "string" && error
      ? error
      : fallback;
}

export function parameter(
  params: WebsiteRouteParams,
  name: string,
): string {
  const value = params[name];
  return typeof value === "string" ? value : "";
}

export function parseCursorErrorDetail(rawBody: string): string {
  const body = rawBody.trim();
  if (!body) return "";
  const parsed = parseRecord(body);
  for (const key of ["error", "message", "detail"]) {
    const detail = stringValue(parsed?.[key]);
    if (detail) return detail;
  }
  return body;
}

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit & Readonly<{ timeoutMs?: number }> = {},
): Promise<Response> {
  const { timeoutMs = 30_000, signal, ...requestInit } = init;
  return fetch(input, {
    ...requestInit,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
  });
}

export function publicSiteOrigin(fallbackOrigin: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Preserve the request origin when the optional override is invalid.
    }
  }
  return fallbackOrigin;
}

export function safeReturnPath(
  raw: string | null | undefined,
  fallback = "/onboarding",
): string {
  return raw?.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
}

export function appendQuery(
  path: string,
  params: Readonly<Record<string, string>>,
): string {
  const query = new URLSearchParams(params).toString();
  return path.includes("?") ? `${path}&${query}` : `${path}?${query}`;
}
