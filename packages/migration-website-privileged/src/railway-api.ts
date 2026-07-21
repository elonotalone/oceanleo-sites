import { fetchWithTimeout } from "./runtime";

const RAILWAY_GQL = "https://backboard.railway.com/graphql/v2";

async function gql<T = unknown>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetchWithTimeout(RAILWAY_GQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    timeoutMs: 60_000,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Railway API request failed (${response.status}): ${body.slice(0, 300)}`,
    );
  }
  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (json.errors?.length) {
    throw new Error(
      `Railway API error: ${json.errors.map((error) => error.message).join("; ")}`,
    );
  }
  return json.data as T;
}

export async function validateRailwayToken(
  token: string,
): Promise<{ name: string; email: string } | null> {
  try {
    const data = await gql<{ me: { name: string; email: string } }>(
      token,
      `query { me { name email } }`,
    );
    return data.me;
  } catch {
    return null;
  }
}

export interface RailwayProject {
  id: string;
  name: string;
}

export async function createRailwayProject(
  token: string,
  name: string,
): Promise<RailwayProject> {
  const data = await gql<{ projectCreate: RailwayProject }>(
    token,
    `
    mutation($input: ProjectCreateInput!) { projectCreate(input: $input) { id name } }
  `,
    { input: { name } },
  );
  return data.projectCreate;
}

export interface RailwayService {
  id: string;
  name: string;
}

export async function createServiceFromGitHub(
  token: string,
  projectId: string,
  repo: string,
  branch = "main",
  rootDir?: string,
): Promise<RailwayService> {
  const data = await gql<{ serviceCreate: RailwayService }>(
    token,
    `
    mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id name } }
  `,
    {
      input: {
        projectId,
        name: repo.split("/").pop() || "backend",
        source: { repo },
        ...(rootDir ? { rootDirectory: rootDir } : {}),
      },
    },
  );
  const service = data.serviceCreate;

  await gql(
    token,
    `
    mutation($id: String!, $input: ServiceConnectInput!) { serviceConnect(id: $id, input: $input) { id } }
  `,
    { id: service.id, input: { repo, branch } },
  );

  return service;
}

export async function upsertVariables(
  token: string,
  projectId: string,
  environmentId: string,
  serviceId: string,
  variables: Record<string, string>,
): Promise<void> {
  await gql(
    token,
    `
    mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }
  `,
    {
      input: { projectId, environmentId, serviceId, variables },
    },
  );
}

export async function getDefaultEnvironmentId(
  token: string,
  projectId: string,
): Promise<string> {
  const data = await gql<{
    project: {
      environments: { edges: { node: { id: string; name: string } }[] };
    };
  }>(
    token,
    `
    query($id: String!) {
      project(id: $id) { environments { edges { node { id name } } } }
    }
  `,
    { id: projectId },
  );
  const envs = data.project.environments.edges.map((edge) => edge.node);
  const prod = envs.find((env) => env.name === "production") || envs[0];
  if (!prod) throw new Error("No environments found in Railway project");
  return prod.id;
}

export async function triggerRailwayDeploy(
  token: string,
  serviceId: string,
  environmentId: string,
): Promise<string> {
  const data = await gql<{ serviceInstanceDeploy: string }>(
    token,
    `
    mutation($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
    }
  `,
    { serviceId, environmentId },
  );
  return data.serviceInstanceDeploy;
}

export async function addRailwayDomain(
  token: string,
  serviceId: string,
  environmentId: string,
): Promise<string> {
  const data = await gql<{ serviceDomainCreate: { domain: string } }>(
    token,
    `
    mutation($input: ServiceDomainCreateInput!) {
      serviceDomainCreate(input: $input) { domain }
    }
  `,
    { input: { serviceInstanceId: serviceId, environmentId } },
  );
  return data.serviceDomainCreate.domain;
}

export interface RailwayDeployResult {
  projectId: string;
  serviceId: string;
  environmentId: string;
  deploymentId: string;
  url: string;
}

export async function deployFromGitHub(
  token: string,
  opts: {
    projectName: string;
    repo: string;
    branch?: string;
    rootDir?: string;
    envVars?: Record<string, string>;
  },
): Promise<RailwayDeployResult> {
  const project = await createRailwayProject(token, opts.projectName);
  const service = await createServiceFromGitHub(
    token,
    project.id,
    opts.repo,
    opts.branch || "main",
    opts.rootDir,
  );
  const envId = await getDefaultEnvironmentId(token, project.id);

  if (opts.envVars && Object.keys(opts.envVars).length > 0) {
    await upsertVariables(token, project.id, envId, service.id, opts.envVars);
  }

  const deploymentId = await triggerRailwayDeploy(token, service.id, envId);
  const railwayDomain = await addRailwayDomain(token, service.id, envId);

  return {
    projectId: project.id,
    serviceId: service.id,
    environmentId: envId,
    deploymentId,
    url: `https://${railwayDomain}`,
  };
}
