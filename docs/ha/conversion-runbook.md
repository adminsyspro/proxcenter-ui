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
- **Reuse node 1's existing secrets** (`APP_SECRET`, `NEXTAUTH_SECRET`, `POSTGRES_PASSWORD`, `ORCHESTRATOR_API_KEY`). `APP_SECRET` encrypts stored credentials.

---

## Phase 1: Provision Nodes 2 and 3 (reversible)

### 1.1 Create VMs

On 2 separate Proxmox hosts, create VMs matching node 1's specs. Install Docker and Docker Compose.

### 1.2 Copy ProxCenter files

```sh
# On nodes 2 and 3:
mkdir -p /opt/proxcenter
# Copy from node 1: docker-compose.ha.yml, config/ha/, .env
scp -r root@<NODE1_IP>:/opt/proxcenter/docker-compose.ha.yml /opt/proxcenter/
scp -r root@<NODE1_IP>:/opt/proxcenter/config /opt/proxcenter/
cp /opt/proxcenter/.env.ha.example /opt/proxcenter/.env
# Edit .env with this node's values (NODE_NAME, NODE_IP, VRRP_PRIORITY)
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
cd /opt/proxcenter
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

### 3.4 Start Patroni on node 1 (POINT OF NO RETURN)

Patroni adopts the existing PGDATA directory.

```sh
docker compose -f docker-compose.ha.yml up -d patroni
# Watch logs:
docker compose -f docker-compose.ha.yml logs -f patroni
# Expected: "initialized a new cluster" or "bootstrapped from existing data"
```

### 3.5 Verify Patroni owns node 1's Postgres

```sh
curl -s http://${NODE_IP}:8008/patroni | jq .
# Expected: {"state": "running", "role": "master", ...}
```

### 3.6 Start HAProxy on node 1

```sh
docker compose -f docker-compose.ha.yml up -d haproxy
# Verify local PG access via HAProxy:
docker compose -f docker-compose.ha.yml exec patroni psql -h 127.0.0.1 -U proxcenter -c "SELECT 1;"
```

---

## Phase 4: Clone Replicas

### 4.1 Start Patroni on nodes 2 and 3

```sh
# On nodes 2 and 3:
cd /opt/proxcenter
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
docker compose -f docker-compose.ha.yml up -d frontend orchestrator weasyprint keepalived
```

### 5.2 Verify VIP

```sh
# On any node:
ip addr show ${VIP_INTERFACE} | grep ${VIP}
# Expected: VIP on the highest-priority node (node 1 with VRRP_PRIORITY=150)
```

### 5.3 Verify application via VIP

```sh
curl -s http://${VIP}:3000/api/health
# Expected: {"status":"ok","db":"reachable",...}
```

### 5.4 Verify VIP redirect

```sh
# From any machine, access a non-VIP node:
curl -s -o /dev/null -w "%{http_code} %{redirect_url}" http://<NODE2_IP>:3000/login
# Expected: 302 http://<VIP>:3000/login
```

---

## Phase 6: Validation

Run all drills from `failover-drills.md`. Success criteria:

- [ ] Login via `http://<VIP>:3000` works
- [ ] HA dashboard shows 3 healthy nodes
- [ ] Kill primary: replica promoted within 30s, app reconnects
- [ ] Kill VIP holder: VIP migrates within seconds
- [ ] Switchover: promote sync standby, clean failover
- [ ] Maintenance: enter/exit on a node, services stop/restart
- [ ] VIP redirect: direct access to a non-VIP node redirects to VIP
- [ ] Version display: all nodes show the same version
