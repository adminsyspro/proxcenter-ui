import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import CephHealthCheckDetail from './CephHealthCheckDetail'

/*
   ui#1164: the detail lines of a Ceph health check, under its summary, so a
   `host pve3 has flags noout` shows under the OSD_FLAGS warning.
*/

afterEach(() => cleanup())

describe('CephHealthCheckDetail', () => {
  it('renders each detail line as its own caption, from PVE objects or plain strings', () => {
    renderWithProviders(<CephHealthCheckDetail detail={[{ message: 'host pve3 has flags noout' }, 'osd.4 has flags nodown']} />)

    const block = screen.getByTestId('ceph-health-detail')
    expect(block.children).toHaveLength(2)
    expect(screen.getByText('host pve3 has flags noout')).toHaveClass('MuiTypography-caption')
    expect(screen.getByText('osd.4 has flags nodown')).toBeInTheDocument()
  })

  it('cuts after five lines and says how many more there are', () => {
    renderWithProviders(<CephHealthCheckDetail detail={Array.from({ length: 7 }, (_, i) => ({ message: `line ${i}` }))} />)

    expect(screen.getByText('line 4')).toBeInTheDocument()
    expect(screen.queryByText('line 5')).not.toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('honours a smaller cut', () => {
    renderWithProviders(<CephHealthCheckDetail detail={['a', 'b', 'c']} max={1} />)

    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.queryByText('b')).not.toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it.each([undefined, null, [], [{ message: '' }]])('renders nothing for %j', detail => {
    const { container } = renderWithProviders(<CephHealthCheckDetail detail={detail} />)

    expect(container).toBeEmptyDOMElement()
  })
})
