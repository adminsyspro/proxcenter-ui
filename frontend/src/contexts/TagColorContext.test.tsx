import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

import { SettingsContext } from '@core/contexts/settingsContext'

import { TagColorProvider, useTagColors } from './TagColorContext'

const CONN = 'conn-1'

// Whatever the datacenter is currently answering for its tag-style property.
let datacenterTagStyle = 'color-map=prod:FF0000,shape=dense,ordering=config'

const Probe = () => {
  const { getShape } = useTagColors(CONN)

  return <output data-testid='shape'>{getShape(CONN)}</output>
}

const renderWithSetting = (inventoryTagStyle?: unknown) => {
  const tree = (
    <TagColorProvider>
      <Probe />
    </TagColorProvider>
  )

  return render(
    inventoryTagStyle === undefined ? (
      tree
    ) : (
      <SettingsContext.Provider value={{ settings: { inventoryTagStyle } } as any}>{tree}</SettingsContext.Provider>
    )
  )
}

beforeEach(() => {
  datacenterTagStyle = 'color-map=prod:FF0000,shape=dense,ordering=config'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { 'tag-style': datacenterTagStyle } }),
    }) as unknown as Response)
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TagColorProvider tag shape', () => {
  it('follows the datacenter tag-style when the account is left on auto', async () => {
    const { getByTestId } = renderWithSetting('auto')

    await waitFor(() => expect(getByTestId('shape').textContent).toBe('dense'))
  })

  it('lets the account override the datacenter shape', async () => {
    const { getByTestId } = renderWithSetting('circle')

    expect(getByTestId('shape').textContent).toBe('circle')
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(getByTestId('shape').textContent).toBe('circle')
  })

  it('hides the tags when the account picks none', () => {
    const { getByTestId } = renderWithSetting('none')

    expect(getByTestId('shape').textContent).toBe('none')
  })

  it('falls back to the datacenter shape for a value this build does not know', async () => {
    const { getByTestId } = renderWithSetting('pill')

    await waitFor(() => expect(getByTestId('shape').textContent).toBe('dense'))
  })

  it('renders outside a SettingsProvider, on the shipped default shape', async () => {
    datacenterTagStyle = ''

    const { getByTestId } = renderWithSetting()

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(getByTestId('shape').textContent).toBe('full')
  })
})
