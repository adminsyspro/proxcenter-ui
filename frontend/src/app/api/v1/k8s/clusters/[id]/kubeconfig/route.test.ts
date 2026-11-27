import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const requireK8sPermissionMock = vi.fn()
const resolveStrictTenantMock = vi.fn()
const getWithCredMock = vi.fn()
const buildKubeconfigYamlMock = vi.fn()
const auditMock = vi.fn()

vi.mock('@/lib/k8s/requireK8sPermission', () => ({ requireK8sPermission: (...a: any[]) => requireK8sPermissionMock(...a) }))
vi.mock('@/lib/rbac', () => ({ PERMISSIONS: { K8S_VIEW: 'k8s.view', K8S_MANAGE: 'k8s.manage' } }))
vi.mock('@/lib/k8s/strictTenant', () => ({ resolveStrictTenant: (...a: any[]) => resolveStrictTenantMock(...a) }))
vi.mock('@/lib/k8s/repository', () => ({ getClusterWithCredential: (...a: any[]) => getWithCredMock(...a) }))
vi.mock('@/lib/k8s/server/client', () => ({ buildKubeconfigYaml: (...a: any[]) => buildKubeconfigYamlMock(...a) }))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))

const cred = { apiServerUrl: 'https://10.0.0.1:6443', insecureSkipTlsVerify: false, credentialType: 'token', credential: 't', contextName: 'ctx' }

beforeEach(() => {
  requireK8sPermissionMock.mockReset().mockResolvedValue(null)
  resolveStrictTenantMock.mockReset().mockResolvedValue({ ok: true, tenantId: 't1' })
  getWithCredMock.mockReset().mockResolvedValue({ row: { id: 'c1', name: 'dev' }, credential: cred })
  buildKubeconfigYamlMock.mockReset().mockReturnValue('apiVersion: v1\nkind: Config\n')
  auditMock.mockReset().mockResolvedValue('a1')
})

const params = { id: 'c1' }

describe('GET [id]/kubeconfig', () => {
  it('403 when the gate denies', async () => {
    requireK8sPermissionMock.mockResolvedValue(new Response('no', { status: 403 }))
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(403)
  })
  it('requires the manage permission, not plain view (it exposes admin creds)', async () => {
    const GET = (await import('./route')).GET
    await callRoute(GET, { params })
    expect(requireK8sPermissionMock).toHaveBeenCalledWith('k8s.manage')
  })
  it('404 when the cluster is not in the tenant, without building a kubeconfig', async () => {
    getWithCredMock.mockResolvedValue(null)
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(404)
    expect(buildKubeconfigYamlMock).not.toHaveBeenCalled()
  })
  it('returns the rebuilt kubeconfig + name and audits the export', async () => {
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params })
    const json: any = await readJson(res)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(json.kubeconfig).toContain('kind: Config')
    expect(json.name).toBe('dev')
    expect(buildKubeconfigYamlMock).toHaveBeenCalledWith(cred)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'export', category: 'k8s', resourceId: 'c1', status: 'success' }))
  })
  it('responds with only the kubeconfig + name (no raw credential object)', async () => {
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params })
    const json: any = await readJson(res)
    expect(Object.keys(json).sort()).toEqual(['kubeconfig', 'name'])
  })
})
