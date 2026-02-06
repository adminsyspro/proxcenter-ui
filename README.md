<p align="center">
  <img src="docs/logo.svg" alt="ProxCenter Logo" width="120">
</p>

<h1 align="center">ProxCenter</h1>

<p align="center">
  <strong>Enterprise-grade management platform for Proxmox Virtual Environment</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-15+-black?logo=next.js" alt="Next.js">
  <img src="https://img.shields.io/badge/Proxmox-7.x%20%7C%208.x%20%7C%209.x-E57000" alt="Proxmox">
  <img src="https://img.shields.io/badge/License-Community%20%7C%20Enterprise-blue" alt="License">
</p>

---

## Overview

**ProxCenter** provides a modern, unified web interface for monitoring, managing, and optimizing your Proxmox virtualization infrastructure. Manage multiple clusters, automate workload balancing, and gain deep insights into your infrastructure.

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="Dashboard" width="100%">
</p>

---

## Quick Start

### Community Edition (Free)

```bash
curl -fsSL https://proxcenter.io/install/community | sudo bash
```

Features included:
- Dashboard & Inventory
- VM/CT Management (Start, Stop, Console)
- Backups & Snapshots browsing
- Storage Management
- Multi-cluster support

### Enterprise Edition

```bash
curl -fsSL https://proxcenter.io/install/enterprise | sudo bash -s -- --token YOUR_TOKEN
```

Additional features:
- DRS (Distributed Resource Scheduler)
- RBAC & LDAP/Active Directory
- Advanced Monitoring & AI Insights
- Automated Jobs & Reports
- Email Notifications
- Priority Support

[Get your Enterprise license →](https://proxcenter.io/pricing)

---

## Features

### 📊 Infrastructure Monitoring

Real-time monitoring with health scores, top consumers, and multi-cluster overview.

- Clusters and nodes status at a glance
- CPU, Memory, and Storage utilization gauges
- Top resource consumers
- Backup status and alerts overview

<p align="center">
  <img src="docs/screenshots/inventory.png" alt="Inventory" width="100%">
</p>

<p align="center">
  <img src="docs/screenshots/inventory-detail.png" alt="Inventory Detail" width="100%">
</p>

---

### 📈 Resource Trends & AI Insights <sup>Enterprise</sup>

Comprehensive resource analysis with historical trends and AI-powered predictions.

- Historical resource usage evolution
- Capacity projections and predictions
- AI-assisted trend analysis
- Green IT / Environmental impact metrics
- Overprovisioning detection

<p align="center">
  <img src="docs/screenshots/ressources.png" alt="Resource Trends" width="100%">
</p>

<p align="center">
  <img src="docs/screenshots/green-it.png" alt="Green IT" width="100%">
</p>

---

### ⚖️ DRS - Distributed Resource Scheduler <sup>Enterprise</sup>

Intelligent workload balancing across your Proxmox nodes.

- Automatic and manual balancing modes
- CPU, memory, and storage-aware scheduling
- Affinity and anti-affinity rules
- Migration recommendations with one-click execution

<p align="center">
  <img src="docs/screenshots/drs.png" alt="DRS" width="100%">
</p>

---

### 🔄 Rolling Updates <sup>Enterprise</sup>

Orchestrated node updates with zero-downtime VM migrations.

- Automated pre-migration before updates
- Progress tracking per node
- Rollback capabilities
- Update scheduling

<p align="center">
  <img src="docs/screenshots/rolling-updates.png" alt="Rolling Updates" width="100%">
</p>

<p align="center">
  <img src="docs/screenshots/rolling-updates-2.png" alt="Rolling Updates Progress" width="100%">
</p>

---

### 🔀 Cross-Cluster Migration <sup>Enterprise</sup>

Migrate VMs between different Proxmox clusters seamlessly.

- Cross-cluster VM migration
- Storage and network mapping
- Live migration support
- Migration progress tracking

<p align="center">
  <img src="docs/screenshots/cross-cluster.png" alt="Cross-Cluster Migration" width="100%">
</p>

---

### 🛡️ Firewall & Micro-segmentation <sup>Enterprise</sup>

Centralized firewall management with Zero Trust security model.

- Security groups management
- VM-level firewall rules
- Cluster-wide policies
- Zero Trust recommendations

<p align="center">
  <img src="docs/screenshots/firewall.png" alt="Firewall" width="100%">
</p>

<p align="center">
  <img src="docs/screenshots/firewall-detail.png" alt="Firewall Rules Detail" width="100%">
</p>

---

### 💾 Backup Monitoring (PBS)

Monitor and manage Proxmox Backup Server datastores.

- Datastore health and capacity
- Backup job monitoring
- Verification status
- Storage statistics

<p align="center">
  <img src="docs/screenshots/backup.png" alt="Backup" width="100%">
</p>

<p align="center">
  <img src="docs/screenshots/backup-detail.png" alt="Backup Detail" width="100%">
</p>

---

### 🗄️ Ceph Storage Management

Monitor and manage Ceph distributed storage clusters.

- Ceph cluster health and status
- OSD nodes monitoring
- Storage pools capacity
- Performance metrics and IOPS
- Replication status

<p align="center">
  <img src="docs/screenshots/ceph-1.png" alt="Ceph Overview" width="100%">
</p>

<p align="center">
  <img src="docs/screenshots/ceph-2.png" alt="Ceph Pools" width="100%">
</p>

<p align="center">
  <img src="docs/screenshots/ceph-3.png" alt="Ceph OSD" width="100%">
</p>

---

### 🚨 Alerts & Notifications <sup>Enterprise</sup>

Comprehensive alerting system with email notifications.

- Real-time alerts dashboard
- Configurable thresholds
- Email notifications (SMTP)
- Alert history and acknowledgment

<p align="center">
  <img src="docs/screenshots/alerts.png" alt="Alerts" width="100%">
</p>

<p align="center">
  <img src="docs/screenshots/notifications.png" alt="Notifications" width="100%">
</p>

---

### 📄 Enterprise Reports <sup>Enterprise</sup>

Generate professional PDF reports with AI-powered insights.

- Infrastructure reports
- Capacity planning reports
- Utilization analysis
- Multi-language support (EN/FR)
- AI-powered recommendations (Ollama, OpenAI, Anthropic)

<p align="center">
  <img src="docs/screenshots/report.png" alt="Report" width="50%">
  <img src="docs/screenshots/report-detail.png" alt="Report Content" width="50%">
</p>

---

### 🎨 Customization

Multiple themes and appearance options.

- Light, Dark, and System modes
- Multiple color schemes
- High contrast accessibility option
- Customizable dashboard

<p align="center">
  <img src="docs/screenshots/themes.png" alt="Themes" width="100%">
</p>

---

### 🔐 Enterprise Authentication <sup>Enterprise</sup>

LDAP and Active Directory integration for enterprise environments.

<p align="center">
  <img src="docs/screenshots/login.png" alt="Login" width="100%">
</p>

<p align="center">
  <img src="docs/screenshots/ldap.png" alt="LDAP Configuration" width="100%">
</p>

---

## Requirements

- Docker & Docker Compose
- Proxmox VE 7.x, 8.x or 9.x
- Network access to Proxmox API (port 8006)

## Installation

### Docker (Recommended)

**Community:**
```bash
curl -fsSL https://proxcenter.io/install/community | sudo bash
```

**Enterprise:**
```bash
curl -fsSL https://proxcenter.io/install/enterprise | sudo bash -s -- --token YOUR_TOKEN
```

### Manual Installation

See [docs/manual-installation.md](docs/manual-installation.md) for manual installation instructions.

## Configuration

After installation, ProxCenter runs at `http://your-server:3000`.

Configuration files are located in `/opt/proxcenter/`:
- `.env` - Environment variables
- `config/orchestrator.yaml` - Backend configuration (Enterprise only)

## Management Commands

```bash
cd /opt/proxcenter

# View logs
docker compose logs -f

# Stop services
docker compose down

# Update to latest version
docker compose pull && docker compose up -d

# Restart services
docker compose restart
```

## License

- **Community Edition**: Free for personal and commercial use
- **Enterprise Edition**: Commercial license required - [proxcenter.io/pricing](https://proxcenter.io/pricing)

## Support

- Documentation: [docs.proxcenter.io](https://docs.proxcenter.io)
- Community: [GitHub Issues](https://github.com/adminsyspro/proxcenter-ui/issues)
- Enterprise Support: [support@proxcenter.io](mailto:support@proxcenter.io)

---

<p align="center">
  <img src="docs/logo.svg" alt="ProxCenter" width="60">
  <br>
  <strong>ProxCenter</strong> - Enterprise Proxmox Management Made Simple
</p>
