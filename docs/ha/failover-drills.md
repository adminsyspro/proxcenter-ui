# ProxCenter HA: Failover Drill Procedures

Run these drills after initial deployment (Phase 6) and periodically (quarterly recommended).

## Drill 1: Kill Primary DB

**Purpose:** Verify automatic failover when the Patroni primary is lost.

```sh
# Identify the current primary:
curl -s http://${PEER1_IP}:8008/cluster | jq '.members[] | {name, role}'

# On the primary node, stop Patroni:
docker compose -f docker-compose.ha.yml stop patroni
```

**Expected (within 30s):**
- One replica promoted to primary
- HAProxy repoints `127.0.0.1:5432` to new primary on all nodes
- Application reconnects on next request (brief 500 during switchover)
- VIP stays on its current node (Keepalived check 4 may briefly fail then recover)

**Verify:**
```sh
# On any node:
curl -s http://<other-node-ip>:8008/cluster | jq '.members[] | {name, role, state}'
# New primary should show role: "master"

curl -k https://${VIP_HOSTNAME}/api/health
# Should return {"status":"ok","db":"reachable"}
```

**Success criteria:** RTO < 30s, RPO = 0 (no data loss, strict sync).

**Cleanup:** Restart Patroni on the stopped node. It will rejoin as a replica.
```sh
docker compose -f docker-compose.ha.yml start patroni
```

---

## Drill 2: Kill VIP Holder

**Purpose:** Verify VIP migration when the Keepalived node fails.

```sh
# Identify the VIP holder:
for ip in ${PEER1_IP} ${PEER2_IP} ${PEER3_IP}; do
  ssh root@$ip "ip addr show ${VIP_INTERFACE} | grep ${VIP} && echo VIP_ON_$ip"
done

# On the VIP holder, stop Keepalived:
docker compose -f docker-compose.ha.yml stop keepalived
```

**Expected (within 3-5s):**
- VIP migrates to the next-highest-priority node
- Existing TCP connections to the old VIP holder are dropped
- New connections via VIP reach the new holder's nginx

**Verify:**
```sh
# On another node:
ip addr show ${VIP_INTERFACE} | grep ${VIP}
curl -k https://${VIP_HOSTNAME}/api/health
```

**Success criteria:** VIP migration < 5s.

**Cleanup:** Restart Keepalived. Due to `nopreempt`, VIP stays on the new holder.
```sh
docker compose -f docker-compose.ha.yml start keepalived
```

---

## Drill 3: Network Partition (1 vs 2)

**Purpose:** Verify no split-brain writes during a network partition.

```sh
# On node 1, block traffic to nodes 2 and 3:
iptables -A INPUT -s ${PEER2_IP} -j DROP
iptables -A OUTPUT -d ${PEER2_IP} -j DROP
iptables -A INPUT -s ${PEER3_IP} -j DROP
iptables -A OUTPUT -d ${PEER3_IP} -j DROP
```

**Expected:**
- Node 1 (minority partition) loses etcd quorum
- Patroni on node 1 demotes to replica (cannot confirm writes with no sync standby)
- VIP migrates to the majority partition (nodes 2+3)
- Nodes 2+3 elect a new primary among themselves
- Application via VIP continues serving from the majority

**Verify:**
```sh
# On node 2 or 3:
curl -s http://${PEER2_IP}:8008/cluster | jq '.members[]'
curl -k https://${VIP_HOSTNAME}/api/health
```

**Success criteria:** No writes accepted on the minority side. RPO = 0.

**Cleanup:**
```sh
# On node 1, remove iptables rules:
iptables -D INPUT -s ${PEER2_IP} -j DROP
iptables -D OUTPUT -d ${PEER2_IP} -j DROP
iptables -D INPUT -s ${PEER3_IP} -j DROP
iptables -D OUTPUT -d ${PEER3_IP} -j DROP
```

Node 1's Patroni will rejoin as a replica via `pg_rewind`.

---

## Drill 4: Watchdog Test

**Purpose:** Verify the mandatory watchdog resets the VM when Patroni hangs.

> **WARNING:** This drill will hard-reset the test VM. Only run on non-production or with a fresh snapshot.

```sh
# On the primary node, simulate a Patroni hang by pausing the container:
docker pause $(docker compose -f docker-compose.ha.yml ps -q patroni)
```

**Expected:**
- Patroni stops feeding the watchdog
- After the `safety_margin` (5s) + watchdog timeout (default 60s), the VM is reset
- On reboot, Patroni restarts and rejoins as a replica

**Verify:** The VM rebooted (check `uptime` or `last reboot`).

**Success criteria:** VM reset within the watchdog timeout window.

---

## Drill 5: Sync Standby Loss

**Purpose:** Verify that losing one replica does not block writes.

```sh
# Stop Patroni on one replica (not the primary):
docker compose -f docker-compose.ha.yml stop patroni  # on a replica node
```

**Expected:**
- The remaining replica is promoted to synchronous standby
- Writes continue (the primary now waits for 1 sync standby instead of 2)
- If the remaining replica ALSO goes down, writes block (strict sync, RPO 0)

**Verify:**
```sh
# On the primary:
curl -s http://<primary-ip>:8008/cluster | jq '.members[]'
# Verify: 1 master + 1 sync_standby, 1 missing
```

**Cleanup:** Restart Patroni on the stopped node.

---

## Drill 6: Scheduled Task During Failover

**Purpose:** Verify the leader election `Check()` aborts a running task on failover.

```sh
# Trigger a DRS rebalance or backup on the current leader orchestrator.
# Then kill the Patroni primary to force a failover.

# 1. Identify the orchestrator leader:
# Run on each node locally (orchestrator binds 127.0.0.1 only):
for ip in ${PEER1_IP} ${PEER2_IP} ${PEER3_IP}; do
  ssh root@$ip "curl -s http://127.0.0.1:8080/api/v1/health" | jq -r --arg ip "$ip" '"\($ip): leader=\(.leader)"'
done

# 2. Trigger a long-running task (e.g., scheduled backup via the UI).

# 3. While the task is running, stop Patroni on the primary:
docker compose -f docker-compose.ha.yml stop patroni  # on the DB primary
```

**Expected:**
- HAProxy closes the old connection to the primary
- The orchestrator leader's dedicated connection drops
- `Check()` fails within 30s (periodic check interval)
- The running task is cancelled
- The elector demotes, then reconnects and re-acquires (or another node becomes leader)
- The task runs again at the next scheduled tick on the new leader

**Verify:** Check orchestrator logs for:
- `"leader: heartbeat failed, demoting"`
- `"Leader check failed during task, cancelling"`
- `"leader: acquired leadership"` (on the new leader)
