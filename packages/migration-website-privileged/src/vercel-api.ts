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
