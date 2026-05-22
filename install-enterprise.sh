#!/bin/bash
set -e

# ============================================
# ProxCenter Enterprise Installation Script
# ============================================
# Usage: curl -fsSL https://proxcenter.io/install/enterprise | sudo bash -s -- --token YOUR_GHCR_TOKEN
# ============================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# Configuration
INSTALL_DIR="/opt/proxcenter"
COMPOSE_URL="https://raw.githubusercontent.com/adminsyspro/proxcenter-ui/main/docker-compose.enterprise.yml"
REGISTRY="ghcr.io"
REGISTRY_USER="adminsyspro"
FRONTEND_IMAGE="ghcr.io/adminsyspro/proxcenter-frontend:latest"
ORCHESTRATOR_IMAGE="ghcr.io/adminsyspro/proxcenter-orchestrator:latest"

TOTAL_STEPS=6
START_TIME=$(date +%s)

# ============================================
# Helper Functions
# ============================================

step() {
    local step_num=$1
    local msg=$2
    echo ""
    echo -e "${BOLD}${BLUE}[$step_num/$TOTAL_STEPS]${NC} ${BOLD}$msg${NC}"
}

log_info() {
    echo -e "    ${DIM}$1${NC}"
}

log_success() {
    echo -e "    ${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "    ${YELLOW}!${NC} $1"
}

log_error() {
    echo -e "\n    ${RED}✗ $1${NC}"
    exit 1
}

spinner() {
    local pid=$1
    local msg=${2:-"Please wait"}
    local chars="⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
    local i=0
    tput civis 2>/dev/null || true
    while kill -0 "$pid" 2>/dev/null; do
        printf "\r    ${DIM}%s %s${NC}" "${chars:i++%${#chars}:1}" "$msg"
        sleep 0.1
    done
    printf "\r\033[K"
    tput cnorm 2>/dev/null || true
}

format_duration() {
    local secs=$1
    if [ "$secs" -lt 60 ]; then
        echo "${secs}s"
    else
        echo "$((secs / 60))m $((secs % 60))s"
    fi
}

cleanup_on_error() {
    echo ""
    echo -e "${RED}${BOLD}Installation failed.${NC}"
    echo -e "${DIM}    Logs may help diagnose the issue:${NC}"
    echo -e "${DIM}    - Check Docker: docker compose -f $INSTALL_DIR/docker-compose.yml logs${NC}"
    echo -e "${DIM}    - Re-run this script to retry${NC}"
    echo ""
    tput cnorm 2>/dev/null || true
    exit 1
}

trap cleanup_on_error ERR

print_banner() {
    echo ""
    echo -e "${CYAN}${BOLD}"
    cat << 'EOF'
    ____                 ____           _
   |  _ \ _ __ _____  __/ ___|___ _ __ | |_ ___ _ __
   | |_) | '__/ _ \ \/ / |   / _ \ '_ \| __/ _ \ '__|
   |  __/| | | (_) >  <| |__|  __/ | | | ||  __/ |
   |_|   |_|  \___/_/\_\\____\___|_| |_|\__\___|_|
EOF
    echo -e "${NC}"
    echo -e "    ${GREEN}${BOLD}Enterprise Edition${NC}  ${DIM}— Full Featured${NC}"
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
    echo "  --upgrade          Upgrade an existing installation in-place (keeps .env and data,"
    echo "                     refreshes docker-compose.yml and pulls latest images)"
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
UPGRADE_MODE=false

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
        --upgrade)
            UPGRADE_MODE=true
            shift
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
# Pre-flight Checks
# ============================================

preflight_checks() {
    if [ "$EUID" -ne 0 ]; then
        log_error "This script must be run as root. Use: sudo bash install-enterprise.sh --token YOUR_TOKEN"
    fi

    if [ -z "$GHCR_TOKEN" ]; then
        echo -e "${RED}Error: GHCR token is required${NC}"
        echo ""
        show_usage
    fi

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

    log_info "OS: $OS $VERSION_ID"
}

# ============================================
# Step 1: Validate Token
# ============================================

validate_token() {
    step 1 "Validating installation token"

    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer $GHCR_TOKEN" \
        "https://ghcr.io/v2/adminsyspro/proxcenter-frontend/tags/list" 2>/dev/null || echo "000")

    if [ "$http_code" = "200" ]; then
        log_success "Token validated"
    elif [ "$http_code" = "401" ] || [ "$http_code" = "403" ]; then
        log_error "Invalid token. Make sure your token has read:packages scope.\n    Get one at: https://proxcenter.io/account/tokens"
    else
        log_warning "Could not validate token (HTTP $http_code) — continuing anyway"
    fi
}

# ============================================
# Step 2: Install Docker
# ============================================

install_docker() {
    step 2 "Installing Docker"

    if command -v docker &> /dev/null; then
        local docker_version
        docker_version=$(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1)
        log_success "Docker $docker_version already installed"
        return
    fi

    log_info "Installing dependencies..."
    $PKG_INSTALL openssl curl ca-certificates > /dev/null 2>&1

    case $OS in
        ubuntu|debian)
            apt-get remove -y docker docker-engine docker.io containerd runc > /dev/null 2>&1 || true
            $PKG_INSTALL gnupg lsb-release > /dev/null 2>&1
            install -m 0755 -d /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/$OS/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
            chmod a+r /etc/apt/keyrings/docker.gpg
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
            apt-get update > /dev/null 2>&1
            $PKG_INSTALL docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin > /dev/null 2>&1
            ;;
        centos|rhel|rocky|almalinux|fedora)
            dnf remove -y docker docker-client docker-client-latest docker-common docker-latest docker-latest-logrotate docker-logrotate docker-engine > /dev/null 2>&1 || true
            $PKG_INSTALL dnf-plugins-core > /dev/null 2>&1
            dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo > /dev/null 2>&1
            $PKG_INSTALL docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin > /dev/null 2>&1
            ;;
    esac

    systemctl start docker
    systemctl enable docker > /dev/null 2>&1

    log_success "Docker installed"
}

# ============================================
# Step 3: Authenticate to Registry
# ============================================

authenticate_registry() {
    step 3 "Authenticating to container registry"

    echo "$GHCR_TOKEN" | docker login "$REGISTRY" -u "$REGISTRY_USER" --password-stdin > /dev/null 2>&1

    if [ $? -ne 0 ]; then
        log_error "Failed to authenticate. Please check your token."
    fi

    log_success "Authenticated to ghcr.io"
}

# ============================================
# Step 4: Configure ProxCenter
# ============================================

setup_proxcenter() {
    step 4 "Configuring ProxCenter"

    mkdir -p "$INSTALL_DIR/config"
    cd "$INSTALL_DIR"

    # Download docker-compose
    curl -fsSL "$COMPOSE_URL" -o docker-compose.yml 2>/dev/null
    log_success "Downloaded compose configuration"

    # Generate secrets
    APP_SECRET=$(openssl rand -hex 32)
    NEXTAUTH_SECRET=$(openssl rand -hex 32)
    ORCHESTRATOR_API_KEY=$(openssl rand -hex 32)
    # Postgres password is required by the compose file (it uses the
    # `${VAR:?msg}` form); generate one here so docker compose up doesn't
    # bail. POSTGRES_USER/DB stay defaulted via the compose ${VAR:-default}
    # pattern, so we don't need to write them.
    POSTGRES_PASSWORD=$(openssl rand -hex 24)

    # Get server IP
    SERVER_IP=$(hostname -I | awk '{print $1}' | head -1)
    if [ -z "$SERVER_IP" ]; then
        SERVER_IP="localhost"
    fi

    # Create .env file
    cat > "$INSTALL_DIR/.env" << EOF
# ProxCenter Enterprise Edition
# Generated on $(date -Iseconds)

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
ORCHESTRATOR_API_KEY=$ORCHESTRATOR_API_KEY

# Postgres
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
EOF

    # Create orchestrator config. The compose file injects
    # PROXCENTER_DATABASE_DRIVER + PROXCENTER_DATABASE_DSN as env vars,
    # which override these defaults — they're only here so an operator
    # editing the file by hand sees a coherent, Postgres-shaped baseline.
    cat > "$INSTALL_DIR/config/orchestrator.yaml" << EOF
# ProxCenter Orchestrator Configuration
api:
  address: ":8080"
  read_timeout: 30s
  write_timeout: 30s

database:
  # Postgres-only since step 3 of the SQLite → Postgres migration. The
  # compose file overrides these via env vars; values are shown here as
  # documentation.
  driver: postgres
  dsn: "postgres://proxcenter:\${POSTGRES_PASSWORD}@postgres:5432/proxcenter?sslmode=disable"

proxmox:
  # Must match APP_SECRET from .env
  app_secret: "$APP_SECRET"
  # Frontend volume mounted read-only for white-label branding logos.
  shared_data_path: /app/shared_data

license:
  key: "${LICENSE_KEY:-}"

logging:
  level: info
  format: json
EOF

    chmod 600 "$INSTALL_DIR/.env"
    chmod 600 "$INSTALL_DIR/config/orchestrator.yaml"

    log_success "Secrets generated and configuration saved"
}

# ============================================
# Step 4 (upgrade): Refresh compose file
# ============================================

refresh_compose() {
    step 4 "Refreshing docker-compose.yml"

    if [ ! -f "$INSTALL_DIR/.env" ]; then
        log_error "No existing installation found at $INSTALL_DIR. Run without --upgrade for a fresh install."
    fi
    if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
        log_error "No docker-compose.yml at $INSTALL_DIR. Run without --upgrade for a fresh install."
    fi

    cd "$INSTALL_DIR"

    # Backup current compose with timestamp
    local backup_file
    backup_file="docker-compose.yml.bak.$(date +%Y%m%d-%H%M%S)"
    cp -p docker-compose.yml "$backup_file"
    log_info "Backed up current compose to $backup_file"

    # Download latest compose
    if ! curl -fsSL "$COMPOSE_URL" -o docker-compose.yml.new 2>/dev/null; then
        log_error "Failed to download latest compose from $COMPOSE_URL"
    fi

    if ! diff -q docker-compose.yml docker-compose.yml.new > /dev/null 2>&1; then
        mv docker-compose.yml.new docker-compose.yml
        log_success "Compose updated (diff available: diff $backup_file docker-compose.yml)"
    else
        rm -f docker-compose.yml.new
        log_success "Compose already up-to-date"
    fi

    # Backfill any required env vars introduced by newer compose revisions.
    # The SQLite → Postgres release made POSTGRES_PASSWORD mandatory; legacy
    # installs lack it, and the compose `${VAR:?…}` form would otherwise
    # block `docker compose up`. We generate a fresh password — the SQLite
    # → Postgres switch is a clean install per the changelog, no data
    # carries over.
    if ! grep -q '^POSTGRES_PASSWORD=' .env; then
        local pg_pass
        pg_pass=$(openssl rand -hex 24)
        printf '\n# Postgres (added by upgrade)\nPOSTGRES_PASSWORD=%s\n' "$pg_pass" >> .env
        log_info "Added POSTGRES_PASSWORD to .env (fresh Postgres on first boot)"
    fi

    # Backfill ORCHESTRATOR_API_KEY when missing OR still set to the
    # .env.example placeholder. Pre-v1.4.0 installs didn't write this
    # variable, and operators that bootstrapped from .env.example end up
    # with `your-orchestrator-api-key-change-me` — both leave the frontend
    # and orchestrator unable to authenticate against each other.
    if ! grep -q '^ORCHESTRATOR_API_KEY=' .env; then
        local orch_key
        orch_key=$(openssl rand -hex 32)
        printf '\n# Orchestrator (added by upgrade)\nORCHESTRATOR_API_KEY=%s\n' "$orch_key" >> .env
        log_info "Added ORCHESTRATOR_API_KEY to .env"
    elif grep -q '^ORCHESTRATOR_API_KEY=your-orchestrator-api-key-change-me' .env; then
        local orch_key
        orch_key=$(openssl rand -hex 32)
        sed -i "s|^ORCHESTRATOR_API_KEY=your-orchestrator-api-key-change-me|ORCHESTRATOR_API_KEY=$orch_key|" .env
        log_info "Replaced placeholder ORCHESTRATOR_API_KEY in .env"
    fi
}

# ============================================
# Step 5: Pull & Initialize
# ============================================

pull_and_init() {
    step 5 "Pulling images and initializing"

    cd "$INSTALL_DIR"

    # Pull images (show progress)
    docker compose pull 2>&1 | tail -5
    log_success "Images pulled"

    # Create volumes. postgres_data is declared external in the compose
    # file (so docker compose up won't auto-create it); missing this line
    # is what made fresh installs fail.
    docker volume create proxcenter_data > /dev/null 2>&1 || true
    docker volume create orchestrator_data > /dev/null 2>&1 || true
    docker volume create postgres_data > /dev/null 2>&1 || true
    docker volume create influxdb_data > /dev/null 2>&1 || true

    # Init the frontend data directory so the non-root container user
    # (uid 1001) can write into it. Postgres + Prisma migrations run on
    # first boot via the frontend entrypoint (`prisma migrate deploy` +
    # `prisma/seed.js`); no SQLite bootstrap is needed anymore.
    docker run --rm --user root --entrypoint "" \
        -v proxcenter_data:/app/data \
        "$FRONTEND_IMAGE" \
        sh -c "mkdir -p /app/data && chown -R 1001:1001 /app/data" > /dev/null 2>&1

    log_success "Volumes initialized"
}

# ============================================
# Step 6: Start Services
# ============================================

start_and_wait() {
    step 6 "Starting ProxCenter Enterprise"

    cd "$INSTALL_DIR"
    docker compose up -d 2>&1 | grep -v "^$"
    log_success "Containers started"

    # Wait for frontend with spinner
    log_info "Waiting for services to be ready..."
    (
        local attempt=1
        while [ $attempt -le 60 ]; do
            if curl -s -f http://localhost:3000/api/health > /dev/null 2>&1; then
                exit 0
            fi
            sleep 2
            attempt=$((attempt + 1))
        done
        exit 1
    ) &
    local wait_pid=$!
    spinner $wait_pid "Starting frontend..."
    wait $wait_pid || log_error "Frontend failed to start within 2 minutes. Check: docker compose logs frontend"

    # Wait for orchestrator via Docker health status (port not exposed to host)
    (
        local attempt=1
        while [ $attempt -le 60 ]; do
            local health
            health=$(docker inspect --format='{{.State.Health.Status}}' proxcenter-orchestrator 2>/dev/null || echo "missing")
            if [ "$health" = "healthy" ]; then
                exit 0
            fi
            sleep 2
            attempt=$((attempt + 1))
        done
        exit 1
    ) &
    wait_pid=$!
    spinner $wait_pid "Starting orchestrator..."
    wait $wait_pid || log_error "Orchestrator failed to start within 2 minutes. Check: docker compose logs orchestrator"

    log_success "All services healthy"
}

# ============================================
# Final Summary
# ============================================

print_summary() {
    local end_time=$(date +%s)
    local duration=$((end_time - START_TIME))

    SERVER_IP=$(hostname -I | awk '{print $1}' | head -1)

    echo ""
    echo -e "${GREEN}${BOLD}  ┌─────────────────────────────────────────────┐${NC}"
    echo -e "${GREEN}${BOLD}  │     ProxCenter Enterprise is ready!         │${NC}"
    echo -e "${GREEN}${BOLD}  └─────────────────────────────────────────────┘${NC}"
    echo ""
    echo -e "    ${BOLD}URL${NC}         ${CYAN}http://$SERVER_IP:3000${NC}"
    echo -e "    ${BOLD}Install${NC}     $INSTALL_DIR"
    echo -e "    ${BOLD}Duration${NC}    $(format_duration $duration)"
    echo ""

    if [ -z "$LICENSE_KEY" ]; then
        echo -e "    ${YELLOW}${BOLD}!${NC} ${YELLOW}No license key provided${NC}"
        echo -e "      Activate in ${BOLD}Settings > License${NC} or re-run with ${DIM}--license YOUR_KEY${NC}"
        echo ""
    fi

    echo -e "    ${DIM}Manage:${NC}"
    echo -e "      ${DIM}docker compose -f $INSTALL_DIR/docker-compose.yml logs -f${NC}     ${DIM}# Logs${NC}"
    echo -e "      ${DIM}docker compose -f $INSTALL_DIR/docker-compose.yml down${NC}        ${DIM}# Stop${NC}"
    echo ""
    echo -e "    ${DIM}Upgrade (refreshes docker-compose.yml and pulls latest images):${NC}"
    echo -e "      ${DIM}curl -fsSL https://proxcenter.io/install/enterprise | sudo bash -s -- --token \$GHCR_TOKEN --upgrade${NC}"
    echo ""
    echo -e "    ${DIM}Support: support@proxcenter.io${NC}"
    echo ""
}

# ============================================
# Main
# ============================================

main() {
    print_banner
    preflight_checks

    validate_token
    install_docker
    authenticate_registry
    if [ "$UPGRADE_MODE" = "true" ]; then
        refresh_compose
    else
        setup_proxcenter
    fi
    pull_and_init
    start_and_wait

    print_summary
}

main "$@"
