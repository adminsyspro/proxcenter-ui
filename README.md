<p align="center">
  <img src="docs/logo.png" alt="ProxCenter Logo" width="120">
</p>

<h1 align="center">ProxCenter</h1>

<p align="center">
  <strong>Enterprise-grade management platform for Proxmox Virtual Environment</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/ProxCenter-Enterprise-orange" alt="ProxCenter Enterprise">
  <img src="https://img.shields.io/badge/Go-1.24+-00ADD8?logo=go" alt="Go">
  <img src="https://img.shields.io/badge/Next.js-16+-black?logo=next.js" alt="Next.js">
  <img src="https://img.shields.io/badge/Proxmox-7.x%20%7C%208.x-E57000" alt="Proxmox">
</p>

---

## Overview

**ProxCenter** provides a modern, unified web interface for monitoring, managing, and optimizing your Proxmox virtualization infrastructure. Manage multiple clusters, automate workload balancing, and gain deep insights into your infrastructure.

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="Dashboard" width="100%">
</p>

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

### 📈 Resource Trends & AI Insights

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

### ⚖️ DRS - Distributed Resource Scheduler

Intelligent workload balancing across your Proxmox nodes.

- Automatic and manual balancing modes
- CPU, memory, and storage-aware scheduling
- Affinity and anti-affinity rules
- Migration recommendations with one-click execution

<p align="center">
  <img src="docs/screenshots/drs.png" alt="DRS" width="100%">
</p>

---

### 🔄 Rolling Updates

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

### 🔀 Cross-Cluster Migration

Migrate VMs between different Proxmox clusters seamlessly.

- Cross-cluster VM migration
- Storage and network mapping
- Live migration support
- Migration progress tracking

<p align="center">
  <img src="docs/screenshots/cross-cluster.png" alt="Cross-Cluster Migration" width="100%">
</p>

---

### 🛡️ Firewall & Micro-segmentation

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

### 🚨 Alerts & Notifications

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

### 📄 Enterprise Reports

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

### 🔐 Enterprise Authentication

LDAP and Active Directory integration for enterprise environments.

<p align="center">
  <img src="docs/screenshots/ldap.png" alt="LDAP" width="100%">
</p>

---

## Architecture

```
proxcenter/
├── frontend/          # Next.js web application
│   ├── src/
│   │   ├── app/       # Next.js App Router
│   │   ├── components/
│   │   └── lib/
│   └── prisma/        # Database schema
│
└── backend/           # Go orchestrator service
    ├── cmd/
    │   └── orchestrator/
    └── internal/
        ├── api/       # REST API handlers
        ├── drs/       # Resource scheduler
        ├── metrics/   # Metrics collection
        ├── proxmox/   # Proxmox API client
        ├── reports/   # PDF report generation
        └── ...
```

## Requirements

### Frontend
- Node.js 18+ or 20+
- pnpm (recommended) or npm

### Backend
- Go 1.24+
- SQLite3

### Runtime
- Proxmox VE 7.0+ or 8.0+
- Network access to Proxmox API (port 8006)

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/adminsyspro/proxcenter.git
cd proxcenter
```

### 2. Configure the Backend

```bash
cd backend

# Copy example configuration
cp config.yaml.example config.yaml

# Edit config.yaml with your settings
# Important: Set app_secret to match frontend APP_SECRET

# Build the orchestrator
go build -o orchestrator ./cmd/orchestrator

# Create data directory
mkdir -p data

# Run the orchestrator
./orchestrator
```

### 3. Configure the Frontend

```bash
cd frontend

# Copy example environment
cp .env.example .env

# Edit .env with your settings
# Important: Set APP_SECRET (must match backend config)

# Install dependencies
pnpm install

# Initialize the database
pnpm prisma migrate deploy

# Run development server
pnpm dev
```

### 4. Access ProxCenter

Open http://localhost:3000 in your browser.

## Configuration

### Frontend (.env)

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | SQLite database path | `file:./data/proxcenter.db` |
| `APP_SECRET` | Encryption key for credentials | Required |
| `NEXTAUTH_SECRET` | NextAuth.js session secret | Required |
| `NEXTAUTH_URL` | Application URL | `http://localhost:3000` |
| `ORCHESTRATOR_URL` | Backend API URL | `http://localhost:8080` |

### Backend (config.yaml)

See `backend/config.yaml.example` for all available options.

Key settings:
- `proxmox.app_secret` - Must match frontend `APP_SECRET`
- `proxmox.proxcenter_db_path` - Path to frontend database
- `drs.*` - Resource scheduler configuration
- `notifications.email.*` - SMTP settings for alerts

## Production Deployment

### Using Docker

```bash
cd backend
docker-compose up -d
```

### Manual Deployment

1. Build frontend: `cd frontend && pnpm build`
2. Build backend: `cd backend && go build -o orchestrator ./cmd/orchestrator`
3. Configure reverse proxy (nginx/traefik)
4. Set up systemd services
5. Configure SSL certificates

## License

ProxCenter is proprietary software. Enterprise licenses are available for commercial use.

## Support

- GitHub Issues: [adminsyspro/proxcenter](https://github.com/adminsyspro/proxcenter/issues)

---

<p align="center">
  <img src="docs/logo.png" alt="ProxCenter" width="60">
  <br>
  <strong>ProxCenter</strong> - Enterprise Proxmox Management Made Simple
</p>
