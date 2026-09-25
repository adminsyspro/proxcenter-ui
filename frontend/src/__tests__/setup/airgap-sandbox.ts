// Test harness for install-airgap.sh: the script runs for real under bash,
// with docker, curl and hostname replaced by stubs that record their argv
// and answer from FAKE_* variables. No root, no daemon, no network.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const SCRIPT = join(__dirname, '..', '..', '..', '..', 'install-airgap.sh')

export interface AirgapSandbox {
  dir: string
  bin: string
  installDir: string
  argvLog: string
  argv(): string[]
  env: Record<string, string>
}

const FAKE_DOCKER = `#!/bin/bash
echo "docker $*" >> "$FAKE_ARGV_LOG"
case "$1 $2" in
  "compose version") echo "Docker Compose version v2.29.7"; exit 0 ;;
  "compose config")
    # Record the inline env this call was made with, so a test can assert
    # COMPOSE_FILE/REGISTRY/POSTGRES_IMAGE are pinned rather than inherited.
    echo "compose config env COMPOSE_FILE=$COMPOSE_FILE REGISTRY=$REGISTRY POSTGRES_IMAGE=$POSTGRES_IMAGE" >> "$FAKE_ARGV_LOG"
    if [ "\${FAKE_COMPOSE_CONFIG_RC:-0}" != "0" ]; then echo "fake compose config failure (rc=\$FAKE_COMPOSE_CONFIG_RC)" >&2; exit "$FAKE_COMPOSE_CONFIG_RC"; fi
    # Real compose refuses: the enterprise file requires POSTGRES_PASSWORD.
    if [ -z "$POSTGRES_PASSWORD" ]; then echo "error while interpolating services.postgres.environment: required variable POSTGRES_PASSWORD is missing a value" >&2; exit 1; fi
    # --images: print what FAKE_IMAGES holds, one per line
    printf '%s\\n' $FAKE_IMAGES; exit 0 ;;
  "compose up"|"compose down") echo " Container proxcenter-frontend Started"; exit 0 ;;
  "compose ps") printf '%s\\n' $FAKE_RUNNING_SERVICES; exit 0 ;;
  "compose exec") echo "-- fake pg_dump"; exit \${FAKE_PG_DUMP_RC:-0} ;;
  "image inspect")
    shift 2
    fmt=""; img=""
    while [ $# -gt 0 ]; do case "$1" in --format) fmt="$2"; shift 2 ;; *) img="$1"; shift ;; esac; done
    case " $FAKE_MISSING_IMAGES " in *" $img "*) echo "Error: No such image: $img" >&2; exit 1 ;; esac
    case "$fmt" in
      *RepoDigests*) echo "\${img%%:*}@sha256:0000000000000000000000000000000000000000000000000000000000000000" ;;
      *Size*) echo 123456 ;;
      *) echo "[]" ;;
    esac
    exit 0 ;;
  "save "*)
    out=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done
    echo "fake docker archive" > "$out"; exit 0 ;;
  "load -i") exit \${FAKE_LOAD_RC:-0} ;;
  "info -f"|"info --format") echo "$FAKE_DOCKER_ROOT"; exit 0 ;;
  "inspect --format="*|"inspect --format") echo "healthy"; exit 0 ;;
  *) exit 0 ;;
esac
`

const FAKE_CURL = `#!/bin/bash
echo "curl $*" >> "$FAKE_ARGV_LOG"
# health probe: succeed unless told otherwise; compose download: write FAKE_COMPOSE_BODY
out=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done
if [ -n "$out" ]; then printf '%s' "$FAKE_COMPOSE_BODY" > "$out"; fi
exit \${FAKE_CURL_RC:-0}
`

const FAKE_HOSTNAME = `#!/bin/bash
echo "hostname $*" >> "$FAKE_ARGV_LOG"
if [ "$1" = "-I" ]; then echo "10.42.0.55 172.17.0.1 "; else echo "airgap-test"; fi
`

export function makeAirgapSandbox(): AirgapSandbox {
  const dir = mkdtempSync(join(tmpdir(), 'proxcenter-airgap-test-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  for (const [name, body] of [['docker', FAKE_DOCKER], ['curl', FAKE_CURL], ['hostname', FAKE_HOSTNAME]] as const) {
    const p = join(bin, name)
    writeFileSync(p, body)
    chmodSync(p, 0o755)
  }
  const installDir = join(dir, 'opt', 'proxcenter')
  const argvLog = join(dir, 'argv.log')
  const env: Record<string, string> = {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    HOME: dir,
    FAKE_ARGV_LOG: argvLog,
    FAKE_IMAGES: 'ghcr.io/adminsyspro/proxcenter-frontend:1.4.10\npostgres:16-alpine',
    FAKE_RUNNING_SERVICES: 'frontend postgres',
    FAKE_DOCKER_ROOT: dir,
    FAKE_COMPOSE_BODY: 'services:\n  frontend:\n    image: ${REGISTRY:-ghcr.io/adminsyspro}/proxcenter-frontend:${VERSION:-latest}\n',
    AIRGAP_ALLOW_NON_ROOT: '1',
    TERM: 'dumb',
  }
  return {
    dir, bin, installDir, argvLog, env,
    argv: () => (existsSync(argvLog) ? readFileSync(argvLog, 'utf8').trim().split('\n') : []),
  }
}

/** Removes a sandbox's temp directory. Call from `afterEach` so runs don't pile up on disk. */
export function removeAirgapSandbox(sb: AirgapSandbox): void {
  rmSync(sb.dir, { recursive: true, force: true })
}

export interface RunResult { status: number | null; stdout: string; stderr: string }

/** Runs `bash install-airgap.sh <args>` from `cwd` with the sandbox stubs first in PATH. */
export function runAirgap(sb: AirgapSandbox, args: string[], cwd: string, extraEnv: Record<string, string> = {}): RunResult {
  // /bin/bash on purpose: the missing-docker test hands in a PATH without bash.
  const r = spawnSync('/bin/bash', [SCRIPT, ...args], { cwd, env: { ...sb.env, ...extraEnv }, encoding: 'utf8', timeout: 60_000 })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

export interface FakeBundleOptions {
  edition?: 'community' | 'enterprise'
  version?: string
  images?: string[]
}

/**
 * Lays out an extracted bundle directory the way `bundle` produces it, with
 * a real copy of the script and a valid SHA256SUMS, and returns its path.
 */
export function makeFakeBundle(sb: AirgapSandbox, opts: FakeBundleOptions = {}): string {
  const edition = opts.edition ?? 'enterprise'
  const version = opts.version ?? '1.4.10'
  const images = opts.images ?? (edition === 'enterprise'
    ? ['ghcr.io/adminsyspro/proxcenter-frontend:' + version, 'ghcr.io/adminsyspro/proxcenter-orchestrator:' + version, 'ghcr.io/adminsyspro/proxcenter-weasyprint:' + version, 'postgres:16-alpine']
    : ['ghcr.io/adminsyspro/proxcenter-frontend:' + version, 'postgres:16-alpine'])
  const dir = join(sb.dir, `proxcenter-${edition}-${version}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'install-airgap.sh'), readFileSync(SCRIPT))
  chmodSync(join(dir, 'install-airgap.sh'), 0o755)
  writeFileSync(join(dir, 'docker-compose.yml'), `services:\n  frontend:\n    image: \${REGISTRY:-ghcr.io/adminsyspro}/proxcenter-frontend:\${VERSION:-latest}\n  postgres:\n    image: \${POSTGRES_IMAGE:-postgres:16-alpine}\n`)
  writeFileSync(join(dir, 'images.tar'), 'fake docker archive\n')
  writeFileSync(join(dir, 'README.txt'), 'fake readme\n')
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    schema: 1, edition, version, created_at: '2026-09-25T10:00:00Z', compose: `docker-compose.${edition}.yml`,
    images: images.map(name => ({ name, digest: 'sha256:' + '0'.repeat(64), size: 123456 })),
  }, null, 2) + '\n')
  const sums = spawnSync('sha256sum', ['install-airgap.sh', 'docker-compose.yml', 'images.tar', 'manifest.json', 'README.txt'], { cwd: dir, encoding: 'utf8' })
  writeFileSync(join(dir, 'SHA256SUMS'), sums.stdout)
  return dir
}

export function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (m) out[m[1]] = m[2]
  }
  return out
}
