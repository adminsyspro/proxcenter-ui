import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { truncate } from '@/__tests__/setup/prisma-test'
import { setSetting } from '@/lib/db/settings'
import { putAsset } from './assetStore'
import { GET as publicGET } from '@/app/api/v1/settings/branding/public/route'
import { GET as brandingGET } from '@/app/api/v1/settings/branding/uploads/[filename]/route'
import { GET as backgroundGET } from '@/app/api/v1/settings/login-background/serve/[filename]/route'

const h = vi.hoisted(() => ({ tenantId: 'tenant-a' }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => h.tenantId }))

let root = ''
const serve = (get = brandingGET, filename = 'logo.png', query = '') =>
  get(new Request(`http://localhost/asset${query}`), { params: Promise.resolve({ filename }) })
const upload = (tenantId: string, data: string) =>
  putAsset(tenantId, 'branding', 'logo', 'png', 'image/png', Buffer.from(data))
const disk = (relative: string, data = 'unowned legacy logo') => {
  const filename = path.join(root, relative)
  mkdirSync(path.dirname(filename), { recursive: true })
  writeFileSync(filename, data)
}

beforeEach(async () => {
  await truncate(['uploaded_assets', 'settings'])
  h.tenantId = 'tenant-a'
  root = mkdtempSync(path.join(tmpdir(), 'branding-scope-'))
  vi.spyOn(process, 'cwd').mockReturnValue(root)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('uploaded asset tenant isolation', () => {
  it('uses the provider asset when branding is inherited, ignoring an old tenant upload', async () => {
    await setSetting('branding', 'default', { enabled: true, logoUrl: '/api/v1/settings/branding/uploads/logo.png' })
    await upload('default', 'provider logo')
    await upload('tenant-a', 'stale tenant logo')
    expect(await (await serve()).text()).toBe('provider logo')
  })

  it('keeps a tenant branding override and its own bytes', async () => {
    await setSetting('branding', 'default', { enabled: true })
    await setSetting('branding', 'tenant-a', { enabled: true })
    await upload('default', 'provider logo')
    await upload('tenant-a', 'tenant logo')
    expect(await (await serve()).text()).toBe('tenant logo')
  })

  it('serves the provider bytes to a tenant override that kept the inherited logo URL, never another tenant or an unowned file', async () => {
    // Saving the White Label form persists the URLs the tenant saw while it
    // still inherited the provider branding: those bytes are the provider's.
    await setSetting('branding', 'tenant-a', { enabled: true, logoUrl: '/api/v1/settings/branding/uploads/logo.png' })
    await upload('default', 'provider logo')
    await upload('tenant-b', 'other tenant logo')
    disk('data/uploads/branding/logo.png')
    disk('public/uploads/branding/logo.png')
    expect(await (await serve()).text()).toBe('provider logo')
  })

  it('answers 404 for a tenant override when neither the tenant nor the provider owns the bytes', async () => {
    await setSetting('branding', 'tenant-a', { enabled: true })
    await upload('tenant-b', 'other tenant logo')
    disk('data/uploads/branding/logo.png')
    expect((await serve()).status).toBe(404)
  })

  it('does not fall back to provider bytes for a login background', async () => {
    await setSetting('branding', 'tenant-a', { enabled: true })
    await putAsset('default', 'login-bg', 'background', 'png', 'image/png', Buffer.from('provider background'))
    expect((await serve(backgroundGET, 'background.png')).status).toBe(404)
  })

  it.each(['data', 'public'])('never serves unowned %s branding files', async directory => {
    h.tenantId = 'default'
    disk(`${directory}/uploads/branding/logo.png`)
    expect((await serve()).status).toBe(404)
  })

  it('retains the scoped legacy provider fallback for an inheriting tenant', async () => {
    await setSetting('branding', 'default', { enabled: true })
    disk('data/uploads/branding/default/logo.png', 'provider disk logo')
    disk('data/uploads/branding/tenant-a/logo.png', 'old tenant disk logo')
    expect(await (await serve()).text()).toBe('provider disk logo')
  })

  it('serves provider branding to the anonymous/default session', async () => {
    h.tenantId = 'default'
    await upload('default', 'public provider logo')
    expect(await (await serve()).text()).toBe('public provider logo')
  })

  it('does not inherit login backgrounds from the provider or shared disk', async () => {
    await putAsset('default', 'login-bg', 'background', 'png', 'image/png', Buffer.from('provider background'))
    disk('data/uploads/login-bg/background.png')
    disk('public/uploads/login-bg/background.png')
    expect((await serve(backgroundGET, 'background.png')).status).toBe(404)
  })

  it('prevents success and missing responses from being reused across sessions', async () => {
    await setSetting('branding', 'tenant-a', { enabled: true })
    await setSetting('branding', 'tenant-b', { enabled: true })
    await upload('tenant-a', 'A')
    await upload('tenant-b', 'B')
    const first = await serve()
    h.tenantId = 'tenant-b'
    const second = await serve()
    const missing = await serve(brandingGET, 'missing.png')
    expect(await first.text()).toBe('A')
    expect(await second.text()).toBe('B')
    for (const response of [first, second, missing]) {
      // Private, so no shared cache ever hands one tenant's logo to another;
      // the scoped URL keeps per-tenant browser caching correct.
      expect(response.headers.get('Cache-Control')).toMatch(/private/)
      expect(response.headers.get('Cache-Control')).toMatch(/max-age=\d+/)
      expect(response.headers.get('Cache-Control')).not.toMatch(/public/)
      expect(response.headers.get('Vary')).toMatch(/Cookie/i)
    }
  })
})


describe('explicit uploaded asset owner', () => {
  it('allows own upload preview before saving tenant branding', async () => {
    await setSetting('branding', 'default', { enabled: true })
    await upload('default', 'provider logo')
    await upload('tenant-a', 'new tenant upload')
    expect(await (await serve(brandingGET, 'logo.png', '?tenant=tenant-a')).text()).toBe('new tenant upload')
  })

  it('refuses another tenant supplied in the URL', async () => {
    await upload('tenant-b', 'private tenant logo')
    expect((await serve(brandingGET, 'logo.png', '?tenant=tenant-b')).status).toBe(404)
  })

  it('refuses explicit provider bytes when the current tenant overrides branding', async () => {
    await setSetting('branding', 'tenant-a', { enabled: true })
    await upload('default', 'provider logo')
    expect((await serve(brandingGET, 'logo.png', '?tenant=default')).status).toBe(404)
  })
})


describe('public branding settings and uploaded bytes agree', () => {
  it.each([
    ['logoUrl', 'logo'], ['faviconUrl', 'favicon'], ['loginLogoUrl', 'loginLogo'],
  ])('qualifies inherited %s with the provider owner and ignores stale tenant bytes', async (field, slot) => {
    await setSetting('branding', 'default', {
      enabled: true, [field]: `/uploads/branding/${slot}.png?t=12&tenant=untrusted`,
    })
    await putAsset('default', 'branding', slot, 'png', 'image/png', Buffer.from('provider bytes'))
    await putAsset('tenant-a', 'branding', slot, 'png', 'image/png', Buffer.from('stale tenant bytes'))
    const settings = await (await publicGET()).json()
    const url = new URL(settings[field], 'http://localhost')
    expect(url.searchParams.get('tenant')).toBe('default')
    expect(url.searchParams.get('scope')).toBe('tenant-a')
    const response = await brandingGET(new Request(url), { params: Promise.resolve({ filename: `${slot}.png` }) })
    expect(await response.text()).toBe('provider bytes')
  })
})
