import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SCRIPT, makeAirgapSandbox, makeFakeBundle, readEnvFile, removeAirgapSandbox, runAirgap, type AirgapSandbox } from './setup/airgap-sandbox'

let sb: AirgapSandbox
beforeEach(() => { sb = makeAirgapSandbox() })
afterEach(() => { removeAirgapSandbox(sb) })

describe('install-airgap.sh syntax and usage', () => {
  it('is valid bash', () => {
    expect(spawnSync('bash', ['-n', SCRIPT]).status).toBe(0)
  })

  it('prints usage and exits 1 without a subcommand', () => {
    const r = runAirgap(sb, [], sb.dir)
    expect(r.status).toBe(1)
    expect(r.stdout + r.stderr).toMatch(/Usage:/)
  })
})

describe('bundle', () => {
  it('sets a throwaway POSTGRES_PASSWORD for compose config and saves what compose resolves', () => {
    const out = join(sb.dir, 'dist')
    mkdirSync(out)
    const compose = join(sb.dir, 'docker-compose.community.yml')
    spawnSync('bash', ['-c', `printf '%s' "$FAKE_COMPOSE_BODY" > ${compose}`], { env: sb.env })
    const r = runAirgap(sb, ['bundle', '--edition', 'community', '--version', '1.4.10', '--compose', compose, '--output', out], sb.dir)
    expect(r.status, r.stdout + r.stderr).toBe(0)

    const argv = sb.argv()
    const config = argv.find(a => a.includes('compose') && a.includes('config --images'))
    expect(config).toBeDefined()
    expect(argv).toContain('docker pull ghcr.io/adminsyspro/proxcenter-frontend:1.4.10')
    expect(argv).toContain('docker pull postgres:16-alpine')
    expect(argv.some(a => a.startsWith('docker save ghcr.io/adminsyspro/proxcenter-frontend:1.4.10 postgres:16-alpine -o '))).toBe(true)
    // no curl: --compose was given
    expect(argv.some(a => a.startsWith('curl'))).toBe(false)

    const tarball = join(out, 'proxcenter-community-1.4.10.tar.gz')
    expect(existsSync(tarball)).toBe(true)
    const sums = readFileSync(join(out, 'proxcenter-community-1.4.10.tar.gz.sha256'), 'utf8')
    expect(sums).toMatch(/^[0-9a-f]{64}  proxcenter-community-1\.4\.10\.tar\.gz\n$/)

    const list = spawnSync('tar', ['tzf', tarball], { encoding: 'utf8' }).stdout.trim().split('\n').sort()
    expect(list).toEqual([
      'proxcenter-community-1.4.10/',
      'proxcenter-community-1.4.10/README.txt',
      'proxcenter-community-1.4.10/SHA256SUMS',
      'proxcenter-community-1.4.10/docker-compose.yml',
      'proxcenter-community-1.4.10/images.tar',
      'proxcenter-community-1.4.10/install-airgap.sh',
      'proxcenter-community-1.4.10/manifest.json',
    ])

    const extract = join(sb.dir, 'x')
    mkdirSync(extract)
    spawnSync('tar', ['xzf', tarball, '-C', extract])
    const bdir = join(extract, 'proxcenter-community-1.4.10')
    expect(spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: bdir }).status).toBe(0)
    const manifest = JSON.parse(readFileSync(join(bdir, 'manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({ schema: 1, edition: 'community', version: '1.4.10', compose: 'docker-compose.community.yml' })
    expect(manifest.images.map((i: any) => i.name)).toEqual(['ghcr.io/adminsyspro/proxcenter-frontend:1.4.10', 'postgres:16-alpine'])
    expect(manifest.images[0].digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(readFileSync(join(bdir, 'install-airgap.sh'), 'utf8')).toBe(readFileSync(SCRIPT, 'utf8'))
    const readme = readFileSync(join(bdir, 'README.txt'), 'utf8')
    expect(readme).toContain('sudo ./install-airgap.sh install ')
    expect(readme).toContain('sudo bash install-airgap.sh')
    expect(readme).not.toContain('--license') // Community has no license
  })

  it('downloads the compose file at the tag when --compose is absent', () => {
    const out = join(sb.dir, 'dist')
    mkdirSync(out)
    const r = runAirgap(sb, ['bundle', '--edition', 'enterprise', '--version', '1.4.10', '--output', out], sb.dir)
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(sb.argv().some(a => a.includes('https://raw.githubusercontent.com/adminsyspro/proxcenter-ui/v1.4.10/docker-compose.enterprise.yml'))).toBe(true)
  })

  it('refuses a version that is not X.Y.Z and an unknown edition', () => {
    expect(runAirgap(sb, ['bundle', '--edition', 'enterprise', '--version', 'latest'], sb.dir).status).toBe(1)
    expect(runAirgap(sb, ['bundle', '--edition', 'pro', '--version', '1.4.10'], sb.dir).status).toBe(1)
  })

  it('fails loudly when docker compose config fails, without calling docker pull', () => {
    const out = join(sb.dir, 'dist')
    mkdirSync(out)
    const compose = join(sb.dir, 'docker-compose.community.yml')
    spawnSync('bash', ['-c', `printf '%s' "$FAKE_COMPOSE_BODY" > ${compose}`], { env: sb.env })
    const r = runAirgap(
      sb,
      ['bundle', '--edition', 'community', '--version', '1.4.10', '--compose', compose, '--output', out],
      sb.dir,
      { FAKE_COMPOSE_CONFIG_RC: '15' },
    )
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/✗.*docker compose config/)
    expect(sb.argv().some(a => a.startsWith('docker pull'))).toBe(false)
  })

  it('pins COMPOSE_FILE, REGISTRY and POSTGRES_IMAGE for compose config, ignoring exported overrides', () => {
    const out = join(sb.dir, 'dist')
    mkdirSync(out)
    const compose = join(sb.dir, 'docker-compose.community.yml')
    spawnSync('bash', ['-c', `printf '%s' "$FAKE_COMPOSE_BODY" > ${compose}`], { env: sb.env })
    const r = runAirgap(
      sb,
      ['bundle', '--edition', 'community', '--version', '1.4.10', '--compose', compose, '--output', out],
      sb.dir,
      { COMPOSE_FILE: '/etc/should-not-be-used.yml', REGISTRY: 'evil.example.com', POSTGRES_IMAGE: 'evil:latest' },
    )
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(sb.argv()).toContain('compose config env COMPOSE_FILE=docker-compose.yml REGISTRY=ghcr.io/adminsyspro POSTGRES_IMAGE=postgres:16-alpine')
  })

  it('packs images already present locally with --no-pull, skipping docker pull', () => {
    const out = join(sb.dir, 'dist')
    mkdirSync(out)
    const compose = join(sb.dir, 'docker-compose.community.yml')
    spawnSync('bash', ['-c', `printf '%s' "$FAKE_COMPOSE_BODY" > ${compose}`], { env: sb.env })
    const r = runAirgap(sb, ['bundle', '--edition', 'community', '--version', '1.4.10', '--compose', compose, '--output', out, '--no-pull'], sb.dir)
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(sb.argv().some(a => a.startsWith('docker pull'))).toBe(false)
    expect(existsSync(join(out, 'proxcenter-community-1.4.10.tar.gz'))).toBe(true)
  })

  it('refuses --no-pull when a resolved image is not present locally', () => {
    const out = join(sb.dir, 'dist')
    mkdirSync(out)
    const compose = join(sb.dir, 'docker-compose.community.yml')
    spawnSync('bash', ['-c', `printf '%s' "$FAKE_COMPOSE_BODY" > ${compose}`], { env: sb.env })
    const r = runAirgap(
      sb,
      ['bundle', '--edition', 'community', '--version', '1.4.10', '--compose', compose, '--output', out, '--no-pull'],
      sb.dir,
      { FAKE_MISSING_IMAGES: 'postgres:16-alpine' },
    )
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/postgres:16-alpine is not present locally/)
  })
})

describe('install', () => {
  it('verifies, loads, configures, starts and waits (enterprise)', () => {
    const bdir = makeFakeBundle(sb, { edition: 'enterprise', version: '1.4.10' })
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir, '--health-timeout', '5'], bdir)
    expect(r.status, r.stdout + r.stderr).toBe(0)

    const argv = sb.argv()
    const loadIdx = argv.findIndex(a => a.startsWith('docker load -i '))
    expect(loadIdx).toBeGreaterThan(-1)
    expect(argv[loadIdx]).toBe(`docker load -i ${join(bdir, 'images.tar')}`)
    for (const v of ['proxcenter_data', 'orchestrator_data', 'postgres_data']) expect(argv).toContain(`docker volume create ${v}`)
    expect(argv.some(a => a.startsWith('docker run --rm --user root --entrypoint  -v proxcenter_data:/app/data ghcr.io/adminsyspro/proxcenter-frontend:1.4.10'))).toBe(true)
    expect(argv).toContain('docker compose up -d')
    // Both health probes read the compose healthcheck: install needs no curl.
    expect(argv.some(a => a.startsWith('docker inspect') && a.includes('proxcenter-frontend'))).toBe(true)
    expect(argv.some(a => a.startsWith('docker inspect') && a.includes('proxcenter-orchestrator'))).toBe(true)
    expect(argv.some(a => a.startsWith('curl'))).toBe(false)
    // The preflight looked for a leftover postgres_data before writing anything.
    expect(argv).toContain('docker volume inspect postgres_data')
    // no license given: no one-shot copy into orchestrator_data
    expect(argv.some(a => a.includes('license.key'))).toBe(false)
    // nothing pulled, nothing pushed, no registry login
    expect(argv.some(a => /^docker (pull|push|login|tag) /.test(a))).toBe(false)

    expect(readFileSync(join(sb.installDir, 'docker-compose.yml'), 'utf8')).toBe(readFileSync(join(bdir, 'docker-compose.yml'), 'utf8'))
    const env = readEnvFile(join(sb.installDir, '.env'))
    expect(env.VERSION).toBe('1.4.10')
    expect(env.PROXCENTER_OFFLINE).toBe('true')
    expect(env.TEMPLATE_CATALOG_AUTO_UPDATE).toBe('false')
    expect(env.LICENSE_KEY).toBe('')
    expect(env.NEXTAUTH_URL).toBe('http://10.42.0.55:3000')
    expect(env.ORCHESTRATOR_URL).toBe('http://orchestrator:8080')
    expect(env.GHCR_TOKEN).toBe('')
    for (const k of ['APP_SECRET', 'NEXTAUTH_SECRET', 'ORCHESTRATOR_API_KEY']) expect(env[k], k).toMatch(/^[0-9a-f]{64}$/)
    expect(env.POSTGRES_PASSWORD).toMatch(/^[0-9a-f]{48}$/)
    expect(env.REGISTRY).toBeUndefined()

    const yaml = readFileSync(join(sb.installDir, 'config', 'orchestrator.yaml'), 'utf8')
    expect(yaml).toContain(`app_secret: "${env.APP_SECRET}"`)
    expect(yaml).toContain('key: ""')
    const mode = (statSync(join(sb.installDir, 'config', 'orchestrator.yaml')).mode & 0o777).toString(8)
    expect(mode).toBe('644')
    expect((statSync(join(sb.installDir, '.env')).mode & 0o777).toString(8)).toBe('600')
    expect(existsSync(join(sb.installDir, 'install-airgap.log'))).toBe(true)

    // No license was given: the summary points at Settings > License.
    expect(r.stdout).toMatch(/No license key provided.*Settings > License/s)
  })

  it('copies the .key file into the orchestrator data volume (enterprise)', () => {
    const bdir = makeFakeBundle(sb, { edition: 'enterprise', version: '1.4.10' })
    const keyPath = join(sb.dir, 'lic.key')
    writeFileSync(keyPath, '-----BEGIN PROXCENTER LICENSE-----\nQUJD\n-----BEGIN SIGNATURE-----\nWFla\n-----END PROXCENTER LICENSE-----\n')
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir, '--license', keyPath, '--health-timeout', '5'], bdir)
    expect(r.status, r.stdout + r.stderr).toBe(0)

    const argv = sb.argv()
    const copyLine = argv.find(a => a.startsWith('docker run') && a.includes('license.key'))
    expect(copyLine, argv.join('\n')).toBeDefined()
    // Streamed on stdin as root: a 600 root:root key is unreadable to the
    // image's non-root user through a bind mount, and its chown a no-op.
    expect(copyLine).toMatch(/^docker run -i --rm --user root --entrypoint sh /)
    expect(copyLine?.match(/ -v /g)).toHaveLength(1)
    expect(copyLine).toContain('-v orchestrator_data:/app/data ')
    expect(copyLine).not.toContain('/tmp/license.key')
    expect(copyLine).not.toContain(keyPath)
    expect(copyLine).toContain('ghcr.io/adminsyspro/proxcenter-orchestrator:1.4.10')
    expect(copyLine).toContain('cat > /app/data/license.key')
    expect(readFileSync(`${sb.argvLog}.stdin`, 'utf8')).toBe(readFileSync(keyPath, 'utf8'))

    const env = readEnvFile(join(sb.installDir, '.env'))
    expect(env.LICENSE_KEY).toBe('')
    const yaml = readFileSync(join(sb.installDir, 'config', 'orchestrator.yaml'), 'utf8')
    expect(yaml).toContain('key: ""')

    expect(r.stdout).toMatch(new RegExp(`License file copied from.*${keyPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*imports it at its first start`))
    // The invoked arguments are on record (the path, never the key's content).
    const log = readFileSync(join(sb.installDir, 'install-airgap.log'), 'utf8')
    expect(log).toContain(`install-airgap.sh install --install-dir ${sb.installDir} --license ${keyPath} --health-timeout 5`)
    expect(log).not.toContain('QUJD')
  })

  it('refuses a --license value that is not a readable file', () => {
    const bdir = makeFakeBundle(sb, { edition: 'enterprise' })
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir, '--license', 'NOT-A-FILE', '--health-timeout', '5'], bdir)
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/--license must be the path/)
    expect(sb.argv().some(a => a.startsWith('docker load'))).toBe(false)
  })

  it('community edition ignores --license (no copy) and writes a .env without orchestrator settings', () => {
    const bdir = makeFakeBundle(sb, { edition: 'community' })
    const keyPath = join(sb.dir, 'lic.key')
    writeFileSync(keyPath, 'FILE-KEY-CONTENT\n')
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir, '--license', keyPath, '--health-timeout', '5'], bdir)
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toMatch(/--license is ignored on the Community edition/)
    const env = readEnvFile(join(sb.installDir, '.env'))
    expect(env.LICENSE_KEY).toBeUndefined()
    expect(env.ORCHESTRATOR_URL).toBeUndefined()
    expect(existsSync(join(sb.installDir, 'config', 'orchestrator.yaml'))).toBe(false)
    expect(sb.argv()).not.toContain('docker volume create orchestrator_data')
    expect(sb.argv().some(a => a.startsWith('docker inspect') && a.includes('proxcenter-orchestrator'))).toBe(false)
    expect(sb.argv().some(a => a.startsWith('docker inspect') && a.includes('proxcenter-frontend'))).toBe(true)
    expect(sb.argv().some(a => a.includes('license.key'))).toBe(false)
  })

  it('fails outside an extracted bundle directory with a manifest.json not found message', () => {
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir], sb.dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/manifest\.json not found next to/)
  })

  it('resolves bundle files next to the invoked script, not the current directory', () => {
    const bdir = makeFakeBundle(sb, { edition: 'enterprise', version: '1.4.10' })
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir, '--health-timeout', '5'], sb.dir, {}, join(bdir, 'install-airgap.sh'))
    expect(r.status, r.stdout + r.stderr).toBe(0)
  })

  it('fails early with a clear message when the Docker daemon is not running', () => {
    const bdir = makeFakeBundle(sb)
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir], bdir, { FAKE_DOCKER_INFO_RC: '1' })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/Docker daemon is not running/)
    expect(sb.argv().some(a => a.startsWith('docker load'))).toBe(false)
  })

  it('falls back to localhost for NEXTAUTH_URL when hostname -I fails', () => {
    const bdir = makeFakeBundle(sb, { edition: 'enterprise', version: '1.4.10' })
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir, '--health-timeout', '5'], bdir, { FAKE_HOSTNAME_RC: '1' })
    expect(r.status, r.stdout + r.stderr).toBe(0)
    const env = readEnvFile(join(sb.installDir, '.env'))
    expect(env.NEXTAUTH_URL).toBe('http://localhost:3000')
  })

  it('validates --health-timeout is a number of seconds', () => {
    const bdir = makeFakeBundle(sb)
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir, '--health-timeout', 'abc'], bdir)
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/--health-timeout/)
  })

  it('refuses a tampered images.tar before loading anything', () => {
    const bdir = makeFakeBundle(sb)
    writeFileSync(join(bdir, 'images.tar'), 'tampered\n')
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir], bdir)
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/Checksum verification failed/)
    expect(r.stderr).toMatch(/images\.tar/)
    expect(sb.argv().some(a => a.startsWith('docker load'))).toBe(false)
    expect(existsSync(join(sb.installDir, '.env'))).toBe(false)
  })

  it('refuses to install over an existing installation', () => {
    const bdir = makeFakeBundle(sb)
    mkdirSync(sb.installDir, { recursive: true })
    writeFileSync(join(sb.installDir, '.env'), 'VERSION=1.4.9\n')
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir], bdir)
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/already exists.*upgrade/)
    expect(r.stderr).toMatch(/docker volume rm postgres_data proxcenter_data orchestrator_data, then delete/)
    expect(r.stderr).not.toMatch(/remove .*\.env to start over/)
  })

  it('refuses, before writing anything, when a postgres_data volume is left from a previous installation', () => {
    const bdir = makeFakeBundle(sb)
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir, '--health-timeout', '5'], bdir, { FAKE_VOLUME_EXISTS: 'postgres_data' })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/A postgres_data volume already exists from a previous ProxCenter installation/)
    expect(r.stderr).toMatch(/docker compose down; docker volume rm postgres_data proxcenter_data orchestrator_data/)
    expect(existsSync(sb.installDir)).toBe(false)
    expect(sb.argv().some(a => a.startsWith('docker load'))).toBe(false)
    expect(sb.argv().some(a => a.startsWith('docker volume create'))).toBe(false)
  })

  it('removes the configuration and the volumes it created when it fails while initialising volumes', () => {
    const bdir = makeFakeBundle(sb)
    const keyPath = join(sb.dir, 'lic.key')
    writeFileSync(keyPath, 'KEY\n')
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir, '--license', keyPath, '--health-timeout', '5'], bdir, { FAKE_LICENSE_COPY_RC: '1' })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/Could not install the license file: sh: can't create/)
    expect(r.stderr).toMatch(/Removed the configuration and the volumes this run created/)
    expect(existsSync(join(sb.installDir, '.env'))).toBe(false)
    expect(existsSync(join(sb.installDir, 'config', 'orchestrator.yaml'))).toBe(false)
    expect(existsSync(join(sb.installDir, 'docker-compose.yml'))).toBe(false)
    const argv = sb.argv()
    for (const v of ['postgres_data', 'proxcenter_data', 'orchestrator_data']) expect(argv, v).toContain(`docker volume rm ${v}`)
    expect(argv).not.toContain('docker compose up -d')
  })

  it('removes only the volumes this run created when the chown one-shot fails', () => {
    const bdir = makeFakeBundle(sb)
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir, '--health-timeout', '5'], bdir, { FAKE_CHOWN_RC: '1', FAKE_VOLUME_EXISTS: 'proxcenter_data' })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/Could not initialise the proxcenter_data volume: chown/)
    expect(existsSync(join(sb.installDir, '.env'))).toBe(false)
    const argv = sb.argv()
    expect(argv).not.toContain('docker volume create proxcenter_data')
    expect(argv).not.toContain('docker volume rm proxcenter_data')
    expect(argv).toContain('docker volume rm postgres_data')
    expect(argv).toContain('docker volume rm orchestrator_data')
  })

  it('keeps everything, with the retry hint, when it fails once the stack is starting', () => {
    const bdir = makeFakeBundle(sb)
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir, '--health-timeout', '5'], bdir, { FAKE_COMPOSE_UP_RC: '1' })
    expect(r.status).toBe(1)
    expect(existsSync(join(sb.installDir, '.env'))).toBe(true)
    expect(sb.argv().some(a => a.startsWith('docker volume rm'))).toBe(false)
    expect(r.stderr).toMatch(/retry with: cd .* && docker compose up -d/)
  })

  it('shows the last line of docker load output when the load fails', () => {
    const bdir = makeFakeBundle(sb)
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir, '--health-timeout', '5'], bdir, { FAKE_LOAD_RC: '1' })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/docker load failed: .*no space left on device/)
  })

  it('fails early with a clear message when docker is missing', () => {
    const bdir = makeFakeBundle(sb)
    // A PATH holding the coreutils the script runs before its Docker check, and no docker.
    const nobin = join(sb.dir, 'nobin')
    mkdirSync(nobin)
    for (const tool of ['dirname', 'basename', 'date', 'sed', 'grep', 'mkdir', 'cat', 'tr', 'head', 'chmod']) {
      const real = ['/usr/bin', '/bin'].map(d => join(d, tool)).find(p => existsSync(p))
      if (real) symlinkSync(real, join(nobin, tool))
    }
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir], bdir, { PATH: nobin })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/Docker is not installed/)
  })

  it('fails when an image listed in the manifest is absent after docker load', () => {
    const bdir = makeFakeBundle(sb)
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir], bdir, { FAKE_MISSING_IMAGES: 'postgres:16-alpine' })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/postgres:16-alpine is listed in manifest\.json but is not present/)
  })

  it('fails before any docker run when manifest.json lists no image', () => {
    const bdir = makeFakeBundle(sb, { edition: 'community', images: [] })
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir, '--health-timeout', '5'], bdir)
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/manifest\.json lists no image/)
    expect(sb.argv().some(a => a.startsWith('docker run'))).toBe(false)
  })

  it('--registry retags and pushes every image and writes REGISTRY and POSTGRES_IMAGE', () => {
    const bdir = makeFakeBundle(sb, { edition: 'enterprise' })
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir, '--registry', 'harbor.lan/proxcenter/', '--health-timeout', '5'], bdir)
    expect(r.status, r.stdout + r.stderr).toBe(0)
    const argv = sb.argv()
    expect(argv).toContain('docker tag ghcr.io/adminsyspro/proxcenter-frontend:1.4.10 harbor.lan/proxcenter/proxcenter-frontend:1.4.10')
    expect(argv).toContain('docker push harbor.lan/proxcenter/proxcenter-frontend:1.4.10')
    expect(argv).toContain('docker tag postgres:16-alpine harbor.lan/proxcenter/postgres:16-alpine')
    const env = readEnvFile(join(sb.installDir, '.env'))
    expect(env.REGISTRY).toBe('harbor.lan/proxcenter')
    expect(env.POSTGRES_IMAGE).toBe('harbor.lan/proxcenter/postgres:16-alpine')
  })
})

describe('upgrade', () => {
  function installedEnv(extra = '') {
    mkdirSync(sb.installDir, { recursive: true })
    writeFileSync(join(sb.installDir, '.env'), [
      '# old install', 'VERSION=1.4.9', 'APP_SECRET=' + 'a'.repeat(64), 'NEXTAUTH_SECRET=' + 'b'.repeat(64),
      'NEXTAUTH_URL=http://10.42.0.55:3000', 'POSTGRES_PASSWORD=' + 'c'.repeat(48), 'LICENSE_KEY=LIC', 'ORCHESTRATOR_URL=http://orchestrator:8080',
      extra,
    ].filter(Boolean).join('\n') + '\n')
    // Enterprise-shaped: installed_edition() looks for the orchestrator service.
    writeFileSync(join(sb.installDir, 'docker-compose.yml'), 'services:\n  frontend:\n    image: x\n  orchestrator:\n    image: y\n# old compose\n')
  }

  it('backs up the database and compose, backfills, bumps VERSION and keeps the secrets byte-identical', () => {
    installedEnv('ORCHESTRATOR_API_KEY=your-orchestrator-api-key-change-me')
    const before = readEnvFile(join(sb.installDir, '.env'))
    const beforeRaw = readFileSync(join(sb.installDir, '.env'), 'utf8')
    const oldCompose = readFileSync(join(sb.installDir, 'docker-compose.yml'), 'utf8')
    const bdir = makeFakeBundle(sb, { edition: 'enterprise', version: '1.4.10' })
    const r = runAirgap(sb, ['upgrade', '--install-dir', sb.installDir, '--health-timeout', '5'], bdir)
    expect(r.status, r.stdout + r.stderr).toBe(0)

    const argv = sb.argv()
    const pgDumpIdx = argv.findIndex(a => a.startsWith('docker compose exec -T postgres pg_dump --clean --if-exists -U proxcenter proxcenter'))
    const loadIdx = argv.findIndex(a => a.startsWith('docker load -i '))
    expect(pgDumpIdx).toBeGreaterThan(-1)
    expect(loadIdx).toBeGreaterThan(-1)
    expect(pgDumpIdx).toBeLessThan(loadIdx) // the dump is taken before anything is loaded/replaced
    const backups = readdirSync(join(sb.installDir, 'backups'))
    const dump = backups.find(f => /^pre-upgrade-1\.4\.9-\d{8}-\d{6}\.sql\.gz$/.test(f))
    expect(dump).toBeDefined()
    expect((statSync(join(sb.installDir, 'backups', dump as string)).mode & 0o777).toString(8)).toBe('600')
    expect((statSync(join(sb.installDir, 'backups')).mode & 0o777).toString(8)).toBe('700')
    const bak = readdirSync(sb.installDir).find(f => /^docker-compose\.yml\.bak\.\d{8}-\d{6}$/.test(f))
    expect(bak).toBeDefined()
    expect(readFileSync(join(sb.installDir, bak as string), 'utf8')).toBe(oldCompose)
    expect(readFileSync(join(sb.installDir, 'docker-compose.yml'), 'utf8')).toBe(readFileSync(join(bdir, 'docker-compose.yml'), 'utf8'))
    expect(argv).toContain('docker compose up -d')

    const after = readEnvFile(join(sb.installDir, '.env'))
    expect(after.VERSION).toBe('1.4.10')
    for (const k of ['APP_SECRET', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL', 'POSTGRES_PASSWORD', 'LICENSE_KEY']) expect(after[k], k).toBe(before[k])
    expect(after.ORCHESTRATOR_API_KEY).toMatch(/^[0-9a-f]{64}$/)
    expect(after.PROXCENTER_OFFLINE).toBe('true')
    expect(after.TEMPLATE_CATALOG_AUTO_UPDATE).toBe('false')
    expect(r.stdout).toMatch(/VERSION=1\.4\.9/) // rollback hint names the previous version
    // The exact rollback sequence: stop the apps, restore the dump, then
    // VERSION, the compose backup and the restart, in that order.
    const dumpPath = join(sb.installDir, 'backups', dump as string)
    const seq = [
      `cd ${sb.installDir} && docker compose stop frontend orchestrator`,
      `cd ${sb.installDir} && docker compose exec -T postgres psql -U proxcenter -d proxcenter -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`,
      `cd ${sb.installDir} && gunzip -c ${dumpPath} | docker compose exec -T postgres psql -U proxcenter -d proxcenter`,
      `sed -i 's/^VERSION=.*/VERSION=1.4.9/' ${sb.installDir}/.env`,
      `cp ${sb.installDir}/docker-compose.yml.bak.`,
      `cd ${sb.installDir} && docker compose up -d`,
    ]
    const tail = r.stdout.slice(r.stdout.lastIndexOf('Rollback to the previous version'))
    let at = 0
    for (const line of seq) {
      const i = tail.indexOf(line, at)
      expect(i, line).toBeGreaterThan(-1)
      at = i + line.length
    }
    expect(r.stdout).toMatch(/docker image prune -a/)

    // Every pre-existing line (including the "# old install" comment), in the
    // same order, is untouched: only VERSION/ORCHESTRATOR_API_KEY change in
    // place and PROXCENTER_OFFLINE/TEMPLATE_CATALOG_AUTO_UPDATE/comments are
    // appended — nothing else is rewritten, reordered or duplicated.
    const stripChanging = (s: string) => s.split('\n').filter(l => l !== '' &&
      !/^(VERSION=|ORCHESTRATOR_API_KEY=|PROXCENTER_OFFLINE=|TEMPLATE_CATALOG_AUTO_UPDATE=|# (Orchestrator|Postgres|Air-gapped site))/.test(l))
    expect(stripChanging(readFileSync(join(sb.installDir, '.env'), 'utf8'))).toEqual(stripChanging(beforeRaw))
  })

  it('refuses when there is no installation, and when the edition differs', () => {
    const bdir = makeFakeBundle(sb, { edition: 'enterprise' })
    let r = runAirgap(sb, ['upgrade', '--install-dir', sb.installDir], bdir)
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/No existing installation/)

    installedEnv()
    writeFileSync(join(sb.installDir, 'docker-compose.yml'), 'services:\n  frontend:\n    image: x\n# no orchestrator service\n')
    r = runAirgap(sb, ['upgrade', '--install-dir', sb.installDir], bdir)
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/Community installation.*enterprise bundle/i)
  })

  it('--skip-db-backup skips pg_dump; a failing pg_dump aborts before touching the stack', () => {
    installedEnv()
    writeFileSync(join(sb.installDir, 'docker-compose.yml'), 'services:\n  orchestrator:\n    image: x\n')
    const bdir = makeFakeBundle(sb, { edition: 'enterprise' })
    let r = runAirgap(sb, ['upgrade', '--install-dir', sb.installDir, '--skip-db-backup', '--health-timeout', '5'], bdir)
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(sb.argv().some(a => a.includes('pg_dump'))).toBe(false)

    sb = makeAirgapSandbox()
    installedEnv()
    const oldCompose = 'services:\n  orchestrator:\n    image: x\n'
    writeFileSync(join(sb.installDir, 'docker-compose.yml'), oldCompose)
    const bdir2 = makeFakeBundle(sb, { edition: 'enterprise' })
    r = runAirgap(sb, ['upgrade', '--install-dir', sb.installDir], bdir2, { FAKE_PG_DUMP_RC: '3' })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/Database backup failed/)
    expect(sb.argv()).not.toContain('docker compose up -d')
    expect(sb.argv().some(a => a.startsWith('docker load'))).toBe(false)
    expect(readEnvFile(join(sb.installDir, '.env')).VERSION).toBe('1.4.9')
    expect(readFileSync(join(sb.installDir, 'docker-compose.yml'), 'utf8')).toBe(oldCompose)
    const backupsDir = join(sb.installDir, 'backups')
    if (existsSync(backupsDir)) expect(readdirSync(backupsDir).filter(f => f.endsWith('.sql.gz'))).toHaveLength(0)
  })

  it('pushes the new images to REGISTRY when the install uses one', () => {
    installedEnv('REGISTRY="harbor.lan/pc"')
    writeFileSync(join(sb.installDir, 'docker-compose.yml'), 'services:\n  orchestrator:\n    image: x\n')
    const bdir = makeFakeBundle(sb, { edition: 'enterprise' })
    const r = runAirgap(sb, ['upgrade', '--install-dir', sb.installDir, '--skip-db-backup', '--health-timeout', '5'], bdir)
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(sb.argv()).toContain('docker push harbor.lan/pc/proxcenter-frontend:1.4.10')
  })

  it('refuses to run again once .env VERSION already matches the bundle (a previous run only failed to restart)', () => {
    installedEnv()
    writeFileSync(join(sb.installDir, '.env'), readFileSync(join(sb.installDir, '.env'), 'utf8').replace('VERSION=1.4.9', 'VERSION=1.4.10'))
    writeFileSync(join(sb.installDir, 'docker-compose.yml'), 'services:\n  orchestrator:\n    image: x\n')
    const bdir = makeFakeBundle(sb, { edition: 'enterprise', version: '1.4.10' })
    const r = runAirgap(sb, ['upgrade', '--install-dir', sb.installDir], bdir)
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/1\.4\.10/)
    expect(r.stderr).toMatch(/docker compose up -d/)
    expect(sb.argv().some(a => a.startsWith('docker load'))).toBe(false)
  })

  it('prints the rollback commands before restarting, so they are on record even if the restart fails', () => {
    installedEnv()
    writeFileSync(join(sb.installDir, 'docker-compose.yml'), 'services:\n  orchestrator:\n    image: x\n')
    const bdir = makeFakeBundle(sb, { edition: 'enterprise', version: '1.4.10' })
    const r = runAirgap(sb, ['upgrade', '--install-dir', sb.installDir, '--skip-db-backup', '--health-timeout', '5'], bdir, { FAKE_COMPOSE_UP_RC: '1' })
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/roll back with/i)
    expect(r.stdout).toMatch(/docker-compose\.yml\.bak\.\d{8}-\d{6}/)
    expect(r.stdout).toMatch(/VERSION=1\.4\.9/)
  })

  it('aborts before loading anything when docker compose ps itself fails, instead of assuming postgres is down', () => {
    installedEnv()
    writeFileSync(join(sb.installDir, 'docker-compose.yml'), 'services:\n  orchestrator:\n    image: x\n')
    const bdir = makeFakeBundle(sb, { edition: 'enterprise' })
    const r = runAirgap(sb, ['upgrade', '--install-dir', sb.installDir], bdir, { FAKE_COMPOSE_PS_RC: '1' })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/docker compose ps/)
    expect(sb.argv().some(a => a.startsWith('docker load'))).toBe(false)
    expect(readEnvFile(join(sb.installDir, '.env')).VERSION).toBe('1.4.9')
  })

  it('warns and proceeds without a dump when postgres is not among the running services', () => {
    installedEnv()
    writeFileSync(join(sb.installDir, 'docker-compose.yml'), 'services:\n  orchestrator:\n    image: x\n')
    const bdir = makeFakeBundle(sb, { edition: 'enterprise' })
    const r = runAirgap(sb, ['upgrade', '--install-dir', sb.installDir, '--health-timeout', '5'], bdir, { FAKE_RUNNING_SERVICES: 'frontend' })
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toMatch(/postgres is not running/)
    expect(sb.argv().some(a => a.includes('pg_dump'))).toBe(false)
  })

  it('keeps the last pre-existing line intact when .env has no trailing newline', () => {
    mkdirSync(sb.installDir, { recursive: true })
    writeFileSync(join(sb.installDir, '.env'), ['VERSION=1.4.9', 'LICENSE_KEY=LIC'].join('\n')) // no final \n
    writeFileSync(join(sb.installDir, 'docker-compose.yml'), 'services:\n  frontend:\n    image: x\n# no orchestrator: community\n')
    const bdir = makeFakeBundle(sb, { edition: 'community' })
    const r = runAirgap(sb, ['upgrade', '--install-dir', sb.installDir, '--skip-db-backup', '--health-timeout', '5'], bdir)
    expect(r.status, r.stdout + r.stderr).toBe(0)
    const after = readEnvFile(join(sb.installDir, '.env'))
    expect(after.LICENSE_KEY).toBe('LIC') // not glued to the next appended key
    expect(after.PROXCENTER_OFFLINE).toBe('true')
    expect(after.TEMPLATE_CATALOG_AUTO_UPDATE).toBe('false')
  })

  it('spells out setting VERSION by hand in the rollback hint when there was no previous VERSION', () => {
    mkdirSync(sb.installDir, { recursive: true })
    writeFileSync(join(sb.installDir, '.env'), 'APP_SECRET=' + 'a'.repeat(64) + '\n')
    writeFileSync(join(sb.installDir, 'docker-compose.yml'), 'services:\n  frontend:\n    image: x\n# no orchestrator: community\n')
    const bdir = makeFakeBundle(sb, { edition: 'community' })
    const r = runAirgap(sb, ['upgrade', '--install-dir', sb.installDir, '--skip-db-backup', '--health-timeout', '5'], bdir)
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toMatch(/set VERSION to your previous version/)
    expect(r.stdout).not.toMatch(/VERSION=PREVIOUS/)
    // --skip-db-backup: no restore line, and no schema-recreate line either; community: no orchestrator to stop.
    expect(r.stdout).not.toMatch(/gunzip -c/)
    expect(r.stdout).not.toMatch(/DROP SCHEMA/)
    expect(r.stdout).toMatch(/docker compose stop frontend(?! orchestrator)/)
  })
})

describe('round trip', () => {
  // The regression this whole task is about: cmd_bundle writes each manifest
  // image entry on ONE line (`    { "name": "...", ... },`), which the old
  // line-anchored manifest_images() never matched. Every other test in this
  // file goes through makeFakeBundle, a fixture; this one runs `bundle` for
  // real and installs from what it actually produces, so a regression back
  // to a line-anchored (or otherwise real-shape-blind) manifest_images()
  // fails here even if every fixture-based test above stays green.
  it('installs from a bundle it just built: the manifest images are read back and the frontend image reaches the volume init', () => {
    const compose = join(sb.dir, 'docker-compose.enterprise.yml')
    writeFileSync(compose, [
      'services:',
      '  frontend:',
      '    image: ${REGISTRY:-ghcr.io/adminsyspro}/proxcenter-frontend:${VERSION:-latest}',
      '  orchestrator:',
      '    image: ${REGISTRY:-ghcr.io/adminsyspro}/proxcenter-orchestrator:${VERSION:-latest}',
      '  weasyprint:',
      '    image: ${REGISTRY:-ghcr.io/adminsyspro}/proxcenter-weasyprint:${VERSION:-latest}',
      '  postgres:',
      '    image: ${POSTGRES_IMAGE:-postgres:16-alpine}',
      '',
    ].join('\n'))
    const fakeImages = [
      'ghcr.io/adminsyspro/proxcenter-frontend:1.4.10',
      'ghcr.io/adminsyspro/proxcenter-orchestrator:1.4.10',
      'ghcr.io/adminsyspro/proxcenter-weasyprint:1.4.10',
      'postgres:16-alpine',
    ]
    const out = join(sb.dir, 'dist')
    mkdirSync(out)
    const bundleR = runAirgap(
      sb,
      ['bundle', '--edition', 'enterprise', '--version', '1.4.10', '--compose', compose, '--output', out, '--no-pull'],
      sb.dir,
      { FAKE_IMAGES: fakeImages.join('\n') },
    )
    expect(bundleR.status, bundleR.stdout + bundleR.stderr).toBe(0)

    const tarball = join(out, 'proxcenter-enterprise-1.4.10.tar.gz')
    expect(existsSync(tarball)).toBe(true)
    const extract = join(sb.dir, 'extracted')
    mkdirSync(extract)
    expect(spawnSync('tar', ['xzf', tarball, '-C', extract]).status).toBe(0)
    const bdir = join(extract, 'proxcenter-enterprise-1.4.10')

    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir, '--health-timeout', '5'], bdir)
    expect(r.status, r.stdout + r.stderr).toBe(0)

    const argv = sb.argv()
    expect(argv).toContain(`docker load -i ${join(bdir, 'images.tar')}`)
    for (const img of fakeImages) expect(argv, img).toContain(`docker image inspect ${img}`)
    expect(argv.some(a => a.startsWith(
      'docker run --rm --user root --entrypoint  -v proxcenter_data:/app/data ghcr.io/adminsyspro/proxcenter-frontend:1.4.10 sh -c',
    ))).toBe(true)
    // The bug: an empty frontend_image_of() left the image argument blank,
    // so the chown container ran against "" instead of the frontend image.
    expect(argv.some(a => a.includes('-v proxcenter_data:/app/data  sh -c'))).toBe(false)

    const env = readEnvFile(join(sb.installDir, '.env'))
    expect(env.VERSION).toBe('1.4.10')
  })
})
