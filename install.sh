#!/bin/bash
set -e

# ============================================
# ProxCenter Installation Script
# ============================================
# Usage: curl -fsSL https://raw.githubusercontent.com/adminsyspro/proxcenter/main/install.sh | sudo bash
# ============================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="/opt/proxcenter"
REPO_URL="https://github.com/adminsyspro/proxcenter.git"
BRANCH="main"
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
    echo -e "${BLUE}"
    cat << 'EOF'
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@#####%@@@@@@@@@@@@@@@@@@@@@@%%%%%%@@@@@@@@
@@@@@@@@@*.....:@@@......#@@@@@@@@@%++++++@@@@@@@@@
@@@@@@@@@@@......@@@+.....+@@@@@@@*+++++#@@@@@@@@@@
@@@@@@@@@@@@:.....#@@#......@@@@%++++++%@@@@@@@@@@@
@@@@@@@@@@@@@+.....=@@@......%@@+++++*@@@@@@@@@@@@@
@@@@@@@@@@@@@@%.....:@@@=.....+@@+++@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@......%@@#.....:@@#@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@=.....#@@@......@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@-.....*@@#......@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@%......%@@-.....=@@*+*@@@@@@@@@@@@@@@
@@@@@@@@@@@@@=.....=@@%......%@@+++++@@@@@@@@@@@@@@
@@@@@@@@@@@%......%@@+.....:@@@@*+++++%@@@@@@@@@@@@
@@@@@@@@@@+.....-@@@......#@@@@@@#+++++#@@@@@@@@@@@
@@@@@@@@@:.....#@@#.....:@@@@@@@@@@++++++@@@@@@@@@@
@@@@@@@%......@@@-.....*@@@@@@@@@@@@++++++%@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@

EOF
    echo -e "${NC}"
    echo "PROXCENTER - Proxmox Management Platform"
    echo "========================================="
    echo ""
}

# ============================================
# Check Requirements
# ============================================

check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "This script must be run as root. Use: sudo bash install.sh"
    fi
}

detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        VERSION=$VERSION_ID
    elif [ -f /etc/debian_version ]; then
        OS="debian"
        VERSION=$(cat /etc/debian_version)
    elif [ -f /etc/redhat-release ]; then
        OS="rhel"
        VERSION=$(cat /etc/redhat-release | grep -oP '[0-9]+' | head -1)
    else
        log_error "Unsupported operating system"
    fi

    log_info "Detected OS: $OS $VERSION"

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
            log_error "Unsupported OS: $OS. Supported: Ubuntu, Debian, CentOS, RHEL, Rocky, AlmaLinux, Fedora"
            ;;
    esac
}

# ============================================
# Install Dependencies
# ============================================

install_docker() {
    if command -v docker &> /dev/null; then
        log_success "Docker is already installed: $(docker --version)"
        return
    fi

    log_info "Installing Docker..."

    case $OS in
        ubuntu|debian)
            # Remove old versions
            apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

            # Install prerequisites
            $PKG_INSTALL ca-certificates curl gnupg lsb-release

            # Add Docker's official GPG key
            install -m 0755 -d /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/$OS/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
            chmod a+r /etc/apt/keyrings/docker.gpg

            # Set up the repository
            echo \
                "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS \
                $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

            # Install Docker
            apt-get update
            $PKG_INSTALL docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            ;;

        centos|rhel|rocky|almalinux|fedora)
            # Remove old versions
            dnf remove -y docker docker-client docker-client-latest docker-common \
                docker-latest docker-latest-logrotate docker-logrotate docker-engine 2>/dev/null || true

            # Install prerequisites
            $PKG_INSTALL dnf-plugins-core

            # Add Docker repository
            dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

            # Install Docker
            $PKG_INSTALL docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            ;;
    esac

    # Start and enable Docker
    systemctl start docker
    systemctl enable docker

    log_success "Docker installed successfully"
}

install_git() {
    if command -v git &> /dev/null; then
        log_success "Git is already installed: $(git --version)"
        return
    fi

    log_info "Installing Git..."
    $PKG_UPDATE
    $PKG_INSTALL git
    log_success "Git installed successfully"
}

# ============================================
# Setup ProxCenter
# ============================================

clone_repository() {
    if [ -d "$INSTALL_DIR" ]; then
        log_info "Installation directory exists, updating..."
        cd "$INSTALL_DIR"
        git fetch origin
        git reset --hard origin/$BRANCH
    else
        log_info "Cloning ProxCenter repository..."
        git clone --branch $BRANCH --depth 1 "$REPO_URL" "$INSTALL_DIR"
    fi

    log_success "Repository ready at $INSTALL_DIR"
}

generate_secrets() {
    log_info "Generating secrets..."

    # Generate random secrets
    APP_SECRET=$(openssl rand -hex 32)
    NEXTAUTH_SECRET=$(openssl rand -hex 32)

    log_success "Secrets generated"
}

create_env_file() {
    log_info "Creating .env file..."

    # Get server IP for NEXTAUTH_URL
    SERVER_IP=$(hostname -I | awk '{print $1}' | head -1)
    if [ -z "$SERVER_IP" ]; then
        SERVER_IP="localhost"
    fi

    cat > "$INSTALL_DIR/.env" << EOF
# ProxCenter Environment Configuration
# Generated by install.sh on $(date)

# Application Secrets (DO NOT SHARE)
APP_SECRET=$APP_SECRET
NEXTAUTH_SECRET=$NEXTAUTH_SECRET

# NextAuth Configuration
NEXTAUTH_URL=http://$SERVER_IP:3000

# Image version (latest, v1.0.0, sha-xxx)
VERSION=latest

# Optional: Grafana admin password (for monitoring profile)
GRAFANA_ADMIN_PASSWORD=$(openssl rand -hex 16)
EOF

    chmod 600 "$INSTALL_DIR/.env"
    log_success ".env file created"
}

create_orchestrator_config() {
    log_info "Creating orchestrator configuration..."

    mkdir -p "$INSTALL_DIR/config"

    # Copy example and update with generated secret
    cp "$INSTALL_DIR/config/orchestrator.yaml.example" "$INSTALL_DIR/config/orchestrator.yaml"

    # Replace placeholder with actual secret
    sed -i "s/YOUR_APP_SECRET_HERE/$APP_SECRET/g" "$INSTALL_DIR/config/orchestrator.yaml"

    # Update CORS origins with server IP
    SERVER_IP=$(hostname -I | awk '{print $1}' | head -1)
    if [ -n "$SERVER_IP" ] && [ "$SERVER_IP" != "localhost" ]; then
        sed -i "s|cors_origins:|cors_origins:\n    - \"http://$SERVER_IP:3000\"|g" "$INSTALL_DIR/config/orchestrator.yaml"
    fi

    chmod 600 "$INSTALL_DIR/config/orchestrator.yaml"
    log_success "Orchestrator configuration created"
}

# ============================================
# Pull and Start Services
# ============================================

pull_images() {
    log_info "Pulling Docker images..."

    cd "$INSTALL_DIR"
    docker compose pull

    log_success "Docker images pulled successfully"
}

run_migrations() {
    log_info "Running database migrations..."

    cd "$INSTALL_DIR"

    # Run migrations using the frontend image
    docker run --rm \
        -v proxcenter_data:/app/data \
        -e DATABASE_URL=file:/app/data/proxcenter.db \
        "$FRONTEND_IMAGE" \
        npx prisma migrate deploy

    log_success "Migrations completed"
}

start_services() {
    log_info "Starting ProxCenter services..."

    cd "$INSTALL_DIR"
    docker compose up -d

    log_success "Services started"
}

# ============================================
# Post-Installation
# ============================================

wait_for_health() {
    log_info "Waiting for services to be healthy..."

    local max_attempts=30
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if curl -s -f http://localhost:3000/api/health > /dev/null 2>&1; then
            log_success "Frontend is healthy"
            return 0
        fi

        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done

    log_warning "Health check timed out. Services may still be starting."
    return 1
}

print_success() {
    SERVER_IP=$(hostname -I | awk '{print $1}' | head -1)
    if [ -z "$SERVER_IP" ]; then
        SERVER_IP="localhost"
    fi

    echo ""
    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN}   ProxCenter Installation Complete!${NC}"
    echo -e "${GREEN}============================================${NC}"
    echo ""
    echo -e "Access ProxCenter at: ${BLUE}http://$SERVER_IP:3000${NC}"
    echo ""
    echo "Default ports:"
    echo "  - Frontend:  3000"
    echo "  - WebSocket: 3001"
    echo "  - API:       8080 (internal)"
    echo ""
    echo "Useful commands:"
    echo "  - View logs:     docker compose -f $INSTALL_DIR/docker-compose.yml logs -f"
    echo "  - Stop:          docker compose -f $INSTALL_DIR/docker-compose.yml down"
    echo "  - Restart:       docker compose -f $INSTALL_DIR/docker-compose.yml restart"
    echo "  - Update:        docker compose -f $INSTALL_DIR/docker-compose.yml pull && docker compose -f $INSTALL_DIR/docker-compose.yml up -d"
    echo ""
    echo "Configuration files:"
    echo "  - Environment:   $INSTALL_DIR/.env"
    echo "  - Orchestrator:  $INSTALL_DIR/config/orchestrator.yaml"
    echo ""
    echo -e "${YELLOW}Optional: Enable monitoring with:${NC}"
    echo "  docker compose -f $INSTALL_DIR/docker-compose.yml --profile monitoring up -d"
    echo ""
}

# ============================================
# Main Installation Flow
# ============================================

main() {
    print_banner

    log_info "Starting ProxCenter installation..."
    echo ""

    # Pre-flight checks
    check_root
    detect_os

    echo ""

    # Install dependencies
    log_info "Installing dependencies..."
    $PKG_UPDATE || true
    install_git
    install_docker

    echo ""

    # Setup ProxCenter
    log_info "Setting up ProxCenter..."
    clone_repository
    generate_secrets
    create_env_file
    create_orchestrator_config

    echo ""

    # Pull and start
    log_info "Pulling and starting services..."
    pull_images
    run_migrations
    start_services

    echo ""

    # Verify and finish
    wait_for_health || true
    print_success
}

# Run main function
main "$@"
