import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
   ui#1450: the Ceph libraries the cockpit's client components import must not
   pull a server module (SSH, PVE client, database) into the browser bundle:
   `next build` fails on ssh2 and pg there (found by the build of the deploy
   wizard). Type-only imports are erased and do not count.
*/

const SRC = resolve(__dirname, '..', '..')
const SERVER = [/^@\/lib\/ssh\/exec$/, /^@\/lib\/proxmox\/client$/, /^@\/lib\/db\//, /^@\/lib\/tenant/, /^next\/headers$/, /^node:/]
const CLIENT_LIBS = ['deployPreflight', 'poolForm', 'provisionClient', 'freeDisks', 'pvecephCommands', 'initForm', 'cockpitConnections', 'service', 'serviceClient']

function valueImports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(/^import\s+(?!type\b)[^'"]*from\s+['"]([^'"]+)['"]/gm)].map(m => m[1])
}

function resolveImport(from: string, spec: string): string | null {
  if (spec.startsWith('@/')) return join(SRC, `${spec.slice(2)}.ts`)
  if (spec.startsWith('.')) return resolve(dirname(from), `${spec}.ts`)
  return null
}

function serverReach(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return []
  seen.add(file)
  const out: string[] = []
  for (const spec of valueImports(file)) {
    if (SERVER.some(re => re.test(spec))) out.push(`${file.slice(SRC.length + 1)} -> ${spec}`)
    const next = resolveImport(file, spec)
    if (next) {
      try {
        out.push(...serverReach(next, seen))
      } catch {
        // a .tsx or an index module: not a lib of this folder
      }
    }
  }
  return out
}

describe('Ceph libraries used by the browser', () => {
  it.each(CLIENT_LIBS)('%s reaches no server module', name => {
    expect(serverReach(join(SRC, 'lib', 'ceph', `${name}.ts`))).toEqual([])
  })
})
