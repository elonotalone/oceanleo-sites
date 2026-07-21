import { fetchWithTimeout } from "./runtime";

export function parseRepoIdentifier(
  input: string,
): { owner: string; repo: string } | null {
  const cleaned = input.replace(/\.git$/, "").trim();
  const match = cleaned.match(/(?:github\.com[/:])?([^/]+)\/([^/?#]+)/);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]! };
}

export async function setRepoTemplateFlag(
  token: string,
  owner: string,
  repo: string,
  isTemplate: boolean,
): Promise<void> {
  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${owner}/${repo}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ is_template: isTemplate }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub PATCH repo failed (${response.status}): ${body.slice(0, 300)}`,
    );
  }
}

export async function getDefaultBranchSha(
  token: string,
  owner: string,
  repo: string,
): Promise<{ branch: string; sha: string }> {
  const repoResponse = await fetchWithTimeout(
    `https://api.github.com/repos/${owner}/${repo}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );
  if (!repoResponse.ok) {
    throw new Error(`GitHub GET repo failed (${repoResponse.status})`);
  }
  const repoData = (await repoResponse.json()) as Record<string, any>;
  const branch = repoData.default_branch || "main";

  const branchResponse = await fetchWithTimeout(
    `https://api.github.com/repos/${owner}/${repo}/branches/${branch}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );
  if (!branchResponse.ok) {
    throw new Error(`GitHub GET branch failed (${branchResponse.status})`);
  }
  const branchData = (await branchResponse.json()) as Record<string, any>;
  return { branch, sha: branchData.commit?.sha || "" };
}
