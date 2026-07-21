# Retirement controller decision

## Outcome

Retire only the 31 legacy provider projects after deterministic rollback evidence
has been sealed and the replacement topology has passed the complete R0-R4
evidence chain. Canonical domains, the six compatibility aliases, immutable
manifests and receipts, audit history, and archived Git history never become
mutation targets.

## Candidate chains

| Chain | Mature components and interoperability | Guarantees and host fit | Moving parts and failure modes | Decision |
|---|---|---|---|---|
| Content-addressed JSON manifest and receipts, hash-chained JSON ledger, Node `crypto`/`fs`, injected provider interface | Uses Node's documented SHA-256, exclusive create, fsync, rename, and file modes; JSON is directly consumable by provider helpers and CI | No service dependency, works on the existing Linux host, allows deterministic dry-runs and fake-provider tests, and retains portable evidence indefinitely | One process lock and two private files; malformed or stale evidence fails closed, and a crash can leave a harmless stale snapshot that is recovered from the authoritative append journal | **Selected** |
| SQLite event store with provider adapters | SQLite transactions and WAL are mature and broadly interoperable | Strong local transactions and querying, but adds a native/runtime dependency and a database backup/inspection contract for a small append-only control plane | Database migration, WAL durability, binary portability, and operator tooling become additional retirement dependencies | Rejected |
| Provider-native workflow state plus GitHub Actions artifacts | Vercel/GitHub APIs and workflow artifacts are mature within their own systems | Centralized execution, but requires network, credentials, artifact-retention configuration, and mutable third-party control planes to evaluate deletion safety | Cross-provider partial failure, artifact expiry, credential loss, and provider outages can erase or obscure authorization evidence | Rejected |

The selected chain ranks highest on production maturity for the required local
control point, environment fit, and fewest moving parts. The manifest fixes the
authorized resource set; immutable receipt envelopes add evidence; the ledger's
hash-chained journal is authoritative and its atomic snapshot is replaceable.
Provider calls are only reachable through explicit stage methods and are dry-run
by default.

## Falsifying assumption

The chain is invalid if this host cannot durably create a private append journal
and atomically replace a private snapshot while preserving mode `0600`.

The pre-implementation proof creates both files in a temporary directory, fsyncs
file and directory entries, replaces the snapshot, and verifies bytes and modes.
Production scaffolding proceeds only after that proof passes.
