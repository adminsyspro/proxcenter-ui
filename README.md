<p align="center">
  <img src="docs/banner.png" alt="ProxCenter - The Proxmox Datacenter Management Platform" width="100%">
</p>

<p align="center">
  <strong>Enterprise-grade management platform for Proxmox Virtual Environment</strong>
</p>

<p align="center">
  <a href="https://github.com/adminsyspro/proxcenter-ui/stargazers"><img src="https://img.shields.io/github/stars/adminsyspro/proxcenter-ui?style=flat-square&logo=github&label=Star&color=E57000&labelColor=1C1C24" alt="GitHub stars"></a>
  <a href="https://github.com/adminsyspro/proxcenter-ui/releases"><img src="https://img.shields.io/github/v/release/adminsyspro/proxcenter-ui?style=flat-square&label=Release&color=E57000&labelColor=1C1C24" alt="Latest release"></a>
  <a href="https://www.proxmox.com/en/products/proxmox-virtual-environment/overview"><img src="https://img.shields.io/badge/Proxmox%20VE-8.x%20%7C%209.x-F28C28?style=flat-square&logo=proxmox&logoColor=white&labelColor=1C1C24" alt="Proxmox VE 8.x and 9.x"></a>
  <a href="https://www.proxcenter.io/"><img src="https://img.shields.io/badge/License-Community%20%7C%20Enterprise-FFC48A?style=flat-square&labelColor=1C1C24" alt="License Community or Enterprise"></a>
</p>

<p align="center">
  <a href="https://github.com/adminsyspro/proxcenter-ui/actions/workflows/codeql.yml"><img src="https://img.shields.io/github/actions/workflow/status/adminsyspro/proxcenter-ui/codeql.yml?branch=main&style=flat-square&logo=github&label=CodeQL&labelColor=1C1C24" alt="CodeQL"></a>
  <a href="https://github.com/adminsyspro/proxcenter-ui/actions/workflows/security-scan.yml"><img src="https://img.shields.io/github/actions/workflow/status/adminsyspro/proxcenter-ui/security-scan.yml?branch=main&style=flat-square&logo=github&label=Security%20Scan&labelColor=1C1C24" alt="Security Scan"></a>
  <a href="https://sonarcloud.io/summary/overall?id=adminsyspro_proxcenter-ui"><img src="https://img.shields.io/sonar/quality_gate/adminsyspro_proxcenter-ui?server=https%3A%2F%2Fsonarcloud.io&style=flat-square&logo=sonarcloud&label=Quality%20Gate&labelColor=1C1C24" alt="SonarCloud Quality Gate"></a>
</p>

<p align="center">
  <a href="https://www.proxcenter.io/"><b>🌐 Website</b></a> · <a href="https://demo.proxcenter.io/"><b>▶️ Live Demo</b></a> · <a href="https://docs.proxcenter.io/"><b>📖 Documentation</b></a>
</p>

---

## Overview

<p align="center">
  <strong>ProxCenter</strong> is a modern web interface for monitoring, managing, and optimizing Proxmox VE infrastructure. Multi-cluster management, cross-hypervisor migration, workload balancing, and more, all from a single pane of glass.
</p>

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="Modular Dashboard" width="100%">
</p>

---

## Requirements

- **Host**: Linux with Docker Engine 24+ and Docker Compose v2
- **Sizing**: 2 GB RAM and 10 GB disk minimum, more for database growth
- **Ports**: 3000 inbound, outbound to Proxmox VE 8006 and Proxmox Backup Server 8007
- **Proxmox**: Proxmox VE 8.x or 9.x

High availability adds its own sizing and network prerequisites, listed in the [documentation](https://docs.proxcenter.io/operations/ha-prerequisites).

---

## Quick Start

```bash
# Community Edition (Free)
curl -fsSL https://proxcenter.io/install/community | sudo bash

# Enterprise Edition
curl -fsSL https://proxcenter.io/install/enterprise | sudo bash -s -- --token YOUR_TOKEN
```

The installer sets up Docker, the Compose stack, PostgreSQL and the persistent volumes under `/opt/proxcenter`. When it finishes, open `http://your-server:3000` and create the first admin account.

Running behind a reverse proxy? Enable the *"Behind reverse proxy"* toggle in the connection settings, to prevent failover from switching to the internal node IPs.

---

## Features

| Feature | Community | Enterprise |
|---|:---:|:---:|
| Multi-cluster management | ✅ | ✅ |
| Modular dashboard (drag-and-drop widgets) | ✅ | ✅ |
| Advanced VM inventory | ✅ | ✅ |
| Unified storage view | ✅ | ✅ |
| Real-time Ceph monitoring | ✅ | ✅ |
| PBS multi-server management | ✅ | ✅ |
| In-browser consoles (noVNC, SPICE) | ✅ | ✅ |
| Network topology map | ✅ | ✅ |
| Cloud-Init templates | ✅ | ✅ |
| Integrated IPAM | ✅ | ✅ |
| Proxmox firewall rules (cluster, node, guest) | ✅ | ✅ |
| Events & audit logs | ✅ | ✅ |
| Self-hosted / on-premise | ✅ | ✅ |
| Alerts (dashboard widgets in Community, rules, routing and notifications in Enterprise) | 🟡 | ✅ |
| Cross-cluster migration | ❌ | ✅ |
| Hypervisor migration (VMware ESXi, XCP-ng, Nutanix, Hyper-V) | ❌ | ✅ |
| DRS load balancing | ❌ | ✅ |
| Site Recovery (Ceph cross-cluster replication) | ❌ | ✅ |
| Micro-segmentation | ❌ | ✅ |
| sFlow network flow analysis | ❌ | ✅ |
| Rolling updates | ❌ | ✅ |
| CVE vulnerability scanning | ❌ | ✅ |
| Compliance auditing | ❌ | ✅ |
| Change tracking & configuration drift | ❌ | ✅ |
| AI analytics & predictions | ❌ | ✅ |
| Green IT metrics | ❌ | ✅ |
| Custom infrastructure reports | ❌ | ✅ |
| Task center | ❌ | ✅ |
| Syslog / SIEM forwarding | ❌ | ✅ |
| RBAC + LDAP / AD | ❌ | ✅ |
| OIDC SSO (Keycloak, Entra ID, Okta, Auth0) | ❌ | ✅ |
| Virtual Data Centers (vDC) & tenant self-service portal | ❌ | ✅ |
| Full white-label (MSP branding) | ❌ | ✅ |
| ProxCenter HA: highly available control plane (3 nodes, VIP failover) | ❌ | ➕ |
| REST API (service-account tokens) | ❌ | ➕ |

✅ included · 🟡 partial · ❌ not included · ➕ paid add-on on top of Enterprise

See the [documentation](https://docs.proxcenter.io/) for the full feature list and the Community vs Enterprise breakdown.

---

## Screenshots

<table>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/multi-cluster-inventory.png" alt="Multi-cluster Inventory" width="100%"><br><sub><b>Multi-cluster Inventory</b></sub></td>
    <td width="50%" align="center"><img src="docs/screenshots/drs.png" alt="DRS Load Balancing" width="100%"><br><sub><b>DRS Load Balancing</b></sub></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/migration.png" alt="Hypervisor Migration" width="100%"><br><sub><b>Hypervisor Migration</b></sub></td>
    <td width="50%" align="center"><img src="docs/screenshots/ceph.png" alt="Real-Time Ceph Monitoring" width="100%"><br><sub><b>Real-Time Ceph Monitoring</b></sub></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/site-recovery.png" alt="Site Recovery" width="100%"><br><sub><b>Site Recovery</b></sub></td>
    <td width="50%" align="center"><img src="docs/screenshots/alerts.png" alt="Multi-channel Alerts" width="100%"><br><sub><b>Multi-channel Alerts</b></sub></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/network-security.png" alt="Zero Trust Network Security" width="100%"><br><sub><b>Zero Trust Network Security</b></sub></td>
    <td width="50%" align="center"><img src="docs/screenshots/topology.png" alt="Network Topology Map" width="100%"><br><sub><b>Network Topology Map</b></sub></td>
  </tr>
</table>

---

## Architecture

<p align="center">
  <img src="docs/architecture.png" alt="ProxCenter architecture: service topology for the Community and Enterprise deployments" width="100%">
</p>

- **Single exposed port** (3000): HTTP and WebSocket served by one process, with Nginx optional in front for TLS
- **PostgreSQL** is the only source of truth, and schema migrations run at startup
- **Enterprise** adds the Go orchestrator (DRS, jobs, alerts, reports, flow telemetry) and the WeasyPrint sidecar for PDF rendering, both kept on the internal network
- Proxmox VE, Proxmox Backup Server, and the migration sources are reached outbound, with no agent to deploy

### High Availability *(Enterprise)*

<p align="center">
  <img src="docs/architecture-ha.png" alt="ProxCenter HA architecture: three-node control plane with a virtual IP and replicated PostgreSQL" width="100%">
</p>

- Three nodes behind a **Keepalived VIP**, with quorum on 2 of the 3 nodes
- PostgreSQL replicated by **Patroni**, which elects the single writable primary through etcd
- A local **HAProxy** on every node routes database traffic to the current primary and leader-only traffic, DRS included, to the elected orchestrator
- Converting an existing single-node install is driven by the wizard in *Settings > High Availability*, see the [HA prerequisites](https://docs.proxcenter.io/operations/ha-prerequisites)

---

## Upgrade

Pull the new images and restart the stack:

```bash
cd /opt/proxcenter
docker compose pull
docker compose up -d
```

Schema migrations run automatically on startup. Nothing else is required for a Community install.

<details>
<summary><b>Enterprise: when a release adds a setting</b></summary>

`docker compose pull` refreshes the images, never `docker-compose.yml`, and the shipped Compose files pass their environment through an explicit `environment:` list. A setting introduced by a newer release therefore never reaches the container on a pull-only update, whatever `/opt/proxcenter/.env` holds. Re-run the installer to refresh the Compose file:

```bash
curl -fsSL https://proxcenter.io/install/enterprise | sudo bash -s -- --token YOUR_TOKEN
```

It keeps your secrets, your customised `NEXTAUTH_URL` and `APP_URL`, and your license key, leaves the data untouched, then pulls and recreates only the containers whose environment changed. An install that pinned a version in `.env` has to pass it again with `--version`, since a re-run otherwise resets it to `latest`.

</details>

**High availability**: the three nodes run the same Compose file, so the same two commands apply per node. Upgrade one node at a time and keep the version identical across the cluster.

**Coming from v1.3.x or earlier**: SQLite support was removed in v1.4.0 and there is no in-place migration to PostgreSQL. Follow [Upgrade to v1.4](https://docs.proxcenter.io/getting-started/upgrade-v1-4) for the cutover.

Checking the result:

```bash
cd /opt/proxcenter
docker compose ps               # Service status
docker compose logs -f          # Follow the logs
docker compose restart          # Restart the stack
```

---

## Build from source

The Docker install above is the supported path. Building by hand suits hosts without Docker, such as an LXC container, and covers the Community Edition only: the Enterprise features need the closed-source orchestrator.

<details>
<summary><b>Build steps</b></summary>

You need Node.js 22.12 or later, PostgreSQL 16 or later with an empty database, and **4 GB of RAM for the build**. The running application needs far less, around 300 MB.

```bash
VERSION=vX.Y.Z    # the release to install
mkdir -p /opt/proxcenter && cd /opt/proxcenter
curl -fsSL https://github.com/adminsyspro/proxcenter-ui/archive/refs/tags/$VERSION.tar.gz | tar xz --strip-components=1
cd frontend

npm ci --legacy-peer-deps --ignore-scripts
npm run build:icons
npx prisma generate
PROXCENTER_SKIP_TYPECHECK=1 npm run build
```

`PROXCENTER_SKIP_TYPECHECK=1` skips the TypeScript check of `next build`. That check needs about 3 GB of heap on top of the compiler, and CI has already run it on every released tag. Keep it on when you build modified sources, with about 8 GB of RAM and `NODE_OPTIONS=--max-old-space-size=4096`.

Create the environment file, for example `/opt/proxcenter_data/.env`, readable by root only:

```bash
NODE_ENV=production
DATABASE_URL=postgresql://proxcenter:PASSWORD@localhost:5432/proxcenter?schema=public
APP_SECRET=...        # openssl rand -base64 32
NEXTAUTH_SECRET=...   # openssl rand -base64 32
NEXTAUTH_URL=http://your-server:3000
APP_URL=http://your-server:3000
```

Apply the schema, seed the default tenant and roles, then start the server from the `frontend` directory:

```bash
set -a && . /opt/proxcenter_data/.env && set +a
npx prisma migrate deploy
npx prisma db seed
node start.js           # listens on 0.0.0.0:3000, override with PORT and HOSTNAME
```

Run `node start.js` under a service manager, such as a systemd unit with `WorkingDirectory=/opt/proxcenter/frontend` and `EnvironmentFile=/opt/proxcenter_data/.env`. To upgrade, fetch the new tag, repeat the build, run `npx prisma migrate deploy` and restart the service. The seed is idempotent and safe to run again.

</details>

---

## Security

Automated scanning via **CodeQL**, **Trivy**, and **Dependabot**. Report vulnerabilities to [security@proxcenter.io](mailto:security@proxcenter.io).

## Star History

<a href="https://star-history.com/#adminsyspro/proxcenter-ui&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=adminsyspro/proxcenter-ui&type=Date&theme=dark">
    <img src="https://api.star-history.com/svg?repos=adminsyspro/proxcenter-ui&type=Date" alt="Star History Chart" width="100%">
  </picture>
</a>

## License

- **Community**: Free for personal and commercial use
- **Enterprise**: Commercial license

## Support

- Community: [GitHub Issues](https://github.com/adminsyspro/proxcenter-ui/issues)
- Enterprise: [support@proxcenter.io](mailto:support@proxcenter.io)
