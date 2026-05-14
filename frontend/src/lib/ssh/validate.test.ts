import { describe, it, expect } from 'vitest'

import {
  assertVmid,
  assertNodeName,
  assertStorageName,
  assertBridgeName,
  assertAbsPath,
  InvalidShellArgError,
} from './validate'

describe('assertVmid', () => {
  it('accepts positive integers as strings', () => {
    expect(assertVmid('100')).toBe('100')
    expect(assertVmid('9999')).toBe('9999')
    expect(assertVmid('999999999')).toBe('999999999')
  })

  it('accepts positive integers as numbers and returns them stringified', () => {
    expect(assertVmid(100)).toBe('100')
    expect(assertVmid(1)).toBe('1')
  })

  it('rejects values with leading zeros', () => {
    expect(() => assertVmid('0100')).toThrow(InvalidShellArgError)
  })

  it('rejects zero and negative numbers', () => {
    expect(() => assertVmid('0')).toThrow(InvalidShellArgError)
    expect(() => assertVmid('-1')).toThrow(InvalidShellArgError)
    expect(() => assertVmid(-5)).toThrow(InvalidShellArgError)
  })

  it('rejects values above the 999_999_999 ceiling', () => {
    expect(() => assertVmid('1000000000')).toThrow(InvalidShellArgError)
  })

  it('rejects non-numeric strings, including shell-injection payloads', () => {
    expect(() => assertVmid('100; rm -rf /')).toThrow(InvalidShellArgError)
    expect(() => assertVmid('$(whoami)')).toThrow(InvalidShellArgError)
    expect(() => assertVmid('100 200')).toThrow(InvalidShellArgError)
    expect(() => assertVmid('100abc')).toThrow(InvalidShellArgError)
    expect(() => assertVmid('')).toThrow(InvalidShellArgError)
  })

  it('rejects non-string, non-number inputs', () => {
    expect(() => assertVmid(null)).toThrow(InvalidShellArgError)
    expect(() => assertVmid(undefined)).toThrow(InvalidShellArgError)
    expect(() => assertVmid({})).toThrow(InvalidShellArgError)
    expect(() => assertVmid([100])).toThrow(InvalidShellArgError)
    expect(() => assertVmid(true)).toThrow(InvalidShellArgError)
  })

  it('rejects floating-point numbers', () => {
    expect(() => assertVmid('100.5')).toThrow(InvalidShellArgError)
    expect(() => assertVmid(100.5)).toThrow(InvalidShellArgError)
  })
})

describe('assertNodeName', () => {
  it('accepts standard hostnames', () => {
    expect(assertNodeName('pve1')).toBe('pve1')
    expect(assertNodeName('node-01')).toBe('node-01')
    expect(assertNodeName('proxmox.example.com')).toBe('proxmox.example.com')
    expect(assertNodeName('a')).toBe('a')
  })

  it('accepts the underscore character which Proxmox tolerates', () => {
    expect(assertNodeName('node_alpha')).toBe('node_alpha')
  })

  it('rejects names starting with non-alphanumeric characters', () => {
    expect(() => assertNodeName('-node')).toThrow(InvalidShellArgError)
    expect(() => assertNodeName('.node')).toThrow(InvalidShellArgError)
    expect(() => assertNodeName('_node')).toThrow(InvalidShellArgError)
  })

  it('rejects shell metacharacters', () => {
    expect(() => assertNodeName('node;ls')).toThrow(InvalidShellArgError)
    expect(() => assertNodeName('node$(id)')).toThrow(InvalidShellArgError)
    expect(() => assertNodeName('node|cat')).toThrow(InvalidShellArgError)
    expect(() => assertNodeName('node&whoami')).toThrow(InvalidShellArgError)
    expect(() => assertNodeName('node`whoami`')).toThrow(InvalidShellArgError)
    expect(() => assertNodeName('node\nls')).toThrow(InvalidShellArgError)
    expect(() => assertNodeName('node ls')).toThrow(InvalidShellArgError)
  })

  it('rejects empty strings and non-strings', () => {
    expect(() => assertNodeName('')).toThrow(InvalidShellArgError)
    expect(() => assertNodeName(null)).toThrow(InvalidShellArgError)
    expect(() => assertNodeName(123)).toThrow(InvalidShellArgError)
  })

  it('rejects names longer than 63 characters', () => {
    const sixtyThree = 'a' + 'b'.repeat(62)
    const sixtyFour = 'a' + 'b'.repeat(63)
    expect(assertNodeName(sixtyThree)).toBe(sixtyThree)
    expect(() => assertNodeName(sixtyFour)).toThrow(InvalidShellArgError)
  })
})

describe('assertStorageName', () => {
  it('accepts typical storage identifiers', () => {
    expect(assertStorageName('local')).toBe('local')
    expect(assertStorageName('local-lvm')).toBe('local-lvm')
    expect(assertStorageName('ceph_pool.1')).toBe('ceph_pool.1')
  })

  it('rejects names with slashes (path traversal)', () => {
    expect(() => assertStorageName('storage/../etc')).toThrow(InvalidShellArgError)
    expect(() => assertStorageName('a/b')).toThrow(InvalidShellArgError)
  })

  it('rejects shell metacharacters', () => {
    expect(() => assertStorageName('store;ls')).toThrow(InvalidShellArgError)
    expect(() => assertStorageName('store$(pwd)')).toThrow(InvalidShellArgError)
  })
})

describe('assertBridgeName', () => {
  it('accepts standard PVE bridge names', () => {
    expect(assertBridgeName('vmbr0')).toBe('vmbr0')
    expect(assertBridgeName('vmbr10')).toBe('vmbr10')
    expect(assertBridgeName('bond0')).toBe('bond0')
    expect(assertBridgeName('eno1')).toBe('eno1')
    expect(assertBridgeName('eth0.100')).toBe('eth0.100')
  })

  it('rejects malformed bridge names', () => {
    expect(() => assertBridgeName('-vmbr')).toThrow(InvalidShellArgError)
    expect(() => assertBridgeName('vmbr 0')).toThrow(InvalidShellArgError)
    expect(() => assertBridgeName('vmbr0;reboot')).toThrow(InvalidShellArgError)
  })
})

describe('assertAbsPath', () => {
  it('accepts standard absolute paths', () => {
    expect(assertAbsPath('/var/lib/vz')).toBe('/var/lib/vz')
    expect(assertAbsPath('/tmp/v2v-abc123')).toBe('/tmp/v2v-abc123')
    expect(assertAbsPath('/etc/pve/qemu-server/100.conf')).toBe('/etc/pve/qemu-server/100.conf')
    expect(assertAbsPath('/')).toBe('/')
  })

  it('rejects relative paths', () => {
    expect(() => assertAbsPath('var/lib/vz')).toThrow(InvalidShellArgError)
    expect(() => assertAbsPath('./relative')).toThrow(InvalidShellArgError)
    expect(() => assertAbsPath('../etc/passwd')).toThrow(InvalidShellArgError)
  })

  it('rejects shell metacharacters in paths', () => {
    expect(() => assertAbsPath("/tmp/'; rm -rf /; '")).toThrow(InvalidShellArgError)
    expect(() => assertAbsPath('/tmp/$(whoami)')).toThrow(InvalidShellArgError)
    expect(() => assertAbsPath('/tmp/file space')).toThrow(InvalidShellArgError)
    expect(() => assertAbsPath('/tmp/file;cat')).toThrow(InvalidShellArgError)
    expect(() => assertAbsPath('/tmp/file`whoami`')).toThrow(InvalidShellArgError)
    expect(() => assertAbsPath('/tmp/file|cat')).toThrow(InvalidShellArgError)
    expect(() => assertAbsPath('/tmp/file&pwd')).toThrow(InvalidShellArgError)
    expect(() => assertAbsPath('/tmp/file\n')).toThrow(InvalidShellArgError)
  })

  it('rejects non-string inputs', () => {
    expect(() => assertAbsPath(null)).toThrow(InvalidShellArgError)
    expect(() => assertAbsPath(123)).toThrow(InvalidShellArgError)
  })
})

describe('InvalidShellArgError', () => {
  it('keeps a stable name for instanceof / catch blocks', () => {
    try {
      assertVmid('nope')
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidShellArgError)
      expect((e as Error).name).toBe('InvalidShellArgError')
    }
  })
})
