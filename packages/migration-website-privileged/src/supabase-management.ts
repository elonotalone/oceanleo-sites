import { fetchWithTimeout } from "./runtime";

const SUPABASE_API = "https://api.supabase.com/v1";
const SUPABASE_TOKEN_URL = "https://api.supabase.com/v1/oauth/token";

export interface SupabaseProjectResult {
  projectRef: string;
  anonKey: string;
  serviceRoleKey: string;
  url: string;
  dbHost: string;
}

export interface SupabaseRefreshedTokens {
  access_token: string;
  refresh_token: string;
}

export async function refreshSupabaseAccessToken(
  refreshToken: string,
): Promise<SupabaseRefreshedTokens> {
  const clientId = process.env.SUPABASE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.SUPABASE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("SUPABASE_OAUTH_CLIENT_ID / CLIENT_SECRET not configured");
  }

  const response = await fetch(SUPABASE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Supabase token refresh failed (${response.status}): ${body}`,
    );
  }

  const data = (await response.json()) as Record<string, any>;
  if (!data.access_token) {
    throw new Error("Supabase token refresh returned no access_token");
  }

  return {
    access_token: data.access_token as string,
    refresh_token: (data.refresh_token as string) || refreshToken,
  };
}

export async function listOrganizations(
  token: string,
): Promise<{ id: string; name: string }[]> {
  const response = await fetchWithTimeout(`${SUPABASE_API}/organizations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Supabase token is invalid or lacks permissions. Re-connect Supabase.",
      );
    }
    throw new Error(`Supabase list orgs failed: ${response.status}`);
  }
  return (await response.json()) as { id: string; name: string }[];
}

export async function createSupabaseProject(
  token: string,
  name: string,
  organizationId: string,
  region = "us-east-1",
  dbPass: string,
): Promise<SupabaseProjectResult> {
  const response = await fetchWithTimeout(`${SUPABASE_API}/projects`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      organization_id: organizationId,
      region,
      db_pass: dbPass,
      plan: "free",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(
      `Supabase create project failed (${response.status}): ${err}`,
    );
  }

  const data = (await response.json()) as Record<string, any>;
  return {
    projectRef: data.id,
    anonKey: "",
    serviceRoleKey: "",
    url: `https://${data.id}.supabase.co`,
    dbHost: data.database?.host || "",
  };
}

export async function waitForProjectReady(
  token: string,
  projectRef: string,
  maxWaitMs = 120_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const response = await fetchWithTimeout(
      `${SUPABASE_API}/projects/${projectRef}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (response.ok) {
      const data = (await response.json()) as Record<string, any>;
      if (data.status === "ACTIVE_HEALTHY") return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("Supabase project did not become ready in time");
}

export async function getProjectApiKeys(
  token: string,
  projectRef: string,
): Promise<{ anonKey: string; serviceRoleKey: string }> {
  const response = await fetchWithTimeout(
    `${SUPABASE_API}/projects/${projectRef}/api-keys`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(`Failed to get API keys: ${response.status}`);
  }
  const keys = (await response.json()) as Array<{
    name?: string;
    api_key?: string;
  }>;
  const anon = keys.find((key) => key.name === "anon");
  const service = keys.find((key) => key.name === "service_role");
  return {
    anonKey: anon?.api_key || "",
    serviceRoleKey: service?.api_key || "",
  };
}

export async function executeSQL(
  token: string,
  projectRef: string,
  sql: string,
): Promise<void> {
  const response = await fetchWithTimeout(
    `${SUPABASE_API}/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(
      `Supabase SQL execution failed (${response.status}): ${err}`,
    );
  }
}

export function getDefaultInitSQL(): string {
  return `
    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      first_name TEXT,
      last_name TEXT,
      avatar_url TEXT,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users manage own profile'
      ) THEN
        CREATE POLICY "Users manage own profile" ON public.profiles
          FOR ALL USING (auth.uid() = id)
          WITH CHECK (auth.uid() = id);
      END IF;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Admins read all profiles'
      ) THEN
        CREATE POLICY "Admins read all profiles" ON public.profiles
          FOR SELECT USING (
            EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = TRUE)
          );
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS public.agent_tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CREATING',
      model TEXT,
      branch TEXT,
      pr_url TEXT,
      summary TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_agent_tasks_user ON agent_tasks(user_id);

    ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'agent_tasks' AND policyname = 'Users manage own tasks'
      ) THEN
        CREATE POLICY "Users manage own tasks" ON public.agent_tasks
          FOR ALL USING (auth.uid() = user_id)
          WITH CHECK (auth.uid() = user_id);
      END IF;
    END $$;

    CREATE OR REPLACE FUNCTION public.handle_new_user()
    RETURNS trigger AS $$
    DECLARE
      user_count INTEGER;
    BEGIN
      SELECT COUNT(*) INTO user_count FROM public.profiles;
      INSERT INTO public.profiles (id, first_name, avatar_url, is_admin)
      VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', ''),
        CASE WHEN user_count = 0 THEN TRUE ELSE FALSE END
      )
      ON CONFLICT (id) DO NOTHING;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;

    DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  `;
}
