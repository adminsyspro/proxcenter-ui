# ProxCenter HA: In-Place Conversion Runbook

This runbook converts a single-VM ProxCenter installation into a 3-node HA cluster. The existing VM becomes node 1.

## Phase 0: Pre-flight

### 0.1 Verify prerequisites

```sh
# On node 1 (existing VM):
docker compose -f docker-compose.enterprise.yml ps          # all services running
docker compose -f docker-compose.enterprise.yml exec postgres pg_isready  # DB reachable
cat /proc/version          # note kernel version
ls -l /dev/watchdog        # watchdog present
```

### 0.2 Snapshot node 1

Take a Proxmox snapshot of the existing VM. This is your rollback point if Phase 3 fails.

```sh
# On the Proxmox host running node 1:
qm snapshot <VMID> pre-ha-conversion --vmstate
```

### 0.3 Prepare node-specific .env files

Copy `.env.ha.example` to `.env` on each node. Fill in:
- `NODE_NAME`, `NODE_IP`, `VRRP_PRIORITY` (per node)
- `PEER1_IP`, `PEER2_IP`, `PEER3_IP`, `VIP` (same on all 3)
- All secrets (same on all 3)
- **Reuse node 1's existing secrets** (`APP_SECRET`, `NEXTAUTH_SECRET`, `POSTGRES_PASSWORD`, `ORCHESTRATOR_API_KEY`) — do NOT generate new values. `APP_SECRET` encrypts stored credentials.

---

## Phase 1: Provision Nodes 2 and 3 (reversible)

### 1.1 Create VMs

On 2 separate Proxmox hosts, create VMs matching node 1's specs. Install Docker and Docker Compose.

### 1.2 Clone the ProxCenter repo

```sh
# On nodes 2 and 3:
git clone <repo-url> /opt/proxcenter
cd /opt/proxcenter
cp .env.ha.example .env
# Edit .env with this node's values
```

### 1.3 Load watchdog module

```sh
echo softdog >> /etc/modules
modprobe softdog
ls -l /dev/watchdog
```

### Rollback: destroy VMs 2 and 3. No changes to node 1 yet.

---

## Phase 2: Form etcd Cluster (reversible)

### 2.1 Start etcd on all 3 nodes

```sh
# On each node:
docker compose -f docker-compose.ha.yml up -d etcd
```

### 2.2 Verify quorum

```sh
# On any node:
docker compose -f docker-compose.ha.yml exec etcd etcdctl endpoint health --cluster
# Expected: 3 healthy endpoints
docker compose -f docker-compose.ha.yml exec etcd etcdctl member list
# Expected: 3 members, all started
```

### Rollback: `docker compose -f docker-compose.ha.yml down` on all 3 nodes. Delete etcd volumes.

---

## Phase 3: Adopt Node 1 Postgres into Patroni (POINT OF NO RETURN at 3.4)

### 3.1 Preflight checklist

```sh
# On node 1:
docker compose -f docker-compose.enterprise.yml exec postgres psql -U proxcenter -c "SHOW wal_log_hints;"
# Must be 'on'. If not:
docker compose -f docker-compose.enterprise.yml exec postgres psql -U proxcenter -c "ALTER SYSTEM SET wal_log_hints = on;"
docker compose -f docker-compose.enterprise.yml restart postgres
```

### 3.2 Take a fresh backup

```sh
docker compose -f docker-compose.enterprise.yml exec postgres pg_dumpall -U proxcenter > /backup/pre-patroni-$(date +%s).sql
```

### 3.3 Stop the existing single-node stack

```sh
docker compose -f docker-compose.enterprise.yml down
```

### 3.4 Configure HAProxy on node 1 (POINT OF NO RETURN)

Replace `PEER1_IP`, `PEER2_IP`, `PEER3_IP` in `config/ha/haproxy.cfg`:

```sh
sed -i "s/PEER1_IP/${PEER1_IP}/g; s/PEER2_IP/${PEER2_IP}/g; s/PEER3_IP/${PEER3_IP}/g" config/ha/haproxy.cfg
```

### 3.5 Start Patroni on node 1 (adopts existing PGDATA)

```sh
docker compose -f docker-compose.ha.yml up -d patroni
# Watch logs:
docker compose -f docker-compose.ha.yml logs -f patroni
# Expected: "initialized a new cluster" or "bootstrapped from existing data"
```

### 3.6 Verify Patroni owns node 1's Postgres

```sh
curl -s http://${NODE_IP}:8008/patroni | jq .
# Expected: {"state": "running", "role": "master", ...}
```

### 3.7 Start HAProxy on node 1

```sh
docker compose -f docker-compose.ha.yml up -d haproxy
# Verify:
psql "postgresql://proxcenter:${POSTGRES_PASSWORD}@127.0.0.1:5432/proxcenter" -c "SELECT 1;"
```

---

## Phase 4: Clone Replicas

### 4.1 Start Patroni on nodes 2 and 3

```sh
# On nodes 2 and 3 (after configuring haproxy.cfg with sed):
sed -i "s/PEER1_IP/${PEER1_IP}/g; s/PEER2_IP/${PEER2_IP}/g; s/PEER3_IP/${PEER3_IP}/g" config/ha/haproxy.cfg
docker compose -f docker-compose.ha.yml up -d patroni haproxy
```

Patroni will automatically `pg_basebackup` from the primary. Monitor:

```sh
docker compose -f docker-compose.ha.yml logs -f patroni
# Expected: "replica has been created" after base backup completes
```

### 4.2 Verify replication and sync mode

```sh
# On node 1:
curl -s http://${NODE_IP}:8008/cluster | jq '.members[] | {name, role, state, lag}'
# Expected: 1 master + 2 replicas, lag = 0
```

### 4.3 Verify strict synchronous mode

```sh
docker compose -f docker-compose.ha.yml exec patroni patronictl show-config
# synchronous_mode: true
# synchronous_mode_strict: true
```

---

## Phase 5: Application Stack + VIP

### 5.1 Start application services on all 3 nodes

```sh
# On each node:
docker compose -f docker-compose.ha.yml up -d frontend orchestrator weasyprint nginx keepalived
```

### 5.2 Verify VIP

```sh
# On any node:
ip addr show ${VIP_INTERFACE} | grep ${VIP}
# Expected: VIP on the highest-priority node (node 1 with priority 150)
```

### 5.3 Verify application via VIP

```sh
curl -k https://${VIP_HOSTNAME}/api/health
# Expected: {"status":"ok","db":"reachable",...}
```

---

## Phase 6: Validation

Run all drills from `failover-drills.md`. Success criteria:

- [ ] Kill primary: replica promoted within 30s, app reconnects
- [ ] Kill VIP holder: VIP migrates within seconds
- [ ] Network partition: no split-brain writes
- [ ] Watchdog: VM reset on simulated Patroni hang
- [ ] Sync standby loss: remaining replica promoted to sync

Only after all drills pass, update DNS to point to the VIP hostname.
