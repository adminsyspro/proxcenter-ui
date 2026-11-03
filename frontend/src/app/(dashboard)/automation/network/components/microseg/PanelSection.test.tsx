import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'

import PanelSection, { PANEL_SECTIONS_KEY } from './PanelSection'

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

const render = () => renderWithProviders(<PanelSection id='zone.members' title='Members' count={3}><p>inside</p></PanelSection>)

describe('PanelSection', () => {
  it('opens by default with its title and count, folds and remembers it, opens again', async () => {
    render()
    const header = screen.getByTestId('section-zone.members')
    expect(header.textContent).toBe('Members3')
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('inside')).toBeTruthy()

    fireEvent.click(header)
    await waitFor(() => expect(screen.queryByText('inside')).toBeNull())
    expect(window.localStorage.getItem(PANEL_SECTIONS_KEY)).toBe('["zone.members"]')

    cleanup()
    render()
    expect(screen.getByTestId('section-zone.members').getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByTestId('section-zone.members'))
    expect(await screen.findByText('inside')).toBeTruthy()
    expect(window.localStorage.getItem(PANEL_SECTIONS_KEY)).toBe('[]')
  })

  it('stays open when the stored value is not ours', () => {
    window.localStorage.setItem(PANEL_SECTIONS_KEY, '{oops')
    render()
    expect(screen.getByTestId('section-zone.members').getAttribute('aria-expanded')).toBe('true')
  })
})
