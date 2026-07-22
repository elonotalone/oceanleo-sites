// OceanLeo shared identity — single source of cookie/SSO configuration.
//
// CRITICAL: browser client, server client, AND middleware must all use the
// SAME cookieOptions, or sessions split-brain (one path sets a cookie scoped
// to .oceanleo.com, another sets a host-only cookie, and they fight). This
// module is that single source. See
// docs/architecture/oceanleo-cross-subdomain-sso.md (oceandino repo).

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_OCEANLEO_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_OCEANLEO_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";

export const GATEWAY_BASE =
  process.env.NEXT_PUBLIC_OCEANLEO_GATEWAY_URL ||
  process.env.NEXT_PUBLIC_GATEWAY_URL ||
  "https://api.oceanleo.com";

// The parent domain that all *.oceanleo.com subdomains share. Setting the auth
// cookie's Domain to this makes one login on ANY subdomain visible to ALL of
// them — the whole point of the OceanLeo "全家桶" SSO. Leave empty in local dev
// (host-only cookie) so localhost works without a real parent domain.
const RAW_COOKIE_DOMAIN = (
  process.env.NEXT_PUBLIC_OCEANLEO_COOKIE_DOMAIN || ".oceanleo.com"
).trim();

// Only apply a cross-subdomain Domain on real oceanleo.com hosts. On localhost
// / vercel preview hosts we must NOT send Domain=.oceanleo.com (the browser
// would silently drop the cookie), so we fall back to host-only there.
export function cookieDomainFor(host: string | null | undefined): string | undefined {
  const h = (host || "").split(":")[0].toLowerCase();
  if (!RAW_COOKIE_DOMAIN) return undefined;
  if (h.endsWith("oceanleo.com")) return RAW_COOKIE_DOMAIN;
  return undefined; // localhost, *.vercel.app, etc → host-only cookie
}

// Shared cookie options. `domain` is filled in per-request from the Host header
// (server/middleware) or window.location.host (browser).
export function cookieOptions(host: string | null | undefined) {
  const domain = cookieDomainFor(host);
  return {
    ...(domain ? { domain } : {}),
    path: "/",
    sameSite: "lax" as const,
    secure: true,
  };
}

export function configured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
