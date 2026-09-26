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

  it.each(['docker-compose.enterprise.yml', 'docker-compose.ha.yml'])('%s exposes the CVE mirrors to the orchestrator', file => {
    const text = read(file)
    expect(text).toMatch(/PROXCENTER_CVE_FEED_URL[=:]\s*\$\{CVE_FEED_URL:-\}/)
    expect(text).toMatch(/PROXCENTER_CVE_DEBIAN_MIRROR[=:]\s*\$\{CVE_DEBIAN_MIRROR:-\}/)
  })

  it('every ${VERSION} image also carries the REGISTRY prefix', () => {
    for (const file of files) {
      for (const line of imageLines(read(file))) {
        if (line.includes('${VERSION:-latest}')) expect(line).toContain('${REGISTRY:-ghcr.io/adminsyspro}/')
      }
    }
  })
})
