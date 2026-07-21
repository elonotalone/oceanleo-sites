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
