import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'
import { DESTRUCTIVE_SCOPE_IDS, WRITE_SCOPE_IDS } from '@/lib/api-tokens/scopes'
import en from '@/messages/en.json'
import CreateTokenDialog, { filterToVisibleConnectionIds } from './CreateTokenDialog'

// A scope with no entry in the dialog's local icon map, standing in for a
// future addition to SCOPE_DEFINITIONS that nobody has wired an icon for yet.
vi.mock('@/lib/api-tokens/scopes', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-tokens/scopes')>()
  return { ...actual, ALL_SCOPE_IDS: [...actual.ALL_SCOPE_IDS, 'future:scope'] }
})

// Fix round 3, finding 1: no UI sequence has been shown to submit a stale
// connection id (the tenant-change effect clears the selection before the
// next user event can fire Create), so this exercises the structural
// backstop directly by constructing the "stale" state as function inputs,
// rather than by trying to force a race that does not exist through the UI.
describe('filterToVisibleConnectionIds', () => {
  const visibleForTenantA = [{ id: 'conn-a', tenantId: 'tenant-a', name: 'Tenant A PVE' }]

  it('drops an id that is not among the currently visible connections', () => {
    // 'conn-b' stands in for an id carried over from a different tenant's
    // selection that should never reach the request body.
    expect(filterToVisibleConnectionIds(['conn-a', 'conn-b'], visibleForTenantA)).toEqual(['conn-a'])
  })

  it('keeps every id when all are currently visible', () => {
    const visible = [
      { id: 'conn-a', tenantId: 'tenant-a', name: 'A' },
      { id: 'conn-b', tenantId: 'tenant-a', name: 'B' },
    ]
    expect(filterToVisibleConnectionIds(['conn-a', 'conn-b'], visible)).toEqual(['conn-a', 'conn-b'])
  })

  it('returns an empty array when nothing is visible', () => {
    expect(filterToVisibleConnectionIds(['conn-a'], [])).toEqual([])
  })

  it('returns an empty array when nothing was selected', () => {
    expect(filterToVisibleConnectionIds([], visibleForTenantA)).toEqual([])
  })
})

describe('CreateTokenDialog scopes layout', () => {
  beforeEach(() => {
    // The tenant/connection plumbing degrades gracefully on a failed fetch
    // (asserted elsewhere in ApiTokensTab.test.tsx); irrelevant to this
    // scopes-rendering test beyond needing `fetch` to exist under jsdom.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('falls back to a generic icon for a scope with no mapped entry', async () => {
    renderWithProviders(<CreateTokenDialog open onClose={() => {}} onCreated={() => {}} />)
    const dialog = await screen.findByRole('dialog')
    const checkbox = within(dialog).getByLabelText('future:scope')
    const row = checkbox.closest('label') as HTMLElement
    expect(row.querySelector('i.ri-key-line')).not.toBeNull()
  })
})

describe('CreateTokenDialog write scopes', () => {
  const dialogT = (en as any).settings.apiTokens.dialog
  const READ_GRANTABLE = ['vms:read', 'nodes:read', 'storage:read', 'backups:read', 'automation:read', 'alerts:read', 'reports:read']

  // `null` makes the grantable-scopes call fail; a function answers per URL.
  let grantableFor: ((url: string) => string[]) | null

  beforeEach(() => {
    grantableFor = () => [...READ_GRANTABLE, ...WRITE_SCOPE_IDS]
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/tenants') {
        return new Response(JSON.stringify({ data: [
          { id: 'default', name: 'Provider', enabled: true },
          { id: 'tenant-a', name: 'Tenant A', enabled: true },
        ] }), { status: 200 })
      }
      if (url === '/api/v1/admin/vdcs') return new Response(JSON.stringify({ data: [] }), { status: 200 })
      if (url === '/api/v1/admin/connections?type=pve') {
        return new Response(JSON.stringify({ data: [
          { id: 'conn-default', tenantId: 'default', name: 'Provider PVE' },
          { id: 'conn-a', tenantId: 'tenant-a', name: 'Tenant A PVE' },
        ] }), { status: 200 })
      }
      if (url.startsWith('/api/v1/settings/api-tokens/grantable-scopes')) {
        return grantableFor
          ? new Response(JSON.stringify({ data: { grantable: grantableFor(url) } }), { status: 200 })
          : new Response(JSON.stringify({ error: 'boom' }), { status: 500 })
      }
      if (url === '/api/v1/settings/api-tokens' && init?.method === 'POST') {
        return new Response(JSON.stringify({ data: { secret: 'pxc_SECRET' } }), { status: 201 })
      }
      return new Response('{}', { status: 404 })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  async function openDialog() {
    renderWithProviders(<CreateTokenDialog open onClose={() => {}} onCreated={() => {}} />)
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getAllByRole('combobox').length).toBeGreaterThanOrEqual(3))
    return dialog
  }

  function writeToggle(dialog: HTMLElement) {
    return within(dialog).getByRole('button', { name: new RegExp(`^${dialogT.writeScopes}`) })
  }

  async function expandWrite(dialog: HTMLElement) {
    await userEvent.click(writeToggle(dialog))
    await waitFor(() => expect(writeToggle(dialog)).toHaveAttribute('aria-expanded', 'true'))
  }

  function checkboxOf(dialog: HTMLElement, scope: string) {
    return within(dialog).getByLabelText(scope) as HTMLInputElement
  }

  function grantableCalls() {
    return vi.mocked(fetch).mock.calls
      .map(([url]) => String(url))
      .filter(url => url.startsWith('/api/v1/settings/api-tokens/grantable-scopes'))
  }

  function postBody() {
    const call = vi.mocked(fetch).mock.calls.find(([url, init]: any) => url === '/api/v1/settings/api-tokens' && init?.method === 'POST')
    expect(call, 'expected a POST').toBeDefined()
    return JSON.parse((call as any)[1].body)
  }

  it('renders a Read and a Write section, Write folded by default behind a warning', async () => {
    const dialog = await openDialog()
    expect(within(dialog).getByText(dialogT.readScopes)).toBeInTheDocument()
    expect(writeToggle(dialog)).toHaveAttribute('aria-expanded', 'false')
    // (MUI hides the native input itself, so visibility is read on the row.)
    expect(checkboxOf(dialog, 'vms:read').closest('label')).toBeVisible()
    expect(checkboxOf(dialog, 'vms:power').closest('label')).not.toBeVisible()
    expect(within(dialog).getByText(dialogT.writeWarning)).not.toBeVisible()

    await expandWrite(dialog)
    expect(within(dialog).getByText(dialogT.writeWarning)).toBeVisible()
    expect(checkboxOf(dialog, 'vms:power').closest('label')).toBeVisible()
    for (const scope of WRITE_SCOPE_IDS) {
      const row = checkboxOf(dialog, scope).closest('label') as HTMLElement
      // Every write scope has its own icon, never the generic fallback.
      expect(row.querySelector('i[class^="ri-"]'), `icon on ${scope}`).not.toBeNull()
      expect(row.querySelector('i.ri-key-line'), `no fallback icon on ${scope}`).toBeNull()
    }
  })

  it('paints the destructive scopes in the error colour', async () => {
    const dialog = await openDialog()
    await expandWrite(dialog)
    for (const scope of DESTRUCTIVE_SCOPE_IDS) {
      expect(checkboxOf(dialog, scope).closest('.MuiCheckbox-root')?.className).toContain('MuiCheckbox-colorError')
    }
    expect(checkboxOf(dialog, 'vms:power').closest('.MuiCheckbox-root')?.className).not.toContain('MuiCheckbox-colorError')
  })

  it('disables a write scope the caller cannot grant, with a tooltip saying why', async () => {
    grantableFor = () => [...READ_GRANTABLE, 'vms:power']
    const dialog = await openDialog()
    await expandWrite(dialog)
    await waitFor(() => expect(checkboxOf(dialog, 'vms:power')).toBeEnabled())
    expect(checkboxOf(dialog, 'vms:delete')).toBeDisabled()
    expect(checkboxOf(dialog, 'vms:read')).toBeEnabled()

    await userEvent.hover(checkboxOf(dialog, 'vms:delete').closest('label') as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(dialogT.scopeNotGrantable)
  })

  it('keeps every write scope disabled when the grantable check fails (fail closed)', async () => {
    grantableFor = null
    const dialog = await openDialog()
    await expandWrite(dialog)
    await waitFor(() => expect(grantableCalls().length).toBeGreaterThan(0))
    for (const scope of WRITE_SCOPE_IDS) expect(checkboxOf(dialog, scope)).toBeDisabled()
    expect(checkboxOf(dialog, 'vms:read')).toBeEnabled()

    await userEvent.hover(checkboxOf(dialog, 'vms:power').closest('label') as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(dialogT.grantableError)
  })

  it('asks again for the selected tenant and connections, and drops a scope that became ungrantable', async () => {
    grantableFor = url => (url.includes('tenantId=tenant-a') ? READ_GRANTABLE : [...READ_GRANTABLE, ...WRITE_SCOPE_IDS])
    const dialog = await openDialog()
    await expandWrite(dialog)
    await waitFor(() => expect(checkboxOf(dialog, 'vms:power')).toBeEnabled())
    await userEvent.click(checkboxOf(dialog, 'vms:power'))
    expect(checkboxOf(dialog, 'vms:power')).toBeChecked()

    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[1])
    await userEvent.click(await screen.findByRole('option', { name: 'Tenant A' }))
    await waitFor(() => expect(grantableCalls().some(url => url.includes('tenantId=tenant-a'))).toBe(true))
    await waitFor(() => expect(checkboxOf(dialog, 'vms:power')).toBeDisabled())
    expect(checkboxOf(dialog, 'vms:power')).not.toBeChecked()

    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[2])
    await userEvent.click(await screen.findByRole('option', { name: 'Tenant A PVE' }))
    await waitFor(() => expect(grantableCalls().some(url => url.includes('connectionIds=conn-a'))).toBe(true))
  })

  it('presets a 90-day expiry when a write scope is checked, and keeps it when unchecked', async () => {
    const dialog = await openDialog()
    const expiration = within(dialog).getAllByRole('combobox')[0]
    expect(expiration).toHaveTextContent(dialogT.expirationNone)
    await expandWrite(dialog)
    await waitFor(() => expect(checkboxOf(dialog, 'vms:snapshot')).toBeEnabled())

    await userEvent.click(checkboxOf(dialog, 'vms:snapshot'))
    expect(expiration).toHaveTextContent(dialogT.expiration90)
    await userEvent.click(checkboxOf(dialog, 'vms:snapshot'))
    expect(expiration).toHaveTextContent(dialogT.expiration90)

    await userEvent.type(within(dialog).getByLabelText(new RegExp(`^${dialogT.name}`)), 'ci')
    await userEvent.click(checkboxOf(dialog, 'vms:power'))
    await userEvent.click(within(dialog).getByRole('button', { name: new RegExp(`^${dialogT.create}$`) }))
    await waitFor(() => expect(postBody().expiresInDays).toBe(90))
  })

  it('leaves an expiry the user chose alone when a write scope is checked', async () => {
    const dialog = await openDialog()
    const expiration = within(dialog).getAllByRole('combobox')[0]
    fireEvent.mouseDown(expiration)
    await userEvent.click(await screen.findByRole('option', { name: dialogT.expiration30 }))
    await expandWrite(dialog)
    await waitFor(() => expect(checkboxOf(dialog, 'vms:power')).toBeEnabled())
    await userEvent.click(checkboxOf(dialog, 'vms:power'))
    expect(expiration).toHaveTextContent(dialogT.expiration30)
  })

  it('sends writeRateLimitPerMin, 60 by default', async () => {
    const dialog = await openDialog()
    await userEvent.type(within(dialog).getByLabelText(new RegExp(`^${dialogT.name}`)), 'ci')
    await userEvent.click(checkboxOf(dialog, 'vms:read'))
    await userEvent.click(within(dialog).getByRole('button', { name: new RegExp(`^${dialogT.create}$`) }))
    await waitFor(() => expect(postBody().writeRateLimitPerMin).toBe(60))
  })

  it('sends the writes-per-minute value the user typed', async () => {
    const dialog = await openDialog()
    await userEvent.type(within(dialog).getByLabelText(new RegExp(`^${dialogT.name}`)), 'ci')
    await expandWrite(dialog)
    await waitFor(() => expect(checkboxOf(dialog, 'vms:power')).toBeEnabled())
    await userEvent.click(checkboxOf(dialog, 'vms:power'))
    const field = within(dialog).getByLabelText(dialogT.writeRateLimit)
    await userEvent.clear(field)
    await userEvent.type(field, '120')
    await userEvent.click(within(dialog).getByRole('button', { name: new RegExp(`^${dialogT.create}$`) }))
    await waitFor(() => expect(postBody().writeRateLimitPerMin).toBe(120))
    expect(postBody().scopes).toEqual(['vms:power'])
  })
})
