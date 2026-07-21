/** Byte-stable SQL bootstrap copied from website:front/app/api/setup/init-db/route.ts */

export const MIGRATION_SQL = `
-- templates (must exist before deployed_sites due to FK)
CREATE TABLE IF NOT EXISTS public.templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name_zh TEXT NOT NULL DEFAULT '',
  name_en TEXT NOT NULL DEFAULT '',
  description_zh TEXT,
  description_en TEXT,
  thumbnail_url TEXT,
  github_template_owner TEXT NOT NULL DEFAULT 'website',
  github_template_repo TEXT NOT NULL DEFAULT 'template-default',
  framework TEXT NOT NULL DEFAULT 'nextjs',
  supports_backend BOOLEAN DEFAULT false,
  required_platforms TEXT[] NOT NULL DEFAULT '{"github","vercel","supabase"}',
  optional_platforms TEXT[],
  init_sql TEXT,
  env_vars JSONB,
  is_free BOOLEAN NOT NULL DEFAULT true,
  price_cents INTEGER DEFAULT 0,
  files_to_remove TEXT[],
  version TEXT DEFAULT '1.0.0',
  sort_order INTEGER DEFAULT 0,
  is_published BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'templates' AND policyname = 'Anyone can read published templates'
  ) THEN
    CREATE POLICY "Anyone can read published templates" ON public.templates
      FOR SELECT USING (is_published = true);
  END IF;
END $$;

-- Allow the hardcoded admin account to manage the public template library.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'templates' AND policyname = 'Admin manages templates'
  ) THEN
    CREATE POLICY "Admin manages templates" ON public.templates
      FOR ALL
      USING (auth.jwt() ->> 'email' = 'elonlee63@gmail.com')
      WITH CHECK (auth.jwt() ->> 'email' = 'elonlee63@gmail.com');
  END IF;
END $$;

-- deployed_sites
CREATE TABLE IF NOT EXISTS public.deployed_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  template_id UUID REFERENCES public.templates(id),
  deploy_mode TEXT NOT NULL DEFAULT 'vercel_only',
  status TEXT NOT NULL DEFAULT 'deploying',
  github_repo TEXT,
  github_repo_url TEXT,
  vercel_project_id TEXT,
  vercel_project_url TEXT,
  site_url TEXT,
  custom_domain TEXT,
  custom_domain_status TEXT DEFAULT 'none',
  supabase_project_ref TEXT,
  supabase_project_url TEXT,
  backend_provider TEXT,
  backend_project_id TEXT,
  backend_url TEXT,
  backend_status TEXT DEFAULT 'none',
  deploy_log JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_deployed_sites_user ON deployed_sites(user_id);
CREATE INDEX IF NOT EXISTS idx_deployed_sites_status ON deployed_sites(status);

ALTER TABLE public.deployed_sites ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'deployed_sites' AND policyname = 'Users manage own sites'
  ) THEN
    CREATE POLICY "Users manage own sites" ON public.deployed_sites
      FOR ALL USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- server_connections (SSH access to user servers)
CREATE TABLE IF NOT EXISTS public.server_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID REFERENCES public.deployed_sites(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  username TEXT NOT NULL DEFAULT 'root',
  auth_type TEXT NOT NULL DEFAULT 'key',
  encrypted_credentials TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  last_connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_server_connections_user ON server_connections(user_id);

ALTER TABLE public.server_connections ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'server_connections' AND policyname = 'Users manage own servers'
  ) THEN
    CREATE POLICY "Users manage own servers" ON public.server_connections
      FOR ALL USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Add server-related columns to deployed_sites
ALTER TABLE public.deployed_sites ADD COLUMN IF NOT EXISTS server_connection_id UUID REFERENCES public.server_connections(id);
ALTER TABLE public.deployed_sites ADD COLUMN IF NOT EXISTS backend_port INTEGER;
ALTER TABLE public.deployed_sites ADD COLUMN IF NOT EXISTS webhook_secret TEXT;
-- Human-readable error for the last failed backend deploy (nullable when healthy)
ALTER TABLE public.deployed_sites ADD COLUMN IF NOT EXISTS backend_deploy_error TEXT;
-- Step-by-step log for the last backend deploy (array of DeploymentStep objects).
-- Same shape as deploy_log — drives the progress bar on the site detail page.
ALTER TABLE public.deployed_sites ADD COLUMN IF NOT EXISTS backend_deploy_log JSONB DEFAULT '[]'::jsonb;
-- One-click offline: set when the user pauses the site by tearing down DNS.
-- The deployed_sites.status value flips between 'live' and 'paused';
-- paused_at gives the UI and any billing/alerts a reliable timestamp.
ALTER TABLE public.deployed_sites ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;

-- Origin of the site: 'template' (created via Mycreator's template pipeline),
-- 'imported_vercel' (adopted from an already-deployed Vercel project), or
-- 'imported_github' (adopted from an existing GitHub repo, possibly with
-- Mycreator triggering the first Vercel deploy). Used by the UI to gate
-- capabilities and by analytics to distinguish the flow the site came from.
ALTER TABLE public.deployed_sites ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'template';

-- Per-site capability flags: { vibe_code, env_edit, toggle_dns, domain }.
-- Vibe-coding is only safe on repos that follow the template contract; for
-- imported repos we default it off. The UI respects this flag verbatim.
ALTER TABLE public.deployed_sites ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '{}'::jsonb;

-- DNS provider for the custom domain: 'cloudflare' (default/only supported
-- today) or 'external' (user manages DNS themselves; one-click offline is
-- disabled for those). Leaves room for future provider implementations
-- without schema churn.
ALTER TABLE public.deployed_sites ADD COLUMN IF NOT EXISTS dns_provider TEXT NOT NULL DEFAULT 'cloudflare';

-- Most-recent toggle error message (nullable when healthy). Populated when
-- /api/sites/[id]/toggle fails mid-way so the UI can display a compensation
-- banner instead of leaving the user guessing.
ALTER TABLE public.deployed_sites ADD COLUMN IF NOT EXISTS toggle_error TEXT;

-- user_templates: each row is a user's personal, editable template
-- (based on a public template, with overrides stored as JSONB so "change a
-- heading" becomes a ~1KB DB write, no rebuild required).
CREATE TABLE IF NOT EXISTS public.user_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  base_template_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot_ref TEXT,
  published_template_slug TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_templates_user ON user_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_user_templates_updated ON user_templates(updated_at DESC);

ALTER TABLE public.user_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_templates' AND policyname = 'Users manage own templates'
  ) THEN
    CREATE POLICY "Users manage own templates" ON public.user_templates
      FOR ALL USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Add slots column to templates so each public template declares which
-- elements can be overridden inline (text/color/image).
ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS slots JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS default_overrides JSONB DEFAULT '{}'::jsonb;

-- Admin-authored templates carry the prompt used to (re)generate the
-- code plus a structured spec JSON the admin edited before kicking off
-- code generation. "repo_full_name" and "repo_visibility" point at the
-- GitHub repo that holds the generated code, so publishing the template
-- just flips visibility.
ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS build_prompt TEXT;
ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS spec_json JSONB;
ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS repo_full_name TEXT;
ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS repo_visibility TEXT DEFAULT 'private';
ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS generation_status TEXT DEFAULT 'idle';
ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS generation_log TEXT;
ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS generated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Continuous editing: each deployed_site can link back to the user_template
-- whose overrides it was deployed with. We also remember what overrides we
-- actually baked into the repo, so a later "push edits to live site" action
-- knows how to diff old -> new and perform literal text replacement.
ALTER TABLE public.deployed_sites ADD COLUMN IF NOT EXISTS user_template_id UUID REFERENCES public.user_templates(id) ON DELETE SET NULL;
ALTER TABLE public.deployed_sites ADD COLUMN IF NOT EXISTS applied_overrides JSONB DEFAULT '{}'::jsonb;

-- Platform hosting (宗旨 v21, 2026-07-09): where the site actually lives.
--   'platform'      — hosted on OUR ECS box, served at <slug>.oceanleo.app
--                     from /opt/oceanleo-sites/<slug> via the wildcard Caddy.
--                     This is the NEW default for freshly created sites and for
--                     the 'upload_files' import path.
--   'remote_server' — files live on the USER's own server; we only connect via
--                     SSH (server_connection_id). Used by 'remote_server' import.
--   'vercel'        — classic Vercel deploy (template pipeline / imported Vercel).
--   'external'      — user manages hosting entirely themselves.
-- Nullable so legacy rows (pre-v21) keep working; the sites API back-fills a
-- sensible value from deploy_mode/source when it's null.
ALTER TABLE public.deployed_sites ADD COLUMN IF NOT EXISTS hosting_mode TEXT;
-- For hosting_mode='platform': the assigned "<slug>.oceanleo.app" hostname and
-- the on-disk root we rsync/agent into. host_provider records which box
-- ('oceanleo-ecs' for the platform default; a server label for remote).
ALTER TABLE public.deployed_sites ADD COLUMN IF NOT EXISTS platform_subdomain TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS deployed_sites_platform_subdomain_unique
  ON public.deployed_sites (platform_subdomain)
  WHERE platform_subdomain IS NOT NULL;
ALTER TABLE public.deployed_sites ADD COLUMN IF NOT EXISTS platform_root TEXT;
ALTER TABLE public.deployed_sites ADD COLUMN IF NOT EXISTS host_provider TEXT;
-- Ledger of the last platform deploy / transfer-out (array of step objects,
-- same shape as deploy_log) so the site detail page can show progress.
ALTER TABLE public.deployed_sites ADD COLUMN IF NOT EXISTS platform_deploy_log JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.deployed_sites ADD COLUMN IF NOT EXISTS platform_deploy_error TEXT;

-- Visual site editor (/embed/site-editor, 2026-07-14): the editable
-- VirtualSiteConfig JSON for builder-generated sites. NULL for sites that
-- weren't created from the virtual-site builder (imported repos etc.), in
-- which case the visual editor shows an honest "not editable" placeholder.
ALTER TABLE public.deployed_sites ADD COLUMN IF NOT EXISTS virtual_site_config JSONB;

-- Promote snapshot_ref from TEXT to JSONB so we can store a structured
-- pointer (type, owner, repo, ref, capturedAt, capturedFromSiteId) rather
-- than a stringly-typed blob. Safe when the existing column is NULL or
-- holds no rows; casts any accidental text via jsonb_build_object.
DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'user_templates' AND column_name = 'snapshot_ref';

  IF col_type IS NULL THEN
    ALTER TABLE public.user_templates ADD COLUMN snapshot_ref JSONB;
  ELSIF col_type = 'text' THEN
    ALTER TABLE public.user_templates
      ALTER COLUMN snapshot_ref TYPE JSONB
      USING CASE
        WHEN snapshot_ref IS NULL OR snapshot_ref = '' THEN NULL
        ELSE jsonb_build_object('legacy', snapshot_ref)
      END;
  END IF;
END $$;

-- Force PostgREST to refresh its schema cache
NOTIFY pgrst, 'reload schema';
`;
