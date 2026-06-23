import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import { callRoute } from '@/__tests__/setup/route-test'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const findUniqueMock = vi.fn<(args: any) => Promise<any>>()
const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const verifyConnectionOwnershipMock = vi.fn<(id: string) => Promise<Response | null>>()
const collectHardeningDataMock = vi.fn<(opts: any) => Promise<any>>()
const requireEnterpriseMock = vi.fn<() => Promise<Response | null>>()
const renderPdfMock = vi.fn<(html: string) => Promise<any>>()
const getSettingMock = vi.fn<(key: string, tenantId: string) => Promise<any>>()

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({
    connection: { findUnique: findUniqueMock },
  }),
  verifyConnectionOwnership: verifyConnectionOwnershipMock,
  getCurrentTenantId: vi.fn(async () => 'tenant-1'),
}))

vi.mock('@/lib/db/settings', () => ({
  getSetting: getSettingMock,
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_COMPLIANCE: 'admin.compliance' },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: getConnectionByIdMock,
}))

vi.mock('@/lib/compliance/collectHardeningData', () => ({
  collectHardeningData: collectHardeningDataMock,
}))

vi.mock('@/lib/auth/requireEnterprise', () => ({
  requireEnterprise: requireEnterpriseMock,
}))

vi.mock('@/lib/reporting/weasyprintClient', () => ({
  renderPdf: renderPdfMock,
}))

// Mock node:fs so logo disk reads never hit the real filesystem in tests
vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => Buffer.from('')),
  },
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => Buffer.from('')),
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/v1/compliance/frameworks/[frameworkId]/report', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: enterprise permitted, RBAC permitted, ownership OK
    requireEnterpriseMock.mockResolvedValue(null)
    checkPermissionMock.mockResolvedValue(null)
    verifyConnectionOwnershipMock.mockResolvedValue(null)
    // Use a hostile connection name to verify filename sanitization
    getConnectionByIdMock.mockResolvedValue({ id: 'c1', name: 'pr"od/<x>' })
    findUniqueMock.mockResolvedValue({ sshEnabled: false })
    collectHardeningDataMock.mockResolvedValue({})
    renderPdfMock.mockResolvedValue({ ok: true, pdf: Buffer.from([1, 2, 3]) })
    // Default: no branding settings
    getSettingMock.mockResolvedValue(null)
    // Default: no logo files on disk (clearAllMocks does not reset implementations)
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from(''))
  })

  it('streams a PDF with sanitized attachment filename (hostile conn name)', async () => {
    // Capture the html arg passed to renderPdf to verify i18n keys are resolved
    let capturedHtml = ''
    renderPdfMock.mockImplementation(async (html: string) => {
      capturedHtml = html
      return { ok: true, pdf: Buffer.from([1, 2, 3]) }
    })

    const { GET } = await import('./route')
    const res = await callRoute(GET, {
      params: { frameworkId: 'nist-800-171-r2' },
      searchParams: { connectionId: 'c1' },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')

    const disposition = res.headers.get('content-disposition') ?? ''
    expect(disposition).toContain('attachment')
    // RFC 6266 quoted form; the filename portion (inside quotes) must be sanitized
    expect(disposition).toMatch(/^attachment; filename="[^"/\\<>]+\.pdf"$/)

    // Verify PDF HTML contains readable English text, not raw i18n keys
    expect(capturedHtml).toContain('controls assessed')
    expect(capturedHtml).not.toContain('compliance.frameworks.controlsAssessed')
  })

  it('returns 400 when connectionId is missing', async () => {
    const { GET } = await import('./route')
    const res = await callRoute(GET, {
      params: { frameworkId: 'nist-800-171-r2' },
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 on unknown frameworkId', async () => {
    const { GET } = await import('./route')
    const res = await callRoute(GET, {
      params: { frameworkId: 'bogus' },
      searchParams: { connectionId: 'c1' },
    })
    expect(res.status).toBe(400)
  })

  it('returns 403 when requireEnterprise denies', async () => {
    const { NextResponse } = await import('next/server')
    requireEnterpriseMock.mockResolvedValue(
      NextResponse.json({ error: 'Enterprise feature' }, { status: 403 })
    )
    const { GET } = await import('./route')
    const res = await callRoute(GET, {
      params: { frameworkId: 'nist-800-171-r2' },
      searchParams: { connectionId: 'c1' },
    })
    expect(res.status).toBe(403)
  })

  it('returns 403 when RBAC checkPermission denies', async () => {
    const { NextResponse } = await import('next/server')
    checkPermissionMock.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    )
    const { GET } = await import('./route')
    const res = await callRoute(GET, {
      params: { frameworkId: 'nist-800-171-r2' },
      searchParams: { connectionId: 'c1' },
    })
    expect(res.status).toBe(403)
  })

  it('returns ownership error when verifyConnectionOwnership denies', async () => {
    const { NextResponse } = await import('next/server')
    verifyConnectionOwnershipMock.mockResolvedValue(
      NextResponse.json({ error: 'Not found' }, { status: 404 })
    )
    const { GET } = await import('./route')
    const res = await callRoute(GET, {
      params: { frameworkId: 'nist-800-171-r2' },
      searchParams: { connectionId: 'c1' },
    })
    expect(res.status).toBe(404)
  })

  it('returns 404 when connection is not found', async () => {
    getConnectionByIdMock.mockResolvedValue(null)
    const { GET } = await import('./route')
    const res = await callRoute(GET, {
      params: { frameworkId: 'nist-800-171-r2' },
      searchParams: { connectionId: 'c1' },
    })
    expect(res.status).toBe(404)
  })

  it('returns 503 when the PDF sidecar fails', async () => {
    renderPdfMock.mockResolvedValue({ ok: false, error: 'down' })
    const { GET } = await import('./route')
    const res = await callRoute(GET, {
      params: { frameworkId: 'nist-800-171-r2' },
      searchParams: { connectionId: 'c1' },
    })
    expect(res.status).toBe(503)
  })

  it('returns 503 when renderPdf returns ok:true but no pdf buffer', async () => {
    renderPdfMock.mockResolvedValue({ ok: true })
    const { GET } = await import('./route')
    const res = await callRoute(GET, {
      params: { frameworkId: 'nist-800-171-r2' },
      searchParams: { connectionId: 'c1' },
    })
    expect(res.status).toBe(503)
  })

  it('passes sshEnabled from prisma to collectHardeningData', async () => {
    findUniqueMock.mockResolvedValue({ sshEnabled: true })
    const { GET } = await import('./route')
    await callRoute(GET, {
      params: { frameworkId: 'nist-800-171-r2' },
      searchParams: { connectionId: 'c1' },
    })
    expect(collectHardeningDataMock).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'c1', sshEnabled: true })
    )
  })

  it('embeds the framework badge as a data URI when the logo file exists', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    let capturedHtml = ''
    renderPdfMock.mockImplementation(async (html: string) => {
      capturedHtml = html
      return { ok: true, pdf: Buffer.from([1, 2, 3]) }
    })
    const { GET } = await import('./route')
    const res = await callRoute(GET, {
      params: { frameworkId: 'iso-27001-2022' },
      searchParams: { connectionId: 'c1' },
    })
    expect(res.status).toBe(200)
    expect(capturedHtml).toContain('<img class="cover-framework-logo" src="data:image/png;base64,')
  })

  it('still returns 200 when getSetting throws (branding hiccup)', async () => {
    getSettingMock.mockRejectedValue(new Error('DB connection lost'))
    const { GET } = await import('./route')
    const res = await callRoute(GET, {
      params: { frameworkId: 'nist-800-171-r2' },
      searchParams: { connectionId: 'c1' },
    })
    expect(res.status).toBe(200)
  })
})
