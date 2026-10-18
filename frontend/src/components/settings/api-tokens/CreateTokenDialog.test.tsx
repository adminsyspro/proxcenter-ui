import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'
import { DESTRUCTIVE_SCOPE_IDS, READ_SCOPE_IDS, WRITE_SCOPE_IDS } from '@/lib/api-tokens/scopes'
import en from '@/messages/en.json'
import CreateTokenDialog, { SCOPE_DOMAINS, SUB_SCOPE_LABEL_KEYS, filterToVisibleConnectionIds } from './CreateTokenDialog'

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

describe('SCOPE_DOMAINS', () => {
  it('places every scope id in exactly one domain, one read scope per domain', () => {
    const placed = SCOPE_DOMAINS.flatMap(domain => [domain.read, ...domain.write])
    expect([...placed].sort()).toEqual([...READ_SCOPE_IDS, ...WRITE_SCOPE_IDS].sort())
    expect(new Set(placed).size).toBe(placed.length)
    for (const domain of SCOPE_DOMAINS) expect(READ_SCOPE_IDS, domain.id).toContain(domain.read)
  })

  it('labels every write sub-scope that is shown as a chip', () => {
    const subScopes = (en as any).settings.apiTokens.dialog.subScopes
    for (const domain of SCOPE_DOMAINS.filter(d => d.write.length > 1)) {
      for (const scope of domain.write) expect(subScopes[SUB_SCOPE_LABEL_KEYS[scope]], scope).toBeTruthy()
    }
  })
})

describe('CreateTokenDialog scope picker', () => {
  const dialogT = (en as any).settings.apiTokens.dialog
  const READ_GRANTABLE = [...READ_SCOPE_IDS]
  const VM_DEFAULTS = ['vms:read', 'vms:power', 'vms:write', 'vms:snapshot', 'vms:migrate']

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

  // The level toggle of a domain row is a group named after the domain.
  function levels(dialog: HTMLElement, domain: string) {
    return within(dialog).getByRole('group', { name: dialogT.domains[domain] })
  }

  function levelButton(dialog: HTMLElement, domain: string, level: 'none' | 'read' | 'write') {
    return within(levels(dialog, domain)).getByRole('button', { name: dialogT.access[level] })
  }

  function rowOf(dialog: HTMLElement, domain: string) {
    return levels(dialog, domain).closest('[data-domain]') as HTMLElement
  }

  function chipGroup(dialog: HTMLElement, domain: string) {
    return within(dialog).queryByRole('group', { name: dialogT.subScopesLabel.replace('{domain}', dialogT.domains[domain]) })
  }

  function chip(dialog: HTMLElement, domain: string, subKey: string) {
    const group = chipGroup(dialog, domain)
    expect(group, `chips of ${domain}`).not.toBeNull()
    return within(group as HTMLElement).getByRole('button', { name: dialogT.subScopes[subKey] })
  }

  async function grantableSettled(dialog: HTMLElement) {
    await waitFor(() => expect(levelButton(dialog, 'vms', 'write')).toBeEnabled())
  }

  async function typeName(dialog: HTMLElement) {
    await userEvent.type(within(dialog).getByLabelText(new RegExp(`^${dialogT.name}`)), 'ci')
  }

  function createButton(dialog: HTMLElement) {
    return within(dialog).getByRole('button', { name: new RegExp(`^${dialogT.create}$`) })
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

  it('renders one row per domain with its icon, label and None, Read, Write, all on None', async () => {
    const dialog = await openDialog()
    for (const domain of SCOPE_DOMAINS) {
      const row = rowOf(dialog, domain.id)
      expect(row.querySelector(`i.${domain.icon}`), `icon on ${domain.id}`).not.toBeNull()
      expect(within(row).getByText(dialogT.domains[domain.id])).toBeInTheDocument()
      expect(levelButton(dialog, domain.id, 'none')).toHaveAttribute('aria-pressed', 'true')
      expect(levelButton(dialog, domain.id, 'read')).toHaveAttribute('aria-pressed', 'false')
      expect(levelButton(dialog, domain.id, 'write')).toHaveAttribute('aria-pressed', 'false')
    }
    expect(within(dialog).queryByText(dialogT.writeWarning)).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText(dialogT.writeRateLimit)).not.toBeInTheDocument()
    await typeName(dialog)
    expect(createButton(dialog)).toBeDisabled()
  })

  it('shows the raw scope ids a domain grants in a tooltip on its label', async () => {
    const dialog = await openDialog()
    await userEvent.hover(within(rowOf(dialog, 'vms')).getByText(dialogT.domains.vms))
    const tooltip = await screen.findByRole('tooltip')
    for (const scope of ['vms:read', 'vms:power', 'vms:delete']) expect(tooltip).toHaveTextContent(scope)
  })

  it('keeps Write disabled on the read only domains, with a tooltip saying why', async () => {
    const dialog = await openDialog()
    await grantableSettled(dialog)
    for (const domain of ['automation', 'alerts', 'reports']) {
      expect(levelButton(dialog, domain, 'write'), domain).toBeDisabled()
      expect(levelButton(dialog, domain, 'read'), domain).toBeEnabled()
    }
    await userEvent.hover(levelButton(dialog, 'alerts', 'write').parentElement as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(dialogT.readOnlyDomain)
  })

  it('sends the read scopes of the domains on Read, without a write rate limit', async () => {
    const dialog = await openDialog()
    await typeName(dialog)
    await userEvent.click(levelButton(dialog, 'alerts', 'read'))
    await userEvent.click(levelButton(dialog, 'vms', 'read'))
    expect(levelButton(dialog, 'vms', 'read')).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).queryByText(dialogT.writeWarning)).not.toBeInTheDocument()
    await userEvent.click(createButton(dialog))
    await waitFor(() => expect(postBody().scopes).toEqual(['vms:read', 'alerts:read']))
    expect(postBody()).not.toHaveProperty('writeRateLimitPerMin')
  })

  it('drops every scope of a domain set back to None', async () => {
    const dialog = await openDialog()
    await grantableSettled(dialog)
    await typeName(dialog)
    await userEvent.click(levelButton(dialog, 'vms', 'write'))
    expect(createButton(dialog)).toBeEnabled()
    await userEvent.click(levelButton(dialog, 'vms', 'none'))
    expect(chipGroup(dialog, 'vms')).toBeNull()
    expect(createButton(dialog)).toBeDisabled()
  })

  it('reveals the sub-scope chips on Write, every non destructive one selected and Delete left out', async () => {
    const dialog = await openDialog()
    await grantableSettled(dialog)
    expect(chipGroup(dialog, 'vms')).toBeNull()
    await userEvent.click(levelButton(dialog, 'vms', 'write'))
    expect(levelButton(dialog, 'vms', 'write')).toHaveAttribute('aria-pressed', 'true')
    for (const key of ['vmsPower', 'vmsWrite', 'vmsSnapshot', 'vmsMigrate']) {
      expect(chip(dialog, 'vms', key), key).toHaveAttribute('aria-pressed', 'true')
    }
    expect(chip(dialog, 'vms', 'vmsDelete')).toHaveAttribute('aria-pressed', 'false')
    expect(within(dialog).getByText(dialogT.writeWarning)).toBeVisible()
    expect(within(dialog).getByLabelText(dialogT.writeRateLimit)).toBeInTheDocument()

    await typeName(dialog)
    await userEvent.click(createButton(dialog))
    await waitFor(() => expect(postBody().scopes).toEqual(VM_DEFAULTS))
    expect(postBody().writeRateLimitPerMin).toBe(60)
  })

  it('paints the destructive chips, label included, in the error colour', async () => {
    const dialog = await openDialog()
    await grantableSettled(dialog)
    await userEvent.click(levelButton(dialog, 'vms', 'write'))
    await userEvent.click(levelButton(dialog, 'backups', 'write'))
    const destructive = [chip(dialog, 'vms', 'vmsDelete'), chip(dialog, 'backups', 'backupsDelete')]
    expect(DESTRUCTIVE_SCOPE_IDS).toEqual(['vms:delete', 'backups:delete'])
    for (const element of destructive) {
      expect(element.className).toContain('MuiChip-colorError')
      expect(getComputedStyle(element).color).toBe('rgb(211, 47, 47)')
    }
    expect(chip(dialog, 'vms', 'vmsPower').className).not.toContain('MuiChip-colorError')
    expect(chip(dialog, 'backups', 'backupsRestore').className).not.toContain('MuiChip-colorError')
  })

  it('adds a destructive sub-scope only when its chip is picked', async () => {
    const dialog = await openDialog()
    await grantableSettled(dialog)
    await typeName(dialog)
    await userEvent.click(levelButton(dialog, 'vms', 'write'))
    await userEvent.click(chip(dialog, 'vms', 'vmsDelete'))
    expect(chip(dialog, 'vms', 'vmsDelete')).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(chip(dialog, 'vms', 'vmsWrite'))
    await userEvent.click(createButton(dialog))
    await waitFor(() => expect(postBody().scopes).toEqual(['vms:read', 'vms:power', 'vms:snapshot', 'vms:migrate', 'vms:delete']))
  })

  it('switches the row back to Read when the last sub-scope chip is unselected', async () => {
    const dialog = await openDialog()
    await grantableSettled(dialog)
    await typeName(dialog)
    await userEvent.click(levelButton(dialog, 'nodes', 'write'))
    for (const key of ['haWrite', 'poolsWrite', 'networkWrite']) await userEvent.click(chip(dialog, 'nodes', key))
    expect(levelButton(dialog, 'nodes', 'write')).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(chip(dialog, 'nodes', 'firewallWrite'))
    expect(levelButton(dialog, 'nodes', 'read')).toHaveAttribute('aria-pressed', 'true')
    expect(chipGroup(dialog, 'nodes')).toBeNull()
    expect(within(dialog).queryByText(dialogT.writeWarning)).not.toBeInTheDocument()
    await userEvent.click(createButton(dialog))
    await waitFor(() => expect(postBody().scopes).toEqual(['nodes:read']))
    expect(postBody()).not.toHaveProperty('writeRateLimitPerMin')
  })

  it('needs no chips for a domain with a single write scope', async () => {
    const dialog = await openDialog()
    await grantableSettled(dialog)
    await typeName(dialog)
    await userEvent.click(levelButton(dialog, 'storage', 'write'))
    expect(chipGroup(dialog, 'storage')).toBeNull()
    await userEvent.click(createButton(dialog))
    await waitFor(() => expect(postBody().scopes).toEqual(['storage:read', 'storage:write']))
  })

  it('disables a sub-scope chip the caller cannot grant, and leaves it out of the defaults', async () => {
    grantableFor = () => [...READ_GRANTABLE, 'vms:power', 'vms:delete']
    const dialog = await openDialog()
    await grantableSettled(dialog)
    await typeName(dialog)
    await userEvent.click(levelButton(dialog, 'vms', 'write'))
    expect(chip(dialog, 'vms', 'vmsPower')).toHaveAttribute('aria-pressed', 'true')
    expect(chip(dialog, 'vms', 'vmsSnapshot')).toHaveAttribute('aria-disabled', 'true')
    expect(chip(dialog, 'vms', 'vmsDelete')).not.toHaveAttribute('aria-disabled')

    await userEvent.hover(chip(dialog, 'vms', 'vmsSnapshot').parentElement as HTMLElement)
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent(dialogT.scopeNotGrantable)
    expect(tooltip).toHaveTextContent('vms:snapshot')

    await userEvent.click(createButton(dialog))
    await waitFor(() => expect(postBody().scopes).toEqual(['vms:read', 'vms:power']))
  })

  it('disables Write on a domain when none of its write scopes is grantable', async () => {
    grantableFor = () => [...READ_GRANTABLE, 'vms:power']
    const dialog = await openDialog()
    await grantableSettled(dialog)
    expect(levelButton(dialog, 'backups', 'write')).toBeDisabled()
    expect(levelButton(dialog, 'backups', 'read')).toBeEnabled()
    await userEvent.hover(levelButton(dialog, 'backups', 'write').parentElement as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(dialogT.domainNotGrantable)
  })

  it('selects the only grantable sub-scope on Write even when it is destructive', async () => {
    grantableFor = () => [...READ_GRANTABLE, 'vms:delete']
    const dialog = await openDialog()
    await grantableSettled(dialog)
    await userEvent.click(levelButton(dialog, 'vms', 'write'))
    expect(chip(dialog, 'vms', 'vmsDelete')).toHaveAttribute('aria-pressed', 'true')
    expect(levelButton(dialog, 'vms', 'write')).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps every Write button disabled when the grantable check fails (fail closed)', async () => {
    grantableFor = null
    const dialog = await openDialog()
    await waitFor(() => expect(grantableCalls().length).toBeGreaterThan(0))
    for (const domain of SCOPE_DOMAINS) {
      expect(levelButton(dialog, domain.id, 'write'), domain.id).toBeDisabled()
      expect(levelButton(dialog, domain.id, 'read'), domain.id).toBeEnabled()
    }
    await userEvent.hover(levelButton(dialog, 'vms', 'write').parentElement as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(dialogT.grantableError)
  })

  it('keeps every Write button disabled while the grantable answer is pending', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const answer = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (url: any, init?: any) => {
      if (String(url).startsWith('/api/v1/settings/api-tokens/grantable-scopes')) await held
      return answer(url, init)
    })
    const dialog = await openDialog()
    await waitFor(() => expect(grantableCalls().length).toBeGreaterThan(0))
    expect(levelButton(dialog, 'vms', 'write')).toBeDisabled()
    await userEvent.hover(levelButton(dialog, 'vms', 'write').parentElement as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(dialogT.scopesLoading)
    release()
    await grantableSettled(dialog)
  })

  it('asks again for the selected tenant and connections, and drops a write scope that became ungrantable', async () => {
    grantableFor = url => (url.includes('tenantId=tenant-a') ? READ_GRANTABLE : [...READ_GRANTABLE, ...WRITE_SCOPE_IDS])
    const dialog = await openDialog()
    await grantableSettled(dialog)
    await userEvent.click(levelButton(dialog, 'vms', 'write'))

    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[1])
    await userEvent.click(await screen.findByRole('option', { name: 'Tenant A' }))
    await waitFor(() => expect(grantableCalls().some(url => url.includes('tenantId=tenant-a'))).toBe(true))
    // The read scope stays: the row falls back to Read, Write is now refused.
    await waitFor(() => expect(levelButton(dialog, 'vms', 'read')).toHaveAttribute('aria-pressed', 'true'))
    expect(levelButton(dialog, 'vms', 'write')).toBeDisabled()
    expect(chipGroup(dialog, 'vms')).toBeNull()

    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[2])
    await userEvent.click(await screen.findByRole('option', { name: 'Tenant A PVE' }))
    await waitFor(() => expect(grantableCalls().some(url => url.includes('connectionIds=conn-a'))).toBe(true))
  })

  it('presets a 90-day expiry when a domain goes to Write, and keeps it when back to Read', async () => {
    const dialog = await openDialog()
    const expiration = within(dialog).getAllByRole('combobox')[0]
    expect(expiration).toHaveTextContent(dialogT.expirationNone)
    await grantableSettled(dialog)

    await userEvent.click(levelButton(dialog, 'backups', 'write'))
    expect(expiration).toHaveTextContent(dialogT.expiration90)
    await userEvent.click(levelButton(dialog, 'backups', 'read'))
    expect(expiration).toHaveTextContent(dialogT.expiration90)

    await typeName(dialog)
    await userEvent.click(createButton(dialog))
    await waitFor(() => expect(postBody().expiresInDays).toBe(90))
  })

  it('leaves an expiry the user chose alone when a domain goes to Write', async () => {
    const dialog = await openDialog()
    const expiration = within(dialog).getAllByRole('combobox')[0]
    fireEvent.mouseDown(expiration)
    await userEvent.click(await screen.findByRole('option', { name: dialogT.expiration30 }))
    await grantableSettled(dialog)
    await userEvent.click(levelButton(dialog, 'vms', 'write'))
    expect(expiration).toHaveTextContent(dialogT.expiration30)
  })

  it('disables Create while a domain is on Write and the grantable answer for the new perimeter is pending', async () => {
    // The first answer comes at once; the one for tenant-a is held back.
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const answer = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (url: any, init?: any) => {
      if (String(url).includes('tenantId=tenant-a')) await held
      return answer(url, init)
    })

    const dialog = await openDialog()
    await typeName(dialog)
    await grantableSettled(dialog)
    await userEvent.click(levelButton(dialog, 'vms', 'write'))
    expect(createButton(dialog)).toBeEnabled()

    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[1])
    await userEvent.click(await screen.findByRole('option', { name: 'Tenant A' }))
    await waitFor(() => expect(grantableCalls().some(url => url.includes('tenantId=tenant-a'))).toBe(true))
    expect(levelButton(dialog, 'vms', 'write')).toHaveAttribute('aria-pressed', 'true')
    expect(createButton(dialog)).toBeDisabled()

    release()
    await waitFor(() => expect(createButton(dialog)).toBeEnabled())
  })

  it('drops the write scopes when the check fails, so Create stays usable for the read scopes', async () => {
    let fail = false
    const answer = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (url: any, init?: any) => {
      if (String(url).startsWith('/api/v1/settings/api-tokens/grantable-scopes') && fail) {
        return new Response('{}', { status: 500 })
      }
      return answer(url, init)
    })
    const dialog = await openDialog()
    await typeName(dialog)
    await grantableSettled(dialog)
    await userEvent.click(levelButton(dialog, 'vms', 'write'))
    fail = true
    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[1])
    await userEvent.click(await screen.findByRole('option', { name: 'Tenant A' }))
    await waitFor(() => expect(levelButton(dialog, 'vms', 'read')).toHaveAttribute('aria-pressed', 'true'))
    expect(createButton(dialog)).toBeEnabled()
    await userEvent.click(createButton(dialog))
    await waitFor(() => expect(postBody().scopes).toEqual(['vms:read']))
  })

  it('sends the writes-per-minute value the user typed', async () => {
    const dialog = await openDialog()
    await typeName(dialog)
    await grantableSettled(dialog)
    await userEvent.click(levelButton(dialog, 'storage', 'write'))
    const field = within(dialog).getByLabelText(dialogT.writeRateLimit)
    await userEvent.clear(field)
    await userEvent.type(field, '120')
    await userEvent.click(createButton(dialog))
    await waitFor(() => expect(postBody().writeRateLimitPerMin).toBe(120))
    expect(postBody().scopes).toEqual(['storage:read', 'storage:write'])
  })
})
