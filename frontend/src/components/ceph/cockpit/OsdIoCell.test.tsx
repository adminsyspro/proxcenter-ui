import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'

import type { OsdIoPoint } from '@/lib/ceph/osdIo'
import en from '@/messages/en.json'

import OsdIoCell from './OsdIoCell'

const p = (time: number, readOps = 120, writeOps = 8.5, readBytes = 3 * 1024 * 1024, writeBytes = 512): OsdIoPoint => ({ time, readOps, writeOps, readBytes, writeBytes })

function renderCell(props: Partial<Parameters<typeof OsdIoCell>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
      <ThemeProvider theme={createTheme()}>
        <OsdIoCell kind='ops' current={p(2)} series={[p(1), p(2)]} state='ok' port={9926} session {...props} />
      </ThemeProvider>
    </NextIntlClientProvider>,
  )
}

afterEach(cleanup)

describe('OsdIoCell', () => {
  it('shows the current read and write IOPS and a two-line curve, read solid and write dashed', () => {
    renderCell()
    const cell = screen.getByTestId('osd-io-cell')

    expect(cell).toHaveTextContent('R 120 W 8.5')
    expect(cell).toHaveAttribute('aria-label', 'Read 120, write 8.5 (curve since this page was opened)')
    const lines = cell.querySelectorAll('polyline')

    expect(lines).toHaveLength(2)
    expect(lines[0].getAttribute('stroke-dasharray')).toBeNull()
    expect(lines[1].getAttribute('stroke-dasharray')).toBe('4 3')
  })

  it('shows the throughput with binary units, and the stored-history tooltip outside a session curve', () => {
    renderCell({ kind: 'bytes', session: false })
    const cell = screen.getByTestId('osd-io-cell')

    expect(cell).toHaveTextContent('R 3 MiB/s W 512 B/s')
    expect(cell).toHaveAttribute('aria-label', 'Read 3 MiB/s, write 512 B/s')
  })

  it('draws no curve under 2 points but keeps the room of the column', () => {
    renderCell({ series: [p(1)] })
    expect(screen.getByTestId('osd-io-cell')).toHaveTextContent('R 120 W 8.5')
    expect(screen.queryByTestId('sparkline')).toBeNull()
  })

  it('shows an ellipsis while no rate exists yet', () => {
    renderCell({ current: undefined, series: [] })
    expect(screen.getByTestId('osd-io-measuring')).toHaveTextContent('…')
  })

  it('a down OSD with no rate shows a dash, not the ellipsis of a measure in progress', () => {
    renderCell({ current: undefined, series: [], up: false })
    expect(screen.getByTestId('osd-io-down')).toHaveTextContent('–')
    expect(screen.queryByTestId('osd-io-measuring')).toBeNull()
  })

  it('a node without exporter shows a dash that points to the help, with the port of the connection', () => {
    renderCell({ state: 'down', current: undefined, series: [], port: 9100 })
    const cell = screen.getByTestId('osd-io-absent')

    expect(cell).toHaveTextContent('–')
    expect(cell.getAttribute('aria-label')).toContain('ceph-exporter')
    expect(cell.getAttribute('aria-label')).toContain('9100')
  })

  it('a node down names the reason in the tooltip: refused, timeout, invalid; no reason or no node is the generic text', () => {
    const label = () => screen.getByTestId('osd-io-absent').getAttribute('aria-label')
    const down = { state: 'down', current: undefined, series: [], port: 9100, node: 'pve2' } as const

    renderCell({ ...down, reason: 'refused' })
    expect(label()).toBe('Nothing listens on port 9100 of pve2: the ceph-exporter package is not installed or its service is stopped.')
    cleanup()
    renderCell({ ...down, reason: 'timeout' })
    expect(label()).toBe('pve2 does not answer on port 9100: open this port from ProxCenter in the firewall.')
    cleanup()
    renderCell({ ...down, reason: 'invalid' })
    expect(label()).toBe('Port 9100 of pve2 does not return ceph-exporter metrics: check the port set on the connection.')
    cleanup()
    renderCell({ ...down, reason: null })
    expect(label()).toContain('install the ceph-exporter package')
    cleanup()
    renderCell({ ...down, node: null, reason: 'refused' })
    expect(label()).toContain('install the ceph-exporter package')
  })

  it('a failed reading and an OSD without node are a dash with their own explanation', () => {
    renderCell({ state: 'error', current: undefined, series: [] })
    expect(screen.getByTestId('osd-io-absent')).toHaveAttribute('aria-label', en.cephCockpit.osd.io.unavailable)
    cleanup()
    renderCell({ noNode: true, state: 'pending', current: undefined, series: [] })
    expect(screen.getByTestId('osd-io-absent')).toHaveAttribute('aria-label', en.cephCockpit.osd.io.noNode)
  })
})
