import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import CustomImageDialog from './CustomImageDialog'

// The hardware spec inputs are the ones discussion #634 is about: they used to
// coerce every keystroke with `parseInt(e.target.value) || <default>`, so the
// field could never be emptied and a retyped value landed glued behind the old
// default ('4' over '1' gave '14'). Nothing else in the dialog needs stubbing:
// the volume browser only fetches in "PVE volume" mode, which is provider-only
// and off by default, and `useTenant()` falls back to its own default context.
const open = () => renderWithProviders(<CustomImageDialog open onClose={() => {}} />)

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement

describe('CustomImageDialog hardware spec fields', () => {
  // This suite renders repeatedly; RTL is not auto-cleaned up in this repo.
  afterEach(cleanup)

  it('lets min cores be cleared and retyped', async () => {
    open()

    const minCores = field('Min Cores')

    expect(minCores.value).toBe('1')

    await userEvent.clear(minCores)
    expect(minCores.value).toBe('')

    await userEvent.type(minCores, '4')
    expect(minCores.value).toBe('4')
  })

  it('lets min memory be cleared and retyped', async () => {
    open()

    const minMemory = field('Min Memory')

    expect(minMemory.value).toBe('512')

    await userEvent.clear(minMemory)
    expect(minMemory.value).toBe('')

    await userEvent.type(minMemory, '1024')
    expect(minMemory.value).toBe('1024')
  })

  it('restores the default when min memory is left empty', async () => {
    open()

    const minMemory = field('Min Memory')

    await userEvent.clear(minMemory)
    await userEvent.tab()

    expect(minMemory.value).toBe('512')
  })
})

// Copies of a volume image on other clusters (#44). Editing a volume image puts
// the dialog in volume mode whatever the tenant, so the copy list is reachable.
describe('CustomImageDialog copies on other clusters', () => {
  const CONNS = [{ id: 'c-prod', name: 'PVE-PROD' }, { id: 'c-dr', name: 'PVE-DR' }, { id: 'c-lab', name: 'PVE-LAB' }]
  const image = {
    id: 'img-1', name: 'Golden', sourceType: 'volume', format: 'qcow2', defaultDiskSize: '20G',
    sourceConnectionId: 'c-prod', sourceNode: 'pve1', volumeId: 'local:import/golden.qcow2',
    extraLocations: [{ connectionId: 'c-dr', node: 'pve1-dr', volumeId: 'local:import/golden.qcow2' }],
  }
  let saved: any = null

  beforeEach(() => {
    saved = null
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') { saved = JSON.parse(String(init.body)); return { json: async () => ({ data: {} }) } }
      if (url.startsWith('/api/v1/connections?')) return { json: async () => ({ data: CONNS }) }
      return { json: async () => ({ data: [] }) }
    }))
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('shows the stored copy, removes it and adds a new one before saving', async () => {
    const onClose = vi.fn()
    renderWithProviders(<CustomImageDialog open onClose={onClose} editData={image} />)

    expect(await screen.findByText('Copy on another cluster #1')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.queryByText('Copy on another cluster #1')).toBeNull()

    await userEvent.click(await screen.findByRole('button', { name: 'Add a copy on another cluster' }))
    expect(screen.getByText('Copy on another cluster #1')).toBeTruthy()
    // A copy still missing its cluster, node and volume keeps Save disabled.
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
    expect(saved).toMatchObject({ sourceType: 'volume', sourceConnectionId: 'c-prod', sourceNode: 'pve1', extraLocations: [] })
  })

  it('sends the stored copies back unchanged on a plain save', async () => {
    renderWithProviders(<CustomImageDialog open onClose={() => {}} editData={image} />)
    await screen.findByText('Copy on another cluster #1')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saved?.extraLocations).toEqual(image.extraLocations))
  })
})
