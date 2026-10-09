import { beforeEach, describe, expect, it, vi } from 'vitest'

const { pbsFetchMock } = vi.hoisted(() => ({ pbsFetchMock: vi.fn<(...a: any[]) => Promise<any>>() }))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))
vi.mock('@/lib/rbac', () => ({ checkPermission: async () => null, PERMISSIONS: { BACKUP_VIEW: 'backup.view' } }))
vi.mock('@/lib/vdc/scope', () => ({ assertVdcPbsAccess: async () => ({ kind: 'admin' }) }))
vi.mock('@/lib/connections/getConnection', () => ({
  getPbsConnectionById: async () => ({ id: 'pbs1' }),
  getPbsConnectionByIdUnscoped: async () => ({ id: 'pbs1' }),
}))
vi.mock('@/lib/proxmox/pbs-client', () => ({ pbsFetch: pbsFetchMock }))

import { GET } from './route'

const backupId = encodeURIComponent('test-vdc/tenant-msp/vdc-a/ct/101/1790254249')

function call(query: string) {
  return GET(new Request(`http://x/api/v1/pbs/pbs1/backups/${backupId}/content?${query}`), {
    params: Promise.resolve({ id: 'pbs1', backupId }),
  })
}

function catalogFilepath(): string {
  const path = pbsFetchMock.mock.calls[0][1] as string
  const fp = new URL(`http://x${path}`).searchParams.get('filepath')!
  return Buffer.from(fp, 'base64').toString('utf-8')
}

beforeEach(() => {
  pbsFetchMock.mockReset()
  pbsFetchMock.mockResolvedValue([{ text: 'apt', type: 'd', leaf: false }])
})

describe('GET /api/v1/pbs/{id}/backups/{backupId}/content (archive browsing)', () => {
  // Lab, PBS 4.2: a plain `root.pxar.didx/etc` was refused with
  // "base64 decoding of path failed", so no pxar archive could be browsed.
  it('sends the catalog path base64-encoded, archive first', async () => {
    const res = await call('archive=root.pxar.didx&filepath=%2Fetc')
    expect(res.status).toBe(200)
    expect(catalogFilepath()).toBe('/root.pxar.didx/etc')
    const body = await res.json()
    expect(body.data.files).toEqual([expect.objectContaining({ name: 'apt', type: 'directory' })])
  })

  it('lists the archive root without a trailing slash', async () => {
    await call('archive=root.pxar.didx&filepath=%2F')
    expect(catalogFilepath()).toBe('/root.pxar.didx')
  })

  it('keeps non ASCII names intact', async () => {
    await call(`archive=root.pxar.didx&filepath=${encodeURIComponent('/home/éa b')}`)
    expect(catalogFilepath()).toBe('/root.pxar.didx/home/éa b')
  })
})
