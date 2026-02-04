# ProxCenter

**ProxCenter** is an enterprise-grade management platform for Proxmox Virtual Environment (PVE) clusters. It provides a modern web interface for monitoring, managing, and optimizing your virtualization infrastructure.

![ProxCenter](https://img.shields.io/badge/ProxCenter-Enterprise-orange)
![License](https://img.shields.io/badge/License-Proprietary-blue)
![Go](https://img.shields.io/badge/Go-1.24+-00ADD8?logo=go)
![Next.js](https://img.shields.io/badge/Next.js-16+-black?logo=next.js)

## Features

### Infrastructure Management
- **Multi-cluster support** - Manage multiple Proxmox clusters from a single interface
- **Real-time monitoring** - Live metrics for CPU, memory, storage, and network
- **VM & Container management** - Start, stop, migrate, and configure VMs and LXC containers
- **Storage management** - View and manage storage pools across clusters

### Intelligent Resource Management
- **DRS (Distributed Resource Scheduler)** - Automatic and manual workload balancing
- **Affinity/Anti-affinity rules** - Control VM placement across nodes
- **Capacity planning** - Analyze trends and plan for growth

### Operations
- **Rolling updates** - Orchestrated node updates with automatic VM migration
- **Backup management** - Monitor and manage Proxmox Backup Server (PBS) backups
- **Firewall management** - Centralized firewall rule management

### Enterprise Features
- **PDF Reports** - Generate infrastructure, alerts, utilization, and capacity reports
- **AI-powered insights** - Optional AI analysis for reports (Ollama, OpenAI, Anthropic)
- **Email notifications** - Configurable alerts for events, migrations, and maintenance
- **LDAP/Active Directory** - Enterprise authentication integration
- **Multi-language** - English and French support

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

Default credentials are created on first run - check the console output.

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

## Development

### Frontend

```bash
cd frontend
pnpm dev          # Development server
pnpm build        # Production build
pnpm lint         # Run linter
```

### Backend

```bash
cd backend
go build ./...              # Build all
go test ./...               # Run tests
go run ./cmd/orchestrator   # Run directly
```

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
- Email: support@adminsyspro.com

---

**ProxCenter** - Enterprise Proxmox Management Made Simple
