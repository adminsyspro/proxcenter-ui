import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const h = vi.hoisted(() => ({
  resolveReportRequest: vi.fn(),
  getPrincipal: vi.fn(),
  getHardeningData: vi.fn(),
  buildFrameworkReportPdf: vi.fn(),
  resolveReportBranding: vi.fn(),
  requireEnterprise: vi.fn(),
  checkPermission: vi.fn(),
  backgroundTenants: [] as string[],
}))

vi.mock('@/lib/compliance/report/reportRequest', () => ({ resolveReportRequest: h.resolveReportRequest }))
vi.mock('@/lib/auth/principal', () => ({
  getPrincipal: h.getPrincipal,
  rejectionToResponse: (r: any) => new Response(JSON.stringify(r?.body ?? {}), { status: r?.status ?? 401 }),
}))
vi.mock('@/lib/compliance/collectionCache', () => ({ getHardeningData: h.getHardeningData }))
vi.mock('@/lib/compliance/report/buildFrameworkReport', () => ({ buildFrameworkReportPdf: h.buildFrameworkReportPdf }))
vi.mock('@/lib/reporting/reportBranding', () => ({ resolveReportBranding: h.resolveReportBranding }))
vi.mock('@/lib/tenant/background', () => ({
  runWithBackgroundTenant: (tenantId: string, fn: () => unknown) => { h.backgroundTenants.push(tenantId); return fn() },
}))
vi.mock('@/lib/auth/requireEnterprise', () => ({ requireEnterprise: h.requireEnterprise }))
vi.mock('@/lib/rbac', () => ({ checkPermission: h.checkPermission, PERMISSIONS: { ADMIN_COMPLIANCE: 'admin.compliance' } }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 't1' }))
vi.mock('@/lib/audit/withAudit', () => ({ withAudit: (_spec: unknown, handler: unknown) => handler }))

import { POST } from './route'
import { GET as GET_JOB } from './[jobId]/route'
import { GET as DOWNLOAD } from './[jobId]/download/route'
import { MAX_REPORT_JOBS_PER_OWNER, resetReportJobs } from '@/lib/compliance/report/reportJobs'

const CONN = { id: 'c1', name: 'PVE-PROD' }
const BRANDING = { brandColor: '#E57000', logoDataUri: '', appName: '' }
const PDF = Buffer.from('%PDF-1.7 test')
const SESSION = (userId: string) => ({ ok: true, principal: { kind: 'session', userId, tenantId: 't1' } })

const post = (body: Record<string, unknown> = { frameworkId: 'cmmc-l2', connectionId: 'c1' }) => callRoute(POST, { method: 'POST', body })
const getJob = (jobId: string) => callRoute(GET_JOB, { params: { jobId } })
const download = (jobId: string) => callRoute(DOWNLOAD, { params: { jobId } })

beforeEach(() => {
  vi.clearAllMocks()
  resetReportJobs()
  h.backgroundTenants.length = 0
  h.resolveReportRequest.mockResolvedValue({ ok: true, frameworkId: 'cmmc-l2', connectionId: 'c1', conn: CONN, sshEnabled: true, tenantId: 't1' })
  h.getPrincipal.mockResolvedValue(SESSION('u1'))
  h.resolveReportBranding.mockResolvedValue(BRANDING)
  h.getHardeningData.mockResolvedValue({ data: { nodes: [] }, collectedAt: new Date(), fromCache: true })
  h.buildFrameworkReportPdf.mockResolvedValue({ ok: true, pdf: PDF, filename: 'cmmc-l2-PVE-PROD-2026-11-20.pdf' })
  h.requireEnterprise.mockResolvedValue(null)
  h.checkPermission.mockResolvedValue(null)
})

async function startedJobId(): Promise<string> {
  const res = await post()
  expect(res.status).toBe(202)
  return (await readJson<{ data: { id: string } }>(res))!.data.id
}

describe('POST /api/v1/compliance/report-jobs', () => {
  it('runs every report guard on the body, then answers 202 with a running job', async () => {
    const res = await post()

    expect(res.status).toBe(202)
    const body = await readJson<{ data: any }>(res)
    expect(body?.data).toMatchObject({ status: 'running', frameworkId: 'cmmc-l2', connectionId: 'c1', connectionName: 'PVE-PROD' })
    expect(body?.data).not.toHaveProperty('ownerKey')
    expect(h.resolveReportRequest).toHaveBeenCalledWith('cmmc-l2', 'c1')
  })

  it('builds the PDF in the background, in the tenant of the request, from the shared collection', async () => {
    const id = await startedJobId()

    await vi.waitFor(async () => expect((await readJson<{ data: any }>(await getJob(id)))?.data.status).toBe('done'))
    expect(h.backgroundTenants).toEqual(['t1'])
    expect(h.getHardeningData).toHaveBeenCalledWith({ tenantId: 't1', connectionId: 'c1', conn: CONN, sshEnabled: true })
    expect(h.buildFrameworkReportPdf).toHaveBeenCalledWith(expect.objectContaining({ frameworkId: 'cmmc-l2', connectionName: 'PVE-PROD', branding: BRANDING }))
  })

  it('hands back the refusal of a guard and starts nothing', async () => {
    h.resolveReportRequest.mockResolvedValue({ ok: false, response: new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }) })

    const res = await post()

    expect(res.status).toBe(404)
    expect(h.getHardeningData).not.toHaveBeenCalled()
  })

  it('passes null for missing or non-string fields', async () => {
    h.resolveReportRequest.mockResolvedValue({ ok: false, response: new Response('{}', { status: 400 }) })

    await post({ frameworkId: 42 })

    expect(h.resolveReportRequest).toHaveBeenCalledWith(null, null)
  })

  it('refuses a caller with no identity to own the job', async () => {
    h.getPrincipal.mockResolvedValue({ ok: true })

    expect((await post()).status).toBe(401)
  })

  it('hands back a principal rejection', async () => {
    h.getPrincipal.mockResolvedValue({ ok: false, rejection: { status: 429, body: { error: 'quota' } } })

    expect((await post()).status).toBe(429)
  })

  it('answers 429 with a code once the caller has the maximum running', async () => {
    h.getHardeningData.mockReturnValue(new Promise(() => {}))
    for (let i = 0; i < MAX_REPORT_JOBS_PER_OWNER; i++) expect((await post()).status).toBe(202)

    const res = await post()

    expect(res.status).toBe(429)
    expect((await readJson<{ code: string }>(res))?.code).toBe('E_TOO_MANY_REPORT_JOBS')
  })

  it('answers 500 on an unexpected failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.resolveReportBranding.mockRejectedValue(new Error('boom'))

    expect((await post()).status).toBe(500)
  })
})

describe('GET /api/v1/compliance/report-jobs/[jobId] and its download', () => {
  it('serves the PDF of a finished job to the caller that started it', async () => {
    const id = await startedJobId()
    await vi.waitFor(async () => expect((await readJson<{ data: any }>(await getJob(id)))?.data.status).toBe('done'))

    const res = await download(id)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="cmmc-l2-PVE-PROD-2026-11-20.pdf"')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PDF)
    expect(h.checkPermission).toHaveBeenCalledWith('admin.compliance', 'connection', 'c1')
  })

  it('answers 409 while the report is still being built, and with its error once failed', async () => {
    let fail: (e: Error) => void = () => {}
    h.getHardeningData.mockReturnValue(new Promise((_r, rej) => { fail = rej }))
    const id = await startedJobId()

    expect((await download(id)).status).toBe(409)

    fail(new Error('pve down'))
    await vi.waitFor(async () => expect((await readJson<{ data: any }>(await getJob(id)))?.data.status).toBe('error'))
    const res = await download(id)
    expect(res.status).toBe(409)
    expect((await readJson<{ error: string }>(res))?.error).toBe('pve down')
  })

  it('reads somebody else\'s job as not found', async () => {
    const id = await startedJobId()
    h.getPrincipal.mockResolvedValue(SESSION('u2'))

    expect((await getJob(id)).status).toBe(404)
    expect((await download(id)).status).toBe(404)
  })

  it('re-checks the compliance right on the connection at read time', async () => {
    const id = await startedJobId()
    h.checkPermission.mockResolvedValue(new Response('{}', { status: 403 }))

    expect((await getJob(id)).status).toBe(403)
    expect((await download(id)).status).toBe(403)
  })

  it('is Enterprise only', async () => {
    const id = await startedJobId()
    h.requireEnterprise.mockResolvedValue(new Response('{}', { status: 403 }))

    expect((await getJob(id)).status).toBe(403)
  })

  it('refuses a caller without identity or with a rejected principal', async () => {
    const id = await startedJobId()

    h.getPrincipal.mockResolvedValue({ ok: true })
    expect((await getJob(id)).status).toBe(401)

    h.getPrincipal.mockResolvedValue({ ok: false, rejection: { status: 401, body: {} } })
    expect((await download(id)).status).toBe(401)
  })

  it('answers 500 when reading fails unexpectedly', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.requireEnterprise.mockRejectedValue(new Error('boom'))

    expect((await getJob('x')).status).toBe(500)
    expect((await download('x')).status).toBe(500)
  })
})
