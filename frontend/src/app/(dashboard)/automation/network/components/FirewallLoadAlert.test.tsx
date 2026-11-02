/**
 * The alert the tabs show when the firewall data of the connection could not be loaded (#1022): without it a
 * failed load reads as an empty cluster.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import FirewallLoadAlert from './FirewallLoadAlert'

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
})
