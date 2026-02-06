#!/bin/bash
set -e

# ============================================
# ProxCenter Enterprise Installation Script
# ============================================
# Usage: curl -fsSL https://get.proxcenter.io/enterprise | sudo bash -s -- --token YOUR_GHCR_TOKEN
# ============================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="/opt/proxcenter"
COMPOSE_URL="https://raw.githubusercontent.com/adminsyspro/proxcenter/main/docker-compose.enterprise.yml"
REGISTRY="ghcr.io"
REGISTRY_USER="adminsyspro"
FRONTEND_IMAGE="ghcr.io/adminsyspro/proxcenter-frontend:latest"
ORCHESTRATOR_IMAGE="ghcr.io/adminsyspro/proxcenter-orchestrator:latest"

# ============================================
# Helper Functions
# ============================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

print_banner() {
    echo -e "${CYAN}"
    cat << 'EOF'
  ____                 ____           _
 |  _ \ _ __ _____  __/ ___|___ _ __ | |_ ___ _ __
 | |_) | '__/ _ \ \/ / |   / _ \ '_ \| __/ _ \ '__|
 |  __/| | | (_) >  <| |__|  __/ | | | ||  __/ |
 |_|   |_|  \___/_/\_\\____\___|_| |_|\__\___|_|

EOF
    echo -e "${NC}"
    echo -e "${GREEN}Enterprise Edition${NC} - Full Featured"
    echo "============================================="
    echo ""
}

show_usage() {
    echo "Usage: $0 --token <GHCR_TOKEN> [options]"
    echo ""
    echo "Required:"
    echo "  --token <token>    GitHub Container Registry token (PAT with read:packages)"
    echo ""
    echo "Options:"
    echo "  --license <key>    License key for activation"
    echo "  --version <tag>    Specific version to install (default: latest)"
    echo "  --help             Show this help message"
    echo ""
    echo "Get your token at: https://proxcenter.io/account/tokens"
    exit 1
}

# ============================================
# Parse Arguments
# ============================================

GHCR_TOKEN=""
LICENSE_KEY=""
VERSION="latest"

while [[ $# -gt 0 ]]; do
    case $1 in
        --token)
            GHCR_TOKEN="$2"
            shift 2
            ;;
        --license)
            LICENSE_KEY="$2"
            shift 2
            ;;
        --version)
            VERSION="$2"
            shift 2
            ;;
        --help|-h)
            show_usage
            ;;
        *)
            log_error "Unknown option: $1"
            ;;
    esac
done

# ============================================
# Check Requirements
# ============================================

check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "This script must be run as root. Use: sudo bash install-enterprise.sh --token YOUR_TOKEN"
    fi
}

check_token() {
    if [ -z "$GHCR_TOKEN" ]; then
        echo -e "${RED}Error: GHCR token is required${NC}"
        echo ""
        show_usage
    fi
}

detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        VERSION_ID=$VERSION_ID
    elif [ -f /etc/debian_version ]; then
        OS="debian"
    elif [ -f /etc/redhat-release ]; then
        OS="rhel"
    else
        log_error "Unsupported operating system"
    fi

    log_info "Detected OS: $OS $VERSION_ID"

    case $OS in
        ubuntu|debian)
            PKG_MANAGER="apt-get"
            PKG_UPDATE="apt-get update"
            PKG_INSTALL="apt-get install -y"
            ;;
        centos|rhel|rocky|almalinux|fedora)
            PKG_MANAGER="dnf"
            PKG_UPDATE="dnf check-update || true"
            PKG_INSTALL="dnf install -y"
            ;;
        *)
            log_error "Unsupported OS: $OS"
            ;;
    esac
}

# ============================================
# Install Docker
# ============================================

install_docker() {
    if command -v docker &> /dev/null; then
        log_success "Docker is already installed"
        return
    fi

    log_info "Installing Docker..."

    case $OS in
        ubuntu|debian)
            apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
            $PKG_INSTALL ca-certificates curl gnupg lsb-release
            install -m 0755 -d /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/$OS/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
            chmod a+r /etc/apt/keyrings/docker.gpg
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
            apt-get update
            $PKG_INSTALL docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            ;;
        centos|rhel|rocky|almalinux|fedora)
            dnf remove -y docker docker-client docker-client-latest docker-common docker-latest docker-latest-logrotate docker-logrotate docker-engine 2>/dev/null || true
            $PKG_INSTALL dnf-plugins-core
            dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
            $PKG_INSTALL docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            ;;
    esac

    systemctl start docker
    systemctl enable docker

    log_success "Docker installed"
}

# ============================================
# Authenticate to GHCR
# ============================================

authenticate_ghcr() {
    log_info "Authenticating to GitHub Container Registry..."

    echo "$GHCR_TOKEN" | docker login "$REGISTRY" -u "$REGISTRY_USER" --password-stdin

    if [ $? -ne 0 ]; then
        log_error "Failed to authenticate to GHCR. Please check your token."
    fi

    log_success "Authenticated to GHCR"
}

# ============================================
# Setup ProxCenter
# ============================================

setup_proxcenter() {
    log_info "Setting up ProxCenter Enterprise..."

    # Create install directory
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR/config"
    cd "$INSTALL_DIR"

    # Download docker-compose file
    log_info "Downloading configuration..."
    curl -fsSL "$COMPOSE_URL" -o docker-compose.yml

    # Generate secrets
    log_info "Generating secrets..."
    APP_SECRET=$(openssl rand -hex 32)
    NEXTAUTH_SECRET=$(openssl rand -hex 32)

    # Get server IP
    SERVER_IP=$(hostname -I | awk '{print $1}' | head -1)
    if [ -z "$SERVER_IP" ]; then
        SERVER_IP="localhost"
    fi

    # Create .env file
    cat > "$INSTALL_DIR/.env" << EOF
# ProxCenter Enterprise Edition
# Generated on $(date)

# Docker Registry
GHCR_TOKEN=$GHCR_TOKEN

# Version
VERSION=$VERSION

# Secrets
APP_SECRET=$APP_SECRET
NEXTAUTH_SECRET=$NEXTAUTH_SECRET
NEXTAUTH_URL=http://$SERVER_IP:3000

# License (optional - can be activated via UI)
LICENSE_KEY=${LICENSE_KEY:-}

# Orchestrator
ORCHESTRATOR_URL=http://orchestrator:8080
EOF

    # Create orchestrator config
    cat > "$INSTALL_DIR/config/orchestrator.yaml" << EOF
# ProxCenter Orchestrator Configuration
# Generated on $(date)

server:
  port: 8080
  mode: production

database:
  path: /app/data/orchestrator.db

proxmox:
  proxcenter_db_path: /app/shared_data/proxcenter.db

license:
  key: "${LICENSE_KEY:-}"

logging:
  level: info
  format: json
EOF

    chmod 600 "$INSTALL_DIR/.env"
    chmod 600 "$INSTALL_DIR/config/orchestrator.yaml"

    log_success "Configuration created"
}

# ============================================
# Start Services
# ============================================

start_services() {
    log_info "Pulling Docker images..."
    cd "$INSTALL_DIR"
    docker compose pull

    log_info "Initializing database..."
    docker volume create proxcenter_data 2>/dev/null || true
    docker volume create orchestrator_data 2>/dev/null || true

    # Initialize data directory
    docker run --rm --user root \
        -v proxcenter_data:/app/data \
        "$FRONTEND_IMAGE" \
        sh -c "mkdir -p /app/data && chown -R 1001:1001 /app/data"

    # Run migrations
    docker run --rm \
        -v proxcenter_data:/app/data \
        -e DATABASE_URL="file:/app/data/proxcenter.db" \
        "$FRONTEND_IMAGE" \
        sh -c "prisma db push --schema /app/prisma/schema.migrate.prisma --accept-data-loss --skip-generate" 2>/dev/null || true

    log_info "Starting ProxCenter Enterprise..."
    docker compose up -d

    log_success "ProxCenter Enterprise started"
}

# ============================================
# Wait and Print Success
# ============================================

wait_and_finish() {
    log_info "Waiting for services to be ready..."

    # Wait for frontend
    local attempt=1
    while [ $attempt -le 30 ]; do
        if curl -s -f http://localhost:3000/api/health > /dev/null 2>&1; then
            break
        fi
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done
    echo ""

    # Wait for orchestrator
    attempt=1
    while [ $attempt -le 30 ]; do
        if curl -s -f http://localhost:8080/api/v1/health > /dev/null 2>&1; then
            break
        fi
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done
    echo ""

    SERVER_IP=$(hostname -I | awk '{print $1}' | head -1)

    echo ""
    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN}   ProxCenter Enterprise is ready!${NC}"
    echo -e "${GREEN}============================================${NC}"
    echo ""
    echo -e "Open: ${CYAN}http://$SERVER_IP:3000${NC}"
    echo ""
    echo "All features included:"
    echo "  - Dashboard & Inventory"
    echo "  - VM/CT Management"
    echo "  - Backups & Snapshots"
    echo "  - Storage Management"
    echo "  - DRS (Distributed Resource Scheduler)"
    echo "  - RBAC & LDAP"
    echo "  - Advanced Monitoring"
    echo "  - AI Insights"
    echo "  - Jobs & Automation"
    echo "  - And more..."
    echo ""
    if [ -z "$LICENSE_KEY" ]; then
        echo -e "${YELLOW}Note: No license key provided. Activate your license in Settings > License${NC}"
        echo ""
    fi
    echo "Commands:"
    echo "  cd $INSTALL_DIR && docker compose logs -f   # View logs"
    echo "  cd $INSTALL_DIR && docker compose down      # Stop"
    echo "  cd $INSTALL_DIR && docker compose pull      # Update"
    echo ""
    echo "Support: support@proxcenter.io"
    echo ""
}

# ============================================
# Main
# ============================================

main() {
    print_banner
    check_root
    check_token
    detect_os

    echo ""
    $PKG_UPDATE > /dev/null 2>&1 || true
    install_docker

    echo ""
    authenticate_ghcr

    echo ""
    setup_proxcenter

    echo ""
    start_services

    echo ""
    wait_and_finish
}

main "$@"
