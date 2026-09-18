import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())
vi.mock('./client', () => ({ pveFetch: fetchMock }))
import { downloadToStorage, PveDownloadPermissionError } from './download'

const conn = { baseUrl: 'https://pve.test', apiToken: 'test' }
const params = new URLSearchParams({ url: 'https://image.test/image.qcow2', content: 'import', filename: 'image.qcow2' })
let grants: Record<string, Record<string, number>>

beforeEach(() => {
  grants = { '/': { 'Sys.Audit': 1 }, '/nodes/pve1': {}, '/storage/imports': { 'Datastore.AllocateTemplate': 1 } }
  fetchMock.mockReset().mockImplementation(async (_conn, path) => {
    if (path.startsWith('/access/permissions?')) {
      const requested = new URLSearchParams(path.split('?')[1]).get('path')!
      return { [requested]: grants[requested] ?? {} }
    }
    return 'UPID:download'
  })
})
const download = () => downloadToStorage(conn, 'pve1', 'imports', params)
const writes = () => fetchMock.mock.calls.filter(([, , opts]) => opts?.method === 'POST')

describe('downloadToStorage effective token preflight', () => {
  it('rejects PVEAdmin with the missing privilege and path before any write', async () => {
    await expect(download()).rejects.toThrow('Sys.AccessNetwork on /nodes/pve1')
    expect(writes()).toHaveLength(0)
  })

  it.each([0, 1])('accepts node network privileges with propagation=%s', async propagation => {
    grants['/nodes/pve1']['Sys.AccessNetwork'] = propagation
    grants['/storage/imports']['Datastore.AllocateTemplate'] = propagation
    await expect(download()).resolves.toBe('UPID:download')
    expect(writes()).toHaveLength(1)
    expect(writes()[0]).toEqual([conn, '/nodes/pve1/storage/imports/download-url', { method: 'POST', body: params }])
  })

  it('accepts the legacy Sys.Audit + Sys.Modify alternative on /', async () => {
    grants['/']['Sys.Modify'] = 1
    await expect(download()).resolves.toBe('UPID:download')
  })

  it('does not accept Sys.Modify alone or on the wrong path', async () => {
    grants['/'] = { 'Sys.Modify': 1 }
    grants['/nodes/pve1'] = { 'Sys.Modify': 1, 'Sys.Audit': 1 }
    await expect(download()).rejects.toBeInstanceOf(PveDownloadPermissionError)
    expect(writes()).toHaveLength(0)
  })

  it('requires allocation on the selected storage even with network permission', async () => {
    grants['/nodes/pve1']['Sys.AccessNetwork'] = 1
    grants['/storage/imports'] = {}
    await expect(download()).rejects.toThrow('Datastore.AllocateTemplate on /storage/imports')
    expect(writes()).toHaveLength(0)
  })

  it('fails closed when effective permissions cannot be read', async () => {
    fetchMock.mockRejectedValue(new Error('permission lookup unavailable'))
    await expect(download()).rejects.toThrow('permission lookup unavailable')
    expect(writes()).toHaveLength(0)
  })

  it('explains a 403 caused by an ACL change after preflight', async () => {
    grants['/nodes/pve1']['Sys.AccessNetwork'] = 1
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (...args) => {
      if (args[2]?.method === 'POST') throw Object.assign(new Error('PVE 403 denied'), { statusCode: 403 })
      return original(...args)
    })
    await expect(download()).rejects.toThrow('after the permission check')
  })

  it('does not mislabel unrelated download failures as permission errors', async () => {
    grants['/nodes/pve1']['Sys.AccessNetwork'] = 1
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (...args) => {
      if (args[2]?.method === 'POST') throw new Error('storage unavailable')
      return original(...args)
    })
    await expect(download()).rejects.toThrow('storage unavailable')
  })
})
