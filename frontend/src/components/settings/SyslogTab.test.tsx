import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

// SyslogTab is a thin wrapper: heading + description text plus the real
// destinations card. The card has its own fetches and its own test file, so
// it is mocked out here to keep this test scoped to the wrapper's own lines.
vi.mock('./SyslogDestinationsCard', () => ({
  default: () => <div data-testid='syslog-destinations-card' />,
}))

import SyslogTab from './SyslogTab'

afterEach(() => {
  cleanup()
})

describe('SyslogTab', () => {
  it('renders the tab heading and mounts the destinations card', async () => {
    renderWithProviders(<SyslogTab />)

    expect(await screen.findByText('Syslog / SIEM forwarding')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Every audit entry is forwarded in real time to the collectors below, with the ProxCenter user behind the action. Retention and search happen in your SIEM.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByTestId('syslog-destinations-card')).toBeInTheDocument()
  })
})
