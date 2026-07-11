# ProxCenter HA: Prerequisites

## Hardware

- **3 distinct Proxmox hosts** (anti-affinity: no two ProxCenter VMs on the same physical host)
- Recommended per VM: 4 vCPU, 8 GB RAM, 50 GB disk
- Watchdog device: `/dev/watchdog` accessible in each VM (enable `softdog` kernel module: `modprobe softdog`)

## Network

- **L2 connectivity** between all 3 VMs (same VLAN or bridged subnet)
- **1 free IP** for the Virtual IP (VIP), on the same subnet as the 3 node IPs
- No multicast requirement (Keepalived uses unicast VRRP)
- Firewall rules between the 3 nodes:

| Port | Protocol | Purpose |
|------|----------|---------|
| 2379 | TCP | etcd client |
| 2380 | TCP | etcd peer |
| 5432 | TCP | PostgreSQL (Patroni replication) |
| 8008 | TCP | Patroni REST API |
| 112 | VRRP (IP proto) | Keepalived VRRP |

> **Security note:** etcd stores the Patroni DCS state including cluster topology. Ports 2379/2380/8008 MUST be firewalled to allow traffic only between the 3 cluster nodes. On each node:
>
> ```sh
> for port in 2379 2380 8008; do
>   for peer in ${PEER1_IP} ${PEER2_IP} ${PEER3_IP}; do
>     iptables -A INPUT -p tcp --dport $port -s $peer -j ACCEPT
>   done
>   iptables -A INPUT -p tcp --dport $port -j DROP
> done
> ```

## Software

- Docker Engine 24+ and Docker Compose v2 on all 3 nodes
- `softdog` kernel module loaded: `echo softdog >> /etc/modules && modprobe softdog`
- Verify watchdog: `ls -l /dev/watchdog` (should exist and be writable by root)

## Secrets

All 3 nodes must share identical secret values. **For in-place conversions (existing single-node), copy the secrets from node 1's existing `.env` file.** Only generate fresh values for greenfield (new) installs:

```sh
# GREENFIELD ONLY — generate once, copy to all 3 nodes' .env files:
openssl rand -base64 32  # NEXTAUTH_SECRET
openssl rand -base64 32  # APP_SECRET
openssl rand -hex 32     # ORCHESTRATOR_API_KEY
openssl rand -base64 32  # POSTGRES_PASSWORD
```

> **WARNING:** For in-place conversions, you MUST reuse the existing `APP_SECRET` from node 1. It encrypts stored connection credentials — generating a new one makes all stored Proxmox/SSH credentials unreadable.

## TLS

- Certificate with SAN covering the VIP hostname (e.g., `proxcenter.example.com`)
- If TLS is required, deploy a reverse proxy in front of the VIP (see EXTERNAL_URL in `.env.ha.example`)
- Self-signed is acceptable for internal deployments

## Backup

Backup and PITR are the administrator's responsibility. Patroni manages replication but does NOT manage backups. Recommended:

- `pg_basebackup` cron job from one replica
- WAL archiving to external storage (pgBackRest or pg_probackup)
- Test restore procedure before going live
