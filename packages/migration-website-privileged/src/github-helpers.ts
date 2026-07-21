import { fetchWithTimeout } from "./runtime";

export function parseRepoIdentifier(
  input: string,
): { owner: string; repo: string } | null {
  const cleaned = input.replace(/\.git$/, "").trim();
  const match = cleaned.match(/(?:github\.com[/:])?([^/]+)\/([^/?#]+)/);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]! };
}

function githubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function getAuthenticatedUser(
  token: string,
): Promise<{ login: string }> {
  const response = await fetchWithTimeout("https://api.github.com/user", {
    headers: githubHeaders(token),
  });
  if (!response.ok) throw new Error("Failed to get GitHub user");
  return (await response.json()) as { login: string };
}

export async function createRepo(
  token: string,
  name: string,
  isPrivate = true,
  description = "",
): Promise<{ repoFullName: string; repoUrl: string; htmlUrl: string }> {
  const response = await fetchWithTimeout("https://api.github.com/user/repos", {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({
      name,
      private: isPrivate,
      description,
      auto_init: true,
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`GitHub create repo failed (${response.status}): ${err}`);
  }
  const data = (await response.json()) as Record<string, any>;
  return {
    repoFullName: data.full_name,
    repoUrl: data.clone_url,
    htmlUrl: data.html_url,
  };
}

export async function pushFilesViaTree(
  token: string,
  owner: string,
  repo: string,
  files: { path: string; contentBase64: string }[],
  message: string,
  branch = "main",
): Promise<void> {
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = githubHeaders(token);

  let baseSha: string | null = null;
  let baseTreeSha: string | null = null;
  let targetBranch = branch;
  const refRes = await fetchWithTimeout(`${api}/git/ref/heads/${branch}`, {
    headers,
  });
  if (refRes.ok) {
    const ref = (await refRes.json()) as Record<string, any>;
    baseSha = ref.object?.sha || null;
  } else {
    const repoRes = await fetchWithTimeout(api, { headers });
    if (repoRes.ok) {
      const info = (await repoRes.json()) as Record<string, any>;
      targetBranch = info.default_branch || branch;
      const dRes = await fetchWithTimeout(
        `${api}/git/ref/heads/${targetBranch}`,
        { headers },
      );
      if (dRes.ok) {
        baseSha = ((await dRes.json()) as Record<string, any>).object?.sha || null;
      }
    }
  }
  if (baseSha) {
    const commitRes = await fetchWithTimeout(`${api}/git/commits/${baseSha}`, {
      headers,
    });
    if (commitRes.ok) {
      baseTreeSha =
        ((await commitRes.json()) as Record<string, any>).tree?.sha || null;
    }
  }

  const treeItems: Array<{
    path: string;
    mode: "100644";
    type: "blob";
    sha: string;
  }> = [];
  for (const file of files) {
    const blobRes = await fetchWithTimeout(`${api}/git/blobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        content: file.contentBase64.replace(/\s+/g, ""),
        encoding: "base64",
      }),
    });
    if (!blobRes.ok) {
      throw new Error(
        `GitHub blob create failed for ${file.path}: ${blobRes.status}`,
      );
    }
    const blob = (await blobRes.json()) as Record<string, any>;
    treeItems.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  const treeRes = await fetchWithTimeout(`${api}/git/trees`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
      tree: treeItems,
    }),
  });
  if (!treeRes.ok) {
    throw new Error(
      `GitHub tree create failed: ${treeRes.status} ${await treeRes.text()}`,
    );
  }
  const tree = (await treeRes.json()) as Record<string, any>;

  const commitRes = await fetchWithTimeout(`${api}/git/commits`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message,
      tree: tree.sha,
      ...(baseSha ? { parents: [baseSha] } : {}),
    }),
  });
  if (!commitRes.ok) {
    throw new Error(
      `GitHub commit create failed: ${commitRes.status} ${await commitRes.text()}`,
    );
  }
  const commit = (await commitRes.json()) as Record<string, any>;

  const updateRefRes = await fetchWithTimeout(
    `${api}/git/refs/heads/${targetBranch}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ sha: commit.sha, force: false }),
    },
  );
  if (!updateRefRes.ok) {
    const createRefRes = await fetchWithTimeout(`${api}/git/refs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ref: `refs/heads/${targetBranch}`,
        sha: commit.sha,
      }),
    });
    if (!createRefRes.ok) {
      throw new Error(
        `GitHub ref update failed: ${updateRefRes.status} ${await updateRefRes.text()}`,
      );
    }
  }
}

export async function updateFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
): Promise<void> {
  const getRes = await fetchWithTimeout(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    { headers: githubHeaders(token) },
  );
  let sha: string | undefined;
  if (getRes.ok) {
    const existing = (await getRes.json()) as Record<string, any>;
    sha = existing.sha;
  }
  const putRes = await fetchWithTimeout(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      method: "PUT",
      headers: githubHeaders(token),
      body: JSON.stringify({
        message,
        content: Buffer.from(content).toString("base64"),
        sha,
      }),
    },
  );
  if (!putRes.ok) {
    const err = await putRes.text();
    throw new Error(`GitHub update file failed (${putRes.status}): ${err}`);
  }
}

export async function getFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
): Promise<{ content: string; sha: string } | null> {
  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    { headers: githubHeaders(token) },
  );
  if (!response.ok) return null;
  const data = (await response.json()) as Record<string, any>;
  if (Array.isArray(data) || !data.content) return null;
  return {
    content: Buffer.from(data.content, "base64").toString("utf-8"),
    sha: data.sha,
  };
}

export interface SyncOverridesResult {
  filesTextReplaced: number;
  overridesFile: boolean;
  readerInjected: boolean;
}

export async function syncOverridesToRepo(
  token: string,
  owner: string,
  repo: string,
  transitions: Array<{ id: string; from: string; to: string }>,
  newOverrides: Record<string, string>,
): Promise<SyncOverridesResult> {
  const result: SyncOverridesResult = {
    filesTextReplaced: 0,
    overridesFile: false,
    readerInjected: false,
  };

  try {
    const json = JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        overrides: newOverrides,
      },
      null,
      2,
    );
    await updateFileContent(
      token,
      owner,
      repo,
      "public/website-overrides.json",
      json,
      "chore(website): sync visual-edit overrides",
    );
    result.overridesFile = true;
  } catch (error) {
    console.warn("[sync] failed to write overrides.json:", error);
  }

  try {
    const existing = await getFileContent(
      token,
      owner,
      repo,
      "lib/website-overrides.ts",
    );
    if (!existing) {
      const reader = `import overridesJson from "../public/website-overrides.json";

type OverridesShape = { version: number; generatedAt: string; overrides: Record<string, string> };

const data = overridesJson as OverridesShape;

export function getOverride(slotId: string, fallback = ""): string {
  return data.overrides?.[slotId] ?? fallback;
}

export function allOverrides(): Record<string, string> {
  return { ...(data.overrides || {}) };
}
`;
      await updateFileContent(
        token,
        owner,
        repo,
        "lib/website-overrides.ts",
        reader,
        "chore(website): add overrides reader helper",
      );
      result.readerInjected = true;
    }
  } catch (error) {
    console.warn("[sync] failed to ensure reader helper:", error);
  }

  const manifest = await getFileContent(
    token,
    owner,
    repo,
    ".website-template.json",
  );
  let files: string[] = [];
  if (manifest) {
    try {
      const parsed = JSON.parse(manifest.content) as Record<string, unknown>;
      if (Array.isArray(parsed.editableFiles)) {
        files = parsed.editableFiles as string[];
      } else if (Array.isArray(parsed.files)) {
        files = parsed.files as string[];
      }
    } catch {
      /* ignore */
    }
  }
  if (files.length === 0) {
    files = [
      "app/page.tsx",
      "app/[locale]/page.tsx",
      "app/layout.tsx",
      "components/Hero.tsx",
      "components/Features.tsx",
      "components/CTA.tsx",
      "src/app/page.tsx",
    ];
  }

  const active = transitions.filter(
    (transition) =>
      transition.from &&
      transition.to &&
      transition.from !== transition.to &&
      transition.from.length >= 3,
  );
  if (active.length === 0) return result;

  for (const filePath of files) {
    const file = await getFileContent(token, owner, repo, filePath);
    if (!file) continue;
    let newContent = file.content;
    let touched = false;
    for (const transition of active) {
      const re = new RegExp(escapeRegex(transition.from), "g");
      if (re.test(newContent)) {
        newContent = newContent.replace(re, transition.to);
        touched = true;
      }
    }
    if (touched && newContent !== file.content) {
      await updateFileContent(
        token,
        owner,
        repo,
        filePath,
        newContent,
        "chore(website): sync visual-edit overrides",
      );
      result.filesTextReplaced += 1;
    }
  }

  return result;
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


export interface RefreshedTokens {
  access_token: string;
  refresh_token: string;
}

export async function validateGithubToken(token: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout("https://api.github.com/user", {
      headers: githubHeaders(token),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function refreshGithubAccessToken(
  refreshToken: string,
): Promise<RefreshedTokens> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GITHUB_CLIENT_ID / CLIENT_SECRET not configured");
  }
  const response = await fetchWithTimeout(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub token refresh failed (${response.status}): ${body}`);
  }
  const data = (await response.json()) as Record<string, any>;
  if (data.error || !data.access_token) {
    throw new Error(
      `GitHub token refresh error: ${data.error_description || data.error || "no access_token"}`,
    );
  }
  return {
    access_token: data.access_token as string,
    refresh_token: (data.refresh_token as string) || refreshToken,
  };
}

export interface GitHubCreateRepoResult {
  repoFullName: string;
  repoUrl: string;
  htmlUrl: string;
}

export async function createRepoFromTemplate(
  token: string,
  templateOwner: string,
  templateRepo: string,
  owner: string,
  name: string,
  isPrivate = true,
): Promise<GitHubCreateRepoResult> {
  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${templateOwner}/${templateRepo}/generate`,
    {
      method: "POST",
      headers: {
        ...githubHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        owner,
        name,
        private: isPrivate,
        include_all_branches: false,
      }),
    },
  );
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`GitHub create repo failed (${response.status}): ${err}`);
  }
  const data = (await response.json()) as Record<string, any>;
  return {
    repoFullName: data.full_name,
    repoUrl: data.clone_url,
    htmlUrl: data.html_url,
  };
}

export async function deleteFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  message: string,
): Promise<void> {
  const getRes = await fetchWithTimeout(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    { headers: githubHeaders(token) },
  );
  if (!getRes.ok) return;
  const existing = (await getRes.json()) as Record<string, any> | any[];
  if (Array.isArray(existing)) {
    for (const file of existing) {
      if (file.type === "file" || file.type === "dir") {
        await deleteFile(token, owner, repo, file.path, message);
      }
    }
    return;
  }
  const delRes = await fetchWithTimeout(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      method: "DELETE",
      headers: githubHeaders(token),
      body: JSON.stringify({ message, sha: existing.sha }),
    },
  );
  if (!delRes.ok && delRes.status !== 404) {
    console.warn(`GitHub delete ${path} failed: ${delRes.status}`);
  }
}

export async function applyTemplatePlaceholders(
  token: string,
  owner: string,
  repo: string,
  replacements: Record<string, string>,
): Promise<number> {
  const manifest = await getFileContent(
    token,
    owner,
    repo,
    ".website-template.json",
  );
  if (!manifest) return 0;
  let parsed: { files?: string[] };
  try {
    parsed = JSON.parse(manifest.content) as { files?: string[] };
  } catch {
    return 0;
  }
  const files = parsed.files || [];
  let replaced = 0;
  for (const filePath of files) {
    const file = await getFileContent(token, owner, repo, filePath);
    if (!file) continue;
    let newContent = file.content;
    for (const [key, value] of Object.entries(replacements)) {
      newContent = newContent.split(`{{${key}}}`).join(value);
    }
    if (newContent === file.content) continue;
    await updateFileContent(
      token,
      owner,
      repo,
      filePath,
      newContent,
      "Apply template placeholders",
    );
    replaced += 1;
  }
  return replaced;
}

export interface OverrideSlot {
  id: string;
  default: string;
  type?: string;
}

export interface ApplyOverridesResult {
  overridesFile: boolean;
  filesTextReplaced: number;
  readmeInjected: boolean;
  readerInjected: boolean;
}

export async function applyOverridesToRepo(
  token: string,
  owner: string,
  repo: string,
  overrides: Record<string, string>,
  slots: OverrideSlot[],
): Promise<ApplyOverridesResult> {
  const result: ApplyOverridesResult = {
    overridesFile: false,
    filesTextReplaced: 0,
    readmeInjected: false,
    readerInjected: false,
  };
  if (!overrides || Object.keys(overrides).length === 0) return result;

  try {
    const json = JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        overrides,
      },
      null,
      2,
    );
    await updateFileContent(
      token,
      owner,
      repo,
      "public/website-overrides.json",
      json,
      "chore(website): add visual-edit overrides snapshot",
    );
    result.overridesFile = true;
  } catch (err) {
    console.warn("[deploy] applyOverrides: failed to write overrides.json:", err);
  }

  try {
    const reader = `// Auto-generated by website at deploy time.
import overridesJson from "../public/website-overrides.json";

type OverridesShape = { version: number; generatedAt: string; overrides: Record<string, string> };

const data = overridesJson as OverridesShape;

export function getOverride(slotId: string, fallback = ""): string {
  return data.overrides?.[slotId] ?? fallback;
}

export function allOverrides(): Record<string, string> {
  return { ...(data.overrides || {}) };
}
`;
    await updateFileContent(
      token,
      owner,
      repo,
      "lib/website-overrides.ts",
      reader,
      "chore(website): add overrides reader helper",
    );
    result.readerInjected = true;
  } catch (err) {
    console.warn("[deploy] applyOverrides: failed to write reader:", err);
  }

  const manifest = await getFileContent(
    token,
    owner,
    repo,
    ".website-template.json",
  );
  let files: string[] = [];
  if (manifest) {
    try {
      const parsed = JSON.parse(manifest.content) as Record<string, unknown>;
      if (Array.isArray(parsed.editableFiles)) {
        files = parsed.editableFiles as string[];
      } else if (Array.isArray(parsed.files)) {
        files = parsed.files as string[];
      }
    } catch {
      /* ignore */
    }
  }
  if (files.length === 0) {
    files = [
      "app/page.tsx",
      "app/[locale]/page.tsx",
      "app/layout.tsx",
      "components/Hero.tsx",
      "components/Features.tsx",
      "components/CTA.tsx",
      "src/app/page.tsx",
    ];
  }

  const changes: Array<{ id: string; from: string; to: string }> = [];
  for (const slot of slots) {
    const override = overrides[slot.id];
    if (typeof override !== "string") continue;
    if (!slot.default || !override || override === slot.default) continue;
    if (slot.default.length < 3) continue;
    changes.push({ id: slot.id, from: slot.default, to: override });
  }

  if (changes.length > 0) {
    for (const filePath of files) {
      const file = await getFileContent(token, owner, repo, filePath);
      if (!file) continue;
      let newContent = file.content;
      let fileTouched = false;
      for (const change of changes) {
        const re = new RegExp(escapeRegex(change.from), "g");
        if (re.test(newContent)) {
          newContent = newContent.replace(re, change.to);
          fileTouched = true;
        }
      }
      if (fileTouched && newContent !== file.content) {
        await updateFileContent(
          token,
          owner,
          repo,
          filePath,
          newContent,
          "chore(website): apply visual-edit overrides",
        );
        result.filesTextReplaced += 1;
      }
    }
  }

  try {
    const existing = await getFileContent(
      token,
      owner,
      repo,
      "MYCREATOR_OVERRIDES.md",
    );
    if (!existing) {
      const readme = `# Mycreator visual-edit overrides

This repository was generated by Mycreator. During deploy we wrote your
visual-edit overrides into \`public/website-overrides.json\` and
\`lib/website-overrides.ts\`.

Generated at: ${new Date().toISOString()}
`;
      await updateFileContent(
        token,
        owner,
        repo,
        "MYCREATOR_OVERRIDES.md",
        readme,
        "docs(website): document visual-edit overrides",
      );
      result.readmeInjected = true;
    }
  } catch (err) {
    console.warn("[deploy] applyOverrides: failed to write README:", err);
  }

  return result;
}
