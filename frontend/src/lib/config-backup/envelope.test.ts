import { describe, expect, it } from 'vitest'

import { BACKUP_FORMAT, EnvelopeError, openBackup, sealBackup } from './envelope'

const payload = { migration: '20261023120000_x', tables: { tenants: [{ id: 'default', name: 'Provider' }] } }

describe('backup envelope', () => {
  it('round-trips the payload and keeps only the header readable', async () => {
    const raw = await sealBackup(payload, 'correct horse battery', '1.4.12', new Date('2026-10-25T08:00:00Z'))
    const envelope = JSON.parse(raw)

    expect(envelope.format).toBe(BACKUP_FORMAT)
    expect(envelope.createdAt).toBe('2026-10-25T08:00:00.000Z')
    expect(envelope.appVersion).toBe('1.4.12')
    expect(raw).not.toContain('Provider')

    const opened = await openBackup(raw, 'correct horse battery')
    expect(opened.payload).toEqual(payload)
    expect(opened.appVersion).toBe('1.4.12')
  })

  it('tells a wrong passphrase from a file that is not a backup', async () => {
    const raw = await sealBackup(payload, 'correct horse battery', '1.4.12')

    await expect(openBackup(raw, 'wrong passphrase!')).rejects.toMatchObject({ code: 'wrong-passphrase' })
    await expect(openBackup('not json', 'x')).rejects.toMatchObject({ code: 'invalid-file' })
    await expect(openBackup('{"format":"something-else"}', 'x')).rejects.toBeInstanceOf(EnvelopeError)
    await expect(openBackup(JSON.stringify({ ...JSON.parse(raw), version: 99 }), 'x')).rejects.toMatchObject({ code: 'unsupported-version' })
  })

  it('refuses KDF parameters that would exhaust the server', async () => {
    const raw = JSON.parse(await sealBackup(payload, 'correct horse battery', '1.4.12'))
    raw.kdf.N = 1 << 24

    await expect(openBackup(JSON.stringify(raw), 'correct horse battery')).rejects.toMatchObject({ code: 'invalid-file' })
  })

  it('rejects a file whose ciphertext was tampered with', async () => {
    const raw = JSON.parse(await sealBackup(payload, 'correct horse battery', '1.4.12'))
    raw.data = Buffer.from('tampered').toString('base64')

    await expect(openBackup(JSON.stringify(raw), 'correct horse battery')).rejects.toMatchObject({ code: 'wrong-passphrase' })
  })
})
