import crypto from "node:crypto";

import { fetchWithTimeout } from "./runtime";

const API_VERSION = "2020-06-01";

function percentEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~");
}

function getEndpoint(regionId: string): string {
  if (regionId.startsWith("cn-")) {
    return `https://swas-open.${regionId}.aliyuncs.com`;
  }
  return "https://swas-open.ap-southeast-1.aliyuncs.com";
}

function buildSignedParams(
  accessKeyId: string,
  accessKeySecret: string,
  action: string,
  params: Record<string, string>,
): URLSearchParams {
  const common: Record<string, string> = {
    Action: action,
    Version: API_VERSION,
    Format: "JSON",
    AccessKeyId: accessKeyId,
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  const merged = { ...common, ...params };
  const canonical = Object.keys(merged)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(merged[key]!)}`)
    .join("&");
  const signature = crypto
    .createHmac("sha1", `${accessKeySecret}&`)
    .update(`POST&${percentEncode("/")}&${percentEncode(canonical)}`)
    .digest("base64");
  const body = new URLSearchParams(merged);
  body.set("Signature", signature);
  return body;
}

async function swasCall<T = unknown>(
  accessKeyId: string,
  accessKeySecret: string,
  action: string,
  regionId: string,
  params: Record<string, string> = {},
): Promise<T> {
  const endpoint = getEndpoint(regionId);
  const body = buildSignedParams(accessKeyId, accessKeySecret, action, {
    RegionId: regionId,
    ...params,
  });
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    timeoutMs: 60_000,
  });
  const json = (await response.json()) as Record<string, unknown> & {
    Code?: string;
    Message?: string;
  };
  if (json.Code && json.Code !== "200") {
    throw new Error(
      `Alibaba Cloud SWAS ${action} failed: ${json.Code} — ${json.Message || "unknown"}`,
    );
  }
  return json as T;
}

export interface SwasRegion {
  RegionId: string;
  LocalName: string;
}

export async function listRegions(
  accessKeyId: string,
  accessKeySecret: string,
): Promise<SwasRegion[]> {
  const data = await swasCall<{ Regions: SwasRegion[] }>(
    accessKeyId,
    accessKeySecret,
    "ListRegions",
    "cn-hangzhou",
  );
  return data.Regions || [];
}

export interface SwasPlan {
  PlanId: string;
  Core: number;
  Memory: number;
  DiskSize: number;
  Bandwidth: number;
  Flow: number;
  SupportPlatform: string;
  Price: number;
  Currency: string;
}

export async function listPlans(
  accessKeyId: string,
  accessKeySecret: string,
  regionId: string,
): Promise<SwasPlan[]> {
  const data = await swasCall<{ Plans: SwasPlan[] }>(
    accessKeyId,
    accessKeySecret,
    "ListPlans",
    regionId,
  );
  return data.Plans || [];
}

export interface SwasImage {
  ImageId: string;
  ImageName: string;
  OsType: string;
  Platform: string;
  Description: string;
}

export async function listImages(
  accessKeyId: string,
  accessKeySecret: string,
  regionId: string,
): Promise<SwasImage[]> {
  const data = await swasCall<{ Images: SwasImage[] }>(
    accessKeyId,
    accessKeySecret,
    "ListImages",
    regionId,
  );
  return data.Images || [];
}

export async function createInstance(
  accessKeyId: string,
  accessKeySecret: string,
  regionId: string,
  imageId: string,
  planId: string,
  period = 1,
): Promise<string[]> {
  const data = await swasCall<{ InstanceIds: string[] }>(
    accessKeyId,
    accessKeySecret,
    "CreateInstances",
    regionId,
    {
      ImageId: imageId,
      PlanId: planId,
      Period: String(period),
      Amount: "1",
      ChargeType: "PrePaid",
    },
  );
  return data.InstanceIds;
}

export interface SwasInstance {
  InstanceId: string;
  Status: string;
  PublicIpAddress: string;
  InnerIpAddress: string;
  RegionId: string;
  ImageId: string;
  PlanId: string;
  InstanceName: string;
}

export async function getInstance(
  accessKeyId: string,
  accessKeySecret: string,
  regionId: string,
  instanceId: string,
): Promise<SwasInstance | null> {
  const data = await swasCall<{ Instances: SwasInstance[] }>(
    accessKeyId,
    accessKeySecret,
    "ListInstances",
    regionId,
    { InstanceIds: JSON.stringify([instanceId]) },
  );
  return data.Instances?.[0] ?? null;
}

export async function waitForInstanceRunning(
  accessKeyId: string,
  accessKeySecret: string,
  regionId: string,
  instanceId: string,
  maxWaitMs = 300_000,
): Promise<SwasInstance> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const instance = await getInstance(
      accessKeyId,
      accessKeySecret,
      regionId,
      instanceId,
    );
    if (instance?.Status === "Running") return instance;
    if (instance?.Status === "Stopped" || instance?.Status === "Disabled") {
      throw new Error(`Instance entered unexpected state: ${instance.Status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error("Alibaba Cloud instance did not become Running in time");
}

export async function createFirewallRules(
  accessKeyId: string,
  accessKeySecret: string,
  regionId: string,
  instanceId: string,
  rules: ReadonlyArray<{ port: string; protocol?: string }>,
): Promise<string[]> {
  const flat: Record<string, string> = { InstanceId: instanceId };
  rules.forEach((rule, index) => {
    flat[`FirewallRules.${index + 1}.Port`] = rule.port;
    flat[`FirewallRules.${index + 1}.RuleProtocol`] = rule.protocol || "TCP";
    flat[`FirewallRules.${index + 1}.SourceCidrIp`] = "0.0.0.0/0";
  });
  const data = await swasCall<{ FirewallRuleIds: string[] }>(
    accessKeyId,
    accessKeySecret,
    "CreateFirewallRules",
    regionId,
    flat,
  );
  return data.FirewallRuleIds || [];
}


export async function validateCredentials(
  accessKeyId: string,
  accessKeySecret: string,
  regionId = "cn-hangzhou",
): Promise<boolean> {
  try {
    await listRegions(accessKeyId, accessKeySecret);
    void regionId;
    return true;
  } catch {
    return false;
  }
}

export interface AliyunCommandResult {
  InvokeId: string;
}

export async function runRemoteCommand(
  accessKeyId: string,
  accessKeySecret: string,
  regionId: string,
  instanceId: string,
  command: string,
  timeout = 600,
): Promise<string> {
  const data = await swasCall<AliyunCommandResult>(
    accessKeyId,
    accessKeySecret,
    "RunCommand",
    regionId,
    {
      InstanceId: instanceId,
      CommandContent: Buffer.from(command).toString("base64"),
      Type: "RunShellScript",
      Timeout: String(timeout),
      Name: `website-deploy-${Date.now()}`,
    },
  );
  return data.InvokeId;
}

export interface InvocationResult {
  InvokeId: string;
  InvokeStatus: string;
  Output: string;
  ErrorInfo: string;
}

export async function getCommandResult(
  accessKeyId: string,
  accessKeySecret: string,
  regionId: string,
  instanceId: string,
  invokeId: string,
): Promise<InvocationResult | null> {
  const data = await swasCall<{ InvocationResult?: InvocationResult }>(
    accessKeyId,
    accessKeySecret,
    "DescribeInvocationResult",
    regionId,
    {
      InstanceId: instanceId,
      InvokeId: invokeId,
    },
  );
  return data.InvocationResult ?? null;
}

export async function waitForCommand(
  accessKeyId: string,
  accessKeySecret: string,
  regionId: string,
  instanceId: string,
  invokeId: string,
  maxWaitMs = 300_000,
): Promise<InvocationResult> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const result = await getCommandResult(
      accessKeyId,
      accessKeySecret,
      regionId,
      instanceId,
      invokeId,
    );
    if (
      result &&
      (result.InvokeStatus === "Finished" || result.InvokeStatus === "Failed")
    ) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("Command execution timed out");
}

export interface AliyunDeployResult {
  instanceId: string;
  publicIp: string;
  backendUrl: string;
}

export async function deployBackend(
  accessKeyId: string,
  accessKeySecret: string,
  opts: {
    regionId: string;
    imageId: string;
    planId: string;
    period?: number;
    repoUrl: string;
    branch?: string;
    backendDir?: string;
    port?: number;
    envVars?: Record<string, string>;
  },
): Promise<AliyunDeployResult> {
  const instanceIds = await createInstance(
    accessKeyId,
    accessKeySecret,
    opts.regionId,
    opts.imageId,
    opts.planId,
    opts.period || 1,
  );
  const instanceId = instanceIds[0]!;
  const instance = await waitForInstanceRunning(
    accessKeyId,
    accessKeySecret,
    opts.regionId,
    instanceId,
  );
  const port = opts.port || 8000;

  await createFirewallRules(
    accessKeyId,
    accessKeySecret,
    opts.regionId,
    instanceId,
    [{ port: `${port}/${port}`, protocol: "TCP" }],
  );

  const envExports = opts.envVars
    ? Object.entries(opts.envVars)
        .map(([key, value]) => `export ${key}="${value}"`)
        .join("\n")
    : "";
  const dir = opts.backendDir || "back-end";
  const branch = opts.branch || "main";

  const deployScript = `#!/bin/bash
set -e
apt-get update -y && apt-get install -y docker.io docker-compose-plugin git
systemctl enable docker && systemctl start docker
git clone --branch ${branch} --single-branch ${opts.repoUrl} /opt/app
cd /opt/app/${dir}
${envExports}
cat > .env << 'ENVEOF'
${opts.envVars ? Object.entries(opts.envVars).map(([k, v]) => `${k}=${v}`).join("\n") : ""}
PORT=${port}
ENVEOF
if [ -f docker-compose.yml ] || [ -f docker-compose.yaml ] || [ -f compose.yml ]; then
  docker compose up -d
elif [ -f Dockerfile ]; then
  docker build -t website-backend .
  docker run -d --restart unless-stopped -p ${port}:${port} --env-file .env website-backend
elif [ -f requirements.txt ]; then
  apt-get install -y python3 python3-pip python3-venv
  python3 -m venv /opt/venv
  /opt/venv/bin/pip install -r requirements.txt
  nohup /opt/venv/bin/uvicorn main:app --host 0.0.0.0 --port ${port} > /var/log/backend.log 2>&1 &
elif [ -f package.json ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  npm install
  nohup npm start > /var/log/backend.log 2>&1 &
fi`;

  const invokeId = await runRemoteCommand(
    accessKeyId,
    accessKeySecret,
    opts.regionId,
    instanceId,
    deployScript,
    600,
  );
  await waitForCommand(
    accessKeyId,
    accessKeySecret,
    opts.regionId,
    instanceId,
    invokeId,
    600_000,
  );

  return {
    instanceId,
    publicIp: instance.PublicIpAddress,
    backendUrl: `http://${instance.PublicIpAddress}:${port}`,
  };
}
