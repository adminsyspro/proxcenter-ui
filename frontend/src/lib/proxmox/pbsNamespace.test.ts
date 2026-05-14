import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ensureNamespace, ensureSubToken, setNamespaceAcl, deleteSubToken } from './pbsNamespace'

vi.mock('./pbs-client', () => ({
  pbsFetch: vi.fn(),
}))
import { pbsFetch } from './pbs-client'

const mock = pbsFetch as any

const conn = { baseUrl: 'https://pbs.example:8007', apiToken: 'root@pam!x:y', insecureDev: true }

describe('ensureNamespace', () => {
  beforeEach(() => mock.mockReset())

  it('creates a root namespace when missing', async () => {
    mock.mockResolvedValueOnce([])
    mock.mockResolvedValueOnce({})
    await ensureNamespace(conn, 'store1', 'tenant-acme')
    expect(mock).toHaveBeenCalledTimes(2)
    expect(mock.mock.calls[1][1]).toBe('/admin/datastore/store1/namespace')
    expect(mock.mock.calls[1][2]).toMatchObject({ method: 'POST', body: expect.objectContaining({ name: 'tenant-acme' }) })
  })

  it('creates a child namespace with parent param', async () => {
    mock.mockResolvedValueOnce([])
    mock.mockResolvedValueOnce({})
    await ensureNamespace(conn, 'store1', 'tenant-acme/vdc-prod', { parent: 'tenant-acme' })
    expect(mock.mock.calls[1][2].body).toMatchObject({ name: 'vdc-prod', parent: 'tenant-acme' })
  })

  it('skips creation when namespace already exists', async () => {
    mock.mockResolvedValueOnce([{ ns: 'tenant-acme' }])
    await ensureNamespace(conn, 'store1', 'tenant-acme')
    expect(mock).toHaveBeenCalledTimes(1)
  })
})

describe('ensureSubToken', () => {
  beforeEach(() => mock.mockReset())

  it('creates a token and returns { tokenId, secret }', async () => {
    mock.mockRejectedValueOnce(new Error('PBS 404 /access/users/root@pam/token/vdc-abc'))
    mock.mockResolvedValueOnce({ tokenid: 'root@pam!vdc-abc', value: 'sekret' })
    const res = await ensureSubToken(conn, 'root@pam', 'vdc-abc')

    expect(res).toEqual({ tokenId: 'root@pam!vdc-abc', secret: 'sekret' })
  })

  it('reuses an existing token (no secret returned)', async () => {
    mock.mockResolvedValueOnce({ tokenid: 'root@pam!vdc-abc' })
    const res = await ensureSubToken(conn, 'root@pam', 'vdc-abc')

    expect(res).toEqual({ tokenId: 'root@pam!vdc-abc', secret: null })
  })
})

describe('setNamespaceAcl', () => {
  beforeEach(() => mock.mockReset())

  it('PUTs /access/acl with the expected shape', async () => {
    mock.mockResolvedValueOnce({})
    await setNamespaceAcl(conn, 'store1', 'tenant-x/vdc-y', 'root@pam!vdc-abc')
    expect(mock.mock.calls[0][1]).toBe('/access/acl')
    expect(mock.mock.calls[0][2].body).toMatchObject({
      path: '/datastore/store1/tenant-x/vdc-y',
      'auth-id': 'root@pam!vdc-abc',
      role: 'DatastoreBackup',
      propagate: true,
    })
  })
})

describe('deleteSubToken', () => {
  beforeEach(() => mock.mockReset())

  it('issues DELETE on /access/users/<u>/token/<id>', async () => {
    mock.mockResolvedValueOnce({})
    await deleteSubToken(conn, 'root@pam', 'vdc-abc')
    expect(mock.mock.calls[0][1]).toBe('/access/users/root@pam/token/vdc-abc')
    expect(mock.mock.calls[0][2]).toMatchObject({ method: 'DELETE' })
  })

  it('swallows 404 (already deleted)', async () => {
    mock.mockRejectedValueOnce(new Error('PBS 404 /access/users/root@pam/token/vdc-abc'))
    await expect(deleteSubToken(conn, 'root@pam', 'vdc-abc')).resolves.not.toThrow()
  })
})
