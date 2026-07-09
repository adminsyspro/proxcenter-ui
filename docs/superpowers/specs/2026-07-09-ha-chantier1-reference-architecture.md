# Chantier 1: HA Reference Architecture - Implementation Design

- **Date:** 2026-07-09
- **Status:** Design approved
- **Prereq:** Chantier 0 (stateless app) complete on both repos
- **Parent spec:** `2026-07-08-proxcenter-control-plane-ha-design.md`
- **Edition:** Enterprise only

## 1. Goal

Implement the validated 3-node HA stack from the parent spec: etcd, Patroni with mandatory watchdog, HAProxy with session shutdown, Keepalived with health-aware track_script, orchestrator advisory-lock leader election, Prisma migration serialization, plus runbooks for in-place conversion and failover drills.

## 2. Scope

### In scope
- Advisory-lock leader election for the orchestrator scheduler (Go backend code)
- Prisma migration serialization via advisory lock (frontend entrypoint)
- Health endpoint enrichment (leader status, DB reachability)
- Connection pool tuning for failover resilience (both repos)
- `docker-compose.ha.yml` standalone compose for the 3-node HA deployment
- Configuration templates: Patroni, HAProxy, Keepalived, etcd, track_script
- Runbooks: conversion procedure, failover drills, prerequisites

### Out of scope
- Backup/PITR scripts and WAL archiving setup (admin responsibility, not application)
- Deployment wizard UI (Chantier 2, deferred)
- Automatic node re-integration (manual runbook in v1)
- Read-scaling across replicas

## 3. Advisory-Lock Leader Election (Backend Go)

### 3.1 Package: `internal/leader`

New package providing single-leader election for the orchestrator scheduler via PostgreSQL advisory locks.

```go
type Elector struct {
    db        *sql.DB
    lockID    int64          // constant: 0x50524F58 ("PROX")
    conn      *sql.Conn      // dedicated connection (lock is session-scoped)
    isLeader  atomic.Bool
    interval  time.Duration  // 5s default
    onDemote  func()         // callback on lock loss
}

func New(db *sql.DB, opts ...Option) *Elector
func (e *Elector) Start(ctx context.Context)  // goroutine: try_lock loop
func (e *Elector) Stop()                       // release lock, close conn
func (e *Elector) IsLeader() bool
func (e *Elector) Check() error                // fast liveness check on dedicated conn
```

### 3.2 Mechanism

1. `Start` opens a dedicated connection (`db.Conn(ctx)`) and launches a goroutine.
2. Every 5s the goroutine runs a heartbeat cycle:
   - If **not leader**: `SELECT pg_try_advisory_lock(0x50524F58)`. Returns `true`: set `isLeader = true`. Returns `false`: remain standby.
   - If **already leader**: `SELECT 1` on the dedicated connection (heartbeat, no re-acquire). This avoids the `pg_try_advisory_lock` counter-increment gotcha (each successful call increments an internal counter; re-acquiring would require matching unlocks).
3. On connection loss (HAProxy closes session at failover): `isLeader = false` immediately. Goroutine reconnects with exponential backoff (1s, 2s, 4s, ..., capped at 30s) and re-acquires.
4. `Stop()` calls a single `pg_advisory_unlock` then closes the connection.

### 3.3 `Check()` method

`Check()` performs a `SELECT 1` on the dedicated connection and returns an error if the connection is dead. The scheduler calls `Check()` **before each long-running job** (DRS rebalance, migration execution, scheduled backup) and aborts immediately on error. This satisfies the parent spec requirement (Section 3.2): "re-checks lock ownership before each long-running job and stops work immediately on a DB connection drop / failover signal."

### 3.4 Scheduler integration

- `Scheduler` receives an `*Elector` via `SetLeader(e *Elector)`.
- The runner in `scheduler.go` checks `e.IsLeader()` before executing. Non-leader: debug log + skip.
- For long-running tasks (DRS rebalance, migration, backup), the task wrapper calls `e.Check()` at start and periodically (every 30s). On error: abort, log, yield leadership.
- When no `Elector` is set (non-HA / Community mode), all tasks run (backward compatible).

### 3.5 Fencing

The advisory lock is session-scoped on a connection routed through HAProxy. When HAProxy repoints to the new primary, it closes existing connections (`on-marked-down shutdown-sessions`). The old leader's connection drops, the lock is released server-side, and the old leader detects the loss. No zombie window.

### 3.6 Lock ID

Constant `0x50524F58` (ASCII "PROX"). Not configurable. Distinct from the Prisma migration lock ID.

### 3.7 Tests

- Two `Elector` instances on the same DB: only one is leader.
- Kill the leader's connection: the other acquires leadership.
- `Stop()` releases the lock immediately.

## 4. Prisma Migration Serialization (Frontend)

### 4.1 Problem

Three frontends boot simultaneously, each running `prisma migrate deploy` in the entrypoint. Prisma's internal migration lock is not designed for 3 concurrent processes on 3 different machines. Risk of deadlock or P3009 errors.

### 4.2 Solution: `scripts/migrate-with-lock.js`

A Node.js script that wraps migration in a PostgreSQL advisory lock:

```js
// ESM (.mjs) or wrap in async IIFE for CJS compatibility.
const { Client } = require('pg');
const { execFileSync } = require('child_process');

const LOCK_ID = 0x50524D49; // "PRMI" = Prisma Migration

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
  try {
    execFileSync('node', ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
      { stdio: 'inherit' });
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
    await client.end();
  }
})();
```

### 4.3 Design decisions

- **Blocking lock** (`pg_advisory_lock`, not `pg_try_`). First frontend takes the lock and applies migrations. The other two wait (seconds), then pass and see 0 pending migrations.
- **Lock ID** `0x50524D49`, distinct from the leader election lock `0x50524F58`.
- **Dependency:** `pg` package added to `dependencies` in `package.json` (pure JS, no native bindings).
- **Non-HA mode:** works identically. Single frontend takes the lock, applies, releases. Negligible overhead (1 PG roundtrip).

### 4.4 Entrypoint change

In `docker-entrypoint.sh`, replace:
```sh
node node_modules/prisma/build/index.js migrate deploy
```
with:
```sh
node scripts/migrate-with-lock.js
```

### 4.5 Tests

A Vitest test that launches 3 concurrent calls and verifies no P3009 error.

## 5. Health Endpoints

### 5.1 Orchestrator (`/api/v1/health`)

Existing handler (server.go:617). Add a `leader` field to the response payload:

```json
{
  "status": "ok",
  "leader": true,
  "connections": { "..." },
  "version": "1.4.5"
}
```

Source: `elector.IsLeader()`. When no Elector is set (non-HA), `leader` is omitted.

### 5.2 Frontend (`/api/health`)

Add a `db` field:

```json
{
  "status": "ok",
  "db": "reachable"
}
```

A `SELECT 1` via Prisma. On failure: `"db": "unreachable"`, status remains `"ok"` (frontend still serves static pages). The track_script uses this signal.

### 5.3 Keepalived track_script (`config/ha/track_script.sh`)

Executed periodically by Keepalived. All 3 checks must pass for the node to hold the VIP:

```sh
#!/bin/sh
# 1. Frontend up
wget -q --spider --timeout=3 http://127.0.0.1:3000/api/health || exit 1

# 2. Orchestrator up
wget -q --spider --timeout=3 http://127.0.0.1:8080/api/v1/health || exit 1

# 3. DB primary reachable via local HAProxy
wget -q --spider --timeout=3 http://127.0.0.1:8008/primary || exit 1

exit 0
```

A minority-partition node fails check 3 (no reachable primary), so it never holds the VIP.

No write probe (per spec Section 4.2): the Patroni `/primary` check is read-only.

## 6. Connection Resilience

### 6.1 Orchestrator (Go, `database/sql` + pgx)

Pool tuning in `storage.NewDatabase`:
- `SetConnMaxLifetime(5 * time.Minute)`: connections recycled regularly, no zombie sessions.
- `SetConnMaxIdleTime(1 * time.Minute)`: idle connections closed quickly after failover.
- `SetMaxOpenConns(10)`: bounds the pool (3 orchestrators = 30 connections max to primary).

`database/sql` handles retry on dead connections: `Query`/`Exec` failure with `driver.ErrBadConn` causes the pool to discard and reopen. No custom retry code needed. The `LeaderElector` dedicated connection handles its own reconnection (Section 3.2).

### 6.2 Frontend (Prisma)

Prisma Client uses an internal connection pool (query engine). When HAProxy closes a connection, Prisma discards it and opens a new one on the next query.

Tuning via `DATABASE_URL` query params:
- `connection_limit=5`: bounds the pool (3 frontends = 15 connections max).
- `pool_timeout=10`: timeout waiting for a free connection (seconds).

### 6.3 User-facing failover behavior

- In-flight requests at failover moment fail (occasional 500).
- Next request succeeds (new connection to new primary via HAProxy).
- Browser sees at worst a page reload (few seconds).
- No session loss: NextAuth uses JWT, no server-side sessions.

### 6.4 No application-level retry in v1

Retry is at the client layer (browser reload). A server-side retry middleware risks re-executing non-idempotent mutations. YAGNI for v1.

## 7. Docker Compose HA (`docker-compose.ha.yml`)

### 7.1 Deployment model

Each of the 3 VMs runs the same `docker-compose.ha.yml`, parameterized by `.env`:

```env
# Node identity
NODE_NAME=proxcenter-1
NODE_IP=10.0.0.11
VRRP_PRIORITY=150        # 150/100/50 for nodes 1/2/3

# Cluster peers
PEER1_IP=10.0.0.11
PEER2_IP=10.0.0.12
PEER3_IP=10.0.0.13
VIP=10.0.0.10
VIP_INTERFACE=eth0

# Secrets (identical on all 3 nodes)
APP_SECRET=...
NEXTAUTH_SECRET=...
POSTGRES_PASSWORD=...
ORCHESTRATOR_API_KEY=...
```

### 7.2 Services

| Service | Image | Network mode | Notes |
|---|---|---|---|
| `nginx` | nginx:1.27-alpine | host | TLS termination :443, reverse-proxy to frontend :3000 + orchestrator :8080. `ip_hash` for upload-progress session affinity (parent spec Section 6). |
| `frontend` | ghcr.io/.../proxcenter-frontend | bridge | `DATABASE_URL` points to `127.0.0.1:5432` (local HAProxy) |
| `orchestrator` | ghcr.io/.../proxcenter-orchestrator | bridge | DSN points to `127.0.0.1:5432` |
| `weasyprint` | ghcr.io/.../proxcenter-weasyprint | bridge | Unchanged |
| `patroni` | Custom Dockerfile: `postgres:16-alpine` base + Patroni pip install | host | Manages Postgres, etcd connection, replication |
| `etcd` | quay.io/coreos/etcd:v3.5 | host | Peer/client on `NODE_IP` |
| `haproxy` | haproxy:2.9-alpine | host | Listens `127.0.0.1:5432`, routes to Patroni primary |
| `keepalived` | custom alpine + keepalived | host | `network_mode: host` + `NET_ADMIN` for VRRP/VIP |

### 7.3 Network design

`network_mode: host` for nginx, Patroni, etcd, HAProxy, Keepalived: they need real L2 visibility between VMs and/or must bind to the VIP. Frontend/orchestrator/weasyprint stay on internal bridge and access PG via `127.0.0.1:5432` (HAProxy listens on host).

### 7.4 Upload-progress session affinity

The parent spec (Section 6) classifies upload progress (`upload-progress.ts`, in-memory Map) as ephemeral with session affinity as mitigation. nginx uses `ip_hash` upstream directive so a given client IP always hits the same frontend during an upload. This is best-effort: a VIP failover mid-upload loses progress, which is acceptable in v1.

## 8. Configuration Templates

All in `config/ha/` directory in the frontend repo.

### 8.1 `patroni.yml`

Key settings:
- `bootstrap.dcs.synchronous_mode: true`
- `bootstrap.dcs.synchronous_mode_strict: true`
- `bootstrap.dcs.synchronous_node_count: 1`
- `watchdog.mode: required`
- `watchdog.device: /dev/watchdog`
- Replication slots enabled
- `pg_hba` entries for replication and Patroni REST
- `restapi.listen: ${NODE_IP}:8008` (bound to node IP only, not 0.0.0.0, to avoid exposing the unauthenticated REST API beyond the cluster network)
- `restapi.connect_address: ${NODE_IP}:8008`
- Placeholders: `${NODE_NAME}`, `${NODE_IP}`, `${PEER*_IP}`

### 8.2 `haproxy.cfg`

- Frontend: `bind 127.0.0.1:5432`
- Backend: 3 servers (`PEER1/2/3_IP:5432`), each with `check port 8008` (health check on Patroni REST port, not the PG port)
- `option httpchk GET /primary` (returns 200 only on the current primary)
- `on-marked-down shutdown-sessions`
- `rise 1 fall 2 inter 1000ms`
- Explicit `timeout connect 3s / timeout server 30s / timeout client 30s`

### 8.3 `keepalived.conf`

- `vrrp_script chk_proxcenter` pointing to `track_script.sh`
- `vrrp_instance VI_PROXCENTER` with `virtual_ipaddress = ${VIP}`
- `priority = ${VRRP_PRIORITY}`
- `nopreempt` (VIP does not auto-return to node 1 after recovery, avoids double failover)
- `interface = ${VIP_INTERFACE}`

### 8.4 `etcd.conf`

- `initial-cluster` with 3 peers
- `initial-cluster-state: new`
- Peer/client URLs on `${NODE_IP}`
- TLS: self-signed certs generated at provisioning time (not by compose)
- Auth: enabled (root + proxcenter user with restricted key prefix)
- Auto-compaction: `auto-compaction-mode: periodic`, `auto-compaction-retention: 1h`
- Defrag: documented in the conversion runbook as a periodic admin task (not automated by the application)

### 8.5 `nginx.conf`

- TLS termination on `:443` with certificate whose SAN covers the VIP hostname
- `upstream frontend` with `ip_hash` for upload-progress session affinity
- `proxy_pass` to `127.0.0.1:3000` (frontend) and `127.0.0.1:8080` (orchestrator API, under `/orchestrator/`)
- WebSocket upgrade support for the SSH/console proxy
- Redirect `:80` to `:443`

### 8.6 `track_script.sh`

See Section 5.3.

## 9. Runbooks

All in `docs/ha/` directory.

### 9.1 `prerequisites.md`

- Network: L2 connectivity between 3 VMs, one free IP for VIP
- Hardware: 3 distinct Proxmox hosts (anti-affinity)
- Software: Docker + Docker Compose, watchdog kernel module (`modprobe softdog`)
- Secrets: identical `APP_SECRET`, `NEXTAUTH_SECRET`, `POSTGRES_PASSWORD`, `ORCHESTRATOR_API_KEY` on all 3 nodes
- TLS: certificate with SAN covering VIP hostname
- Backup recommendation (admin responsibility, not application)

### 9.2 `conversion-runbook.md`

Step-by-step in-place conversion from single-VM to 3-node HA, following Phase 0-6 from the parent spec:

- Phase 0: prerequisites check, Proxmox snapshot of node 1
- Phase 1: provision nodes 2 and 3, install stack (reversible)
- Phase 2: form etcd 3-node quorum (reversible)
- Phase 3: adopt node 1 Postgres into Patroni (fresh backup, preflight checklist, handover, point of no return)
- Phase 4: clone replicas via pg_basebackup, enable strict sync
- Phase 5: HAProxy + Keepalived + VIP, frontend/orchestrator repointed to 127.0.0.1:5432
- Phase 6: validation drills

Each phase: exact commands, pre/post checks, rollback procedure.

### 9.3 `failover-drills.md`

Post-deployment validation procedures:

- **Kill primary:** stop Patroni on primary node. Expected: replica promoted within 30s, HAProxy repoints, VIP stays or migrates, app reconnects.
- **Kill VIP holder:** stop Keepalived on VIP node. Expected: VIP migrates to next priority node within seconds.
- **Network partition 1v2:** iptables block between node 1 and nodes 2+3. Expected: minority node demoted, VIP in majority partition, no split-brain writes.
- **Watchdog path:** prevent Patroni from demoting Postgres (simulate hang). Expected: watchdog resets the VM.
- **Sync standby loss:** stop one replica. Expected: second replica promoted to synchronous.

- **Scheduled backup/task during failover:** trigger a scheduled backup or DRS rebalance, then kill the leader mid-job. Expected: the `Check()` call (Section 3.3) detects connection loss, job aborts cleanly, new leader picks up at next scheduled tick.

For each drill: command, expected result, success criteria (RTO, RPO 0 verification).

## 10. Implementation Order

Bottom-up, code first:

1. **Advisory-lock leader election** (backend) - testable in isolation
2. **Scheduler integration** (backend) - wire Elector into Scheduler
3. **Health endpoint: leader status** (backend) - expose leader in /health
4. **Connection pool tuning** (backend) - storage.NewDatabase pool params
5. **Prisma migration lock** (frontend) - migrate-with-lock.js + entrypoint
6. **Health endpoint: DB reachability** (frontend) - /api/health db field
7. **Connection pool tuning** (frontend) - DATABASE_URL params
8. **docker-compose.ha.yml** (frontend repo) - full HA compose (8 services incl. nginx)
9. **Config templates** (frontend repo) - nginx/patroni/haproxy/keepalived/etcd/track_script
10. **Runbooks** (frontend repo) - prerequisites, conversion, drills

Tasks 1-7: testable locally with unit/integration tests.
Tasks 8-9: validated on test VMs.
Task 10: documentation, validated by review.
