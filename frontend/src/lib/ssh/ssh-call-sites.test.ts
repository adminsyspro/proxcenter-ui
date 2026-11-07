import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import manifest from './ssh-call-sites.json'
import { countSshCalls, isSourceFile } from './sshCallSites'

const SRC = join(__dirname, '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)

    if (entry.isDirectory()) walk(p, out)
    else out.push(p)
  }

  return out
}

// A new SSH command must be classified before it ships: a privileged program
// gets asRoot() and a sudoers rule, a read runs as the account. This test
// catches a call site added (or removed) without updating the manifest.
describe('SSH call-site manifest', () => {
  it('matches the source tree', () => {
    const actual: Record<string, number> = {}

    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/')

      if (!isSourceFile(rel)) continue
      const n = countSshCalls(readFileSync(file, 'utf8'))

      if (n > 0) actual[rel] = n
    }

    expect(actual, manifest.about).toEqual(manifest.files)
  })

  it('counts calls, not the executors\' own definitions', () => {
    expect(countSshCalls('export async function executeSSH(a) {}\nawait executeSSH(id, ip, cmd)\nexecuteSSHDirect({})')).toBe(2)
  })
})
