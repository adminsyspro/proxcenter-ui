#!/bin/bash
# ============================================
# ProxCenter air-gapped bundle
# ============================================
# Builds a self-contained bundle on a connected host, and installs or
# upgrades ProxCenter from it on a host with no internet access (ui#956).
#
#   ./install-airgap.sh bundle --edition <community|enterprise> --version <X.Y.Z> [--compose <file>] [--output <dir>] [--no-pull]
#   sudo ./install-airgap.sh install [--license <key or .key path>] [--install-dir /opt/proxcenter] [--registry <host/namespace>]
#   sudo ./install-airgap.sh upgrade [--install-dir /opt/proxcenter] [--skip-db-backup]
#
# install and upgrade run from the extracted bundle directory and find the
# other files next to this script. They need Docker Engine 24+ with the
# compose plugin already installed: nothing is downloaded on the isolated host.
# ============================================
set -Eeuo pipefail

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
  $0 bundle  --edition <community|enterprise> --version <X.Y.Z> [--compose <file>] [--output <dir>] [--no-pull]
  $0 install [--license <key or .key path>] [--install-dir <dir>] [--registry <host/namespace>] [--health-timeout <s>]
  $0 upgrade [--install-dir <dir>] [--skip-db-backup] [--health-timeout <s>]

bundle runs on a connected host already logged in to ghcr.io (Enterprise).
--no-pull packs the images already present in the local Docker daemon
instead of pulling them (CI build jobs, or a local build with no registry
token at hand).
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
    # docker/docker compose version only need the CLI: they never contact the daemon.
    if ! docker info >/dev/null 2>&1; then
        log_error "The Docker daemon is not running. Start it (systemctl start docker) and retry."
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

# manifest_images [FILE]: every image name of the manifest, one per line, in
# file order. Not anchored to the start of the line: cmd_bundle writes each
# image entry on ONE line (`    { "name": "...", "digest": ..., "size": ... },`),
# so a sed anchored on ^[[:space:]]*"name": (the previous implementation)
# never matched a real manifest.json and silently returned nothing.
# shellcheck disable=SC2120 # optional FILE: install/upgrade (B6/B7) call this
# against an arbitrary manifest.json; this file's own callers use the default.
manifest_images() {
    # `|| true`: under pipefail, grep matching nothing (an empty images
    # array) makes the pipeline return 1, which would trip `set -e` at
    # `images_list=$(manifest_images)` in load_images() before that call
    # gets to check the count itself.
    grep -o '"name":[[:space:]]*"[^"]*"' "${1:-$SCRIPT_DIR/manifest.json}" | sed 's/.*"name":[[:space:]]*"\([^"]*\)"/\1/' || true
}

# image_basename ghcr.io/adminsyspro/proxcenter-frontend:1.4.11 -> proxcenter-frontend:1.4.11
image_basename() { echo "${1##*/}"; }

env_get() { sed -n "s/^$1=//p" "$2" | head -1; }

# env_set KEY VALUE FILE: replace the line or append it.
env_set() {
    if grep -q "^$1=" "$3"; then
        sed -i "s|^$1=.*|$1=$2|" "$3"
    else
        # A file with no trailing newline would otherwise get its last line
        # glued to this append (e.g. "LICENSE_KEY=LICTEMPLATE_CATALOG_...").
        [ -s "$3" ] && [ -n "$(tail -c1 "$3")" ] && printf '\n' >> "$3"
        printf '%s=%s\n' "$1" "$2" >> "$3"
    fi
}

verify_checksums() {
    if [ ! -f "$SCRIPT_DIR/SHA256SUMS" ]; then log_error "SHA256SUMS is missing next to $SCRIPT_PATH. Run the install-airgap.sh shipped inside the extracted bundle."; fi
    local out
    if ! out=$(cd "$SCRIPT_DIR" && sha256sum -c --strict SHA256SUMS 2>&1); then
        log_error "Checksum verification failed, the bundle is corrupt or incomplete:\n$out"
    fi
    log_success "Checksums verified ($(wc -l < "$SCRIPT_DIR/SHA256SUMS") files)"
}

load_images() {
    log_info "Loading images from images.tar (this takes a minute)..."
    docker load -i "$SCRIPT_DIR/images.tar" >> "${LOG_FILE:-/dev/null}" 2>&1 || log_error "docker load failed. See $LOG_FILE"
    local images_list; images_list=$(manifest_images)
    [ -n "$images_list" ] || log_error "manifest.json lists no image; the bundle is corrupt"
    local img
    while IFS= read -r img; do
        [ -z "$img" ] && continue
        if ! docker image inspect "$img" >/dev/null 2>&1; then
            log_error "Image $img is listed in manifest.json but is not present after docker load."
        fi
    done <<< "$images_list"
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
    local edition="" version="" compose="" output="." no_pull=false
    while [[ $# -gt 0 ]]; do
        case $1 in
            --edition) edition="$2"; shift 2 ;;
            --version) version="$2"; shift 2 ;;
            --compose) compose="$2"; shift 2 ;;
            --output) output="$2"; shift 2 ;;
            --no-pull) no_pull=true; shift ;;
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

    if [ "$no_pull" = true ]; then step 2 "Resolving images already present locally"; else step 2 "Resolving and pulling images"; fi
    # The compose declares ${POSTGRES_PASSWORD:?...}: give config a throwaway value.
    # No -f: run from $stage, where the file is already named docker-compose.yml
    # (compose auto-detects it), so the resolution matches what install/upgrade
    # run against on the isolated host later. COMPOSE_FILE/REGISTRY/POSTGRES_IMAGE
    # are pinned so an operator's shell (or a CI runner) exporting any of them
    # can't silently change which file or images get resolved and bundled.
    local images images_err="$work/compose-config.err"
    if ! images=$(cd "$stage" && COMPOSE_FILE=docker-compose.yml REGISTRY=ghcr.io/adminsyspro POSTGRES_IMAGE=postgres:16-alpine \
            VERSION="$version" POSTGRES_PASSWORD=bundle APP_SECRET=bundle NEXTAUTH_SECRET=bundle ORCHESTRATOR_API_KEY=bundle \
            docker compose config --images 2>"$images_err" | sed '/^[[:space:]]*$/d' | sort -u); then
        log_error "docker compose config failed: $(tr '\n' ' ' < "$images_err")"
    fi
    [ -n "$images" ] || log_error "docker compose config --images returned nothing"
    local img entries=""
    while IFS= read -r img; do
        if [ "$no_pull" = true ]; then
            docker image inspect "$img" >/dev/null 2>&1 || log_error "Image $img is not present locally and --no-pull was given"
        else
            log_info "Pulling $img"
            docker pull "$img" >/dev/null || log_error "docker pull $img failed (Enterprise images need docker login ghcr.io first)"
        fi
        local digest size
        # `|| true`: under -e/pipefail a failing `inspect` would otherwise abort
        # the script here instead of falling back to unknown/0 below.
        digest=$(docker image inspect --format '{{index .RepoDigests 0}}' "$img" 2>/dev/null | sed 's/.*@//') || true
        size=$(docker image inspect --format '{{.Size}}' "$img" 2>/dev/null) || true
        entries+="    { \"name\": \"$img\", \"digest\": \"${digest:-unknown}\", \"size\": ${size:-0} },"$'\n'
    done <<< "$images"
    if [ "$no_pull" = true ]; then log_success "$(echo "$images" | wc -l) images present locally"; else log_success "$(echo "$images" | wc -l) images pulled"; fi

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

# ---------- install ----------

write_env_file() {
    # $1 edition, $2 version, $3 license, $4 server ip
    local edition=$1 version=$2 license=$3 ip=$4
    local app_secret nextauth_secret pg_pass
    app_secret=$(gen_secret 32); nextauth_secret=$(gen_secret 32); pg_pass=$(gen_secret 24)
    # Created with a private umask first: the secrets below must never be
    # briefly readable at the file's default (often group/world-readable) mode.
    ( umask 077; : > "$INSTALL_DIR/.env" )
    {
        echo "# ProxCenter ${edition^} Edition, air-gapped installation"
        echo "# Generated on $(date -Iseconds) by install-airgap.sh"
        echo ""
        echo "# Version of the loaded images (upgrade rewrites it)"
        echo "VERSION=$version"
        echo ""
        echo "# Secrets"
        echo "APP_SECRET=$app_secret"
        echo "NEXTAUTH_SECRET=$nextauth_secret"
        echo "NEXTAUTH_URL=http://$ip:3000"
        echo ""
        echo "# Postgres"
        echo "POSTGRES_PASSWORD=$pg_pass"
        echo ""
        echo "# Air-gapped site: no outbound call from the product"
        echo "PROXCENTER_OFFLINE=true"
        echo "TEMPLATE_CATALOG_AUTO_UPDATE=false"
        if [ "$edition" = "enterprise" ]; then
            echo ""
            echo "# License (optional here, can be activated in Settings > License)"
            echo "LICENSE_KEY=$license"
            echo ""
            echo "# Orchestrator"
            echo "ORCHESTRATOR_URL=http://orchestrator:8080"
            echo "ORCHESTRATOR_API_KEY=$(gen_secret 32)"
            echo ""
            echo "# No registry access on this host: the warm-migration VDDK package needs a mirror"
            echo "GHCR_TOKEN="
        fi
    } > "$INSTALL_DIR/.env"
    chmod 600 "$INSTALL_DIR/.env"
}

write_orchestrator_config() {
    local app_secret=$1 license=$2
    mkdir -p "$INSTALL_DIR/config"
    cat > "$INSTALL_DIR/config/orchestrator.yaml" <<YAML
# ProxCenter Orchestrator Configuration (air-gapped install)
api:
  address: ":8080"
  read_timeout: 30s
  write_timeout: 30s

database:
  # The compose file overrides these through PROXCENTER_DATABASE_* env vars.
  driver: postgres
  dsn: "postgres://proxcenter:\${POSTGRES_PASSWORD}@postgres:5432/proxcenter?sslmode=disable"

proxmox:
  # Must match APP_SECRET from .env
  app_secret: "$app_secret"
  shared_data_path: /app/shared_data

license:
  key: "$license"

logging:
  level: info
  format: json
YAML
    # The orchestrator runs as a non-root user: 600 makes it die on "permission denied".
    chmod 644 "$INSTALL_DIR/config/orchestrator.yaml"
}

create_volumes() {
    local edition=$1 frontend_image=$2
    # Errors go to the log instead of /dev/null: a volume that already exists
    # still exits 0, so `|| true` stays right, but a real Docker daemon error
    # here must be diagnosable after the fact rather than thrown away.
    docker volume create proxcenter_data >> "${LOG_FILE:-/dev/null}" 2>&1 || true
    docker volume create postgres_data >> "${LOG_FILE:-/dev/null}" 2>&1 || true
    if [ "$edition" = "enterprise" ]; then
        docker volume create orchestrator_data >> "${LOG_FILE:-/dev/null}" 2>&1 || true
    fi
    # The frontend runs as uid 1001 and must own /app/data. Unlike the volume
    # creates above, this one-shot's failure is fatal, so its stderr is kept
    # (in the log, and its last line in the error itself) instead of being
    # discarded to /dev/null: an empty frontend_image, a bad image reference
    # or a permission error inside the container must be visible, not just
    # "Could not initialise the proxcenter_data volume" with no reason why.
    local chown_err
    if ! chown_err=$(docker run --rm --user root --entrypoint "" \
        -v proxcenter_data:/app/data \
        "$frontend_image" \
        sh -c "mkdir -p /app/data && chown -R 1001:1001 /app/data" 2>&1); then
        log_line "$chown_err"
        log_error "Could not initialise the proxcenter_data volume: $(printf '%s\n' "$chown_err" | tail -1)"
    fi
    # A bare `[ -n "$chown_err" ] && log_line ...` here would trip `set -e`
    # on the success path (no output): under errexit a failing test outside
    # an if/while is fatal even on the left of `&&`.
    if [ -n "$chown_err" ]; then log_line "$chown_err"; fi
}

start_stack() {
    local edition=$1
    (cd "$INSTALL_DIR" && docker compose up -d >> "${LOG_FILE:-/dev/null}" 2>&1) || log_error "docker compose up failed. See $LOG_FILE"
    log_success "Containers started"
    wait_for_health "frontend" "$(frontend_probe)"
    if [ "$edition" = "enterprise" ]; then
        wait_for_health "orchestrator" "$(orchestrator_probe)"
    fi
}

read_license_arg() {
    # A path to a .key file, or the key string itself.
    if [ -n "$1" ] && [ -f "$1" ]; then tr -d '\r\n' < "$1"; else printf '%s' "$1"; fi
}

server_ip() {
    local ip
    ip=$(hostname -I 2>/dev/null | awk '{print $1}' | head -1) || ip=""
    echo "${ip:-localhost}"
}

frontend_image_of() {
    manifest_images | grep '/proxcenter-frontend:' | head -1
}

cmd_install() {
    local license="" registry=""
    while [[ $# -gt 0 ]]; do
        case $1 in
            --license) [ $# -ge 2 ] || log_error "--license needs a value"; license="$2"; shift 2 ;;
            --install-dir) [ $# -ge 2 ] || log_error "--install-dir needs a value"; INSTALL_DIR="$2"; shift 2 ;;
            --registry) [ $# -ge 2 ] || log_error "--registry needs a value"; registry="${2%/}"; shift 2 ;;
            --health-timeout)
                [ $# -ge 2 ] || log_error "--health-timeout needs a value"
                [[ "$2" =~ ^[0-9]+$ ]] || log_error "--health-timeout needs a number of seconds"
                HEALTH_TIMEOUT="$2"; shift 2 ;;
            -h|--help) usage ;;
            *) log_error "Unknown option: $1" ;;
        esac
    done
    require_root
    require_docker
    [ -f "$SCRIPT_DIR/manifest.json" ] || log_error "manifest.json not found next to $SCRIPT_PATH. Run the install-airgap.sh shipped inside the extracted bundle."
    local edition version
    edition=$(manifest_get edition); version=$(manifest_get version)
    [ -n "$edition" ] && [ -n "$version" ] || log_error "manifest.json has no edition/version"
    if [ -f "$INSTALL_DIR/.env" ]; then
        log_error "An installation already exists at $INSTALL_DIR. To upgrade it, run the upgrade subcommand from a newer bundle. To retry a failed first install, run: cd $INSTALL_DIR && docker compose up -d, or remove $INSTALL_DIR/.env to start over."
    fi
    mkdir -p "$INSTALL_DIR"
    init_log "$INSTALL_DIR/install-airgap.log" install "$@"
    TOTAL_STEPS=6
    if [ -n "$registry" ]; then TOTAL_STEPS=7; fi
    print_banner "${edition^} Edition" "install $version"
    if [ "$edition" = "community" ] && [ -n "$license" ]; then
        log_warning "--license is ignored on the Community edition"
    fi
    license=$(read_license_arg "$license")

    step 1 "Verifying the bundle"
    verify_checksums
    local root_dir free_kb
    # Advisory only: keep only the last line (a failed `docker info` can still
    # print a blank one first) and never let this step abort the install.
    root_dir=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null | tail -n1) || root_dir=""
    root_dir="${root_dir:-/var/lib/docker}"
    free_kb=$(df -Pk "$root_dir" 2>/dev/null | awk 'NR==2 {print $4}') || free_kb=""
    if [ -n "$free_kb" ] && [ "$free_kb" -lt $((5 * 1024 * 1024)) ]; then
        log_warning "Less than 5 GB free under $root_dir; docker load may run out of space"
    fi

    step 2 "Loading images"
    load_images

    local n=3
    if [ -n "$registry" ]; then
        step $n "Pushing images to $registry"
        retag_and_push "$registry"
        log_success "Images available from $registry"
        n=$((n + 1))
    fi

    step $n "Configuring ProxCenter"; n=$((n + 1))
    cp "$SCRIPT_DIR/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
    write_env_file "$edition" "$version" "$license" "$(server_ip)"
    if [ -n "$registry" ]; then
        env_set REGISTRY "$registry" "$INSTALL_DIR/.env"
        env_set POSTGRES_IMAGE "$registry/$(image_basename "$(manifest_images | grep '^postgres' | head -1)")" "$INSTALL_DIR/.env"
    fi
    if [ "$edition" = "enterprise" ]; then
        write_orchestrator_config "$(env_get APP_SECRET "$INSTALL_DIR/.env")" "$license"
    fi
    log_success "Compose, .env and configuration written to $INSTALL_DIR"

    step $n "Initialising volumes"; n=$((n + 1))
    create_volumes "$edition" "$(frontend_image_of)"
    log_success "Volumes ready"

    step $n "Starting ProxCenter"; n=$((n + 1))
    start_stack "$edition"

    step $n "Done"
    print_install_summary "$edition" "$version" "$license"
}

print_install_summary() {
    local edition=$1 version=$2 license=$3 ip
    ip=$(server_ip) || ip="localhost"
    echo ""
    echo -e "${GREEN}${BOLD}  ProxCenter ${edition^} $version is ready (air-gapped)${NC}"
    echo ""
    echo -e "    ${BOLD}URL${NC}         ${CYAN}http://$ip:3000${NC}"
    echo -e "    ${BOLD}Install${NC}     $INSTALL_DIR"
    echo -e "    ${BOLD}Duration${NC}    $(format_duration $(( $(date +%s) - START_TIME )))"
    echo ""
    if [ "$edition" = "enterprise" ] && [ -z "$license" ]; then
        echo -e "    ${YELLOW}${BOLD}!${NC} ${YELLOW}No license key provided${NC}: upload your .key in ${BOLD}Settings > License${NC}"
        echo ""
    fi
    echo -e "    ${DIM}Upgrade: extract the next bundle, then from its directory:${NC}"
    echo -e "      ${DIM}sudo ./install-airgap.sh upgrade --install-dir $INSTALL_DIR${NC}"
    echo -e "    ${DIM}Logs:    docker compose -f $INSTALL_DIR/docker-compose.yml logs -f${NC}"
    echo ""
}

# ---------- upgrade ----------

installed_edition() {
    if grep -qE '^\s+orchestrator:\s*$' "$INSTALL_DIR/docker-compose.yml"; then echo enterprise; else echo community; fi
}

backup_database() {
    local old_version=$1 stamp=$2 pg_user pg_db out services
    # Capture stdout+stderr and the exit code separately: a `ps` failure (older
    # compose plugin without --status, daemon hiccup, ...) must abort loudly,
    # not be read as "postgres is not running" and silently skip the backup.
    if ! services=$(cd "$INSTALL_DIR" && docker compose ps --status running --services 2>&1); then
        log_error "docker compose ps failed, cannot tell whether postgres is running: $(printf '%s' "$services" | tr '\n' ' ')"
    fi
    if ! printf '%s\n' "$services" | grep -qx postgres; then
        log_warning "postgres is not running, skipping the database backup"
        return 0
    fi
    pg_user=$(env_get POSTGRES_USER "$INSTALL_DIR/.env"); pg_db=$(env_get POSTGRES_DB "$INSTALL_DIR/.env")
    mkdir -p "$INSTALL_DIR/backups"
    chmod 700 "$INSTALL_DIR/backups"
    out="$INSTALL_DIR/backups/pre-upgrade-$old_version-$stamp.sql.gz"
    # umask 077: the dump must never be briefly world-readable while it is written.
    if ! (umask 077; cd "$INSTALL_DIR" && docker compose exec -T postgres pg_dump -U "${pg_user:-proxcenter}" "${pg_db:-proxcenter}" | gzip_cmd > "$out"); then
        rm -f "$out"
        log_error "Database backup failed (pg_dump). Nothing was changed. Retry, or pass --skip-db-backup if you have your own backup."
    fi
    chmod 600 "$out"
    log_success "Database backed up to $out"
}

# backfill_env EDITION: EDITION is the already-validated installed edition
# (never re-derived from the compose file here, which by the time this runs
# in cmd_upgrade may already be the new bundle's).
backfill_env() {
    local edition=$1 envf="$INSTALL_DIR/.env"
    # A file with no trailing newline would otherwise get its last line glued
    # to the first append below (e.g. "LICENSE_KEY=LICTEMPLATE_CATALOG_...").
    [ -n "$(tail -c1 "$envf")" ] && echo >> "$envf"
    if ! grep -q '^POSTGRES_PASSWORD=' "$envf"; then
        printf '\n# Postgres (added by upgrade)\nPOSTGRES_PASSWORD=%s\n' "$(gen_secret 24)" >> "$envf"
        log_info "Added POSTGRES_PASSWORD to .env"
    fi
    if [ "$edition" = "enterprise" ]; then
        if ! grep -q '^ORCHESTRATOR_API_KEY=' "$envf"; then
            printf '\n# Orchestrator (added by upgrade)\nORCHESTRATOR_API_KEY=%s\n' "$(gen_secret 32)" >> "$envf"
            log_info "Added ORCHESTRATOR_API_KEY to .env"
        elif grep -q '^ORCHESTRATOR_API_KEY=your-orchestrator-api-key-change-me' "$envf"; then
            env_set ORCHESTRATOR_API_KEY "$(gen_secret 32)" "$envf"
            log_info "Replaced the placeholder ORCHESTRATOR_API_KEY in .env"
        fi
    fi
    grep -q '^PROXCENTER_OFFLINE=' "$envf" || printf '\n# Air-gapped site (added by upgrade)\nPROXCENTER_OFFLINE=true\n' >> "$envf"
    grep -q '^TEMPLATE_CATALOG_AUTO_UPDATE=' "$envf" || printf 'TEMPLATE_CATALOG_AUTO_UPDATE=false\n' >> "$envf"
}

# rollback_commands OLD_VERSION STAMP: the exact shell commands to go back to
# OLD_VERSION using the docker-compose.yml.bak.STAMP taken this run. OLD_VERSION
# can be empty (a first-ever upgrade with no VERSION recorded yet): naming a
# literal placeholder version there would be actively misleading, so this
# spells out what to do by hand instead of a copy-pastable sed.
rollback_commands() {
    local old=$1 stamp=$2
    if [ -n "$old" ]; then
        echo "sed -i 's/^VERSION=.*/VERSION=$old/' $INSTALL_DIR/.env && cp $INSTALL_DIR/docker-compose.yml.bak.$stamp $INSTALL_DIR/docker-compose.yml && cd $INSTALL_DIR && docker compose up -d"
    else
        echo "set VERSION to your previous version in $INSTALL_DIR/.env, then: cp $INSTALL_DIR/docker-compose.yml.bak.$stamp $INSTALL_DIR/docker-compose.yml && cd $INSTALL_DIR && docker compose up -d"
    fi
}

print_rollback_hint() {
    local label=$1 old=$2 stamp=$3 skip=$4
    echo ""
    echo -e "    ${DIM}$label${NC}"
    echo -e "      ${DIM}$(rollback_commands "$old" "$stamp")${NC}"
    if [ "$skip" != true ]; then
        echo -e "    ${DIM}If the new version migrated the database, restore the dump from $INSTALL_DIR/backups/ first.${NC}"
    fi
}

cmd_upgrade() {
    local skip_backup=false
    while [[ $# -gt 0 ]]; do
        case $1 in
            --install-dir) [ $# -ge 2 ] || log_error "--install-dir needs a value"; INSTALL_DIR="$2"; shift 2 ;;
            --skip-db-backup) skip_backup=true; shift ;;
            --health-timeout)
                [ $# -ge 2 ] || log_error "--health-timeout needs a value"
                [[ "$2" =~ ^[0-9]+$ ]] || log_error "--health-timeout needs a number of seconds"
                HEALTH_TIMEOUT="$2"; shift 2 ;;
            -h|--help) usage ;;
            *) log_error "Unknown option: $1" ;;
        esac
    done
    require_root
    require_docker
    [ -f "$SCRIPT_DIR/manifest.json" ] || log_error "manifest.json not found next to $SCRIPT_PATH. Run the install-airgap.sh shipped inside the extracted bundle."
    if [ ! -f "$INSTALL_DIR/.env" ] || [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
        log_error "No existing installation at $INSTALL_DIR (.env or docker-compose.yml missing). Use: sudo $SCRIPT_PATH install"
    fi
    local edition version old_version installed
    edition=$(manifest_get edition); version=$(manifest_get version)
    installed=$(installed_edition)
    if [ "$installed" != "$edition" ]; then
        log_error "This is a ${installed^} installation and the bundle is an $edition bundle. Use the matching bundle."
    fi
    old_version=$(env_get VERSION "$INSTALL_DIR/.env")
    if [ "$old_version" = "$version" ]; then
        log_error "$INSTALL_DIR is already at VERSION=$version; a previous upgrade may have failed only at the restart step. Retry the restart with: cd $INSTALL_DIR && docker compose up -d. To roll back instead, restore the newest docker-compose.yml.bak.* in $INSTALL_DIR, set VERSION back in .env, then run that same command."
    fi
    init_log "$INSTALL_DIR/install-airgap.log" upgrade "$@"
    TOTAL_STEPS=6
    print_banner "${edition^} Edition" "upgrade ${old_version:-?} → $version"
    local stamp; stamp=$(date +%Y%m%d-%H%M%S)

    step 1 "Verifying the bundle"
    verify_checksums

    step 2 "Backing up the database"
    if [ "$skip_backup" = true ]; then log_warning "--skip-db-backup: no pg_dump taken"; else backup_database "${old_version:-unknown}" "$stamp"; fi

    step 3 "Loading images"
    load_images
    local registry; registry=$(env_get REGISTRY "$INSTALL_DIR/.env")
    if [ -n "$registry" ]; then retag_and_push "$registry"; log_success "Images pushed to $registry"; fi

    step 4 "Updating compose and .env"
    cp -p "$INSTALL_DIR/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml.bak.$stamp"
    cp "$SCRIPT_DIR/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
    backfill_env "$edition"
    env_set VERSION "$version" "$INSTALL_DIR/.env"
    log_success "docker-compose.yml replaced (backup: docker-compose.yml.bak.$stamp), VERSION=$version"
    # Printed before the restart is attempted: if step 5 fails, this is still
    # in the transcript, and by then the compose/VERSION are already changed.
    print_rollback_hint "If the restart below fails, roll back with:" "$old_version" "$stamp" "$skip_backup"

    step 5 "Restarting ProxCenter"
    start_stack "$edition"

    step 6 "Done"
    echo ""
    echo -e "${GREEN}${BOLD}  ProxCenter ${edition^} upgraded to $version${NC}"
    echo ""
    echo -e "    ${BOLD}Duration${NC}    $(format_duration $(( $(date +%s) - START_TIME )))"
    print_rollback_hint "Rollback to the previous version, if ever needed:" "$old_version" "$stamp" "$skip_backup"
}

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
