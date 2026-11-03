/**
 * The alert the tabs show when the firewall data of the connection could not be loaded (#1022): without it a
 * failed load reads as an empty cluster.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import FirewallLoadAlert, { loadErrorCauses } from './FirewallLoadAlert'

afterEach(cleanup)

describe('FirewallLoadAlert', () => {
  it('says the lists may be incomplete and why, as a warning', () => {
    renderWithProviders(<FirewallLoadAlert error='HTTP 502' />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Some firewall data could not be loaded, so the lists below may be incomplete: HTTP 502')
    expect(alert.className).toContain('MuiAlert-colorWarning')
  })

  it('retries from the Retry button', () => {
    const onRetry = vi.fn()
    renderWithProviders(<FirewallLoadAlert error='HTTP 502' onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('has no Retry button without a handler', () => {
    renderWithProviders(<FirewallLoadAlert error='HTTP 502' />)
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('shows nothing without an error', () => {
    for (const error of [null, undefined, '']) {
      renderWithProviders(<FirewallLoadAlert error={error} />)
      expect(screen.queryByRole('alert')).toBeNull()
      cleanup()
    }
  })

  it('shows the first cause and how many more, with every cause under Details', () => {
    const error = 'connect ECONNREFUSED 127.0.0.1:9 · HTTP 502 · HTTP 500 · HTTP 502'
    renderWithProviders(<FirewallLoadAlert error={error} onRetry={vi.fn()} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('may be incomplete: connect ECONNREFUSED 127.0.0.1:9')
    expect(within(alert).getByText('and 2 more')).toBeTruthy()
    expect(within(alert).queryByText('HTTP 500')).toBeNull()

    fireEvent.click(within(alert).getByRole('button', { name: 'Details' }))
    expect(within(alert).getByText('HTTP 500')).toBeTruthy()
    expect(within(alert).getByText('HTTP 502')).toBeTruthy()
    expect(within(alert).getByRole('button', { name: 'Hide details' }).getAttribute('aria-expanded')).toBe('true')
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('keeps "and N more" out of the ellipsis of a long first cause', () => {
    const long = `failed to get aliases: ${'x'.repeat(400)}`
    renderWithProviders(<FirewallLoadAlert error={`${long} · HTTP 500 · HTTP 502`} />)
    const alert = screen.getByRole('alert')
    const first = within(alert).getByText(`Some firewall data could not be loaded, so the lists below may be incomplete: ${long}`)
    const more = within(alert).getByText('and 2 more')
    expect(first.contains(more)).toBe(false)
    expect(getComputedStyle(first).textOverflow).toBe('ellipsis')
    expect(getComputedStyle(more).flexShrink).toBe('0')
    expect(getComputedStyle(more).textOverflow).not.toBe('ellipsis')
  })

  it('has no Details button for a single cause', () => {
    renderWithProviders(<FirewallLoadAlert error='HTTP 502' />)
    expect(screen.queryByRole('button', { name: 'Details' })).toBeNull()
    expect(screen.getByRole('alert').textContent).not.toContain('more')
  })

  it('splits the causes the page joined, once each', () => {
    expect(loadErrorCauses('a · b · a ·  · c')).toEqual(['a', 'b', 'c'])
    expect(loadErrorCauses(null)).toEqual([])
  })
})
