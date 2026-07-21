import {
  runUserSshCommand,
  type CommandResult,
  type PrerequisiteCheck,
  type SSHCredentials,
} from "./platform-host";

export type { CommandResult, PrerequisiteCheck, SSHCredentials };

export interface PortAllocation {
  port: number;
  usedPorts: number[];
}

export async function runCommand(
  creds: SSHCredentials,
  command: string,
  timeoutMs = 120_000,
): Promise<CommandResult> {
  return runUserSshCommand(creds, command, timeoutMs);
}

export async function checkPrerequisites(
  creds: SSHCredentials,
): Promise<PrerequisiteCheck> {
  const result = await runCommand(
    creds,
    [
      'command -v docker >/dev/null 2>&1 && echo "docker:yes" || echo "docker:no"',
      'command -v caddy >/dev/null 2>&1 && echo "caddy:yes" || echo "caddy:no"',
      'command -v python3 >/dev/null 2>&1 && echo "python3:yes" || echo "python3:no"',
      'command -v git >/dev/null 2>&1 && echo "git:yes" || echo "git:no"',
      'command -v systemctl >/dev/null 2>&1 && echo "systemctl:yes" || echo "systemctl:no"',
    ].join(" && "),
    15_000,
  );
  const lines = result.stdout;
  return {
    docker: lines.includes("docker:yes"),
    caddy: lines.includes("caddy:yes"),
    python3: lines.includes("python3:yes"),
    git: lines.includes("git:yes"),
    systemctl: lines.includes("systemctl:yes"),
  };
}

export async function installPrerequisites(
  creds: SSHCredentials,
  missing: Partial<PrerequisiteCheck>,
): Promise<CommandResult> {
  const cmds: string[] = ["export DEBIAN_FRONTEND=noninteractive"];

  if (missing.git === false) {
    cmds.push("apt-get update -y && apt-get install -y git");
  }
  if (missing.python3 === false) {
    cmds.push(
      "apt-get update -y && apt-get install -y python3 python3-pip python3-venv",
    );
  }
  if (missing.docker === false) {
    cmds.push(
      "apt-get update -y && apt-get install -y docker.io && systemctl enable docker && systemctl start docker",
    );
  }
  if (missing.caddy === false) {
    cmds.push(
      "apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl && " +
        "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && " +
        "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list && " +
        "apt-get update -y && apt-get install -y caddy && systemctl enable caddy && systemctl start caddy",
    );
  }

  if (cmds.length <= 1) {
    return { code: 0, stdout: "Nothing to install", stderr: "" };
  }

  return runCommand(creds, cmds.join(" && "), 300_000);
}

export async function findAvailablePort(
  creds: SSHCredentials,
  rangeStart = 8001,
  rangeEnd = 8099,
): Promise<PortAllocation> {
  const result = await runCommand(
    creds,
    "ss -tlnp | awk '{print $4}' | grep -oP ':\\K[0-9]+$' | sort -un",
    10_000,
  );
  const usedPorts = result.stdout
    .split("\n")
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((value) => !Number.isNaN(value));

  for (let port = rangeStart; port <= rangeEnd; port += 1) {
    if (!usedPorts.includes(port)) return { port, usedPorts };
  }
  throw new Error(`No available port in range ${rangeStart}-${rangeEnd}`);
}

export interface DeployBackendOpts {
  repoUrl: string;
  branch?: string;
  backendDir?: string;
  siteSlug: string;
  port: number;
  envVars?: Record<string, string>;
  startCommand?: string;
}

export async function deployBackend(
  creds: SSHCredentials,
  opts: DeployBackendOpts,
): Promise<{ backendUrl: string }> {
  const slug = opts.siteSlug;
  const branch = opts.branch || "main";
  const backendDir = opts.backendDir || "back-end";
  const appRoot = `/opt/${slug}`;
  const appBackend = `${appRoot}/${backendDir}`;
  const serviceName = `${slug}-backend`;
  const startCmd =
    opts.startCommand ||
    `${appBackend}/venv/bin/uvicorn main:app --host 127.0.0.1 --port ${opts.port}`;

  const envExports = opts.envVars
    ? Object.entries(opts.envVars)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")
    : "";

  await runCommand(
    creds,
    `if [ -d "${appRoot}/.git" ]; then
      cd ${appRoot} && git fetch origin && git reset --hard origin/${branch}
    else
      git clone --branch ${branch} --single-branch ${opts.repoUrl} ${appRoot}
    fi`,
    120_000,
  );

  await runCommand(
    creds,
    `cd ${appBackend} && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt --quiet`,
    180_000,
  );

  if (envExports) {
    const envContent = `${envExports}\nPORT=${opts.port}`;
    await runCommand(
      creds,
      `cat > ${appBackend}/.env << 'ENVEOF'\n${envContent}\nENVEOF`,
      10_000,
    );
  }

  const serviceFile = `[Unit]
Description=${slug} backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${appBackend}
EnvironmentFile=${appBackend}/.env
ExecStart=${startCmd}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target`;

  await runCommand(
    creds,
    `cat > /etc/systemd/system/${serviceName}.service << 'SVCEOF'\n${serviceFile}\nSVCEOF\nsystemctl daemon-reload && systemctl enable ${serviceName} && systemctl restart ${serviceName}`,
    30_000,
  );

  const deployScript = `#!/bin/bash
set -e
cd ${appBackend}
git fetch origin
git reset --hard origin/${branch}
source venv/bin/activate
pip install -r requirements.txt --quiet
systemctl restart ${serviceName}`;

  await runCommand(
    creds,
    `cat > ${appRoot}/deploy.sh << 'SHEOF'\n${deployScript}\nSHEOF\nchmod +x ${appRoot}/deploy.sh`,
    10_000,
  );

  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const check = await runCommand(
    creds,
    `systemctl is-active ${serviceName} 2>/dev/null || echo "inactive"`,
    10_000,
  );
  if (!check.stdout.trim().startsWith("active")) {
    const logs = await runCommand(
      creds,
      `journalctl -u ${serviceName} --no-pager -n 20 2>/dev/null || true`,
      10_000,
    );
    throw new Error(
      `Service ${serviceName} failed to start. Logs:\n${logs.stdout}\n${logs.stderr}`,
    );
  }

  return { backendUrl: `http://${creds.host}:${opts.port}` };
}

export async function setupCaddy(
  creds: SSHCredentials,
  domain: string,
  port: number,
): Promise<void> {
  const block = `\n${domain} {\n    reverse_proxy localhost:${port}\n}\n`;
  const check = await runCommand(
    creds,
    `grep -qF '${domain}' /etc/caddy/Caddyfile 2>/dev/null && echo "exists" || echo "missing"`,
    10_000,
  );

  if (check.stdout.trim() === "exists") {
    await runCommand(
      creds,
      `sed -i '/${domain.replace(/\./g, "\\.")}/,/}/d' /etc/caddy/Caddyfile`,
      10_000,
    );
  }

  await runCommand(
    creds,
    `cat >> /etc/caddy/Caddyfile << 'CADDYEOF'${block}CADDYEOF`,
    10_000,
  );
  await runCommand(creds, "systemctl reload caddy", 15_000);
}

export async function setupWebhookReceiver(
  creds: SSHCredentials,
  webhookPort = 9000,
): Promise<void> {
  const check = await runCommand(
    creds,
    `systemctl is-active website-webhook 2>/dev/null || echo "inactive"`,
    10_000,
  );
  if (check.stdout.trim() === "active") return;

  const receiverDir = "/opt/website-webhook";
  const receiverCode = `#!/usr/bin/env python3
"""Website webhook receiver - auto-deploys backend on GitHub push."""
import hashlib, hmac, json, os, subprocess
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = int(os.environ.get("WEBHOOK_PORT", "${webhookPort}"))

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        parts = self.path.strip("/").split("/")
        if len(parts) < 2 or parts[0] != "webhook":
            self.send_response(404)
            self.end_headers()
            return

        site_slug = parts[1]
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        secret_path = f"/opt/{site_slug}/.webhook-secret"
        if os.path.exists(secret_path):
            secret = open(secret_path).read().strip()
            sig_header = self.headers.get("X-Hub-Signature-256", "")
            expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(sig_header, expected):
                self.send_response(403)
                self.end_headers()
                self.wfile.write(b"Bad signature")
                return

        deploy_script = f"/opt/{site_slug}/deploy.sh"
        if not os.path.exists(deploy_script):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"No deploy script")
            return

        try:
            payload = json.loads(body) if body else {}
            ref = payload.get("ref", "")
            if ref and ref != "refs/heads/main":
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"Skipped non-main branch")
                return
        except json.JSONDecodeError:
            pass

        result = subprocess.run(["bash", deploy_script], capture_output=True, text=True, timeout=300)
        status = 200 if result.returncode == 0 else 500
        self.send_response(status)
        self.end_headers()
        self.wfile.write(json.dumps({"code": result.returncode, "out": result.stdout[-500:]}).encode())

    def log_message(self, fmt, *args):
        pass

if __name__ == "__main__":
    print(f"Webhook receiver on :{PORT}", flush=True)
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
`;

  await runCommand(creds, `mkdir -p ${receiverDir}`, 5_000);
  await runCommand(
    creds,
    `cat > ${receiverDir}/receiver.py << 'PYEOF'\n${receiverCode}\nPYEOF`,
    10_000,
  );

  const serviceFile = `[Unit]
Description=Website Webhook Receiver
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 ${receiverDir}/receiver.py
Environment=WEBHOOK_PORT=${webhookPort}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target`;

  await runCommand(
    creds,
    `cat > /etc/systemd/system/website-webhook.service << 'SVCEOF'\n${serviceFile}\nSVCEOF\nsystemctl daemon-reload && systemctl enable website-webhook && systemctl start website-webhook`,
    15_000,
  );
}
