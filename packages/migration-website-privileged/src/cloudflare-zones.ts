import { fetchWithTimeout, parseRecord, record, stringValue } from "./runtime";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
}

export interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
}

async function cloudflareJson<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchWithTimeout(`${CLOUDFLARE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
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
      `Cloudflare ${init.method || "GET"} ${path} failed (${response.status}): ${errors}`,
    );
  }
  return data.result as T;
}

export async function listZones(
  token: string,
  domainName?: string,
): Promise<CloudflareZone[]> {
  const query = domainName
    ? `?name=${encodeURIComponent(domainName)}`
    : "";
  const result = await cloudflareJson<CloudflareZone[]>(
    token,
    `/zones${query}`,
  );
  return Array.isArray(result) ? result : [];
}

export async function getZoneForDomain(
  token: string,
  domain: string,
): Promise<CloudflareZone> {
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join(".");
    const zones = await listZones(token, candidate);
    if (zones.length > 0) return zones[0]!;
  }
  throw new Error(
    `No Cloudflare zone found for "${domain}". Add the domain to your Cloudflare account first.`,
  );
}

export async function listDnsRecords(
  token: string,
  zoneId: string,
  name?: string,
): Promise<CloudflareDnsRecord[]> {
  const query = name ? `?name=${encodeURIComponent(name)}` : "";
  const result = await cloudflareJson<CloudflareDnsRecord[]>(
    token,
    `/zones/${zoneId}/dns_records${query}`,
  );
  return Array.isArray(result) ? result : [];
}

export async function createDnsRecord(
  token: string,
  zoneId: string,
  dnsRecord: {
    type: string;
    name: string;
    content: string;
    proxied?: boolean;
    ttl?: number;
  },
): Promise<CloudflareDnsRecord> {
  return cloudflareJson<CloudflareDnsRecord>(
    token,
    `/zones/${zoneId}/dns_records`,
    {
      method: "POST",
      body: JSON.stringify({
        type: dnsRecord.type,
        name: dnsRecord.name,
        content: dnsRecord.content,
        proxied: dnsRecord.proxied ?? false,
        ttl: dnsRecord.ttl ?? 1,
      }),
    },
  );
}

export async function deleteDnsRecord(
  token: string,
  zoneId: string,
  recordId: string,
): Promise<void> {
  const response = await fetchWithTimeout(
    `${CLOUDFLARE_API}/zones/${zoneId}/dns_records/${recordId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    throw new Error(
      `Cloudflare DELETE dns_records failed (${response.status}): ${body.slice(0, 300)}`,
    );
  }
}

export async function upsertVercelDnsRecord(
  token: string,
  zoneId: string,
  domain: string,
  zoneName: string,
): Promise<CloudflareDnsRecord> {
  const existing = await listDnsRecords(token, zoneId, domain);
  for (const dns of existing) {
    if (dns.type === "A" || dns.type === "AAAA" || dns.type === "CNAME") {
      await deleteDnsRecord(token, zoneId, dns.id);
    }
  }
  if (domain === zoneName) {
    return createDnsRecord(token, zoneId, {
      type: "A",
      name: "@",
      content: "76.76.21.21",
      proxied: false,
    });
  }
  const recordName = domain.replace(`.${zoneName}`, "");
  return createDnsRecord(token, zoneId, {
    type: "CNAME",
    name: recordName,
    content: "cname.vercel-dns.com",
    proxied: false,
  });
}

export class DnsZoneNotFoundError extends Error {
  readonly domain: string;

  constructor(domain: string) {
    super(`No Cloudflare zone found for "${domain}"`);
    this.name = "DnsZoneNotFoundError";
    this.domain = domain;
  }
}

export async function getAccountId(token: string): Promise<string> {
  const result = await cloudflareJson<Array<{ id?: string }>>(
    token,
    "/accounts?per_page=1",
  );
  const id = Array.isArray(result) ? stringValue(result[0]?.id) : undefined;
  if (!id) throw new Error("No Cloudflare accounts found for this token");
  return id;
}

export async function createZone(
  token: string,
  accountId: string,
  domainName: string,
): Promise<CloudflareZone> {
  const existing = await listZones(token, domainName);
  if (existing.length > 0) return existing[0]!;
  return cloudflareJson<CloudflareZone>(token, "/zones", {
    method: "POST",
    body: JSON.stringify({
      name: domainName,
      account: { id: accountId },
      type: "full",
    }),
  });
}

export async function waitForZoneActive(
  token: string,
  zoneId: string,
  maxWaitMs = 3 * 60 * 1000,
  intervalMs = 5000,
): Promise<CloudflareZone> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const zone = await cloudflareJson<CloudflareZone>(
      token,
      `/zones/${zoneId}`,
    );
    if (zone.status === "active") return zone;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return cloudflareJson<CloudflareZone>(token, `/zones/${zoneId}`);
}

export interface DomainAvailability {
  domain_name: string;
  available: boolean;
  can_register: boolean;
  reason?: string;
}

export async function checkDomainAvailability(
  token: string,
  accountId: string,
  domain: string,
): Promise<DomainAvailability> {
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
  if (!first) {
    return {
      domain_name: domain,
      available: false,
      can_register: false,
      reason: "no_result",
    };
  }
  return {
    domain_name: stringValue(first.name) || domain,
    available: first.registrable === true,
    can_register: first.registrable === true && first.tier !== "premium",
    reason: stringValue(first.reason),
  };
}

export async function registerDomain(
  token: string,
  accountId: string,
  domainName: string,
  years = 1,
  autoRenew = false,
): Promise<{ status: string; completed: boolean }> {
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
    status: state,
    completed: result.completed === true || state === "succeeded",
  };
}

export async function getZoneForDomainOrThrow(
  token: string,
  domain: string,
): Promise<CloudflareZone> {
  try {
    return await getZoneForDomain(token, domain);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/No Cloudflare zone found/i.test(message)) {
      throw new DnsZoneNotFoundError(domain);
    }
    throw error;
  }
}
