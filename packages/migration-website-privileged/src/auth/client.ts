"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  cookieOptions,
  configured,
} from "./config";

// Browser Supabase client for the OceanLeo shared identity. Stores the auth
// session in a cookie scoped to .oceanleo.com (NOT localStorage), so a login on
// ANY *.oceanleo.com subdomain is instantly recognized on every other one.

let _client: SupabaseClient | null = null;

export function browserClient(): SupabaseClient | null {
  if (!configured()) return null;
  if (_client) return _client;
  const host = typeof window !== "undefined" ? window.location.host : "";
  _client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: cookieOptions(host),
  });
  return _client;
}

export { configured as oceanleoConfigured };

export async function accessToken(): Promise<string | null> {
  const c = browserClient();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function isSignedIn(): Promise<boolean> {
  return Boolean(await accessToken());
}

export async function signOutEverywhere(): Promise<void> {
  const c = browserClient();
  // `global` scope revokes the refresh token server-side; the shared cookie is
  // cleared with the same cookieOptions used to set it, so all *.oceanleo.com
  // sites see the logout.
  await c?.auth.signOut({ scope: "global" });
}
