# ProxCenter HA: In-Place Conversion Runbook

This runbook covers converting a single-VM ProxCenter installation into a
3-node HA cluster. The existing VM becomes node 1.

**The supported conversion path is the wizard** (Settings, High Availability
tab): it validates the environment, provisions nodes 2 and 3 over SSH, and
runs the 18-step conversion with progress streaming. This document explains
what the wizard does, where its safety artifacts live, how failures roll
back, and how to convert or recover manually.

## 1. Before you start

### 1.1 Snapshot node 1 (mandatory)

Take a Proxmox snapshot of the existing VM. The wizard will not start the
deployment until you confirm this with the "I have taken a VM snapshot of
this server" checkbox; the snapshot is the last-resort rollback if
everything else fails.

```sh
# On the Proxmox host running node 1:
qm snapshot <VMID> pre-ha-conversion --vmstate
```

### 1.2 Check the prerequisites

See `prerequisites.md`. The wizard's validation step enforces the
registry-access and port checks automatically; fix anything it reports
before deploying.

### 1.3 Note about the compose file

The official installer deploys the single-node stack as
`/opt/proxcenter/docker-compose.yml`. The commands below use that name.
Customized installs (renamed compose file, `COMPOSE_PROJECT_NAME`, `docker
compose -p`) are supported: the wizard detects the running stack's actual
compose file and project name from the postgres container's labels and
targets exactly that stack. It refuses to proceed when no running postgres
container is found.

### 1.4 `.env` preservation

The wizard first copies node 1's `.env` to `.env.pre-ha` (kept forever),
then MERGES the HA settings into it: every existing key (`NEXTAUTH_URL`,
`GHCR_TOKEN`, `LICENSE_KEY`, SMTP, proxies, custom keys) is preserved
verbatim. Nothing is dropped.

## 2. What the wizard does

Steps 1-12 run from the orchestrator with live progress: SSH key injection,
file distribution, image pre-pulls on all 3 nodes (everything from ghcr.io,
see `prerequisites.md`), and the etcd cluster bootstrap. Step 13 hands off
to a detached conversion script on node 1 (the old stack's shutdown takes
the orchestrator down with it); steps 13-18 stop the old stack, adopt its
Postgres into Patroni, clone the replicas, and start the full HA stack on
all 3 nodes. The wizard page reconnects automatically once node 1 is back.

## 3. The pre-cutover backup

Right before stopping the old stack (step 13), the conversion script writes
a full `pg_dumpall` to:

```
/opt/proxcenter/backup-pre-patroni.sql
```

- The dump is size-checked before the old stack is stopped; a failed or
  suspiciously small dump aborts the conversion while the old stack still
  runs.
- The file is KEPT after a successful conversion. Delete it manually once
  the cluster has been validated (it contains the full database).
- Restore procedure (disaster recovery onto a fresh single-node install):

```sh
cd /opt/proxcenter
docker compose -f docker-compose.yml up -d postgres
docker compose -f docker-compose.yml exec -T postgres psql -U proxcenter -d postgres \
  < /opt/proxcenter/backup-pre-patroni.sql
docker compose -f docker-compose.yml up -d
```

## 4. Failure handling and rollback

- **Failure during steps 13-15** (before both replicas exist): the script's
  error trap stops whatever HA services it started, restarts the OLD stack
  (same compose file and project it detected), waits for its Postgres, and
  records the failure (step, error, timestamp) in the database. The wizard
  shows `failed` at the exact step; the old stack is serving again.
- **Failure during steps 16-18** (replicas exist, cluster viable): no
  rollback. The failure is recorded with step detail; use the HA dashboard
  ops (reinit, switchover) to finish recovery.
- **Retry Deployment** resumes safely: it never wipes a live etcd/Patroni
  cluster.

Operator artifacts on node 1:

- `/opt/proxcenter/ha-convert-status.json`: last status written by the
  conversion script, format `{"v":1, "step": <n>, "ok": <bool>, "error":
  "<msg>", "timestamp": "<iso>"}`. This file is an operator breadcrumb; the
  database record is the mechanism the wizard reads.
- `/opt/proxcenter/ha-convert.log`: full script output. Removed on success,
  kept on failure.
- `/opt/proxcenter/.env.pre-ha`: the pre-conversion `.env`, kept forever.

If even the database write failed (old stack unrestorable), those files plus
the VM snapshot from step 1.1 are the manual-recovery path.

## 5. Manual conversion (recovery / air-gap-adjacent setups)

Only for recovery or when the wizard cannot be used. Every value comes from
`.env` (see `.env.ha.example`).

### Phase 1: provision nodes 2 and 3 (reversible)

On 2 separate Proxmox hosts, create VMs matching node 1's specs, install
Docker Engine 24+ and Compose v2, then:

```sh
mkdir -p /opt/proxcenter
scp root@<NODE1_IP>:/opt/proxcenter/docker-compose.ha.yml /opt/proxcenter/
scp -r root@<NODE1_IP>:/opt/proxcenter/config /opt/proxcenter/
# Create /opt/proxcenter/.env from .env.ha.example with this node's values
# (NODE_NAME, NODE_IP, VRRP_PRIORITY) and node 1's shared secrets.
docker login ghcr.io   # with GHCR_USERNAME / GHCR_TOKEN
```

Rollback: destroy VMs 2 and 3. No changes to node 1 yet.

### Phase 2: form the etcd cluster (reversible)

```sh
# On each node:
cd /opt/proxcenter
docker compose -f docker-compose.ha.yml up -d etcd
# On any node:
docker compose -f docker-compose.ha.yml exec etcd etcdctl endpoint health --cluster
# Expected: 3 healthy endpoints
```

Rollback: `docker compose -f docker-compose.ha.yml down` on all 3 nodes and delete the etcd volumes.

### Phase 3: adopt node 1's Postgres into Patroni (POINT OF NO RETURN at 3.4)

```sh
# 3.1 On node 1, ensure wal_log_hints:
docker compose -f docker-compose.yml exec postgres psql -U proxcenter -c "SHOW wal_log_hints;"
# Must be 'on'. If not:
docker compose -f docker-compose.yml exec postgres psql -U proxcenter -c "ALTER SYSTEM SET wal_log_hints = on;"
docker compose -f docker-compose.yml restart postgres

# 3.2 Fresh backup (same location the wizard uses):
docker compose -f docker-compose.yml exec -T postgres pg_dumpall -U proxcenter \
  > /opt/proxcenter/backup-pre-patroni.sql

# 3.3 Stop the single-node stack:
docker compose -f docker-compose.yml down

# 3.4 Start Patroni on node 1 (POINT OF NO RETURN, adopts the existing PGDATA):
docker compose -f docker-compose.ha.yml up -d patroni
docker compose -f docker-compose.ha.yml logs -f patroni

# 3.5 Verify Patroni owns node 1's Postgres:
curl -s http://${NODE_IP}:8008/patroni
# Expected: "state": "running" and a leader role

# 3.6 Start HAProxy on node 1:
docker compose -f docker-compose.ha.yml up -d haproxy
```

### Phase 4: clone the replicas

```sh
# On nodes 2 and 3:
cd /opt/proxcenter
docker compose -f docker-compose.ha.yml up -d patroni haproxy
docker compose -f docker-compose.ha.yml logs -f patroni   # wait for the basebackup

# On node 1:
curl -s http://${NODE_IP}:8008/cluster
# Expected: 1 leader + 2 replicas, lag 0
```

### Phase 5: application stack and VIP

```sh
# On each node:
docker compose -f docker-compose.ha.yml up -d frontend orchestrator weasyprint keepalived
# Verify:
ip addr show ${VIP_INTERFACE} | grep ${VIP}
curl -s http://${VIP}:3000/api/health          # {"status":"healthy","db":"reachable",...}
curl -s http://${VIP}:3000/api/health/live     # {"status":"alive",...}
```

### Phase 6: validation

Run all drills from `failover-drills.md`. Success criteria:

- [ ] Login via the VIP (or the preserved external URL, see `reverse-proxy.md`) works
- [ ] HA dashboard shows 3 healthy nodes
- [ ] Kill primary: replica promoted within 30s, app reconnects
- [ ] Kill VIP holder: VIP migrates within seconds
- [ ] Switchover: promote sync standby, clean failover
- [ ] Maintenance: enter/exit on a node, services stop/restart
- [ ] VIP redirect: direct access to a non-VIP node redirects to the VIP
- [ ] Version display: all nodes show the same version

## 6. FQDN / reverse-proxy installs

Installs accessed through an external URL (TLS proxy, OIDC) keep that URL
through the conversion; the only admin action is repointing the proxy at the
VIP. See `reverse-proxy.md`.
