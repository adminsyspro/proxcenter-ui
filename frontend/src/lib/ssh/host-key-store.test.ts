import { describe, expect, it, vi, beforeEach } from 'vitest'

const findUniqueMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()
const findManyMock = vi.fn()
const deleteManyMock = vi.fn()

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    sshHostKey: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      create: (...args: unknown[]) => createMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
      findMany: (...args: unknown[]) => findManyMock(...args),
      deleteMany: (...args: unknown[]) => deleteManyMock(...args),
    },
  },
}))

import { verifyOrPin, makeHostVerifier, listPinnedHostKeys, forgetHostKey } from './host-key-store'

// Build a fake ssh2 public-key buffer: <4-byte BE length><algo name><payload>.
// We never inspect the payload bytes for verification (those are compared
// constant-time), so any random suffix works. The algo header is what
// readKeyType extracts for logging.
function fakeKey(algo: string, suffix = 'payload-bytes'): Buffer {
  const algoBuf = Buffer.from(algo, 'utf8')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(algoBuf.length, 0)
  const payload = Buffer.from(suffix, 'utf8')
  return Buffer.concat([lenBuf, algoBuf, payload])
}

beforeEach(() => {
  findUniqueMock.mockReset()
  createMock.mockReset()
  updateMock.mockReset()
  findManyMock.mockReset()
  deleteManyMock.mockReset()
})

describe('verifyOrPin', () => {
  it('pins a new key on first contact and reports the algorithm', async () => {
    findUniqueMock.mockResolvedValueOnce(null)
    createMock.mockResolvedValueOnce({})
    const key = fakeKey('ssh-ed25519', 'first-fingerprint')

    const out = await verifyOrPin('PVE1.example', 22, key)

    expect(out).toEqual({ status: 'pinned-new', keyType: 'ssh-ed25519' })
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { host: 'pve1.example:22' },
      select: { keyType: true, keyData: true },
    })
    expect(createMock).toHaveBeenCalledTimes(1)
    const createArg = createMock.mock.calls[0]?.[0]?.data
    expect(createArg.host).toBe('pve1.example:22')
    expect(createArg.keyType).toBe('ssh-ed25519')
    expect(Buffer.from(createArg.keyData).equals(key)).toBe(true)
  })

  it('returns pinned-existing and refreshes lastUsedAt when the presented key matches', async () => {
    const key = fakeKey('ecdsa-sha2-nistp256', 'pinned-fingerprint')
    findUniqueMock.mockResolvedValueOnce({ keyType: 'ecdsa-sha2-nistp256', keyData: Uint8Array.from(key) })
    updateMock.mockResolvedValueOnce({})

    const out = await verifyOrPin('pve2.example', 22, key)

    expect(out).toEqual({ status: 'pinned-existing', keyType: 'ecdsa-sha2-nistp256' })
    expect(createMock).not.toHaveBeenCalled()
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(updateMock.mock.calls[0]?.[0]?.where).toEqual({ host: 'pve2.example:22' })
  })

  it('pins the same hostname on different ports as distinct entries', async () => {
    const key22 = fakeKey('ssh-ed25519', 'bastion-22')
    const key2222 = fakeKey('ssh-ed25519', 'bastion-2222')
    findUniqueMock
      .mockResolvedValueOnce({ keyType: 'ssh-ed25519', keyData: Uint8Array.from(key22) })
      .mockResolvedValueOnce(null)
    updateMock.mockResolvedValueOnce({})
    createMock.mockResolvedValueOnce({})

    const a = await verifyOrPin('bastion.example', 22, key22)
    expect(a.status).toBe('pinned-existing')
    expect(updateMock.mock.calls[0]?.[0]?.where).toEqual({ host: 'bastion.example:22' })

    const b = await verifyOrPin('bastion.example', 2222, key2222)
    expect(b.status).toBe('pinned-new')
    expect(findUniqueMock.mock.calls[1]?.[0]?.where).toEqual({ host: 'bastion.example:2222' })
    expect(createMock.mock.calls[0]?.[0]?.data?.host).toBe('bastion.example:2222')
  })

  it('returns mismatch when the presented key differs from the pinned one', async () => {
    const pinned = fakeKey('ssh-rsa', 'original')
    const presented = fakeKey('ssh-rsa', 'rotated')
    findUniqueMock.mockResolvedValueOnce({ keyType: 'ssh-rsa', keyData: Uint8Array.from(pinned) })

    const out = await verifyOrPin('pve3.example', 22, presented)

    expect(out).toEqual({
      status: 'mismatch',
      expectedKeyType: 'ssh-rsa',
      presentedKeyType: 'ssh-rsa',
    })
    expect(createMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('rejects an empty host instead of attempting any DB call', async () => {
    const out = await verifyOrPin('   ', 22, fakeKey('ssh-ed25519'))
    expect(out.status).toBe('mismatch')
    expect(findUniqueMock).not.toHaveBeenCalled()
  })

  it('reports keyType=unknown for malformed key buffers', async () => {
    findUniqueMock.mockResolvedValueOnce(null)
    createMock.mockResolvedValueOnce({})
    const out = await verifyOrPin('pve.example', 22, Buffer.from([1, 2, 3]))
    expect(out).toEqual({ status: 'pinned-new', keyType: 'unknown' })
  })

  it('handles a concurrent race (P2002) by re-reading the row that won', async () => {
    const winningKey = fakeKey('ssh-ed25519', 'won')
    findUniqueMock
      .mockResolvedValueOnce(null) // first read: nothing pinned yet
      .mockResolvedValueOnce({ keyType: 'ssh-ed25519', keyData: Uint8Array.from(winningKey) })
    const conflict = Object.assign(new Error('unique'), { code: 'P2002' })
    createMock.mockRejectedValueOnce(conflict)
    updateMock.mockResolvedValueOnce({})

    const out = await verifyOrPin('race.example', 22, winningKey)
    expect(out).toEqual({ status: 'pinned-existing', keyType: 'ssh-ed25519' })
  })

  it('reports mismatch when the race winner has a different key', async () => {
    const ours = fakeKey('ssh-ed25519', 'mine')
    const theirs = fakeKey('ssh-rsa', 'theirs')
    findUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ keyType: 'ssh-rsa', keyData: Uint8Array.from(theirs) })
    createMock.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))

    const out = await verifyOrPin('race-mismatch.example', 22, ours)
    expect(out).toEqual({
      status: 'mismatch',
      expectedKeyType: 'ssh-rsa',
      presentedKeyType: 'ssh-ed25519',
    })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('rethrows non-P2002 errors from create', async () => {
    findUniqueMock.mockResolvedValueOnce(null)
    const fatal = Object.assign(new Error('disk full'), { code: 'P3000' })
    createMock.mockRejectedValueOnce(fatal)
    await expect(verifyOrPin('boom.example', 22, fakeKey('ssh-ed25519'))).rejects.toThrow('disk full')
  })

  it('swallows update failures so an SSH op is not aborted by a missing row', async () => {
    const key = fakeKey('ssh-ed25519', 'pinned')
    findUniqueMock.mockResolvedValueOnce({ keyType: 'ssh-ed25519', keyData: Uint8Array.from(key) })
    updateMock.mockRejectedValueOnce(new Error('row vanished'))
    const out = await verifyOrPin('lossy.example', 22, key)
    expect(out).toEqual({ status: 'pinned-existing', keyType: 'ssh-ed25519' })
  })
})

describe('makeHostVerifier', () => {
  // Helper: drive the ssh2-style (key, callback) shape and resolve when
  // the callback fires. Lets a single await give us the boolean decision.
  function drive(verifier: (key: Buffer, cb: (ok: boolean) => void) => void, key: Buffer): Promise<boolean> {
    return new Promise((resolve) => verifier(key, resolve))
  }

  it('returns true on a first-contact pin and logs the algo and host', async () => {
    findUniqueMock.mockResolvedValueOnce(null)
    createMock.mockResolvedValueOnce({})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const key = fakeKey('ssh-ed25519', 'tofu')
    const ok = await drive(makeHostVerifier('pve.example', 22), key)
    expect(ok).toBe(true)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toContain('ssh-ed25519')
    expect(log.mock.calls[0]?.[0]).toContain('pve.example')
    log.mockRestore()
  })

  it('returns true silently on a ratified pin', async () => {
    const key = fakeKey('ssh-ed25519', 'pinned')
    findUniqueMock.mockResolvedValueOnce({ keyType: 'ssh-ed25519', keyData: Uint8Array.from(key) })
    updateMock.mockResolvedValueOnce({})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const ok = await drive(makeHostVerifier('pve.example', 22), key)
    expect(ok).toBe(true)
    // pinned-existing path does not log; the noise floor stays low.
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('returns false and warns on a mismatch', async () => {
    const pinned = fakeKey('ssh-rsa', 'original')
    const presented = fakeKey('ssh-rsa', 'rotated')
    findUniqueMock.mockResolvedValueOnce({ keyType: 'ssh-rsa', keyData: Uint8Array.from(pinned) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const ok = await drive(makeHostVerifier('pve.example', 22), presented)
    expect(ok).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('host-key mismatch')
    warn.mockRestore()
  })

  it('returns false and logs the error path when verifyOrPin throws', async () => {
    findUniqueMock.mockRejectedValueOnce(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})

    const ok = await drive(makeHostVerifier('pve.example', 22), fakeKey('ssh-ed25519'))
    expect(ok).toBe(false)
    expect(err).toHaveBeenCalledTimes(1)
    expect(err.mock.calls[0]?.[0]).toContain('db down')
    err.mockRestore()
  })
})

describe('listPinnedHostKeys', () => {
  it('lists the pins in host order without the key material', async () => {
    const rows = [
      { host: '10.42.0.101:22', keyType: 'ssh-ed25519', firstSeenAt: new Date(0), lastUsedAt: new Date(0) },
    ]
    findManyMock.mockResolvedValueOnce(rows)

    await expect(listPinnedHostKeys()).resolves.toEqual(rows)
    expect(findManyMock).toHaveBeenCalledWith({
      select: { host: true, keyType: true, firstSeenAt: true, lastUsedAt: true },
      orderBy: { host: 'asc' },
    })
    // keyData never leaves the store: the UI has no use for it and it is
    // the one column worth not shipping to a browser.
    expect(findManyMock.mock.calls[0]?.[0]?.select?.keyData).toBeUndefined()
  })
})

describe('forgetHostKey', () => {
  it('clears every port pinned for the host and reports the row count', async () => {
    deleteManyMock.mockResolvedValueOnce({ count: 2 })

    await expect(forgetHostKey('10.42.0.101')).resolves.toBe(2)
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { OR: [{ host: '10.42.0.101' }, { host: { startsWith: '10.42.0.101:' } }] },
    })
  })

  it('anchors the prefix on the colon so a longer sibling address is left alone', async () => {
    deleteManyMock.mockResolvedValueOnce({ count: 1 })

    await forgetHostKey('10.42.0.1')

    // Without the trailing colon this would also wipe 10.42.0.10 and
    // 10.42.0.111, silently un-pinning hosts nobody asked about.
    const where = deleteManyMock.mock.calls[0]?.[0]?.where
    expect(where.OR[1].host.startsWith).toBe('10.42.0.1:')
  })

  it('normalizes case and surrounding blanks like the verifier does', async () => {
    deleteManyMock.mockResolvedValueOnce({ count: 1 })

    await forgetHostKey('  PVE1.Example  ')

    expect(deleteManyMock.mock.calls[0]?.[0]?.where.OR[0].host).toBe('pve1.example')
  })

  it('returns 0 on an empty host without issuing a delete', async () => {
    await expect(forgetHostKey('   ')).resolves.toBe(0)
    expect(deleteManyMock).not.toHaveBeenCalled()
  })
})

describe('makeHostVerifier mismatch reporting', () => {
  function drive(verifier: (key: Buffer, cb: (ok: boolean) => void) => void, key: Buffer): Promise<boolean> {
    return new Promise((resolve) => verifier(key, resolve))
  }

  it('hands the caller a reason naming both algorithms and the way out', async () => {
    const pinned = fakeKey('ssh-ed25519', 'original')
    const presented = fakeKey('ecdsa-sha2-nistp256', 'reinstalled')
    findUniqueMock.mockResolvedValueOnce({ keyType: 'ssh-ed25519', keyData: Uint8Array.from(pinned) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onMismatch = vi.fn()

    const ok = await drive(makeHostVerifier('pve1.example', 22, onMismatch), presented)

    expect(ok).toBe(false)
    expect(onMismatch).toHaveBeenCalledTimes(1)
    const message = onMismatch.mock.calls[0]?.[0] as string
    expect(message).toContain('pve1.example')
    expect(message).toContain('ssh-ed25519')
    expect(message).toContain('ecdsa-sha2-nistp256')
    expect(message).toContain('re-trust')
    warn.mockRestore()
  })

  it('never fires the callback when the key matches', async () => {
    const key = fakeKey('ssh-ed25519', 'pinned')
    findUniqueMock.mockResolvedValueOnce({ keyType: 'ssh-ed25519', keyData: Uint8Array.from(key) })
    updateMock.mockResolvedValueOnce({})
    const onMismatch = vi.fn()

    await drive(makeHostVerifier('pve1.example', 22, onMismatch), key)

    expect(onMismatch).not.toHaveBeenCalled()
  })
})
