import { describe, it, expect, vi, beforeEach } from 'vitest'

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))

vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  request: requestMock,
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn(async () => null),
  PERMISSIONS: { BACKUP_VIEW: 'backup.view' },
}))

vi.mock('@/lib/vdc/scope', () => ({
  assertVdcPbsAccess: vi.fn(async () => ({ kind: 'admin' })),
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getPbsConnectionById: vi.fn(),
  getPbsConnectionByIdUnscoped: vi.fn(),
}))

import { GET } from './route'
import { getPbsConnectionById } from '@/lib/connections/getConnection'
import { getPbsAgent } from '@/lib/proxmox/pbs-client'

const getPbsConnectionByIdMock = getPbsConnectionById as any

const BACKUP_ID = 'mystore/vm/100/1700000000'

function call(file = 'qemu-server.conf.blob') {
  const req = new Request(`http://localhost/api/v1/pbs/pbs-1/backups/x/download?file=${file}`)
  return GET(req, { params: { id: 'pbs-1', backupId: BACKUP_ID } })
}

describe('GET /api/v1/pbs/[id]/backups/[backupId]/download', () => {
  beforeEach(() => {
    requestMock.mockReset()
    getPbsConnectionByIdMock.mockResolvedValue({ baseUrl: 'https://pbs.local:8007/', apiToken: 'u@pbs!t:s', insecureDev: true })
    requestMock.mockResolvedValue({
      statusCode: 200,
      headers: { 'content-length': '14' },
      body: new Response('boot: order=1\n').body,
    })
  })

  it('asks PBS for the decoded blob, the endpoint its own web UI uses', async () => {
    const res = await call()

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('boot: order=1\n')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="qemu-server.conf.blob"')
    const [url, init] = requestMock.mock.calls[0]
    const u = new URL(url)
    expect(u.pathname).toBe('/api2/json/admin/datastore/mystore/download-decoded')
    expect(Object.fromEntries(u.searchParams)).toEqual({
      'backup-type': 'vm',
      'backup-id': '100',
      'backup-time': '1700000000',
      'file-name': 'qemu-server.conf.blob',
    })
    expect(init.headers.Authorization).toBe('PBSAPIToken=u@pbs!t:s')
  })

  it('goes through the PBS agent, which bounds the handshake', async () => {
    await call()

    expect(requestMock.mock.calls[0][1].dispatcher).toBe(getPbsAgent(true))
  })

  it('passes a PBS refusal through with its status', async () => {
    requestMock.mockResolvedValue({ statusCode: 404, headers: {}, body: { text: async () => 'no such file' } })

    const res = await call()

    expect(res.status).toBe(404)
    expect(await res.text()).toBe('PBS 404: no such file')
  })

  it('refuses anything but a .blob', async () => {
    const res = await call('drive-scsi0.img.fidx')

    expect(res.status).toBe(400)
    expect(requestMock).not.toHaveBeenCalled()
  })
})
