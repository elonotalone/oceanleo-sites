import { fetchWithTimeout } from "./runtime";

const VERCEL_API = "https://api.vercel.com";

export function isVercelIntegrationToken(token: string): boolean {
  return token.startsWith("vca_") || token.startsWith("vci_");
}

async function resolveVercelDashboardSlug(
  token: string,
  teamId?: string | null,
): Promise<string> {
  try {
    if (teamId) {
      const response = await fetchWithTimeout(
        `${VERCEL_API}/v2/teams/${teamId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (response.ok) {
        const data = (await response.json()) as Record<string, any>;
        if (data.slug) return data.slug as string;
      }
    }
    if (!isVercelIntegrationToken(token)) {
      const response = await fetchWithTimeout(`${VERCEL_API}/v2/user`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = (await response.json()) as Record<string, any>;
        const user = data.user || data;
        if (user.username) return user.username as string;
      }
    }
  } catch {
    /* ignore */
  }
  return "~";
}

export interface CreateProjectResult {
  projectId: string;
  projectName: string;
  projectUrl: string;
  resolvedTeamId: string | null | undefined;
  repoId: number | null;
}

export async function createProject(
  token: string,
  name: string,
  repoFullName: string,
  teamId?: string | null,
): Promise<CreateProjectResult> {
  const body: Record<string, unknown> = {
    name,
    framework: "nextjs",
    gitRepository: {
      type: "github",
      repo: repoFullName,
    },
  };

  const doCreate = async (tid: string | null | undefined) => {
    const url = tid
      ? `${VERCEL_API}/v1/projects?teamId=${tid}`
      : `${VERCEL_API}/v1/projects`;
    return fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  };

  let response = await doCreate(teamId);

  if (
    !response.ok &&
    response.status === 403 &&
    !teamId &&
    isVercelIntegrationToken(token)
  ) {
    const errText = await response.text();
    const match = errText.match(/"teamId"\s*:\s*"(team_[^"]+)"/);
    if (match) {
      const detectedTeamId = match[1]!;
      response = await doCreate(detectedTeamId);
      if (response.ok) {
        const data = (await response.json()) as Record<string, any>;
        const slug = await resolveVercelDashboardSlug(token, detectedTeamId);
        return {
          projectId: data.id,
          projectName: data.name,
          projectUrl: `https://vercel.com/${slug}/${data.name}`,
          resolvedTeamId: detectedTeamId,
          repoId: data.link?.repoId ?? null,
        };
      }
    }
    throw new Error(
      `Vercel create project failed (${response.status}): ${errText}`,
    );
  }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Vercel create project failed (${response.status}): ${err}`);
  }

  const data = (await response.json()) as Record<string, any>;
  const slug = await resolveVercelDashboardSlug(token, teamId);
  return {
    projectId: data.id,
    projectName: data.name,
    projectUrl: `https://vercel.com/${slug}/${data.name}`,
    resolvedTeamId: teamId,
    repoId: data.link?.repoId ?? null,
  };
}

export async function triggerFirstDeployment(
  token: string,
  projectName: string,
  repoId: number | null | undefined,
  ref = "main",
  teamId?: string | null,
): Promise<void> {
  const url = teamId
    ? `${VERCEL_API}/v13/deployments?teamId=${teamId}&forceNew=1`
    : `${VERCEL_API}/v13/deployments?forceNew=1`;

  const body: Record<string, unknown> = {
    name: projectName,
    target: "production",
    gitSource: repoId
      ? { type: "github", repoId, ref }
      : { type: "github", ref },
  };

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(
      `Vercel trigger deployment failed (${response.status}): ${err.slice(0, 300)}`,
    );
  }
}

export interface VercelEnvVar {
  id: string;
  key: string;
  value?: string;
  target?: string[];
  type?: string;
}

export interface EnvVarInput {
  key: string;
  value: string;
  target?: string[];
  type?: string;
}

export async function getEnvironmentVariables(
  token: string,
  projectId: string,
  teamId?: string | null,
): Promise<VercelEnvVar[]> {
  const url = teamId
    ? `${VERCEL_API}/v1/projects/${projectId}/env?teamId=${teamId}`
    : `${VERCEL_API}/v1/projects/${projectId}/env`;
  const response = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Vercel get env failed: ${response.status}`);
  }
  const data = (await response.json()) as Record<string, any>;
  return data.envs || [];
}

export async function updateEnvironmentVariable(
  token: string,
  projectId: string,
  envId: string,
  value: string,
  teamId?: string | null,
): Promise<void> {
  const url = teamId
    ? `${VERCEL_API}/v1/projects/${projectId}/env/${envId}?teamId=${teamId}`
    : `${VERCEL_API}/v1/projects/${projectId}/env/${envId}`;
  const response = await fetchWithTimeout(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ value }),
  });
  if (!response.ok) {
    throw new Error(`Vercel update env failed: ${await response.text()}`);
  }
}

export async function setEnvironmentVariables(
  token: string,
  projectId: string,
  envVars: EnvVarInput[],
  teamId?: string | null,
): Promise<void> {
  const url = teamId
    ? `${VERCEL_API}/v1/projects/${projectId}/env?teamId=${teamId}`
    : `${VERCEL_API}/v1/projects/${projectId}/env`;
  for (const env of envVars) {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(env),
    });
    if (!response.ok) {
      const err = await response.text();
      console.warn(`Vercel set env ${env.key} failed: ${err}`);
    }
  }
}

export async function deleteEnvironmentVariable(
  token: string,
  projectId: string,
  envId: string,
  teamId?: string | null,
): Promise<void> {
  const url = teamId
    ? `${VERCEL_API}/v1/projects/${projectId}/env/${envId}?teamId=${teamId}`
    : `${VERCEL_API}/v1/projects/${projectId}/env/${envId}`;
  const response = await fetchWithTimeout(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Vercel delete env failed: ${response.status}`);
  }
}

export async function triggerRedeploy(
  token: string,
  projectId: string,
  teamId?: string | null,
): Promise<string | null> {
  const listUrl = teamId
    ? `${VERCEL_API}/v6/deployments?projectId=${projectId}&limit=1&teamId=${teamId}`
    : `${VERCEL_API}/v6/deployments?projectId=${projectId}&limit=1`;
  const listResponse = await fetchWithTimeout(listUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listResponse.ok) return null;
  const listData = (await listResponse.json()) as Record<string, any>;
  const lastDeployment = listData.deployments?.[0];
  if (!lastDeployment) return null;

  const redeployUrl = teamId
    ? `${VERCEL_API}/v13/deployments?teamId=${teamId}`
    : `${VERCEL_API}/v13/deployments`;
  const response = await fetchWithTimeout(redeployUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: lastDeployment.name,
      target: "production",
      gitSource: lastDeployment.gitSource,
    }),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as Record<string, any>;
  return data.url || null;
}

export async function deleteVercelProject(
  token: string,
  projectId: string,
  teamId?: string | null,
): Promise<void> {
  const url = teamId
    ? `${VERCEL_API}/v1/projects/${projectId}?teamId=${teamId}`
    : `${VERCEL_API}/v1/projects/${projectId}`;
  const response = await fetchWithTimeout(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete Vercel project: ${response.status}`);
  }
}

export async function deleteSupabaseProject(
  token: string,
  projectRef: string,
): Promise<void> {
  const response = await fetchWithTimeout(
    `https://api.supabase.com/v1/projects/${projectRef}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete Supabase project: ${response.status}`);
  }
}


export interface VercelRefreshedTokens {
  access_token: string;
  refresh_token: string;
  team_id: string | null;
}

export async function validateVercelToken(
  token: string,
  teamId?: string | null,
): Promise<boolean> {
  const isIntegration = isVercelIntegrationToken(token);
  const tryEndpoint = async (url: string): Promise<boolean> => {
    try {
      const response = await fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  if (isIntegration) {
    if (teamId) {
      if (
        await tryEndpoint(
          `${VERCEL_API}/v1/projects?teamId=${teamId}&limit=1`,
        )
      ) {
        return true;
      }
    }
    if (
      await tryEndpoint(
        `${VERCEL_API}/v1/integrations/configurations?view=account`,
      )
    ) {
      return true;
    }
    return tryEndpoint(`${VERCEL_API}/v1/projects?limit=1`);
  }

  const url = teamId
    ? `${VERCEL_API}/v2/user?teamId=${teamId}`
    : `${VERCEL_API}/v2/user`;
  return tryEndpoint(url);
}

export async function detectVercelTeamId(
  token: string,
): Promise<string | null> {
  if (!isVercelIntegrationToken(token)) return null;

  for (const view of ["account", "team"]) {
    try {
      const response = await fetchWithTimeout(
        `${VERCEL_API}/v1/integrations/configurations?view=${view}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (response.ok) {
        const data = (await response.json()) as Record<string, any> | any[];
        const configs = Array.isArray(data)
          ? data
          : data.configurations || [];
        for (const cfg of configs) {
          if (cfg.teamId) return cfg.teamId as string;
        }
      }
    } catch {
      /* continue */
    }
  }

  for (const probe of ["_", "personal", "probe"]) {
    try {
      const response = await fetchWithTimeout(
        `${VERCEL_API}/v1/projects?teamId=${probe}&limit=1`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        const body = await response.text();
        const match = body.match(/"teamId"\s*:\s*"(team_[^"]+)"/);
        if (match) return match[1]!;
      }
    } catch {
      /* continue */
    }
  }
  return null;
}

export async function refreshVercelAccessToken(
  refreshToken: string,
): Promise<VercelRefreshedTokens> {
  const clientId = process.env.VERCEL_CLIENT_ID;
  const clientSecret = process.env.VERCEL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("VERCEL_CLIENT_ID / CLIENT_SECRET not configured");
  }
  const response = await fetch(
    "https://api.vercel.com/v2/oauth/access_token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Vercel token refresh failed (${response.status}): ${body}`);
  }
  const data = (await response.json()) as Record<string, any>;
  if (!data.access_token) {
    throw new Error("Vercel token refresh returned no access_token");
  }
  return {
    access_token: data.access_token as string,
    refresh_token: (data.refresh_token as string) || refreshToken,
    team_id: (data.team_id as string) || null,
  };
}

export async function waitForDeployment(
  token: string,
  projectId: string,
  teamId?: string | null,
  maxWaitMs = 300_000,
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const url = teamId
      ? `${VERCEL_API}/v6/deployments?projectId=${projectId}&limit=1&teamId=${teamId}`
      : `${VERCEL_API}/v6/deployments?projectId=${projectId}&limit=1`;
    const response = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      const data = (await response.json()) as Record<string, any>;
      const deployment = data.deployments?.[0];
      if (deployment?.state === "READY") {
        return `https://${deployment.url}`;
      }
      if (deployment?.state === "ERROR") {
        throw new Error("Vercel deployment failed");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return null;
}
