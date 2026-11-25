import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

// config/ha/entrypoint-keepalived.sh runs inside the keepalived image. Here it
// runs in a sandbox: its /etc/keepalived and /run are moved under a temporary
// directory, and envsubst and keepalived are stand-ins on PATH.
const REPO = path.resolve(__dirname, '../../..')
const ENTRYPOINT = readFileSync(path.join(REPO, 'config/ha/entrypoint-keepalived.sh'), 'utf8')
const TEMPLATE = readFileSync(path.join(REPO, 'config/ha/keepalived.conf'), 'utf8')

const ENV = {
  NODE_IP: '10.0.0.12', PEER1_IP: '10.0.0.11', PEER2_IP: '10.0.0.12', PEER3_IP: '10.0.0.13',
  VIP: '10.0.0.10', VIP_PREFIX: '24', VIP_INTERFACE: 'eth0', VRRP_PRIORITY: '100',
}

let dir = ''

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

function run(env: Record<string, string>): { conf: string, started: string } {
  dir = mkdtempSync(path.join(tmpdir(), 'keepalived-entrypoint-'))
  const etc = path.join(dir, 'etc')
  const bin = path.join(dir, 'bin')

  mkdirSync(etc)
  mkdirSync(bin)
  mkdirSync(path.join(dir, 'run'))
  writeFileSync(path.join(etc, 'keepalived.conf.template'), TEMPLATE)
  writeFileSync(path.join(etc, 'track_script.sh'), '#!/bin/sh\nexit 0\n')

  // envsubst stand-in: the variables of the template, nothing else.
  const subst = Object.keys(ENV).map(k => `-e "s|\\\${${k}}|\${${k}}|g"`).join(' ')

  writeFileSync(path.join(bin, 'envsubst'), `#!/bin/sh\nexec sed ${subst}\n`)
  writeFileSync(path.join(bin, 'keepalived'), `#!/bin/sh\necho "$@" > "${dir}/started"\n`)
  chmodSync(path.join(bin, 'envsubst'), 0o755)
  chmodSync(path.join(bin, 'keepalived'), 0o755)

  const script = ENTRYPOINT.replaceAll('/etc/keepalived', etc).replaceAll('/run/', `${dir}/run/`)

  // Only PATH and the variables of the case: the entrypoint must not see a
  // NODE_IP inherited from the shell that runs the tests.
  const childEnv: NodeJS.ProcessEnv = { NODE_ENV: 'test', PATH: `${bin}:${process.env.PATH}`, ...env }

  execFileSync('sh', ['-c', script], { env: childEnv })

  return {
    conf: readFileSync(path.join(etc, 'keepalived.conf'), 'utf8'),
    started: readFileSync(path.join(dir, 'started'), 'utf8').trim(),
  }
}

function peers(conf: string): string[] {
  const block = /unicast_peer\s*\{([^}]*)\}/.exec(conf)

  return (block?.[1] ?? '').split('\n').map(l => l.trim()).filter(Boolean)
}

describe('keepalived entrypoint', () => {
  it('lists the two other nodes as unicast peers, never the node itself', () => {
    const { conf, started } = run(ENV)

    expect(peers(conf)).toEqual(['10.0.0.11', '10.0.0.13'])
    // The rest of the configuration is the rendered template, untouched.
    expect(conf).toContain('unicast_src_ip 10.0.0.12')
    expect(conf).toContain('10.0.0.10/24 dev eth0')
    expect(conf).toContain('priority 100')
    expect(conf.trimEnd().endsWith('}')).toBe(true)
    expect(started).toBe('--dont-fork --log-console')
  })

  it('removes only the peer line: the VIP and the source address keep the node address', () => {
    // A VIP that equals the node address would be a broken configuration, yet
    // the filter must not reach outside the unicast_peer block.
    const { conf } = run({ ...ENV, VIP: '10.0.0.12' })

    expect(peers(conf)).toEqual(['10.0.0.11', '10.0.0.13'])
    expect(conf).toContain('10.0.0.12/24 dev eth0')
    expect(conf).toContain('unicast_src_ip 10.0.0.12')
  })

  it('keeps the three peers when the node address is unknown', () => {
    const { NODE_IP: _unused, ...withoutNodeIp } = ENV
    const { conf } = run(withoutNodeIp)

    expect(peers(conf)).toEqual(['10.0.0.11', '10.0.0.12', '10.0.0.13'])
  })
})
