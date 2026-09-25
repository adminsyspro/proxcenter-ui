import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
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
})

describe('install', () => {
  it('verifies, loads, configures, starts and waits (enterprise)', () => {
    const bdir = makeFakeBundle(sb, { edition: 'enterprise', version: '1.4.10' })
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir, '--license', 'LIC-KEY-STRING', '--health-timeout', '5'], bdir)
    expect(r.status, r.stdout + r.stderr).toBe(0)

    const argv = sb.argv()
    const loadIdx = argv.findIndex(a => a.startsWith('docker load -i '))
    expect(loadIdx).toBeGreaterThan(-1)
    expect(argv[loadIdx]).toBe(`docker load -i ${join(bdir, 'images.tar')}`)
    for (const v of ['proxcenter_data', 'orchestrator_data', 'postgres_data']) expect(argv).toContain(`docker volume create ${v}`)
    expect(argv.some(a => a.startsWith('docker run --rm --user root --entrypoint  -v proxcenter_data:/app/data ghcr.io/adminsyspro/proxcenter-frontend:1.4.10'))).toBe(true)
    expect(argv).toContain('docker compose up -d')
    expect(argv.some(a => a.startsWith('curl') && a.includes('--noproxy') && a.includes('http://localhost:3000/api/health'))).toBe(true)
    expect(argv.some(a => a.startsWith('docker inspect') && a.includes('proxcenter-orchestrator'))).toBe(true)
    // nothing pulled, nothing pushed, no registry login
    expect(argv.some(a => /^docker (pull|push|login|tag) /.test(a))).toBe(false)

    expect(readFileSync(join(sb.installDir, 'docker-compose.yml'), 'utf8')).toBe(readFileSync(join(bdir, 'docker-compose.yml'), 'utf8'))
    const env = readEnvFile(join(sb.installDir, '.env'))
    expect(env.VERSION).toBe('1.4.10')
    expect(env.PROXCENTER_OFFLINE).toBe('true')
    expect(env.TEMPLATE_CATALOG_AUTO_UPDATE).toBe('false')
    expect(env.LICENSE_KEY).toBe('LIC-KEY-STRING')
    expect(env.NEXTAUTH_URL).toBe('http://10.42.0.55:3000')
    expect(env.ORCHESTRATOR_URL).toBe('http://orchestrator:8080')
    expect(env.GHCR_TOKEN).toBe('')
    for (const k of ['APP_SECRET', 'NEXTAUTH_SECRET', 'ORCHESTRATOR_API_KEY']) expect(env[k], k).toMatch(/^[0-9a-f]{64}$/)
    expect(env.POSTGRES_PASSWORD).toMatch(/^[0-9a-f]{48}$/)
    expect(env.REGISTRY).toBeUndefined()

    const yaml = readFileSync(join(sb.installDir, 'config', 'orchestrator.yaml'), 'utf8')
    expect(yaml).toContain(`app_secret: "${env.APP_SECRET}"`)
    expect(yaml).toContain('key: "LIC-KEY-STRING"')
    const mode = (statSync(join(sb.installDir, 'config', 'orchestrator.yaml')).mode & 0o777).toString(8)
    expect(mode).toBe('644')
    expect((statSync(join(sb.installDir, '.env')).mode & 0o777).toString(8)).toBe('600')
    expect(existsSync(join(sb.installDir, 'install-airgap.log'))).toBe(true)
  })

  it('reads --license from a .key file and writes a community .env without orchestrator settings', () => {
    const bdir = makeFakeBundle(sb, { edition: 'community' })
    const keyPath = join(sb.dir, 'lic.key')
    writeFileSync(keyPath, 'FILE-KEY-CONTENT\n')
    const r = runAirgap(sb, ['install', '--install-dir', sb.installDir, '--license', keyPath, '--health-timeout', '5'], bdir)
    expect(r.status, r.stdout + r.stderr).toBe(0)
    const env = readEnvFile(join(sb.installDir, '.env'))
    expect(env.LICENSE_KEY).toBe('FILE-KEY-CONTENT')
    expect(env.ORCHESTRATOR_URL).toBeUndefined()
    expect(existsSync(join(sb.installDir, 'config', 'orchestrator.yaml'))).toBe(false)
    expect(sb.argv()).not.toContain('docker volume create orchestrator_data')
    expect(sb.argv().some(a => a.startsWith('docker inspect'))).toBe(false)
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
