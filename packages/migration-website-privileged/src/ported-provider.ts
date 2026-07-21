import crypto from "node:crypto";

import type { PluginRouteHandler } from "@oceanleo/plugin-runtime";

import { chatComplete, parseJsonResponse } from "./openai";
import {
  appendQuery,
  authenticated,
  decryptVaultValue,
  encryptVaultValue,
  errorMessage,
  fetchWithTimeout,
  json,
  parseRecord,
  publicSiteOrigin,
  record,
  responseHandler,
  safeReturnPath,
  stringValue,
  supabaseFor,
} from "./runtime";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

async function cloudflareAccountId(token: string): Promise<string> {
  const response = await fetchWithTimeout(
    `${CLOUDFLARE_API}/accounts?per_page=1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = (await response.json()) as Record<string, any>;
  if (!response.ok || data.success === false) {
    throw new Error(
      `Cloudflare account lookup failed (${response.status}): ${JSON.stringify(data.errors || [])}`,
    );
  }
  const id = data.result?.[0]?.id;
  if (!id) throw new Error("No Cloudflare accounts found for this token");
  return id;
}

interface DomainSearchResult {
  domain_name: string;
  available: boolean;
  can_register: boolean;
  price?: {
    registration_fee?: number;
    renewal_fee?: number;
    currency?: string;
  };
  tier?: "standard" | "premium";
  reason?: string;
}

function mapCloudflareDomain(value: Record<string, any>): DomainSearchResult {
  const registration = value.pricing?.registration_cost;
  const renewal = value.pricing?.renewal_cost;
  return {
    domain_name: String(value.name || ""),
    available: value.registrable === true,
    can_register: value.registrable === true && value.tier !== "premium",
    price: value.pricing
      ? {
          registration_fee:
            typeof registration === "string"
              ? Number.parseFloat(registration)
              : undefined,
          renewal_fee:
            typeof renewal === "string"
              ? Number.parseFloat(renewal)
              : undefined,
          currency: stringValue(value.pricing.currency),
        }
      : undefined,
    tier:
      value.tier === "premium" || value.tier === "standard"
        ? value.tier
        : undefined,
    reason: stringValue(value.reason),
  };
}

async function cloudflareSearchDomains(
  token: string,
  accountId: string,
  query: string,
  limit = 20,
): Promise<DomainSearchResult[]> {
  const response = await fetchWithTimeout(
    `${CLOUDFLARE_API}/accounts/${accountId}/registrar/domain-search?q=${encodeURIComponent(query)}&limit=${limit}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body = await response.text();
  const data = parseRecord(body) ?? {};
  if (!response.ok || data.success === false) {
    const errors = Array.isArray(data.errors)
      ? data.errors
          .map((value) => stringValue(record(value)?.message))
          .filter(Boolean)
          .join("; ")
      : body.slice(0, 300);
    throw new Error(
      `Cloudflare domain search failed (${response.status}): ${errors}`,
    );
  }
  const result = record(data.result);
  const domains = Array.isArray(result?.domains) ? result.domains : [];
  return domains
    .map(record)
    .filter((value): value is Record<string, unknown> => value !== null)
    .map(mapCloudflareDomain);
}

async function cloudflareCheckDomain(
  token: string,
  accountId: string,
  domain: string,
): Promise<DomainSearchResult> {
  const response = await fetchWithTimeout(
    `${CLOUDFLARE_API}/accounts/${accountId}/registrar/domain-check`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ domains: [domain] }),
    },
  );
  const body = await response.text();
  const data = parseRecord(body) ?? {};
  if (!response.ok || data.success === false) {
    throw new Error(
      `Cloudflare domain check failed (${response.status}): ${body.slice(0, 300)}`,
    );
  }
  const domains = record(data.result)?.domains;
  const first = Array.isArray(domains) ? record(domains[0]) : null;
  return first
    ? mapCloudflareDomain(first)
    : {
        domain_name: domain,
        available: false,
        can_register: false,
        reason: "no_result",
      };
}

async function cloudflareRegisterDomain(
  token: string,
  accountId: string,
  domainName: string,
  years: number,
  autoRenew: boolean,
): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(
    `${CLOUDFLARE_API}/accounts/${accountId}/registrar/registrations`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "respond-async",
      },
      body: JSON.stringify({
        domain_name: domainName,
        years,
        auto_renew: autoRenew,
        privacy_mode: "redaction",
      }),
      timeoutMs: 90_000,
    },
  );
  const body = await response.text();
  const data = parseRecord(body) ?? {};
  if (![200, 201, 202].includes(response.status)) {
    throw new Error(
      `Cloudflare registration failed (${response.status}): ${body.slice(0, 500)}`,
    );
  }
  const result = record(data.result) ?? {};
  const state = stringValue(result.state) || "pending";
  return {
    domain_name: domainName,
    status: state,
    completed: result.completed === true || state === "succeeded",
    links: result.links,
    state,
    error: result.error,
  };
}

async function cloudflareTokenFor(
  request: Request,
): Promise<
  | { ok: true; token: string; accountId: string }
  | { ok: false; response: Response }
> {
  const auth = await authenticated(request);
  if (!auth.ok) return auth;
  const { data: vault } = await auth.supabase
    .from("vault_entries")
    .select("encrypted_token, iv, auth_tag")
    .eq("user_id", auth.user.id)
    .eq("platform", "cloudflare")
    .single();
  if (!vault) {
    return {
      ok: false,
      response: json(
        {
          error: "Connect Cloudflare first",
          missingPlatform: "cloudflare",
        },
        400,
      ),
    };
  }
  let token: string;
  try {
    const raw = decryptVaultValue(
      vault.encrypted_token,
      vault.iv,
      vault.auth_tag,
    );
    token = stringValue(parseRecord(raw)?.api_token) || raw;
  } catch {
    return {
      ok: false,
      response: json(
        { error: "Failed to decrypt Cloudflare token" },
        500,
      ),
    };
  }
  try {
    return {
      ok: true,
      token,
      accountId: await cloudflareAccountId(token),
    };
  } catch (error) {
    return {
      ok: false,
      response: json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Cloudflare account lookup failed",
        },
        500,
      ),
    };
  }
}

const domainSearchHandler = responseHandler({
  GET: async (request) => {
    const query = new URL(request.url).searchParams.get("q")?.trim();
    if (!query) {
      // Authentication is intentionally checked first in the legacy route.
      const auth = await authenticated(request);
      if (!auth.ok) return auth.response;
      return json({ error: "Missing query parameter ?q=" }, 400);
    }
    const credentials = await cloudflareTokenFor(request);
    if (!credentials.ok) return credentials.response;
    if (/^\.?[a-z]{2,}$/i.test(query)) {
      return json(
        {
          error:
            'Please enter a keyword or domain name, not just an extension like "com".',
        },
        400,
      );
    }
    try {
      return json({
        results: await cloudflareSearchDomains(
          credentials.token,
          credentials.accountId,
          query,
        ),
      });
    } catch (error) {
      const message = errorMessage(error, "Domain search failed");
      return /403|forbidden|authentication|permission/i.test(message)
        ? json(
            {
              error: message,
              hint: 'Your Cloudflare API token may be missing the "Account.Registrar:Edit" permission, or the account has not completed registrar onboarding (default address book + billing).',
            },
            403,
          )
        : json({ error: message }, 500);
    }
  },
});

const domainPurchaseHandler = responseHandler({
  POST: async (request) => {
    const credentials = await cloudflareTokenFor(request);
    if (!credentials.ok) return credentials.response;
    let body: {
      domainName?: string;
      years?: number;
      autoRenew?: boolean;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const domainName = body.domainName?.trim();
    if (!domainName) return json({ error: "domainName is required" }, 400);
    try {
      const check = await cloudflareCheckDomain(
        credentials.token,
        credentials.accountId,
        domainName,
      );
      if (!check.available || !check.can_register) {
        return json(
          { error: "Domain is not available for registration", check },
          409,
        );
      }
      const registration = await cloudflareRegisterDomain(
        credentials.token,
        credentials.accountId,
        domainName,
        body.years ?? 1,
        body.autoRenew ?? false,
      );
      return json({ status: "ok", registration });
    } catch (error) {
      return json(
        { error: errorMessage(error, "Domain purchase failed") },
        500,
      );
    }
  },
});

const oauthCloudflareHandler = responseHandler({
  POST: async (request) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    let body: { token?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) return json({ error: "Token is required" }, 400);
    const verify = await fetchWithTimeout(
      `${CLOUDFLARE_API}/user/tokens/verify`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!verify.ok) return json({ error: "Invalid Cloudflare token" }, 400);
    const verifyData = (await verify.json()) as Record<string, unknown>;
    if (verifyData.success !== true) {
      return json(
        { error: "Cloudflare token verification failed" },
        400,
      );
    }
    let displayName = "Cloudflare";
    try {
      const accounts = await fetchWithTimeout(
        `${CLOUDFLARE_API}/accounts?per_page=1`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (accounts.ok) {
        const data = (await accounts.json()) as Record<string, any>;
        displayName = data.result?.[0]?.name || displayName;
      }
    } catch {
      // Account name is cosmetic.
    }
    const encrypted = encryptVaultValue(
      JSON.stringify({ api_token: token }),
    );
    await auth.supabase.from("vault_entries").upsert(
      {
        user_id: auth.user.id,
        platform: "cloudflare",
        encrypted_token: encrypted.ciphertext,
        iv: encrypted.iv,
        auth_tag: encrypted.tag,
        display_name: displayName,
        scopes: ["dns"],
        connected_at: new Date().toISOString(),
      },
      { onConflict: "user_id,platform" },
    );
    return json({ status: "connected", displayName });
  },
});

function aliyunPercentEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~");
}

async function validAliyunCredentials(
  accessKeyId: string,
  accessKeySecret: string,
): Promise<boolean> {
  const values: Record<string, string> = {
    Action: "ListRegions",
    Version: "2020-06-01",
    Format: "JSON",
    AccessKeyId: accessKeyId,
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    RegionId: "cn-hangzhou",
  };
  const canonical = Object.keys(values)
    .sort()
    .map(
      (key) =>
        `${aliyunPercentEncode(key)}=${aliyunPercentEncode(values[key]!)}`,
    )
    .join("&");
  const signature = crypto
    .createHmac("sha1", `${accessKeySecret}&`)
    .update(
      `POST&${aliyunPercentEncode("/")}&${aliyunPercentEncode(canonical)}`,
    )
    .digest("base64");
  const body = new URLSearchParams(values);
  body.set("Signature", signature);
  try {
    const response = await fetchWithTimeout(
      "https://swas-open.cn-hangzhou.aliyuncs.com",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        timeoutMs: 60_000,
      },
    );
    const data = (await response.json()) as Record<string, unknown>;
    return response.ok && (!data.Code || data.Code === "200");
  } catch {
    return false;
  }
}

const oauthAliyunHandler = responseHandler({
  POST: async (request) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    let body: { accessKeyId?: string; accessKeySecret?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const accessKeyId = body.accessKeyId?.trim() || "";
    const accessKeySecret = body.accessKeySecret?.trim() || "";
    if (!accessKeyId || !accessKeySecret) {
      return json(
        { error: "AccessKey ID and Secret are required" },
        400,
      );
    }
    if (!(await validAliyunCredentials(accessKeyId, accessKeySecret))) {
      return json({ error: "Invalid Alibaba Cloud credentials" }, 400);
    }
    const encrypted = encryptVaultValue(
      JSON.stringify({
        access_key_id: accessKeyId,
        access_key_secret: accessKeySecret,
      }),
    );
    const displayName = `China Cloud (${accessKeyId.slice(0, 6)}***)`;
    await auth.supabase.from("vault_entries").upsert(
      {
        user_id: auth.user.id,
        platform: "aliyun",
        encrypted_token: encrypted.ciphertext,
        iv: encrypted.iv,
        auth_tag: encrypted.tag,
        display_name: displayName,
        scopes: ["swas"],
        connected_at: new Date().toISOString(),
      },
      { onConflict: "user_id,platform" },
    );
    return json({ status: "connected", displayName });
  },
});

const oauthRailwayHandler = responseHandler({
  POST: async (request) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    let body: { token?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const token = body.token?.trim() || "";
    if (!token) return json({ error: "Token is required" }, 400);
    let me: { name?: string; email?: string } | null = null;
    try {
      const response = await fetchWithTimeout(
        "https://backboard.railway.com/graphql/v2",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: "query { me { name email } }" }),
          timeoutMs: 60_000,
        },
      );
      const data = (await response.json()) as Record<string, any>;
      if (response.ok && !data.errors?.length) me = data.data?.me ?? null;
    } catch {
      me = null;
    }
    if (!me) return json({ error: "Invalid Railway token" }, 400);
    const encrypted = encryptVaultValue(
      JSON.stringify({ api_token: token }),
    );
    const displayName = me.name || me.email || "Railway";
    await auth.supabase.from("vault_entries").upsert(
      {
        user_id: auth.user.id,
        platform: "railway",
        encrypted_token: encrypted.ciphertext,
        iv: encrypted.iv,
        auth_tag: encrypted.tag,
        display_name: displayName,
        scopes: ["deploy"],
        connected_at: new Date().toISOString(),
      },
      { onConflict: "user_id,platform" },
    );
    return json({ status: "connected", displayName: me.name || me.email });
  },
});

function oauthState(
  raw: string,
): { token: string; returnTo: string; verifier: string } {
  if (!raw) return { token: "", returnTo: "/onboarding", verifier: "" };
  const parsed = parseRecord(
    Buffer.from(raw, "base64url").toString("utf8"),
  );
  if (!parsed) {
    return { token: raw, returnTo: "/onboarding", verifier: "" };
  }
  return {
    token: stringValue(parsed.token) || "",
    returnTo: safeReturnPath(stringValue(parsed.return)),
    verifier: stringValue(parsed.verifier) || "",
  };
}

function authedSupabase(token: string) {
  const request = new Request("https://website.oceanleo.com", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return supabaseFor(request);
}

const oauthGithubHandler = responseHandler({
  GET: async (request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const siteUrl = publicSiteOrigin(url.origin);
    const redirectUri = `${siteUrl}/api/oauth/github`;
    if (!code) {
      const clientId = process.env.GITHUB_CLIENT_ID;
      if (!clientId) {
        return json({ error: "GITHUB_CLIENT_ID not configured" }, 500);
      }
      const returnTo = safeReturnPath(url.searchParams.get("return"));
      const state = Buffer.from(
        JSON.stringify({
          token: url.searchParams.get("state") || "",
          return: returnTo,
        }),
      ).toString("base64url");
      const target = new URL("https://github.com/login/oauth/authorize");
      target.searchParams.set("client_id", clientId);
      target.searchParams.set("redirect_uri", redirectUri);
      target.searchParams.set("scope", "repo");
      target.searchParams.set("state", state);
      return Response.redirect(target, 307);
    }
    const state = oauthState(url.searchParams.get("state") || "");
    try {
      const tokenResponse = await fetchWithTimeout(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            client_id: process.env.GITHUB_CLIENT_ID!,
            client_secret: process.env.GITHUB_CLIENT_SECRET!,
            code,
            redirect_uri: redirectUri,
          }),
        },
      );
      const tokens = (await tokenResponse.json()) as Record<string, any>;
      if (tokens.error || !tokens.access_token) {
        return Response.redirect(
          `${siteUrl}${appendQuery(state.returnTo, {
            error: "github_auth_failed",
            ...(tokens.access_token
              ? {}
              : { detail: "Missing access token" }),
          })}`,
          307,
        );
      }
      const userResponse = await fetchWithTimeout(
        "https://api.github.com/user",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      );
      const githubUser = (await userResponse.json()) as Record<string, any>;
      if (!state.token) {
        return Response.redirect(
          `${siteUrl}${appendQuery(state.returnTo, {
            error: "missing_session",
          })}`,
          307,
        );
      }
      const supabase = authedSupabase(state.token);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return Response.redirect(
          `${siteUrl}${appendQuery(state.returnTo, {
            error: "invalid_session",
          })}`,
          307,
        );
      }
      const encrypted = encryptVaultValue(
        JSON.stringify({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || "",
        }),
      );
      const { error } = await supabase.from("vault_entries").upsert(
        {
          user_id: user.id,
          platform: "github",
          encrypted_token: encrypted.ciphertext,
          iv: encrypted.iv,
          auth_tag: encrypted.tag,
          display_name: githubUser.login
            ? `@${githubUser.login}`
            : "GitHub",
          scopes: ["repo"],
          connected_at: new Date().toISOString(),
        },
        { onConflict: "user_id,platform" },
      );
      if (error) {
        return Response.redirect(
          `${siteUrl}${appendQuery(state.returnTo, {
            error: "github_auth_failed",
            detail: error.message,
          })}`,
          307,
        );
      }
      return Response.redirect(
        `${siteUrl}${appendQuery(
          state.returnTo,
          state.returnTo === "/onboarding"
            ? { step: "3", github: "connected" }
            : { github: "connected" },
        )}`,
        307,
      );
    } catch (error) {
      return Response.redirect(
        `${siteUrl}${appendQuery(state.returnTo, {
          error: "github_auth_failed",
          detail: errorMessage(error, "GitHub authentication failed"),
        })}`,
        307,
      );
    }
  },
});

const oauthSupabaseHandler = responseHandler({
  GET: async (request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const siteUrl = publicSiteOrigin(url.origin);
    const redirectUri = `${siteUrl}/api/oauth/supabase`;
    if (!code) {
      const clientId = process.env.SUPABASE_OAUTH_CLIENT_ID;
      if (!clientId) {
        return json(
          { error: "SUPABASE_OAUTH_CLIENT_ID not configured" },
          500,
        );
      }
      const verifier = crypto.randomBytes(32).toString("base64url");
      const challenge = crypto
        .createHash("sha256")
        .update(verifier)
        .digest("base64url");
      const state = Buffer.from(
        JSON.stringify({
          token: url.searchParams.get("state") || "",
          verifier,
          return: safeReturnPath(url.searchParams.get("return")),
        }),
      ).toString("base64url");
      const target = new URL(
        "https://api.supabase.com/v1/oauth/authorize",
      );
      target.searchParams.set("client_id", clientId);
      target.searchParams.set("redirect_uri", redirectUri);
      target.searchParams.set("response_type", "code");
      target.searchParams.set("code_challenge", challenge);
      target.searchParams.set("code_challenge_method", "S256");
      target.searchParams.set("state", state);
      return Response.redirect(target, 307);
    }
    const rawState = url.searchParams.get("state") || "";
    const parsed = parseRecord(
      Buffer.from(rawState, "base64url").toString("utf8"),
    );
    if (!parsed) {
      return Response.redirect(
        `${siteUrl}/onboarding?error=invalid_state`,
        307,
      );
    }
    const state = oauthState(rawState);
    try {
      const tokenResponse = await fetchWithTimeout(
        "https://api.supabase.com/v1/oauth/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: process.env.SUPABASE_OAUTH_CLIENT_ID!,
            client_secret: process.env.SUPABASE_OAUTH_CLIENT_SECRET!,
            code,
            redirect_uri: redirectUri,
            code_verifier: state.verifier,
          }),
        },
      );
      const tokens = (await tokenResponse.json()) as Record<string, any>;
      if (tokens.error || !tokens.access_token) {
        return Response.redirect(
          `${siteUrl}${appendQuery(state.returnTo, {
            error: "supabase_auth_failed",
            ...(!tokens.access_token
              ? { detail: "Missing access token" }
              : {}),
          })}`,
          307,
        );
      }
      let displayName = "Connected";
      try {
        const organizations = await fetchWithTimeout(
          "https://api.supabase.com/v1/organizations",
          {
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
            },
          },
        );
        if (organizations.ok) {
          const values = (await organizations.json()) as Array<{
            name?: string;
          }>;
          displayName = values[0]?.name || displayName;
        }
      } catch {
        // Organization name is cosmetic.
      }
      if (!state.token) {
        return Response.redirect(
          `${siteUrl}${appendQuery(state.returnTo, {
            error: "missing_session",
          })}`,
          307,
        );
      }
      const supabase = authedSupabase(state.token);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return Response.redirect(
          `${siteUrl}${appendQuery(state.returnTo, {
            error: "invalid_session",
          })}`,
          307,
        );
      }
      const encrypted = encryptVaultValue(
        JSON.stringify({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
        }),
      );
      const { error } = await supabase.from("vault_entries").upsert(
        {
          user_id: user.id,
          platform: "supabase",
          encrypted_token: encrypted.ciphertext,
          iv: encrypted.iv,
          auth_tag: encrypted.tag,
          display_name: displayName,
          scopes: ["management"],
          connected_at: new Date().toISOString(),
        },
        { onConflict: "user_id,platform" },
      );
      if (error) {
        return Response.redirect(
          `${siteUrl}${appendQuery(state.returnTo, {
            error: "supabase_auth_failed",
            detail: error.message,
          })}`,
          307,
        );
      }
      return Response.redirect(
        `${siteUrl}${appendQuery(
          state.returnTo,
          state.returnTo === "/onboarding"
            ? { step: "4", supabase: "connected" }
            : { supabase: "connected" },
        )}`,
        307,
      );
    } catch (error) {
      return Response.redirect(
        `${siteUrl}${appendQuery(state.returnTo, {
          error: "supabase_auth_failed",
          detail: errorMessage(error, "Supabase authentication failed"),
        })}`,
        307,
      );
    }
  },
});

const vaultHandler = responseHandler({
  GET: async (request) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    const [{ data: entries }, { data: servers }] = await Promise.all([
      auth.supabase
        .from("vault_entries")
        .select(
          "platform, display_name, scopes, connected_at, expires_at",
        )
        .eq("user_id", auth.user.id),
      auth.supabase
        .from("server_connections")
        .select(
          "id, label, host, port, username, auth_type, status, last_connected_at, created_at, site_id",
        )
        .eq("user_id", auth.user.id)
        .order("created_at", { ascending: false }),
    ]);
    const platforms = [
      "github",
      "vercel",
      "supabase",
      "cloudflare",
      "aliyun",
      "railway",
    ];
    return json({
      platforms: platforms.map((platform) => {
        const entry = entries?.find(
          (candidate) => candidate.platform === platform,
        );
        return {
          platform,
          connected: Boolean(entry),
          displayName: entry?.display_name || null,
          scopes: entry?.scopes || [],
          connectedAt: entry?.connected_at || null,
        };
      }),
      servers: servers || [],
    });
  },
  DELETE: async (request) => {
    const platform = new URL(request.url).searchParams.get("platform");
    if (!platform) {
      return json({ error: "platform parameter required" }, 400);
    }
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;
    if (platform === "github" || platform === "vercel") {
      try {
        const { data } = await auth.supabase
          .from("vault_entries")
          .select("encrypted_token, iv, auth_tag")
          .eq("user_id", auth.user.id)
          .eq("platform", platform)
          .single();
        if (data) {
          const raw = decryptVaultValue(
            data.encrypted_token,
            data.iv,
            data.auth_tag,
          ).trim();
          const token = stringValue(parseRecord(raw)?.access_token) || raw;
          if (platform === "github") {
            const clientId = process.env.GITHUB_CLIENT_ID;
            const secret = process.env.GITHUB_CLIENT_SECRET;
            if (clientId && secret) {
              await fetchWithTimeout(
                `https://api.github.com/applications/${clientId}/grant`,
                {
                  method: "DELETE",
                  headers: {
                    Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
                    Accept: "application/vnd.github+json",
                  },
                  body: JSON.stringify({ access_token: token }),
                },
              );
            }
          } else {
            const clientId = process.env.VERCEL_CLIENT_ID;
            const secret = process.env.VERCEL_CLIENT_SECRET;
            if (clientId && secret) {
              await fetchWithTimeout(
                "https://api.vercel.com/login/oauth/token/revoke",
                {
                  method: "POST",
                  headers: {
                    Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
                  },
                  body: new URLSearchParams({ token }),
                },
              );
            }
          }
        }
      } catch {
        // Revocation is best effort, matching the legacy route.
      }
    }
    await auth.supabase
      .from("vault_entries")
      .delete()
      .eq("user_id", auth.user.id)
      .eq("platform", platform);
    return json({ status: "disconnected" });
  },
});

async function providerCredential(
  request: Request,
  platform: "github" | "vercel",
): Promise<
  | {
      ok: true;
      auth: Extract<Awaited<ReturnType<typeof authenticated>>, { ok: true }>;
      token: string;
      teamId: string | null;
    }
  | { ok: false; response: Response }
> {
  const auth = await authenticated(request);
  if (!auth.ok) return auth;
  const { data } = await auth.supabase
    .from("vault_entries")
    .select("encrypted_token, iv, auth_tag")
    .eq("user_id", auth.user.id)
    .eq("platform", platform)
    .single();
  if (!data) {
    return {
      ok: false,
      response: json(
        {
          error: `${platform}_not_connected`,
          message: `Connect ${platform === "github" ? "GitHub" : "Vercel"} first to import existing ${platform === "github" ? "repositories" : "projects"}.`,
          missingPlatform: platform,
        },
        400,
      ),
    };
  }
  const raw = decryptVaultValue(
    data.encrypted_token,
    data.iv,
    data.auth_tag,
  );
  const parsed = parseRecord(raw);
  return {
    ok: true,
    auth,
    token: stringValue(parsed?.access_token) || raw,
    teamId: stringValue(parsed?.team_id) || null,
  };
}

const githubReposHandler = responseHandler({
  GET: async (request) => {
    const credential = await providerCredential(request, "github");
    if (!credential.ok) return credential.response;
    const repos: Array<Record<string, any>> = [];
    for (let page = 1; page <= 3; page += 1) {
      const response = await fetchWithTimeout(
        `https://api.github.com/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
        {
          headers: {
            Authorization: `Bearer ${credential.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      if (!response.ok) {
        return json(
          {
            error: "github_list_failed",
            message: `GitHub API returned ${response.status}: ${(await response.text()).slice(0, 200)}`,
          },
          500,
        );
      }
      const chunk = (await response.json()) as Array<Record<string, any>>;
      repos.push(...chunk);
      if (chunk.length < 100) break;
    }
    const names = repos.map((repo) => repo.full_name).filter(Boolean);
    const imported = new Map<string, string>();
    if (names.length > 0) {
      const { data } = await credential.auth.supabase
        .from("deployed_sites")
        .select("id, github_repo")
        .eq("user_id", credential.auth.user.id)
        .in("github_repo", names)
        .neq("status", "deleted");
      for (const site of data || []) {
        if (site.github_repo) imported.set(site.github_repo, site.id);
      }
    }
    return json({
      repos: repos.map((repo) => ({
        fullName: repo.full_name,
        name: repo.name,
        owner: repo.owner?.login || "",
        description: repo.description || null,
        private: Boolean(repo.private),
        defaultBranch: repo.default_branch || "main",
        htmlUrl: repo.html_url,
        pushedAt: repo.pushed_at || null,
        language: repo.language || null,
        alreadyImported: imported.has(repo.full_name),
        importedSiteId: imported.get(repo.full_name),
      })),
    });
  },
});

const vercelProjectsHandler = responseHandler({
  GET: async (request) => {
    const credential = await providerCredential(request, "vercel");
    if (!credential.ok) return credential.response;
    const projects: Array<Record<string, any>> = [];
    let next: string | null = null;
    for (let page = 0; page < 3; page += 1) {
      const query = new URLSearchParams({ limit: "100" });
      if (credential.teamId) query.set("teamId", credential.teamId);
      if (next) query.set("until", next);
      const response = await fetchWithTimeout(
        `https://api.vercel.com/v9/projects?${query}`,
        {
          headers: { Authorization: `Bearer ${credential.token}` },
        },
      );
      if (!response.ok) {
        return json(
          {
            error: "vercel_list_failed",
            message: `Vercel API returned ${response.status}: ${(await response.text()).slice(0, 200)}`,
          },
          500,
        );
      }
      const data = (await response.json()) as Record<string, any>;
      const chunk = Array.isArray(data.projects) ? data.projects : [];
      projects.push(...chunk);
      next =
        data.pagination?.next === null ||
        data.pagination?.next === undefined
          ? null
          : String(data.pagination.next);
      if (!next || chunk.length === 0) break;
    }
    const ids = projects.map((project) => project.id).filter(Boolean);
    const imported = new Map<string, string>();
    if (ids.length > 0) {
      const { data } = await credential.auth.supabase
        .from("deployed_sites")
        .select("id, vercel_project_id")
        .eq("user_id", credential.auth.user.id)
        .in("vercel_project_id", ids)
        .neq("status", "deleted");
      for (const site of data || []) {
        if (site.vercel_project_id) {
          imported.set(site.vercel_project_id, site.id);
        }
      }
    }
    const slug = credential.teamId || "~";
    return json({
      projects: projects.map((project) => {
        const production =
          project.alias?.find(
            (alias: Record<string, unknown>) => alias?.domain,
          )?.domain ||
          project.targets?.production?.alias?.[0] ||
          null;
        return {
          id: project.id,
          name: project.name,
          framework: project.framework || null,
          productionUrl: production ? `https://${production}` : null,
          dashboardUrl: `https://vercel.com/${slug}/${project.name}`,
          gitRepo:
            project.link?.type === "github"
              ? {
                  type: "github",
                  repo: `${project.link.org}/${project.link.repo}`,
                }
              : null,
          createdAt: project.createdAt || null,
          alreadyImported: imported.has(project.id),
          importedSiteId: imported.get(project.id),
        };
      }),
      teamId: credential.teamId,
      isIntegrationToken:
        credential.token.startsWith("vca_") ||
        credential.token.startsWith("vci_"),
    });
  },
});

const vaultDiagnoseHandler = responseHandler({
  GET: async (request) => {
    const platform = new URL(request.url).searchParams.get("platform");
    if (platform !== "supabase" && platform !== "vercel") {
      return json(
        { error: "Only ?platform=supabase|vercel is supported" },
        400,
      );
    }
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;

    const { data } = await auth.supabase
      .from("vault_entries")
      .select("encrypted_token, iv, auth_tag, display_name, connected_at")
      .eq("user_id", auth.user.id)
      .eq("platform", platform)
      .single();

    if (platform === "vercel") {
      if (!data) {
        return json({
          status: "not_connected",
          detail: "No vault entry found for vercel",
        });
      }
      let rawDecrypted: string;
      try {
        rawDecrypted = decryptVaultValue(
          data.encrypted_token,
          data.iv,
          data.auth_tag,
        );
      } catch (error) {
        return json({
          status: "decrypt_error",
          detail:
            error instanceof Error ? error.message : "Decryption failed",
          connectedAt: data.connected_at,
        });
      }
      let accessToken = "";
      let teamId: string | null = null;
      let hasRefreshToken = false;
      const parsed = parseRecord(rawDecrypted);
      if (parsed) {
        accessToken = stringValue(parsed.access_token) || "";
        teamId = stringValue(parsed.team_id) || null;
        hasRefreshToken = Boolean(parsed.refresh_token);
      } else {
        accessToken = rawDecrypted.trim();
      }
      const result: Record<string, unknown> = {
        status: "checking",
        displayName: data.display_name,
        connectedAt: data.connected_at,
        hasRefreshToken,
        teamId,
        tokenPrefix: accessToken
          ? `${accessToken.substring(0, 8)}...`
          : "(empty)",
        tokenLength: accessToken.length,
      };

      try {
        const userUrl = teamId
          ? `https://api.vercel.com/v2/user?teamId=${teamId}`
          : "https://api.vercel.com/v2/user";
        const userRes = await fetchWithTimeout(userUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        result.userApiStatus = userRes.status;
        if (userRes.ok) {
          const userData = (await userRes.json()) as Record<string, any>;
          result.vercelUser =
            userData.user?.username || userData.user?.name || "unknown";
        } else {
          result.userApiBody = (await userRes.text()).substring(0, 300);
        }
      } catch (error) {
        result.userApiError =
          error instanceof Error ? error.message : String(error);
      }

      try {
        const projUrl = teamId
          ? `https://api.vercel.com/v1/projects?teamId=${teamId}&limit=3`
          : "https://api.vercel.com/v1/projects?limit=3";
        const projRes = await fetchWithTimeout(projUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        result.listProjectsStatus = projRes.status;
        if (projRes.ok) {
          const projData = (await projRes.json()) as Record<string, any>;
          const projects = projData.projects || [];
          result.projectCount = projects.length;
          result.projectNames = projects.map(
            (project: { name?: string }) => project.name,
          );
        } else {
          result.listProjectsBody = (await projRes.text()).substring(0, 300);
        }
      } catch (error) {
        result.listProjectsError =
          error instanceof Error ? error.message : String(error);
      }

      try {
        const teamsRes = await fetchWithTimeout(
          "https://api.vercel.com/v2/teams",
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        result.teamsApiStatus = teamsRes.status;
        if (teamsRes.ok) {
          const teamsData = (await teamsRes.json()) as Record<string, any>;
          const teams = teamsData.teams || [];
          result.teams = teams.map(
            (team: { id?: string; slug?: string; name?: string }) => ({
              id: team.id,
              slug: team.slug,
              name: team.name,
            }),
          );
        } else {
          result.teamsApiBody = (await teamsRes.text()).substring(0, 300);
        }
      } catch (error) {
        result.teamsApiError =
          error instanceof Error ? error.message : String(error);
      }

      for (const view of ["account", "team"]) {
        try {
          const cfgRes = await fetchWithTimeout(
            `https://api.vercel.com/v1/integrations/configurations?view=${view}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          result[`configurations_${view}_status`] = cfgRes.status;
          if (cfgRes.ok) {
            const cfgData = (await cfgRes.json()) as any;
            const configs = Array.isArray(cfgData)
              ? cfgData
              : cfgData.configurations || [];
            result[`configurations_${view}`] = configs.map(
              (config: {
                id?: string;
                teamId?: string;
                slug?: string;
                ownerId?: string;
              }) => ({
                id: config.id,
                teamId: config.teamId,
                slug: config.slug,
                ownerId: config.ownerId,
              }),
            );
          } else {
            result[`configurations_${view}_body`] = (
              await cfgRes.text()
            ).substring(0, 300);
          }
        } catch {
          // Best-effort probe, matching legacy diagnose.
        }
      }

      if (
        !teamId &&
        (accessToken.startsWith("vca_") || accessToken.startsWith("vci_"))
      ) {
        try {
          const probeRes = await fetchWithTimeout(
            "https://api.vercel.com/v1/projects?teamId=probe-detect-team&limit=1",
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          if (!probeRes.ok) {
            const probeBody = await probeRes.text();
            const teamMatch = probeBody.match(/"teamId"\s*:\s*"(team_[^"]+)"/);
            if (teamMatch) {
              result.detectedTeamId = teamMatch[1];
              try {
                const verifyRes = await fetchWithTimeout(
                  `https://api.vercel.com/v1/projects?teamId=${teamMatch[1]}&limit=3`,
                  { headers: { Authorization: `Bearer ${accessToken}` } },
                );
                result.detectedTeamProjectsStatus = verifyRes.status;
                if (verifyRes.ok) {
                  const verified = (await verifyRes.json()) as Record<
                    string,
                    any
                  >;
                  const projects = verified.projects || [];
                  result.detectedTeamProjectCount = projects.length;
                  result.detectedTeamProjectNames = projects.map(
                    (project: { name?: string }) => project.name,
                  );
                }
              } catch {
                // Best-effort verification.
              }
            }
          }
        } catch {
          // Best-effort probe.
        }
      }

      result.status =
        result.userApiStatus === 200 ? "token_valid" : "token_invalid";
      return json(result);
    }

    if (!data) {
      return json({
        status: "not_connected",
        detail: "No vault entry found for supabase",
      });
    }

    let rawDecrypted: string;
    try {
      rawDecrypted = decryptVaultValue(
        data.encrypted_token,
        data.iv,
        data.auth_tag,
      );
    } catch (error) {
      return json({
        status: "decrypt_error",
        detail: error instanceof Error ? error.message : "Decryption failed",
        connectedAt: data.connected_at,
      });
    }

    let accessToken = "";
    let hasRefreshToken = false;
    const parsed = parseRecord(rawDecrypted);
    if (parsed) {
      accessToken = stringValue(parsed.access_token) || "";
      hasRefreshToken = Boolean(parsed.refresh_token);
    } else {
      accessToken = rawDecrypted.trim();
    }

    if (!accessToken) {
      return json({
        status: "empty_token",
        detail: "access_token is empty",
        hasRefreshToken,
      });
    }

    const result: Record<string, unknown> = {
      status: "checking",
      displayName: data.display_name,
      connectedAt: data.connected_at,
      hasRefreshToken,
      tokenPrefix: `${accessToken.substring(0, 8)}...`,
      tokenLength: accessToken.length,
    };

    try {
      const response = await fetchWithTimeout(
        "https://api.supabase.com/v1/organizations",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      result.apiStatus = response.status;
      result.apiStatusText = response.statusText;
      if (response.ok) {
        const orgs = (await response.json()) as Array<Record<string, any>>;
        result.status = "valid";
        result.organizations = Array.isArray(orgs)
          ? orgs.map((org) => ({ id: org.id, name: org.name }))
          : [];
      } else {
        result.status = "api_error";
        result.apiBody = (await response.text()).substring(0, 500);
      }
    } catch (error) {
      result.status = "network_error";
      result.detail =
        error instanceof Error ? error.message : String(error);
    }

    if (result.status !== "valid" && hasRefreshToken) {
      try {
        const clientId = process.env.SUPABASE_OAUTH_CLIENT_ID;
        const clientSecret = process.env.SUPABASE_OAUTH_CLIENT_SECRET;
        if (clientId && clientSecret && parsed) {
          const refreshRes = await fetch(
            "https://api.supabase.com/v1/oauth/token",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: String(parsed.refresh_token || ""),
                client_id: clientId,
                client_secret: clientSecret,
              }),
            },
          );
          result.refreshStatus = refreshRes.status;
          result.refreshResponse = (await refreshRes.text()).substring(
            0,
            500,
          );
        } else {
          result.refreshStatus = "no_client_credentials";
        }
      } catch (error) {
        result.refreshStatus = "error";
        result.refreshDetail =
          error instanceof Error ? error.message : String(error);
      }
    }

    return json(result);
  },
});

const VERCEL_AUTH_URL = "https://vercel.com/oauth/authorize";
const VERCEL_MARKETPLACE_URL = "https://vercel.com/integrations";
const VERCEL_TOKEN_URL = "https://api.vercel.com/v2/oauth/access_token";
const VERCEL_STATE_COOKIE = "vercel_oauth_state";

function withCookie(
  response: Response,
  cookie: string,
): Response {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const oauthVercelHandler = responseHandler({
  GET: async (request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const siteUrl = publicSiteOrigin(url.origin);
    const redirectUri = `${siteUrl}/api/oauth/vercel`;

    if (!code) {
      const clientId = process.env.VERCEL_CLIENT_ID;
      if (!clientId) {
        return json({ error: "VERCEL_CLIENT_ID not configured" }, 500);
      }
      const userToken = url.searchParams.get("state") || "";
      const returnTo = safeReturnPath(url.searchParams.get("return"));
      const integrationSlug = process.env.VERCEL_INTEGRATION_SLUG;

      if (integrationSlug) {
        const stateValue = Buffer.from(
          JSON.stringify({ token: userToken, return: returnTo }),
        ).toString("base64url");
        const marketplaceUrl = new URL(
          `${VERCEL_MARKETPLACE_URL}/${integrationSlug}/new`,
        );
        marketplaceUrl.searchParams.set("state", stateValue);
        return withCookie(
          Response.redirect(marketplaceUrl.toString(), 307),
          `${VERCEL_STATE_COOKIE}=${stateValue}; Path=/api/oauth/vercel; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
        );
      }

      const codeVerifier = crypto.randomBytes(32).toString("base64url");
      const codeChallenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");
      const state = Buffer.from(
        JSON.stringify({
          token: userToken,
          verifier: codeVerifier,
          return: returnTo,
        }),
      ).toString("base64url");
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state,
      });
      return Response.redirect(
        `${VERCEL_AUTH_URL}?${params.toString()}`,
        307,
      );
    }

    try {
      const cookieHeader = request.headers.get("cookie") || "";
      const cookieMatch = cookieHeader.match(
        new RegExp(`(?:^|;\\s*)${VERCEL_STATE_COOKIE}=([^;]+)`),
      );
      const stateRaw =
        url.searchParams.get("state") ||
        (cookieMatch ? decodeURIComponent(cookieMatch[1]!) : "") ||
        "";
      let userToken = "";
      let codeVerifier = "";
      let returnTo = "/onboarding";
      const parsed = parseRecord(
        Buffer.from(stateRaw, "base64url").toString("utf8"),
      );
      if (!parsed) {
        return Response.redirect(`${siteUrl}/onboarding?error=invalid_state`, 307);
      }
      userToken = stringValue(parsed.token) || "";
      codeVerifier = stringValue(parsed.verifier) || "";
      returnTo = safeReturnPath(stringValue(parsed.return));

      const clientId = process.env.VERCEL_CLIENT_ID!;
      const clientSecret = process.env.VERCEL_CLIENT_SECRET!;
      const isMarketplaceFlow = !codeVerifier;
      const tokenBody: Record<string, string> = {
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      };
      if (!isMarketplaceFlow) tokenBody.code_verifier = codeVerifier;

      const tokenRes = await fetchWithTimeout(VERCEL_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(tokenBody),
      });
      const tokenData = (await tokenRes.json()) as Record<string, any>;
      if (tokenData.error) {
        const detail =
          typeof tokenData.error_description === "string"
            ? tokenData.error_description
            : JSON.stringify(tokenData.error);
        return withCookie(
          Response.redirect(
            `${siteUrl}${appendQuery(returnTo, {
              error: "vercel_auth_failed",
              detail,
            })}`,
            307,
          ),
          `${VERCEL_STATE_COOKIE}=; Path=/api/oauth/vercel; Max-Age=0`,
        );
      }

      const accessToken = stringValue(tokenData.access_token);
      if (!accessToken) {
        return withCookie(
          Response.redirect(
            `${siteUrl}${appendQuery(returnTo, {
              error: "vercel_auth_failed",
              detail: "Missing access token",
            })}`,
            307,
          ),
          `${VERCEL_STATE_COOKIE}=; Path=/api/oauth/vercel; Max-Age=0`,
        );
      }

      let teamId =
        stringValue(tokenData.team_id) ||
        url.searchParams.get("teamId") ||
        null;

      if (!teamId) {
        try {
          const teamsRes = await fetchWithTimeout(
            "https://api.vercel.com/v2/teams",
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          if (teamsRes.ok) {
            const teamsData = (await teamsRes.json()) as Record<string, any>;
            const teams = teamsData.teams || [];
            if (teams.length > 0) teamId = teams[0].id ?? null;
          }
        } catch {
          // Best-effort team recovery.
        }

        if (
          !teamId &&
          (accessToken.startsWith("vca_") || accessToken.startsWith("vci_"))
        ) {
          try {
            const probeRes = await fetchWithTimeout(
              "https://api.vercel.com/v1/projects?teamId=probe-detect-team&limit=1",
              { headers: { Authorization: `Bearer ${accessToken}` } },
            );
            if (!probeRes.ok) {
              const probeBody = await probeRes.text();
              const teamMatch = probeBody.match(
                /"teamId"\s*:\s*"(team_[^"]+)"/,
              );
              if (teamMatch) {
                const candidate = teamMatch[1]!;
                const verifyRes = await fetchWithTimeout(
                  `https://api.vercel.com/v1/projects?teamId=${candidate}&limit=1`,
                  { headers: { Authorization: `Bearer ${accessToken}` } },
                );
                if (verifyRes.ok) teamId = candidate;
              }
            }
          } catch {
            // Best-effort probe.
          }
        }
      }

      if (accessToken) {
        const validateUrl = teamId
          ? `https://api.vercel.com/v1/projects?teamId=${teamId}&limit=1`
          : "https://api.vercel.com/v1/projects?limit=1";
        try {
          const validateRes = await fetchWithTimeout(validateUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!validateRes.ok) {
            const validateBody = await validateRes.text();
            if (
              validateBody.includes('"scope"') &&
              validateBody.includes('"personal"')
            ) {
              const teamHint = validateBody.match(
                /"teamId"\s*:\s*"(team_[^"]+)"/,
              )?.[1];
              const detail = teamHint
                ? `Token is scoped to "personal" but your projects are under team ${teamHint}. Go to vercel.com/account/integrations, remove this integration, then re-add it and select your team (not "Personal Account") during installation.`
                : `Token is scoped to "personal" and cannot access resources. Go to vercel.com/account/integrations, remove this integration, then re-add it and select a team during installation.`;
              return withCookie(
                Response.redirect(
                  `${siteUrl}${appendQuery(returnTo, {
                    error: "vercel_auth_failed",
                    detail,
                  })}`,
                  307,
                ),
                `${VERCEL_STATE_COOKIE}=; Path=/api/oauth/vercel; Max-Age=0`,
              );
            }
            if (validateRes.status === 403 || validateRes.status === 401) {
              return withCookie(
                Response.redirect(
                  `${siteUrl}${appendQuery(returnTo, {
                    error: "vercel_auth_failed",
                    detail: `Token cannot access Vercel (${validateRes.status}). Try removing the integration from vercel.com/account/integrations and re-connecting.`,
                  })}`,
                  307,
                ),
                `${VERCEL_STATE_COOKIE}=; Path=/api/oauth/vercel; Max-Age=0`,
              );
            }
          }
        } catch {
          // Network validation failures are non-fatal, matching legacy.
        }
      }

      if (!userToken) {
        return withCookie(
          Response.redirect(
            `${siteUrl}${appendQuery(returnTo, { error: "missing_session" })}`,
            307,
          ),
          `${VERCEL_STATE_COOKIE}=; Path=/api/oauth/vercel; Max-Age=0`,
        );
      }

      const supabase = authedSupabase(userToken);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return withCookie(
          Response.redirect(
            `${siteUrl}${appendQuery(returnTo, { error: "invalid_session" })}`,
            307,
          ),
          `${VERCEL_STATE_COOKIE}=; Path=/api/oauth/vercel; Max-Age=0`,
        );
      }

      const encrypted = encryptVaultValue(
        JSON.stringify({
          access_token: accessToken,
          refresh_token: tokenData.refresh_token || "",
          team_id: teamId,
        }),
      );
      const { error: upsertError } = await supabase.from("vault_entries").upsert(
        {
          user_id: user.id,
          platform: "vercel",
          encrypted_token: encrypted.ciphertext,
          iv: encrypted.iv,
          auth_tag: encrypted.tag,
          display_name: teamId ? `Team ${teamId}` : "Personal",
          scopes: ["project"],
          connected_at: new Date().toISOString(),
        },
        { onConflict: "user_id,platform" },
      );
      if (upsertError) {
        return withCookie(
          Response.redirect(
            `${siteUrl}${appendQuery(returnTo, {
              error: "vercel_auth_failed",
              detail: upsertError.message,
            })}`,
            307,
          ),
          `${VERCEL_STATE_COOKIE}=; Path=/api/oauth/vercel; Max-Age=0`,
        );
      }

      return withCookie(
        Response.redirect(
          `${siteUrl}${appendQuery(
            returnTo,
            returnTo === "/onboarding"
              ? { step: "4", vercel: "connected" }
              : { vercel: "connected" },
          )}`,
          307,
        ),
        `${VERCEL_STATE_COOKIE}=; Path=/api/oauth/vercel; Max-Age=0`,
      );
    } catch (error) {
      let errReturnTo = "/onboarding";
      try {
        const cookieHeader = request.headers.get("cookie") || "";
        const cookieMatch = cookieHeader.match(
          new RegExp(`(?:^|;\\s*)${VERCEL_STATE_COOKIE}=([^;]+)`),
        );
        const stateRaw =
          url.searchParams.get("state") ||
          (cookieMatch ? decodeURIComponent(cookieMatch[1]!) : "") ||
          "";
        const parsed = parseRecord(
          Buffer.from(stateRaw, "base64url").toString("utf8"),
        );
        errReturnTo = safeReturnPath(stringValue(parsed?.return));
      } catch {
        // Keep default return path.
      }
      return withCookie(
        Response.redirect(
          `${siteUrl}${appendQuery(errReturnTo, {
            error: "vercel_auth_failed",
            detail: errorMessage(error, "Vercel authentication failed"),
          })}`,
          307,
        ),
        `${VERCEL_STATE_COOKIE}=; Path=/api/oauth/vercel; Max-Age=0`,
      );
    }
  },
});

const BRAINSTORM_SYSTEM_PROMPT = `You are a creative brand-naming assistant that suggests short, memorable domain names.

Rules:
- Output ONLY a JSON object shaped like: {"domains": ["name1", "name2", ...]}
- Each name is the base label only, WITHOUT any TLD (no .com, no .io).
- Each name is lowercase ASCII letters and digits only — no spaces, hyphens, accents, or symbols.
- Keep each name between 4 and 18 characters.
- Produce a wide variety: compounds, portmanteaus, alliterations, evocative single words.
- If the user supplied a "must contain" keyword, every single suggestion MUST include it as a substring.`;

async function generateDomainCandidates(
  userPrompt: string,
  mustContain: string | undefined,
  targetCount: number,
): Promise<string[]> {
  const userMessage =
    `Suggest exactly ${targetCount} domain name labels based on this description:\n\n` +
    `"${userPrompt.trim()}"` +
    (mustContain
      ? `\n\nEvery suggestion MUST contain the substring "${mustContain.toLowerCase()}".`
      : "");
  const content = await chatComplete(
    [
      { role: "system", content: BRAINSTORM_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    {
      responseFormat: "json_object",
      temperature: 0.9,
      maxTokens: 800,
    },
  );
  let parsed: { domains?: unknown };
  try {
    parsed = parseJsonResponse<{ domains?: unknown }>(content);
  } catch {
    throw new Error(
      "OpenAI returned a non-JSON response. Try again or rephrase the prompt.",
    );
  }
  if (!Array.isArray(parsed.domains)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parsed.domains) {
    if (typeof raw !== "string") continue;
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (cleaned.length < 3 || cleaned.length > 30) continue;
    if (mustContain && !cleaned.includes(mustContain.toLowerCase())) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

async function runInBatches<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    out.push(...(await Promise.all(batch.map(fn))));
  }
  return out;
}

const domainBrainstormHandler = responseHandler({
  POST: async (request) => {
    const auth = await authenticated(request);
    if (!auth.ok) return auth.response;

    let body: {
      prompt?: string;
      tlds?: string[];
      limit?: number;
      mustContain?: string;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      return json(
        {
          error:
            "prompt is required (e.g. 'fashion brand with the word fancy')",
        },
        400,
      );
    }

    const tlds = (body.tlds && body.tlds.length ? body.tlds : ["com"])
      .map((tld) => tld.replace(/^\./, "").toLowerCase().trim())
      .filter(Boolean);
    if (tlds.length === 0) {
      return json({ error: "at least one TLD is required" }, 400);
    }

    const limit = Math.max(5, Math.min(body.limit || 20, 30));
    const mustContain = body.mustContain
      ? body.mustContain.replace(/[^a-z0-9]/gi, "").toLowerCase()
      : undefined;

    const { data: vault } = await auth.supabase
      .from("vault_entries")
      .select("encrypted_token, iv, auth_tag")
      .eq("user_id", auth.user.id)
      .eq("platform", "cloudflare")
      .single();
    if (!vault) {
      return json(
        { error: "Connect Cloudflare first", missingPlatform: "cloudflare" },
        400,
      );
    }

    let cfToken: string;
    try {
      const raw = decryptVaultValue(
        vault.encrypted_token,
        vault.iv,
        vault.auth_tag,
      );
      cfToken = stringValue(parseRecord(raw)?.api_token) || raw;
    } catch {
      return json({ error: "Failed to decrypt Cloudflare token" }, 500);
    }

    let accountId: string;
    try {
      accountId = await cloudflareAccountId(cfToken);
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Cloudflare account lookup failed",
        },
        500,
      );
    }

    const overshoot = Math.min(30, Math.ceil(limit * 1.5));
    let names: string[];
    try {
      names = await generateDomainCandidates(prompt, mustContain, overshoot);
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error ? error.message : "LLM generation failed",
        },
        502,
      );
    }

    if (names.length === 0) {
      return json({
        results: [],
        sources: [],
        note: "The model returned no usable suggestions. Try rephrasing the prompt.",
      });
    }

    const candidates = names
      .slice(0, limit)
      .flatMap((name) => tlds.map((tld) => `${name}.${tld}`));

    let cfSuggestions: string[] = [];
    try {
      const cfQuery =
        mustContain ||
        prompt
          .split(/\s+/)
          .filter((word) => word.length >= 3)
          .slice(0, 3)
          .join(" ");
      if (cfQuery) {
        const suggestions = await cloudflareSearchDomains(
          cfToken,
          accountId,
          cfQuery,
          10,
        );
        cfSuggestions = suggestions
          .map((suggestion) => suggestion.domain_name.toLowerCase())
          .filter((domain) => {
            const [label, tld] = domain.split(".");
            return (
              tlds.includes(tld!) &&
              (!mustContain || label?.includes(mustContain))
            );
          });
      }
    } catch {
      // Non-fatal Cloudflare suggestion fan-out.
    }

    const allDomains = Array.from(new Set([...candidates, ...cfSuggestions]));
    const checks = await runInBatches(allDomains, 6, async (domain) => {
      try {
        const result = await cloudflareCheckDomain(cfToken, accountId, domain);
        return { domain, result, error: null as string | null };
      } catch (error) {
        return {
          domain,
          result: null,
          error: error instanceof Error ? error.message : "check failed",
        };
      }
    });

    const results = checks
      .map((check) => ({
        domain: check.domain,
        available: check.result?.available ?? false,
        canRegister: check.result?.can_register ?? false,
        tier: check.result?.tier ?? null,
        registrationFee: check.result?.price?.registration_fee ?? null,
        renewalFee: check.result?.price?.renewal_fee ?? null,
        currency: check.result?.price?.currency ?? null,
        reason: check.result?.reason || check.error,
        source: (candidates.includes(check.domain)
          ? "llm"
          : "cloudflare") as "llm" | "cloudflare",
      }))
      .sort((a, b) => {
        if (a.canRegister !== b.canRegister) return a.canRegister ? -1 : 1;
        if (a.available !== b.available) return a.available ? -1 : 1;
        const pa = a.registrationFee ?? Number.POSITIVE_INFINITY;
        const pb = b.registrationFee ?? Number.POSITIVE_INFINITY;
        if (pa !== pb) return pa - pb;
        return a.domain.localeCompare(b.domain);
      });

    return json({
      results,
      generated: names.length,
      checked: results.length,
    });
  },
});

export const PROVIDER_WEBSITE_HANDLERS: Readonly<
  Record<string, PluginRouteHandler>
> = Object.freeze({
  "/api/domain/brainstorm": domainBrainstormHandler,
  "/api/domain/purchase": domainPurchaseHandler,
  "/api/domain/search": domainSearchHandler,
  "/api/github/repos": githubReposHandler,
  "/api/oauth/aliyun": oauthAliyunHandler,
  "/api/oauth/cloudflare": oauthCloudflareHandler,
  "/api/oauth/github": oauthGithubHandler,
  "/api/oauth/railway": oauthRailwayHandler,
  "/api/oauth/supabase": oauthSupabaseHandler,
  "/api/oauth/vercel": oauthVercelHandler,
  "/api/vault": vaultHandler,
  "/api/vault/diagnose": vaultDiagnoseHandler,
  "/api/vercel/projects": vercelProjectsHandler,
});
