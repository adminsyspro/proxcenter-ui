import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { callRoute } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn()
const getSettingMock = vi.fn()
const setSettingMock = vi.fn()
const updateThresholdsMock = vi.fn()

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))
vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: async () => 'tenant-1',
}))
vi.mock('@/lib/db/settings', () => ({
  getSetting: (...a: any[]) => getSettingMock(...a),
  setSetting: (...a: any[]) => setSettingMock(...a),
}))
vi.mock('@/lib/demo/demo-api', () => ({
  demoResponse: () => null,
}))
vi.mock('@/lib/orchestrator/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator/client')>()
  return {
    ...actual,
    alertsApi: { updateThresholds: (...a: any[]) => updateThresholdsMock(...a) },
  }
})

import { GET, PUT } from './route'

const originalOrchestratorUrl = process.env.ORCHESTRATOR_URL

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getSettingMock.mockResolvedValue(null)
  setSettingMock.mockResolvedValue(undefined)
  updateThresholdsMock.mockResolvedValue({ data: {}, status: 200 })
  process.env.ORCHESTRATOR_URL = 'http://orchestrator.test'
})

afterEach(() => {
  process.env.ORCHESTRATOR_URL = originalOrchestratorUrl
})

describe('GET /api/v1/settings/alerts/thresholds', () => {
  it('returns the defaults with an empty exclude pattern when nothing is stored', async () => {
    const res = await callRoute(GET as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.snapshot_max_age_days).toBe(7)
    expect(body.snapshot_exclude_pattern).toBe('')
  })

  it('merges a stored pattern over the defaults and ignores a non-string one', async () => {
    getSettingMock.mockResolvedValue({ snapshot_exclude_pattern: '(?i)replica', cpu_warning: 70 })
    let body = await (await callRoute(GET as any)).json()
    expect(body.snapshot_exclude_pattern).toBe('(?i)replica')
    expect(body.cpu_warning).toBe(70)

    getSettingMock.mockResolvedValue({ snapshot_exclude_pattern: 42 })
    body = await (await callRoute(GET as any)).json()
    expect(body.snapshot_exclude_pattern).toBe('')
  })
})

describe('PUT /api/v1/settings/alerts/thresholds', () => {
  it('trims the pattern, pushes it to the orchestrator and stores it', async () => {
    const res = await callRoute(PUT as any, {
      method: 'PUT',
      body: { snapshot_max_age_days: 7, snapshot_exclude_pattern: '  (?i)replica ' },
    })
    expect(res.status).toBe(200)
    expect((await res.json()).snapshot_exclude_pattern).toBe('(?i)replica')
    expect(updateThresholdsMock).toHaveBeenCalledWith(expect.objectContaining({ snapshot_exclude_pattern: '(?i)replica' }))
    expect(setSettingMock).toHaveBeenCalledWith('alert_thresholds', 'tenant-1', expect.objectContaining({ snapshot_exclude_pattern: '(?i)replica' }))
  })

  it('relays the orchestrator refusal of an invalid RE2 pattern and stores nothing', async () => {
    // The Go side rejects the regex; a JS RegExp cannot stand in for it, since
    // JS rejects (?i) and accepts the lookahead RE2 refuses.
    updateThresholdsMock.mockRejectedValue(new Error(
      'Orchestrator 400: {"error":"invalid snapshot_exclude_pattern: error parsing regexp: invalid or unsupported Perl syntax: `(?!`"}',
    ))
    const res = await callRoute(PUT as any, {
      method: 'PUT',
      body: { snapshot_exclude_pattern: '(?!replica)' },
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/invalid snapshot_exclude_pattern/)
    expect(setSettingMock).not.toHaveBeenCalled()
  })

  it('still stores the thresholds when the orchestrator is unreachable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    updateThresholdsMock.mockRejectedValue(new Error('fetch failed'))
    const res = await callRoute(PUT as any, {
      method: 'PUT',
      body: { snapshot_exclude_pattern: '(?i)replica' },
    })
    expect(res.status).toBe(200)
    expect(setSettingMock).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('skips the orchestrator entirely without ORCHESTRATOR_URL', async () => {
    delete process.env.ORCHESTRATOR_URL
    const res = await callRoute(PUT as any, { method: 'PUT', body: { cpu_warning: 75 } })
    expect(res.status).toBe(200)
    expect(updateThresholdsMock).not.toHaveBeenCalled()
    expect((await res.json()).cpu_warning).toBe(75)
  })

  it('denies without the settings permission', async () => {
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }))
    const res = await callRoute(PUT as any, { method: 'PUT', body: {} })
    expect(res.status).toBe(403)
    expect(setSettingMock).not.toHaveBeenCalled()
  })
})
