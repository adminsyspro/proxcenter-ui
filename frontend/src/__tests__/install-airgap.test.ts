import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
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
