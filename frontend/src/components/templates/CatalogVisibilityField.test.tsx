import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor, within } from '@testing-library/react'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import CatalogVisibilityField, { visibilityBadge, visibilityMode } from './CatalogVisibilityField'

const tenants = [
  { id: 't-msp', name: 'MSP', slug: 'msp' },
  { id: 't-acme', name: 'Acme', slug: 'acme' },
  { id: 'default', name: 'Default', slug: 'default' },
]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: tenants }) })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CatalogVisibilityField (#903)', () => {
  it('derives the mode from the record', () => {
    expect(visibilityMode({ isShared: true, grantTenantIds: ['x'] })).toBe('everyone')
    expect(visibilityMode({ isShared: false, grantTenantIds: ['x'] })).toBe('tenants')
    expect(visibilityMode({ isShared: false, grantTenantIds: [] })).toBe('private')
  })

  it('switching to "selected tenants" offers every tenant but the provider, and reports the picks', async () => {
    const onChange = vi.fn()
    renderWithProviders(<CatalogVisibilityField value={{ isShared: false, grantTenantIds: [] }} onChange={onChange} />)

    await userEvent.click(screen.getByRole('combobox', { name: 'Visibility' }))
    await userEvent.click(screen.getByRole('option', { name: 'Selected tenants' }))
    expect(onChange).toHaveBeenLastCalledWith({ isShared: false, grantTenantIds: [] })
    // Nothing ticked yet is still "private" as a record: the picker must show anyway.
    expect(screen.getByRole('combobox', { name: 'Visibility' })).toHaveTextContent('Selected tenants')
    expect(await screen.findByLabelText('Tenants')).toBeInTheDocument()

    cleanup()
    renderWithProviders(<CatalogVisibilityField value={{ isShared: false, grantTenantIds: ['t-msp'] }} onChange={onChange} />)
    const picker = await screen.findByLabelText('Tenants')
    await waitFor(() => expect(screen.getByText('MSP')).toBeInTheDocument())
    await userEvent.click(picker)
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).queryByText('Default')).toBeNull()
    await userEvent.click(within(listbox).getByText('Acme'))
    expect(onChange).toHaveBeenLastCalledWith({ isShared: false, grantTenantIds: ['t-msp', 't-acme'] })
  })

  it('"all tenants" sets the shortcut flag, "private" clears the grants', async () => {
    const onChange = vi.fn()
    renderWithProviders(<CatalogVisibilityField value={{ isShared: false, grantTenantIds: ['t-msp'] }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Visibility' }))
    await userEvent.click(screen.getByRole('option', { name: 'All tenants' }))
    expect(onChange).toHaveBeenLastCalledWith({ isShared: true, grantTenantIds: ['t-msp'] })

    await userEvent.click(screen.getByRole('combobox', { name: 'Visibility' }))
    await userEvent.click(screen.getByRole('option', { name: 'Private (provider only)' }))
    expect(onChange).toHaveBeenLastCalledWith({ isShared: false, grantTenantIds: [] })
  })

  it('mentions the per-vDC grants that are managed on the vDC', () => {
    renderWithProviders(<CatalogVisibilityField value={{ isShared: false, grantTenantIds: [] }} onChange={() => {}} vdcGrantCount={2} />)
    expect(screen.getByText(/Also granted to 2 vDCs/)).toBeInTheDocument()
  })
})

describe('visibilityBadge', () => {
  const t = (key: string, values?: Record<string, number>) => {
    const n = values?.count ?? 0
    switch (key) {
      case 'templates.catalog.visibilityChipEveryone': return 'All tenants'
      case 'templates.catalog.visibilityChipPrivate': return 'Private'
      case 'templates.catalog.visibilityTenantsCount': return `${n} tenant${n === 1 ? '' : 's'}`
      case 'templates.catalog.visibilityVdcsCount': return `${n} vDC${n === 1 ? '' : 's'}`
      default: return key
    }
  }

  it('summarises who sees the entry', () => {
    expect(visibilityBadge(t, { isShared: true })).toEqual({ label: 'All tenants', color: 'success' })
    expect(visibilityBadge(t, { isShared: false, grants: { tenantIds: [], vdcIds: [] } })).toEqual({ label: 'Private', color: 'default' })
    expect(visibilityBadge(t, { isShared: false, grants: { tenantIds: ['a'], vdcIds: ['x', 'y'] } })).toEqual({ label: '1 tenant, 2 vDCs', color: 'info' })
    expect(visibilityBadge(t, { isShared: false, grants: { tenantIds: [], vdcIds: ['x'] } })).toEqual({ label: '1 vDC', color: 'info' })
  })
})
