import * as github from "./github-helpers";
import * as supabaseApi from "./supabase-management";
import * as vercelApi from "./vercel-api";

export interface DeploymentStep {
  name: string;
  status: "pending" | "running" | "success" | "error" | "skipped";
  startedAt?: string;
  completedAt?: string;
  output?: Record<string, string>;
  error?: string;
}

export interface DeployConfig {
  siteName: string;
  templateOwner: string;
  templateRepo: string;
  githubToken: string;
  vercelToken: string;
  vercelTeamId?: string | null;
  supabaseToken: string;
  cursorApiKey: string;
  cursorModel?: string;
  filesToRemove: string[];
  initSQL?: string;
  supabaseRegion?: string;
  extraEnvVars?: { key: string; value: string; sensitive?: boolean }[];
  refreshSupabaseToken?: () => Promise<string>;
  refreshVercelToken?: () => Promise<string>;
  refreshGithubToken?: () => Promise<string>;
  overrides?: Record<string, string>;
  overrideSlots?: { id: string; default: string; type?: string }[];
}

export interface DeployResult {
  siteUrl: string | null;
  githubRepo: string;
  githubRepoUrl: string;
  vercelProjectId: string;
  vercelProjectUrl: string;
  supabaseProjectRef: string;
  supabaseUrl: string;
  steps: DeploymentStep[];
}

type StepCallback = (steps: DeploymentStep[]) => void | Promise<void>;

function createStep(name: string): DeploymentStep {
  return { name, status: "pending" };
}

function markRunning(step: DeploymentStep): DeploymentStep {
  return { ...step, status: "running", startedAt: new Date().toISOString() };
}

function markSuccess(
  step: DeploymentStep,
  output?: Record<string, string>,
): DeploymentStep {
  return {
    ...step,
    status: "success",
    completedAt: new Date().toISOString(),
    output,
  };
}

function markError(step: DeploymentStep, error: string): DeploymentStep {
  return {
    ...step,
    status: "error",
    completedAt: new Date().toISOString(),
    error,
  };
}

function generatePassword(length = 24): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%";
  let result = "";
  const array = new Uint8Array(length);
  if (typeof globalThis.crypto !== "undefined") {
    globalThis.crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < length; i += 1) array[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < length; i += 1) {
    result += chars[array[i]! % chars.length]!;
  }
  return result;
}

export async function runDeployPipeline(
  config: DeployConfig,
  onProgress: StepCallback,
): Promise<DeployResult> {
  const steps: DeploymentStep[] = [
    createStep("github_create_repo"),
    createStep("github_apply_placeholders"),
    createStep("github_modify_config"),
    createStep("github_clean_files"),
    createStep("github_apply_overrides"),
    createStep("supabase_create_project"),
    createStep("supabase_init_tables"),
    createStep("vercel_create_project"),
    createStep("vercel_set_env"),
    createStep("vercel_deploy"),
  ];

  const update = async (index: number, step: DeploymentStep) => {
    steps[index] = step;
    await onProgress([...steps]);
  };

  const result: DeployResult = {
    siteUrl: null,
    githubRepo: "",
    githubRepoUrl: "",
    vercelProjectId: "",
    vercelProjectUrl: "",
    supabaseProjectRef: "",
    supabaseUrl: "",
    steps: [],
  };

  await update(0, markRunning(steps[0]!));
  try {
    let ghUser: { login: string };
    try {
      ghUser = await github.getAuthenticatedUser(config.githubToken);
    } catch (firstErr) {
      if (config.refreshGithubToken) {
        try {
          config.githubToken = await config.refreshGithubToken();
          ghUser = await github.getAuthenticatedUser(config.githubToken);
        } catch {
          throw firstErr;
        }
      } else {
        throw firstErr;
      }
    }
    const repo = await github.createRepoFromTemplate(
      config.githubToken,
      config.templateOwner,
      config.templateRepo,
      ghUser.login,
      config.siteName,
    );
    result.githubRepo = repo.repoFullName;
    result.githubRepoUrl = repo.htmlUrl;
    await update(
      0,
      markSuccess(steps[0]!, { repo: repo.repoFullName, url: repo.htmlUrl }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await update(0, markError(steps[0]!, msg));
    result.steps = steps;
    return result;
  }

  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const [owner, repoName] = result.githubRepo.split("/");

  await update(1, markRunning(steps[1]!));
  try {
    const replaced = await github.applyTemplatePlaceholders(
      config.githubToken,
      owner!,
      repoName!,
      { SITE_NAME: config.siteName },
    );
    await update(
      1,
      markSuccess(steps[1]!, { filesUpdated: String(replaced) }),
    );
  } catch (err) {
    await update(
      1,
      markError(
        steps[1]!,
        err instanceof Error ? err.message : "Unknown error",
      ),
    );
  }

  await update(2, markRunning(steps[2]!));

  await update(3, markRunning(steps[3]!));
  try {
    for (const filePath of config.filesToRemove) {
      try {
        await github.deleteFile(
          config.githubToken,
          owner!,
          repoName!,
          filePath,
          `Remove ${filePath}`,
        );
      } catch {
        /* non-critical */
      }
    }
    await update(3, markSuccess(steps[3]!));
  } catch (err) {
    await update(
      3,
      markError(
        steps[3]!,
        err instanceof Error ? err.message : "Unknown error",
      ),
    );
  }

  await update(4, markRunning(steps[4]!));
  try {
    const overrides = config.overrides || {};
    if (Object.keys(overrides).length === 0) {
      await update(4, {
        ...steps[4]!,
        status: "skipped",
        completedAt: new Date().toISOString(),
      });
    } else {
      const applied = await github.applyOverridesToRepo(
        config.githubToken,
        owner!,
        repoName!,
        overrides,
        config.overrideSlots || [],
      );
      await update(
        4,
        markSuccess(steps[4]!, {
          filesTextReplaced: String(applied.filesTextReplaced),
          overridesFile: applied.overridesFile ? "1" : "0",
          readerInjected: applied.readerInjected ? "1" : "0",
        }),
      );
    }
  } catch (err) {
    await update(
      4,
      markError(
        steps[4]!,
        err instanceof Error ? err.message : "Unknown error",
      ),
    );
  }

  await update(5, markRunning(steps[5]!));
  try {
    let sbToken = config.supabaseToken;
    let orgs: { id: string; name: string }[];
    try {
      orgs = await supabaseApi.listOrganizations(sbToken);
    } catch (firstErr) {
      if (config.refreshSupabaseToken) {
        try {
          sbToken = await config.refreshSupabaseToken();
          orgs = await supabaseApi.listOrganizations(sbToken);
          config.supabaseToken = sbToken;
        } catch {
          throw firstErr;
        }
      } else {
        throw firstErr;
      }
    }

    if (orgs.length === 0) throw new Error("No Supabase organizations found");

    const dbPass = generatePassword();
    const project = await supabaseApi.createSupabaseProject(
      config.supabaseToken,
      config.siteName,
      orgs[0]!.id,
      config.supabaseRegion || "us-east-1",
      dbPass,
    );
    result.supabaseProjectRef = project.projectRef;
    result.supabaseUrl = project.url;

    await supabaseApi.waitForProjectReady(
      config.supabaseToken,
      project.projectRef,
    );

    const keys = await supabaseApi.getProjectApiKeys(
      config.supabaseToken,
      project.projectRef,
    );
    await update(
      5,
      markSuccess(steps[5]!, {
        ref: project.projectRef,
        url: project.url,
      }),
    );

    try {
      const envContent = [
        `NEXT_PUBLIC_SUPABASE_URL=${project.url}`,
        `NEXT_PUBLIC_SUPABASE_ANON_KEY=${keys.anonKey}`,
        `CURSOR_API_KEY=\${CURSOR_API_KEY}`,
        `CURSOR_REPO_URL=${result.githubRepoUrl}`,
        `CURSOR_MODEL=${config.cursorModel || "composer-1.5"}`,
        `CURSOR_BASE_BRANCH=main`,
      ].join("\n");

      await github.updateFileContent(
        config.githubToken,
        owner!,
        repoName!,
        ".env.example",
        envContent,
        "Update .env.example with project config",
      );
      await update(2, markSuccess(steps[2]!));
    } catch (err) {
      await update(
        2,
        markError(
          steps[2]!,
          err instanceof Error ? err.message : "Unknown error",
        ),
      );
    }

    await update(6, markRunning(steps[6]!));
    try {
      const sql = config.initSQL || supabaseApi.getDefaultInitSQL();
      await supabaseApi.executeSQL(
        config.supabaseToken,
        project.projectRef,
        sql,
      );
      await update(6, markSuccess(steps[6]!));
    } catch (err) {
      await update(
        6,
        markError(
          steps[6]!,
          err instanceof Error ? err.message : "Unknown error",
        ),
      );
    }

    let vercelProjectName = config.siteName;
    let vercelRepoId: number | null = null;
    await update(7, markRunning(steps[7]!));
    try {
      let vercelProject: vercelApi.CreateProjectResult;
      try {
        vercelProject = await vercelApi.createProject(
          config.vercelToken,
          config.siteName,
          result.githubRepo,
          config.vercelTeamId,
        );
      } catch (firstErr) {
        if (config.refreshVercelToken) {
          try {
            config.vercelToken = await config.refreshVercelToken();
            vercelProject = await vercelApi.createProject(
              config.vercelToken,
              config.siteName,
              result.githubRepo,
              config.vercelTeamId,
            );
          } catch {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }
      result.vercelProjectId = vercelProject.projectId;
      result.vercelProjectUrl = vercelProject.projectUrl;
      vercelProjectName = vercelProject.projectName;
      vercelRepoId = vercelProject.repoId ?? null;
      if (
        vercelProject.resolvedTeamId &&
        vercelProject.resolvedTeamId !== config.vercelTeamId
      ) {
        config.vercelTeamId = vercelProject.resolvedTeamId;
      }
      await update(
        7,
        markSuccess(steps[7]!, {
          projectId: vercelProject.projectId,
          url: vercelProject.projectUrl,
        }),
      );
    } catch (err) {
      await update(
        7,
        markError(
          steps[7]!,
          err instanceof Error ? err.message : "Unknown error",
        ),
      );
      result.steps = steps;
      return result;
    }

    await update(8, markRunning(steps[8]!));
    try {
      const envVars: vercelApi.EnvVarInput[] = [
        {
          key: "NEXT_PUBLIC_SUPABASE_URL",
          value: project.url,
          target: ["production", "preview", "development"],
          type: "plain",
        },
        {
          key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
          value: keys.anonKey,
          target: ["production", "preview", "development"],
          type: "plain",
        },
        {
          key: "CURSOR_API_KEY",
          value: config.cursorApiKey,
          target: ["production", "preview", "development"],
          type: "sensitive",
        },
        {
          key: "CURSOR_REPO_URL",
          value: result.githubRepoUrl,
          target: ["production", "preview", "development"],
          type: "plain",
        },
        {
          key: "CURSOR_BASE_BRANCH",
          value: "main",
          target: ["production", "preview", "development"],
          type: "plain",
        },
        {
          key: "CURSOR_MODEL",
          value: config.cursorModel || "composer-1.5",
          target: ["production", "preview", "development"],
          type: "plain",
        },
      ];

      if (config.extraEnvVars) {
        for (const extra of config.extraEnvVars) {
          envVars.push({
            key: extra.key,
            value: extra.value,
            target: ["production", "preview", "development"],
            type: extra.sensitive ? "sensitive" : "plain",
          });
        }
      }

      await vercelApi.setEnvironmentVariables(
        config.vercelToken,
        result.vercelProjectId,
        envVars,
        config.vercelTeamId,
      );
      await update(8, markSuccess(steps[8]!));
    } catch (err) {
      await update(
        8,
        markError(
          steps[8]!,
          err instanceof Error ? err.message : "Unknown error",
        ),
      );
    }

    await update(9, markRunning(steps[9]!));
    try {
      try {
        await vercelApi.triggerFirstDeployment(
          config.vercelToken,
          vercelProjectName,
          vercelRepoId,
          "main",
          config.vercelTeamId,
        );
      } catch (triggerErr) {
        console.warn(
          "[deploy] triggerFirstDeployment failed (will still poll):",
          triggerErr,
        );
      }
      const siteUrl = await vercelApi.waitForDeployment(
        config.vercelToken,
        result.vercelProjectId,
        config.vercelTeamId,
        300_000,
      );
      result.siteUrl = siteUrl;
      await update(9, markSuccess(steps[9]!, { url: siteUrl || "" }));
    } catch (err) {
      await update(
        9,
        markError(
          steps[9]!,
          err instanceof Error ? err.message : "Unknown error",
        ),
      );
    }
  } catch (err) {
    await update(
      5,
      markError(
        steps[5]!,
        err instanceof Error ? err.message : "Unknown error",
      ),
    );
  }

  result.steps = steps;
  return result;
}
