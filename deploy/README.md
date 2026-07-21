# Two-profile deployment and domain cutover

This directory is the checked-in control plane for moving the 37 exact
`*.oceanleo.com` hosts from 31 legacy Vercel projects to:

- `oceanleo-sites-standard`, rooted at `apps/standard`, for 36 hosts;
- `oceanleo-sites-website-privileged`, rooted at
  `apps/website-privileged`, for `website.oceanleo.com`.

Both projects are fixed to team `team_Jk2R4jQ9GDtSbG2oOXqTRum9`, Node 24,
the `main` production branch, and the same source SHA. Automatic Git
deployments are disabled in each app's `vercel.json`; only the explicit
controller deployment is admitted for this cutover.

## Architecture decision

Three chains were evaluated. Direct provider commands were rejected because
they have no durable receipt, SHA binding, wave barrier, resume cursor, or
mechanical rollback. Extending the existing one-repository/one-project release
saga was rejected because one monorepo now has two independently isolated
project and environment profiles. The selected chain is a repository-checked
manifest plus a dedicated atomic saga controller using Vercel's documented
project, deployment, environment-name, domain-read, and same-team domain-move
APIs.

For environment transfer, manual dashboard copy was rejected because it has no
reviewable source identity, digest agreement gate, redaction boundary, or
idempotent resume. Reusing local helper credentials was rejected because those
operator principals are not evidence for the legacy website runtime principal.
The selected chain is the immutable `environment-mapping.json` contract plus
decrypted reads and stdin-only upserts through `vercel-ops`. Values exist only
in process memory; output contains key names, presence, SHA-256 digests, and
equality results.

The invalidating assumption is that a verified domain can be moved to the
target and returned to its recorded legacy project without a DNS write, while
the new owner is immediately observable. Read-only discovery on 2026-07-21
proved that all 37 hosts are observable exactly once on the recorded 31
legacy projects and that both target names are unused. It did not prove the
mutating move-and-return operation. W0 plus the W1 `asset` canary is the
bounded production proof; a failed canary is returned immediately and blocks
W2-W7.

The invalidating environment assumption is that `decrypt=true` returns the
legacy value bytes without requiring a dashboard export. A read-only
`vercel-ops` probe proved that assumption for all 31 projects and compared
digests in memory without printing values. The provider helper accepts request
bodies as `@-`, so environment values are sent on stdin and never appear in
the helper argument vector.

## Immutable manifest and waves

`cutover-manifest.json` records every old project ID, target profile, exact
host, move order, and rollback owner. `cutover-manifest.sha256` makes any
manifest edit explicit. The loader also validates the 31 rows in
`scripts/oceanleo-sites.tsv`, 37 unique hosts, the 36+1 profile split, wave
counts, alias ordering, and the `ppt.oceanleo.com` redirect.

| Wave | Scope | Hosts |
| --- | --- | ---: |
| W0 | Create/configure both projects and deploy the same SHA with no custom domain | 0 |
| W1 | `asset` canary | 1 |
| W2 | office | 6 |
| W3 | media | 10 |
| W4 | knowledge | 6 |
| W5 | creation | 5 |
| W6 | remaining platform | 8 |
| W7 | website privileged | 1 |

Aliases precede their canonical host inside a wave. Rollback reverses that
order. `ppt.oceanleo.com` is restored to a provider-level 308 redirect to
`slide.oceanleo.com`.

## Command semantics

All commands are dry-run unless `--execute` is present. `plan`, `check`,
`status`, and `cutover:review` are always read-only and reject `--execute`.
Every provider operation goes through `/root/.cursor/bin/vercel-ops`; the
controller never accepts, prints, or stores a provider credential.

```sh
pnpm cutover:plan
pnpm cutover:source-sha
pnpm cutover:review
pnpm cutover:check -- --sha <40-character-sha>
pnpm cutover:create-project -- --sha <40-character-sha> --execute
pnpm cutover:sync-env -- --sha <40-character-sha>
pnpm cutover:sync-env -- --sha <40-character-sha> --execute
pnpm cutover:deploy -- --sha <40-character-sha> --execute
pnpm cutover:move -- --sha <40-character-sha> --wave W1 --execute
pnpm cutover:status
pnpm cutover:rollback -- --wave W1 --execute
```

- `cutover:plan` deterministically resolves `git rev-parse HEAD` and passes it
  as an explicit `--sha` argument. For an externally recorded SHA, use
  `pnpm cutover -- plan --sha <40-character-sha>`.
- `plan` renders the immutable topology and wave sizes without provider
  discovery while retaining the exact SHA binding in its output.
- `check` runs every read-only local, project, deployment, environment-name,
  owner, and W0 probe gate.
- `create-project` creates only a missing exact target; an existing target
  must match every fixed setting.
- `sync-env` decrypts only contract-listed production source keys in memory,
  requires every mapped source digest to agree, rejects missing/ambiguous
  sources and forbidden target names, and is dry-run by default. `--execute`
  creates or updates only exact required target keys, verifies every
  post-write digest, and resumes idempotently.
- `deploy` starts or resumes the two W0 production deployments, waits for
  `READY`, verifies both are the requested SHA, and verifies they have no
  OceanLeo custom domain.
- `move` starts or resumes exactly one wave. It records the move request,
  sanitized provider response, observed target owner, and smoke receipt before
  advancing to the next host.
- `rollback` can act only on the latest touched wave, in reverse order. It is
  deliberately independent of source, inventory, environment, and build
  gates so emergency return remains available.
- `status` reports target setting drift, ledger wave state, and owner counts.

The default durable ledger is
`/var/lib/oceanleo-cutover/ledger.json`; override it with
`OCEANLEO_CUTOVER_LEDGER` or `--ledger`. Writes use a mode-0600 temporary file,
file and directory `fsync`, atomic rename, and an exclusive stale-PID-aware
lock. A ledger is bound to one manifest digest and one source SHA.

## Admission and smoke gates

Mutation is refused unless `HEAD`, `origin/main`, and the requested SHA are
the same full SHA; the branch is `main`; the tree is clean; generated
inventory has zero `pending` and zero `partial`; project settings and
environment key names match; both production deployments are `READY` at the
same SHA; and every manifest host has its expected owner.

W0 probes each deployment URL and requires the profile-specific deterministic
unknown-host response. After a move, owner verification is immediate.
Canonical hosts must pass `/api/health`, `/api/tenant`, and the specialized
`/workspace` route with tenant-isolation headers. Alias hosts must issue an
exact HTTPS 308 to their canonical host. Failure rolls the current wave back
and never touches a later wave.

No controller code calls a DNS, nameserver, domain-registration, domain-add,
domain-remove, project-delete, or legacy-project-delete endpoint.
`sync-env --execute` is the sole environment-write path; it is constrained by
the reviewed mapping digest and uses stdin-only provider bodies. Legacy
projects and their environments remain rollback owners.

## Environment key-name contracts and blockers

Both profiles require only these shared names:

```text
NEXT_PUBLIC_OCEANLEO_ANON_KEY
NEXT_PUBLIC_OCEANLEO_GATEWAY_URL
NEXT_PUBLIC_OCEANLEO_SUPABASE_URL
```

The privileged profile additionally requires:

```text
WEBSITE_SERVER_SSH_KEY
```

Seven provider tokens stay optional until supplied out-of-band (blocked
mappings; no legacy Vercel source). Deploy proceeds without them; privileged
provider features stay unavailable until an operator writes them:

```text
WEBSITE_ALIYUN_ACCESS_KEY_ID
WEBSITE_ALIYUN_ACCESS_KEY_SECRET
WEBSITE_CLOUDFLARE_API_TOKEN
WEBSITE_GITHUB_TOKEN
WEBSITE_RAILWAY_TOKEN
WEBSITE_SUPABASE_MANAGEMENT_TOKEN
WEBSITE_VERCEL_TOKEN
```

Those privileged names and the observed legacy website-only OpenAI,
DashScope, and platform-SSH names are forbidden on the standard target. The
privileged target forbids the observed standard-only
`SUPABASE_SERVICE_ROLE_KEY`, `TRIAL_CHAT_EMAIL`, and
`TRIAL_CHAT_PASSWORD`.

`environment-mapping.json` and its SHA-256 sidecar record every exact
legacy-project/key source, target profile/key, and source-code/API provenance.
Read-only `decrypt=true` discovery found 13 production keys on the legacy
website project. Its exact `OCEANLEO_PLATFORM_SSH_PRIVATE_KEY` usage in
`resolvePlatformTarget` resolves `WEBSITE_SERVER_SSH_KEY`. The three
website-profile shared public keys also have exact sources.

Seven website mappings remain operator holds, not guesses: GitHub, Vercel,
Cloudflare, Supabase-management, Railway, and both Aliyun values are per-user
encrypted `vault_entries` in the legacy runtime, not legacy Vercel project
environment keys. Authenticated local Vercel, Cloudflare, GitHub, and Aliyun
helpers and the installed Supabase helper were checked, but their operator
principals are not accepted as runtime mapping evidence; no Railway helper was
found.

The standard canonical public keys are also blocked by live digest
disagreement across their exact legacy sources. Older fallback names are not
silently substituted because several represent site-specific Supabase
projects. `sync-env` reports source names, presence, digests, and equality but
performs no writes while any one of these blockers remains.

`SUPABASE_SERVICE_ROLE_KEY`, `TRIAL_CHAT_EMAIL`, and
`TRIAL_CHAT_PASSWORD` have no import or `process.env` reference in the current
migrated runtime. They are deliberately excluded; their absence is not a
blocker. Never put a value in the manifest, mapping contract, digest sidecar,
ledger, command line, test output, or review output.

## Verification

Use only the focused checks while developing this control plane:

```sh
pnpm test:cutover
pnpm typecheck:cutover
```

Do not run a local Next production build as a deployment check. The explicit
build scripts and Vercel configuration are exercised by the real W0
deployments after mutation approval.
