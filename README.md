<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/logo.svg">
    <img src="docs/logo.svg" alt="ProxCenter Logo" width="120">
  </picture>
</p>

<h1 align="center">ProxCenter</h1>

<p align="center">
  <a href="https://www.proxcenter.io/">www.proxcenter.io</a>
</p>

<p align="center">
  <strong>Enterprise-grade management platform for Proxmox Virtual Environment</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Proxmox-7.x%20%7C%208.x%20%7C%209.x-E57000" alt="Proxmox">
  <img src="https://img.shields.io/badge/License-Community%20%7C%20Enterprise-blue" alt="License">
  <a href="https://github.com/adminsyspro/proxcenter-ui/actions/workflows/docker-publish.yml"><img src="https://github.com/adminsyspro/proxcenter-ui/actions/workflows/docker-publish.yml/badge.svg" alt="Build"></a>
  <a href="https://github.com/adminsyspro/proxcenter-ui/actions/workflows/codeql.yml"><img src="https://github.com/adminsyspro/proxcenter-ui/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
</p>

---

## Overview

**ProxCenter** is a modern web interface for monitoring, managing, and optimizing Proxmox VE infrastructure. Multi-cluster management, cross-hypervisor migration, workload balancing, and more — from a single pane of glass.

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="Dashboard" width="100%">
</p>

---

## Quick Start

```bash
# Community Edition (Free)
curl -fsSL https://proxcenter.io/install/community | sudo bash

# Enterprise Edition
curl -fsSL https://proxcenter.io/install/enterprise | sudo bash -s -- --token YOUR_TOKEN
```

---

## Features

[See the full feature comparison (Community vs Enterprise)](https://proxcenter.io/#comparison)

---

## Architecture

<p align="center">
  <img src="docs/screenshots/architecture.png" alt="Architecture" width="100%">
</p>

- **Single port** (3000) — HTTP + WebSocket from one process
- **Nginx optional** — SSL termination + reverse proxy
- **Enterprise** adds a Go orchestrator for DRS, alerts, reports, etc.

---

## Configuration

After install, ProxCenter runs at `http://your-server:3000`.

Files in `/opt/proxcenter/`:
- `.env` — Environment variables
- `config/orchestrator.yaml` — Backend config (Enterprise only)

**Reverse proxy**: Enable the *"Behind reverse proxy"* toggle in connection settings to prevent failover from switching to internal node IPs.

```bash
cd /opt/proxcenter
docker compose logs -f          # View logs
docker compose pull && docker compose up -d  # Update
docker compose restart          # Restart
```

---

## Requirements

- Docker & Docker Compose
- Proxmox VE 7.x, 8.x or 9.x
- Network access to Proxmox API (port 8006)

## Security

Automated scanning via **CodeQL**, **Trivy**, and **Dependabot**. Report vulnerabilities to [security@proxcenter.io](mailto:security@proxcenter.io).

## License

- **Community**: Free for personal and commercial use
- **Enterprise**: Commercial license — [proxcenter.io/pricing](https://proxcenter.io/pricing)

## Support

- Community: [GitHub Issues](https://github.com/adminsyspro/proxcenter-ui/issues)
- Enterprise: [support@proxcenter.io](mailto:support@proxcenter.io)
