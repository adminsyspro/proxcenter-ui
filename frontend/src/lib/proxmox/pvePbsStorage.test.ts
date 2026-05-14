import { describe, it, expect, vi, beforeEach } from 'vitest'

import { createPbsStorage, deletePbsStorage, pbsStorageExists, sanitizeStorageName } from './pvePbsStorage'

vi.mock('./client', () => ({ pveFetch: vi.fn() }))
import { pveFetch } from './client'

const mock = pveFetch as any

const conn = { id: 'c1', name: 'cl', baseUrl: 'https://pve', apiToken: 't', insecureDev: true, behindProxy: false }

describe('sanitizeStorageName', () => {
  it('lowercases and strips invalid chars', () => {
    expect(sanitizeStorageName('Acme_Corp', 'Prod Web')).toBe('pbs-acmecorp-prodweb')
  })
  it('truncates to 40 chars max', () => {
    const out = sanitizeStorageName('a'.repeat(30), 'b'.repeat(30))

    expect(out.length).toBeLessThanOrEqual(40)
    expect(out.startsWith('pbs-')).toBe(true)
  })
})

describe('pbsStorageExists', () => {
  beforeEach(() => mock.mockReset())

  it('returns true when the storage is present', async () => {
    mock.mockResolvedValueOnce({ storage: 'pbs-acme-prod', type: 'pbs' })
    expect(await pbsStorageExists(conn, 'pbs-acme-prod')).toBe(true)
  })

  it('returns false on 404', async () => {
    mock.mockRejectedValueOnce(new Error('PVE 404 /storage/pbs-acme-prod'))
    expect(await pbsStorageExists(conn, 'pbs-acme-prod')).toBe(false)
  })
})

describe('createPbsStorage', () => {
  beforeEach(() => mock.mockReset())

  it('POSTs /storage with the expected shape', async () => {
    mock.mockRejectedValueOnce(new Error('PVE 404 /storage/pbs-acme-prod'))
    mock.mockResolvedValueOnce({})
    await createPbsStorage(conn, {
      storage: 'pbs-acme-prod',
      server: 'pbs.local',
      datastore: 'store1',
      namespace: 'tenant-acme/vdc-prod',
      username: 'root@pam!vdc-abc',
      password: 'sekret',
      fingerprint: 'AA:BB:CC',
      nodes: ['pve01', 'pve02'],
    })
    expect(mock.mock.calls[1][1]).toBe('/storage')
    const body = mock.mock.calls[1][2].body as URLSearchParams

    expect(body).toBeInstanceOf(URLSearchParams)
    expect(body.get('storage')).toBe('pbs-acme-prod')
    expect(body.get('type')).toBe('pbs')
    expect(body.get('server')).toBe('pbs.local')
    expect(body.get('datastore')).toBe('store1')
    expect(body.get('namespace')).toBe('tenant-acme/vdc-prod')
    expect(body.get('username')).toBe('root@pam!vdc-abc')
    expect(body.get('password')).toBe('sekret')
    expect(body.get('fingerprint')).toBe('AA:BB:CC')
    expect(body.get('content')).toBe('backup')
    expect(body.get('nodes')).toBe('pve01,pve02')
  })

  it('skips POST when storage already exists', async () => {
    mock.mockResolvedValueOnce({ storage: 'pbs-acme-prod', type: 'pbs' })
    await createPbsStorage(conn, { storage: 'pbs-acme-prod', server: 's', datastore: 'd', namespace: 'n', username: 'u', password: 'p', fingerprint: 'f', nodes: [] })
    expect(mock).toHaveBeenCalledTimes(1)
  })
})

describe('deletePbsStorage', () => {
  beforeEach(() => mock.mockReset())

  it('DELETEs /storage/<name> and tolerates 404', async () => {
    mock.mockResolvedValueOnce({})
    await deletePbsStorage(conn, 'pbs-acme-prod')
    expect(mock.mock.calls[0][2]).toMatchObject({ method: 'DELETE' })

    mock.mockRejectedValueOnce(new Error('PVE 404 /storage/pbs-acme-prod'))
    await expect(deletePbsStorage(conn, 'pbs-acme-prod')).resolves.not.toThrow()
  })
})
