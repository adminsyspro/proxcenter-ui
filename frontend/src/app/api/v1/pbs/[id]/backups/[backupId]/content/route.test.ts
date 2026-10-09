import { beforeEach, describe, expect, it, vi } from 'vitest'

const { pbsFetchMock, permissionMock, accessMock, connMock, unscopedMock, demoMock } = vi.hoisted(() => ({
  pbsFetchMock: vi.fn<(...a: any[]) => Promise<any>>(),
  permissionMock: vi.fn(),
  accessMock: vi.fn(),
  connMock: vi.fn(),
  unscopedMock: vi.fn(),
  demoMock: vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: (...a: any[]) => demoMock(...a) }))
vi.mock('@/lib/rbac', () => ({ checkPermission: (...a: any[]) => permissionMock(...a), PERMISSIONS: { BACKUP_VIEW: 'backup.view' } }))
vi.mock('@/lib/vdc/scope', () => ({ assertVdcPbsAccess: (...a: any[]) => accessMock(...a) }))
vi.mock('@/lib/connections/getConnection', () => ({
  getPbsConnectionById: (...a: any[]) => connMock(...a),
  getPbsConnectionByIdUnscoped: (...a: any[]) => unscopedMock(...a),
}))
vi.mock('@/lib/proxmox/pbs-client', () => ({ pbsFetch: pbsFetchMock }))

import { GET } from './route'

const backupId = encodeURIComponent('test-vdc/tenant-msp/vdc-a/ct/101/1790254249')

function call(query: string, id = backupId, pbsId = 'pbs1') {
  return GET(new Request(`http://x/api/v1/pbs/${pbsId}/backups/${id}/content?${query}`), {
    params: Promise.resolve({ id: pbsId, backupId: id }),
  })
}

function catalogFilepath(): string {
  const path = pbsFetchMock.mock.calls[0][1] as string
  const fp = new URL(`http://x${path}`).searchParams.get('filepath')!
  return Buffer.from(fp, 'base64').toString('utf-8')
}

beforeEach(() => {
  permissionMock.mockReset().mockResolvedValue(null)
  accessMock.mockReset().mockResolvedValue({ kind: 'admin' })
  connMock.mockReset().mockResolvedValue({ id: 'pbs1' })
  unscopedMock.mockReset().mockResolvedValue({ id: 'pbs1', unscoped: true })
  demoMock.mockReset().mockReturnValue(null)
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

describe('GET /api/v1/pbs/{id}/backups/{backupId}/content (snapshot listing and errors)', () => {
  const snapshot = {
    'backup-time': 1790254249,
    files: ['index.json.blob', { filename: 'root.pxar.didx', size: 2048 }, { filename: 'drive-scsi0.img.fidx' }],
  }

  it('lists the archives of the snapshot when no archive is given', async () => {
    pbsFetchMock.mockResolvedValue([{ 'backup-time': 1 }, snapshot])
    const res = await call('')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.snapshot).toEqual({ datastore: 'test-vdc', namespace: 'tenant-msp/vdc-a', backupType: 'ct', backupId: '101', backupTime: '1790254249' })
    expect(body.data.files).toEqual([
      { name: 'index.json.blob', type: 'file', browsable: false, size: 0, sizeFormatted: '-' },
      expect.objectContaining({ name: 'root.pxar.didx', type: 'archive', browsable: true, size: 2048 }),
      expect.objectContaining({ name: 'drive-scsi0.img.fidx', type: 'archive', browsable: false, sizeFormatted: '0 B' }),
    ])
    const path = pbsFetchMock.mock.calls[0][1] as string
    expect(path).toContain('/admin/datastore/test-vdc/snapshots?')
    expect(new URL(`http://x${path}`).searchParams.get('ns')).toBe('tenant-msp/vdc-a')
  })

  it('returns 404 when the snapshot is not there, and lists a root-namespace snapshot without ns', async () => {
    pbsFetchMock.mockResolvedValue(null)
    expect((await call('')).status).toBe(404)

    pbsFetchMock.mockResolvedValue([{ 'backup-time': 5 }])
    const res = await call('', encodeURIComponent('ds/vm/100/5'))
    expect(res.status).toBe(200)
    expect((await res.json()).data.files).toEqual([])
    expect(pbsFetchMock.mock.calls[1][1]).not.toContain('ns=')
  })

  it('returns an empty listing with the error when the catalog cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    pbsFetchMock.mockRejectedValue(new Error('catalog unavailable'))
    const res = await call('archive=root.pxar.didx')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.error).toBe('Cannot browse archive: catalog unavailable')
    expect(body.data).toMatchObject({ path: '/', archive: 'root.pxar.didx', files: [] })
  })

  it('maps the catalog entry kinds and sorts directories first', async () => {
    pbsFetchMock.mockResolvedValue([
      { filename: 'z.txt', type: 'f', size: 10, mtime: 1_700_000_000 },
      { name: 'link', type: 'l' },
      { text: 'hard', type: 'h' },
      { text: 'b-dir', type: 'd' },
      { text: 'a-dir', leaf: false },
      { type: 'f' },
    ])
    const body = await (await call('archive=root.pxar.didx&filepath=%2Fetc', encodeURIComponent('ds/vm/100/5'))).json()
    expect(body.data.files.map((f: any) => [f.name, f.type])).toEqual([
      ['a-dir', 'directory'], ['b-dir', 'directory'], [undefined, 'file'], ['hard', 'hardlink'], ['link', 'symlink'], ['z.txt', 'file'],
    ])
    expect(body.data.files.find((f: any) => f.name === 'z.txt').mtimeFormatted).not.toBe('-')
    expect(pbsFetchMock.mock.calls[0][1]).not.toContain('ns=')
  })

  it('answers the demo response first', async () => {
    demoMock.mockReturnValue(new Response('{}', { status: 299 }))
    expect((await call('')).status).toBe(299)
  })

  it('validates the params', async () => {
    expect((await call('', backupId, '')).status).toBe(400)
    expect((await call('', '')).status).toBe(400)
    expect((await call('', encodeURIComponent('ds/vm/100'))).status).toBe(400)
  })

  it('returns the RBAC and vDC refusals', async () => {
    permissionMock.mockResolvedValueOnce(new Response(null, { status: 403 }))
    expect((await call('')).status).toBe(403)
    accessMock.mockResolvedValueOnce(new Response(null, { status: 403 }))
    expect((await call('')).status).toBe(403)
  })

  it('serves a tenant its own namespace through the unscoped lookup, and refuses another', async () => {
    accessMock.mockResolvedValue({ kind: 'tenant', allowed: [{ datastore: 'test-vdc', namespace: 'tenant-msp/vdc-a' }] })
    pbsFetchMock.mockResolvedValue([])
    await call('archive=root.pxar.didx')
    expect(unscopedMock).toHaveBeenCalledWith('pbs1')
    expect(connMock).not.toHaveBeenCalled()
    expect((await call('ns=other')).status).toBe(403)
  })

  it('maps an unexpected failure to 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    connMock.mockRejectedValue(new Error('PBS gone'))
    const res = await call('')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'PBS gone' })
  })
})
