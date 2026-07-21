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
