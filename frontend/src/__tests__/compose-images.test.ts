import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// The air-gapped installer loads images under their GHCR names and, with
// --registry, retags them into a private registry. Both cases need every
// image line to be overridable from .env, and every knob the installer writes
// to be listed in the compose environment (an env var absent from the list
// never reaches the container).
const ROOT = join(__dirname, '..', '..', '..')
const files = ['docker-compose.community.yml', 'docker-compose.enterprise.yml', 'docker-compose.ha.yml']

function read(name: string): string {
  return readFileSync(join(ROOT, name), 'utf8')
}

// The environment block of one service: from its `  name:` line to the next
// service at the same indentation.
function serviceBlock(text: string, name: string): string {
  const lines = text.split('\n')
  const start = lines.findIndex(l => l === `  ${name}:`)

  if (start < 0) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(l => /^  [a-z][\w-]*:\s*$/.test(l) || /^[a-z]/.test(l))

  return rest.slice(0, end < 0 ? rest.length : end).join('\n')
}

function imageLines(text: string): string[] {
  return text.split('\n').filter(l => /^\s+image:\s/.test(l)).map(l => l.trim())
}

describe('compose files are registry-overridable', () => {
  it.each(files)('%s has no hard-coded ghcr.io or docker.io image', file => {
    for (const line of imageLines(read(file))) {
      expect(line, line).toMatch(/^image: \$\{(REGISTRY:-ghcr\.io\/adminsyspro|POSTGRES_IMAGE:-postgres:16-alpine)\}/)
    }
  })

  it.each(files)('%s exposes PROXCENTER_OFFLINE to the frontend', file => {
    expect(read(file)).toMatch(/PROXCENTER_OFFLINE[=:]\s*\$\{PROXCENTER_OFFLINE:-\}/)
  })

  // The orchestrator reads PROXCENTER_OFFLINE itself to disable the portal
  // connection; without it an air-gapped site offers a Connect that times out.
  it.each(['docker-compose.enterprise.yml', 'docker-compose.ha.yml'])('%s exposes PROXCENTER_OFFLINE to the orchestrator', file => {
    const block = serviceBlock(read(file), 'orchestrator')

    expect(block).toContain('proxcenter-orchestrator')
    expect(block).toMatch(/PROXCENTER_OFFLINE[=:]\s*\$\{PROXCENTER_OFFLINE:-\}/)
  })

  it.each(['docker-compose.enterprise.yml', 'docker-compose.ha.yml'])('%s exposes the CVE mirrors to the orchestrator', file => {
    const text = read(file)
    expect(text).toMatch(/PROXCENTER_CVE_FEED_URL[=:]\s*\$\{CVE_FEED_URL:-\}/)
    expect(text).toMatch(/PROXCENTER_CVE_DEBIAN_MIRROR[=:]\s*\$\{CVE_DEBIAN_MIRROR:-\}/)
  })

  // The installer writes HTTP_PROXY / HTTPS_PROXY / NO_PROXY to .env when it
  // runs behind a proxy. Empty defaults keep direct connections elsewhere.
  // The frontend gets them too since roadmap#78, for the SSO identity provider
  // calls only (lib/auth/oidcProxy.ts); every other call it makes stays direct.
  it.each([
    ['docker-compose.enterprise.yml', 'orchestrator'],
    ['docker-compose.ha.yml', 'orchestrator'],
    ['docker-compose.enterprise.yml', 'frontend'],
    ['docker-compose.ha.yml', 'frontend'],
    ['docker-compose.community.yml', 'frontend'],
  ])('%s passes the HTTP proxy to %s', (file, service) => {
    const block = serviceBlock(read(file), service)

    expect(block).toMatch(/HTTP_PROXY[=:]\s*\$\{HTTP_PROXY:-\}/)
    expect(block).toMatch(/HTTPS_PROXY[=:]\s*\$\{HTTPS_PROXY:-\}/)
    expect(block).toMatch(/NO_PROXY[=:]\s*\$\{NO_PROXY:-localhost,127\.0\.0\.1,frontend,postgres,orchestrator,weasyprint\}/)
  })

  it('every ${VERSION} image also carries the REGISTRY prefix', () => {
    for (const file of files) {
      for (const line of imageLines(read(file))) {
        if (line.includes('${VERSION:-latest}')) expect(line).toContain('${REGISTRY:-ghcr.io/adminsyspro}/')
      }
    }
  })
})
