#!/bin/bash
# ============================================
# ProxCenter air-gapped bundle
# ============================================
# Builds a self-contained bundle on a connected host, and installs or
# upgrades ProxCenter from it on a host with no internet access (ui#956).
#
#   ./install-airgap.sh bundle --edition <community|enterprise> --version <X.Y.Z> [--compose <file>] [--output <dir>]
#   sudo ./install-airgap.sh install [--license <key or .key path>] [--install-dir /opt/proxcenter] [--registry <host/namespace>]
#   sudo ./install-airgap.sh upgrade [--install-dir /opt/proxcenter] [--skip-db-backup]
#
# install and upgrade run from the extracted bundle directory and find the
# other files next to this script. They need Docker Engine 24+ with the
# compose plugin already installed: nothing is downloaded on the isolated host.
# ============================================
set -euo pipefail

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(dirname "$SCRIPT_PATH")"
INSTALL_DIR="/opt/proxcenter"
RAW_BASE="https://raw.githubusercontent.com/adminsyspro/proxcenter-ui"
HEALTH_TIMEOUT=120
LOG_FILE=""
START_TIME=$(date +%s)
TOTAL_STEPS=0

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'
BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

# ---------- output helpers (same look as the online installers) ----------

step() {
    echo ""
    echo -e "${BOLD}${BLUE}[$1/$TOTAL_STEPS]${NC} ${BOLD}$2${NC}"
    log_line "STEP $1/$TOTAL_STEPS: $2"
}
log_line() { if [ -n "$LOG_FILE" ]; then echo "$(date -Iseconds) $1" >> "$LOG_FILE"; fi; }
log_info() { echo -e "    ${DIM}$1${NC}"; log_line "$1"; }
log_success() { echo -e "    ${GREEN}✓${NC} $1"; log_line "OK: $1"; }
log_warning() { echo -e "    ${YELLOW}!${NC} $1"; log_line "WARN: $1"; }
log_error() {
    echo -e "\n    ${RED}✗ $1${NC}" >&2
    log_line "ERROR: $1"
    if [ -n "$LOG_FILE" ]; then echo -e "    ${DIM}Log: $LOG_FILE${NC}" >&2; fi
    exit 1
}

format_duration() {
    local secs=$1
    if [ "$secs" -lt 60 ]; then echo "${secs}s"; else echo "$((secs / 60))m $((secs % 60))s"; fi
}

init_log() {
    mkdir -p "$(dirname "$1")"
    LOG_FILE="$1"
    : >> "$LOG_FILE"
    chmod 600 "$LOG_FILE" 2>/dev/null || true
    log_line "install-airgap.sh $*"
}

on_error() {
    local rc=$?
    echo "" >&2
    echo -e "${RED}${BOLD}Operation failed (exit $rc).${NC}" >&2
    if [ -n "$LOG_FILE" ]; then echo -e "${DIM}    Log: $LOG_FILE${NC}" >&2; fi
    exit "$rc"
}
trap on_error ERR

usage() {
    cat <<USAGE
Usage:
  $0 bundle  --edition <community|enterprise> --version <X.Y.Z> [--compose <file>] [--output <dir>]
  $0 install [--license <key or .key path>] [--install-dir <dir>] [--registry <host/namespace>] [--health-timeout <s>]
  $0 upgrade [--install-dir <dir>] [--skip-db-backup] [--health-timeout <s>]

bundle runs on a connected host already logged in to ghcr.io (Enterprise).
install and upgrade run as root from the extracted bundle directory, on the
air-gapped host, and never touch the network.
USAGE
    exit 1
}

# ---------- small utilities ----------

is_semver() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; }

require_root() {
    if [ "${AIRGAP_ALLOW_NON_ROOT:-}" = "1" ]; then return; fi
    if [ "$EUID" -ne 0 ]; then log_error "This command must be run as root (sudo)."; fi
}

require_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        log_error "Docker is not installed. Install Docker Engine 24+ and the compose plugin from your own package mirror first (see the air-gapped installation guide)."
    fi
    if ! docker compose version >/dev/null 2>&1; then
        log_error "The Docker Compose plugin (docker compose) is missing. Install docker-compose-plugin from your package mirror."
    fi
}

gen_secret() {
    local bytes=$1
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex "$bytes"
    else
        head -c "$bytes" /dev/urandom | od -An -tx1 | tr -d ' \n'
    fi
}

gzip_cmd() { if command -v pigz >/dev/null 2>&1; then pigz -6; else gzip -6; fi; }

# manifest_get KEY [FILE]: flat string value out of manifest.json (no jq on the isolated host).
manifest_get() {
    sed -n "s/^[[:space:]]*\"$1\":[[:space:]]*\"\([^\"]*\)\".*/\1/p" "${2:-$SCRIPT_DIR/manifest.json}" | head -1
}

# manifest_images [FILE]: every image name of the manifest, one per line.
# shellcheck disable=SC2120 # optional FILE: install/upgrade (B6/B7) call this
# against an arbitrary manifest.json; this file's own callers use the default.
manifest_images() {
    sed -n 's/^[[:space:]]*"name":[[:space:]]*"\([^"]*\)".*/\1/p' "${1:-$SCRIPT_DIR/manifest.json}"
}

# image_basename ghcr.io/adminsyspro/proxcenter-frontend:1.4.11 -> proxcenter-frontend:1.4.11
image_basename() { echo "${1##*/}"; }

env_get() { sed -n "s/^$1=//p" "$2" | head -1; }

# env_set KEY VALUE FILE: replace the line or append it.
env_set() {
    if grep -q "^$1=" "$3"; then
        sed -i "s|^$1=.*|$1=$2|" "$3"
    else
        printf '%s=%s\n' "$1" "$2" >> "$3"
    fi
}

verify_checksums() {
    if [ ! -f "$SCRIPT_DIR/SHA256SUMS" ]; then log_error "SHA256SUMS is missing next to $SCRIPT_PATH. Run this command from the extracted bundle directory."; fi
    local out
    if ! out=$(cd "$SCRIPT_DIR" && sha256sum -c --strict SHA256SUMS 2>&1); then
        log_error "Checksum verification failed, the bundle is corrupt or incomplete:\n$out"
    fi
    log_success "Checksums verified ($(wc -l < "$SCRIPT_DIR/SHA256SUMS") files)"
}

load_images() {
    log_info "Loading images from images.tar (this takes a minute)..."
    docker load -i "$SCRIPT_DIR/images.tar" >> "${LOG_FILE:-/dev/null}" 2>&1 || log_error "docker load failed. See $LOG_FILE"
    local img
    while IFS= read -r img; do
        [ -z "$img" ] && continue
        if ! docker image inspect "$img" >/dev/null 2>&1; then
            log_error "Image $img is listed in manifest.json but is not present after docker load."
        fi
    done < <(manifest_images)
    log_success "Images loaded"
}

# retag_and_push REGISTRY: mirror every manifest image into a private registry.
retag_and_push() {
    local registry="${1%/}" img target
    while IFS= read -r img; do
        [ -z "$img" ] && continue
        target="$registry/$(image_basename "$img")"
        docker tag "$img" "$target"
        docker push "$target" >> "${LOG_FILE:-/dev/null}" 2>&1 || log_error "docker push $target failed. Log in to $registry first (docker login)."
        log_info "Pushed $target"
    done < <(manifest_images)
}

wait_for_health() {
    local what=$1 probe=$2 deadline=$((SECONDS + HEALTH_TIMEOUT))
    log_info "Waiting for $what..."
    while [ $SECONDS -lt $deadline ]; do
        if eval "$probe" >/dev/null 2>&1; then log_success "$what is healthy"; return 0; fi
        sleep 2
    done
    log_error "$what did not become healthy within ${HEALTH_TIMEOUT}s. Check: docker compose -f $INSTALL_DIR/docker-compose.yml logs"
}

frontend_probe() { echo "curl -sf --noproxy '*' http://localhost:3000/api/health"; }
orchestrator_probe() { echo "[ \"\$(docker inspect --format='{{.State.Health.Status}}' proxcenter-orchestrator 2>/dev/null)\" = healthy ]"; }

print_banner() {
    echo ""
    echo -e "${CYAN}${BOLD}"
    cat << 'BANNER'
    ____                 ____           _
   |  _ \ _ __ _____  __/ ___|___ _ __ | |_ ___ _ __
   | |_) | '__/ _ \ \/ / |   / _ \ '_ \| __/ _ \ '__|
   |  __/| | | (_) >  <| |__|  __/ | | | ||  __/ |
   |_|   |_|  \___/_/\_\\____\___|_| |_|\__\___|_|
BANNER
    echo -e "${NC}"
    echo -e "    ${GREEN}${BOLD}$1${NC}  ${DIM}— air-gapped $2${NC}"
    echo ""
}

# ---------- bundle ----------

cmd_bundle() {
    local edition="" version="" compose="" output="."
    while [[ $# -gt 0 ]]; do
        case $1 in
            --edition) edition="$2"; shift 2 ;;
            --version) version="$2"; shift 2 ;;
            --compose) compose="$2"; shift 2 ;;
            --output) output="$2"; shift 2 ;;
            -h|--help) usage ;;
            *) log_error "Unknown option: $1" ;;
        esac
    done
    case "$edition" in community|enterprise) ;; *) log_error "--edition must be community or enterprise" ;; esac
    is_semver "$version" || log_error "--version must be X.Y.Z (got '${version:-empty}')"
    require_docker
    mkdir -p "$output"
    output="$(cd "$output" && pwd)"

    TOTAL_STEPS=5
    print_banner "Bundle" "$edition $version"

    local name="proxcenter-$edition-$version" work stage
    work=$(mktemp -d)
    stage="$work/$name"
    mkdir -p "$stage"
    # Double-quoted on purpose: expand $work now, since by the time this EXIT
    # trap fires cmd_bundle's `local work` is out of scope (a real bug caught
    # by the bundle tests, not shellcheck's default advice for this rule).
    # shellcheck disable=SC2064
    trap "rm -rf $(printf '%q' "$work")" EXIT

    step 1 "Resolving the compose file"
    if [ -n "$compose" ]; then
        cp "$compose" "$stage/docker-compose.yml"
        log_success "Using $compose"
    else
        local url="$RAW_BASE/v$version/docker-compose.$edition.yml"
        curl -fsSL --connect-timeout 15 --max-time 60 "$url" -o "$stage/docker-compose.yml" || log_error "Cannot download $url"
        log_success "Downloaded docker-compose.$edition.yml at tag v$version"
    fi

    step 2 "Resolving and pulling images"
    # The compose declares ${POSTGRES_PASSWORD:?...}: give config a throwaway value.
    local images
    # No -f: run from $stage, where the file is already named docker-compose.yml
    # (compose auto-detects it), so the resolution matches what install/upgrade
    # run against on the isolated host later.
    images=$(cd "$stage" && VERSION="$version" POSTGRES_PASSWORD=bundle APP_SECRET=bundle NEXTAUTH_SECRET=bundle ORCHESTRATOR_API_KEY=bundle \
        docker compose config --images 2>/dev/null | sed '/^[[:space:]]*$/d' | sort -u)
    [ -n "$images" ] || log_error "docker compose config --images returned nothing"
    local img entries=""
    while IFS= read -r img; do
        log_info "Pulling $img"
        docker pull "$img" >/dev/null || log_error "docker pull $img failed (Enterprise images need docker login ghcr.io first)"
        local digest size
        digest=$(docker image inspect --format '{{index .RepoDigests 0}}' "$img" 2>/dev/null | sed 's/.*@//')
        size=$(docker image inspect --format '{{.Size}}' "$img" 2>/dev/null)
        entries+="    { \"name\": \"$img\", \"digest\": \"${digest:-unknown}\", \"size\": ${size:-0} },"$'\n'
    done <<< "$images"
    log_success "$(echo "$images" | wc -l) images pulled"

    step 3 "Saving images"
    # shellcheck disable=SC2086
    docker save $images -o "$stage/images.tar" || log_error "docker save failed"
    log_success "images.tar written ($(du -h "$stage/images.tar" | cut -f1))"

    step 4 "Writing manifest, README and checksums"
    cp "$SCRIPT_PATH" "$stage/install-airgap.sh"
    chmod +x "$stage/install-airgap.sh"
    {
        echo "{"
        echo "  \"schema\": 1,"
        echo "  \"edition\": \"$edition\","
        echo "  \"version\": \"$version\","
        echo "  \"created_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
        echo "  \"compose\": \"docker-compose.$edition.yml\","
        echo "  \"images\": ["
        printf '%s\n' "${entries%,$'\n'}"
        echo "  ]"
        echo "}"
    } > "$stage/manifest.json"
    cat > "$stage/README.txt" <<README
ProxCenter $edition $version, air-gapped bundle

On the isolated host (Docker Engine 24+ and the compose plugin already installed):

  sudo ./install-airgap.sh install --license /path/to/license.key     # fresh install
  sudo ./install-airgap.sh upgrade                                     # upgrade an existing /opt/proxcenter

Verify before installing:   sha256sum -c SHA256SUMS
Documentation:              https://docs.proxcenter.io/getting-started/air-gapped-installation
README
    (cd "$stage" && sha256sum install-airgap.sh docker-compose.yml images.tar manifest.json README.txt > SHA256SUMS)
    log_success "manifest.json, README.txt, SHA256SUMS"

    step 5 "Packing $name.tar.gz"
    tar -C "$work" -cf - "$name" | gzip_cmd > "$output/$name.tar.gz"
    (cd "$output" && sha256sum "$name.tar.gz" > "$name.tar.gz.sha256")
    log_success "$output/$name.tar.gz ($(du -h "$output/$name.tar.gz" | cut -f1))"
    log_success "$output/$name.tar.gz.sha256"
    echo ""
    echo -e "    ${DIM}Duration: $(format_duration $(( $(date +%s) - START_TIME )))${NC}"
    echo ""
}

# ---------- install / upgrade: added in the next tasks ----------

cmd_install() { log_error "install: not implemented yet"; }
cmd_upgrade() { log_error "upgrade: not implemented yet"; }

# ---------- main ----------

main() {
    [ $# -ge 1 ] || usage
    local cmd=$1; shift
    case "$cmd" in
        bundle) cmd_bundle "$@" ;;
        install) cmd_install "$@" ;;
        upgrade) cmd_upgrade "$@" ;;
        -h|--help) usage ;;
        *) echo "Unknown command: $cmd" >&2; usage ;;
    esac
}

main "$@"
