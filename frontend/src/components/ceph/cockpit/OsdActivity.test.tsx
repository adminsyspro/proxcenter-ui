import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'

import { CEPH_EXPORTER_INSTALL_STEPS } from '@/lib/ceph/exporterInstall'
import type { OsdIoPoint } from '@/lib/ceph/osdIo'
import type { CephRange } from '@/lib/ceph/types'
import en from '@/messages/en.json'

import OsdActivity from './OsdActivity'

const toast = { success: vi.fn(), error: vi.fn() }
const live = vi.fn()
const history = vi.fn()
const port = vi.fn()

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))
vi.mock('./hooks/useOsdExporterLive', () => ({ useOsdExporterLive: (...a: unknown[]) => live(...a) }))
vi.mock('./hooks/useOsdIoHistory', () => ({ useOsdIoHistory: (...a: unknown[]) => history(...a) }))
vi.mock('./hooks/useCephExporterPort', () => ({ useCephExporterPort: (...a: unknown[]) => port(...a) }))

const p = (time: number, readOps = 100, writeOps = 20, readBytes = 2048 * 1024, writeBytes = 512 * 1024): OsdIoPoint => ({ time, readOps, writeOps, readBytes, writeBytes })

function renderActivity(over: Partial<{ node: string | null; enterprise: boolean; range: CephRange }> = {}) {
  return render(
    <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
      <ThemeProvider theme={createTheme()}>
        <OsdActivity conn='c1' node={'node' in over ? over.node! : 'pve1'} host='pve1' inventory={{ pveNodes: ['pve1'], pveNodeStatus: { pve1: 'online' } }} osd={0} enterprise={over.enterprise ?? false} range={over.range ?? 'live'} />
      </ThemeProvider>
    </NextIntlClientProvider>,
  )
}

beforeEach(() => {
  live.mockReset().mockReturnValue({ status: 'ok', points: [p(1000), p(6000)] })
  history.mockReset().mockReturnValue({ points: [], state: 'live' })
  port.mockReset().mockReturnValue(9926)
  toast.success.mockClear()
  toast.error.mockClear()
})

afterEach(cleanup)

describe('OsdActivity', () => {
  it('shows the latest rates: IOPS and throughput, read and write, with curves (session buffer in Community)', () => {
    renderActivity()
    expect(screen.getByTestId('osd-activity-ops')).toHaveTextContent('100')
    expect(screen.getByTestId('osd-activity-ops')).toHaveTextContent('20')
    expect(screen.getByTestId('osd-activity-bytes')).toHaveTextContent('2 MiB/s')
    expect(screen.getByTestId('osd-activity-bytes')).toHaveTextContent('512 KiB/s')
    expect(screen.getAllByTestId('sparkline')).toHaveLength(2)
    expect(screen.getByText('Real time, last 5 minutes')).toBeTruthy()
    expect(screen.queryByTestId('osd-activity-info')).toBeNull()
  })

  it('falls back to the last stored point of the period when no live rate has arrived yet', () => {
    live.mockReturnValue({ status: 'ok', points: [] })
    history.mockReturnValue({ points: [p(1000, 70, 30, 1024 * 1024, 256 * 1024), p(2000, 80, 40, 3 * 1024 * 1024, 128 * 1024)], state: 'live' })
    renderActivity({ enterprise: true, range: '24h' as CephRange })
    expect(screen.getByTestId('osd-activity-ops')).toHaveTextContent('80')
    expect(screen.getByTestId('osd-activity-ops')).toHaveTextContent('40')
    expect(screen.getByTestId('osd-activity-bytes')).toHaveTextContent('3 MiB/s')
    expect(screen.getByTestId('osd-activity-bytes')).toHaveTextContent('128 KiB/s')
  })

  it('the write curve is dashed, the read curve is not', () => {
    renderActivity()
    const lines = screen.getAllByTestId('sparkline')[0].querySelectorAll('polyline')

    expect(lines).toHaveLength(2)
    expect(lines[0].getAttribute('stroke-dasharray')).toBeNull()
    expect(lines[1].getAttribute('stroke-dasharray')).toBe('4 3')
  })

  it('under 2 points: "measuring", no value, no curve', () => {
    live.mockReturnValue({ status: 'ok', points: [] })
    renderActivity()
    expect(screen.getAllByTestId('osd-activity-measuring')).toHaveLength(2)
    expect(screen.queryByTestId('sparkline')).toBeNull()
    expect(screen.getByTestId('osd-activity-ops')).toHaveTextContent('-')
    live.mockReturnValue({ status: 'pending', points: [] })
    cleanup()
    renderActivity()
    expect(screen.getAllByTestId('osd-activity-measuring')).toHaveLength(2)
  })

  it('the curves and the "measuring" notice sit in the same tinted frame, one per panel', () => {
    renderActivity()
    const frames = screen.getAllByTestId('osd-activity-chart')

    expect(frames).toHaveLength(2)
    for (const frame of frames) expect(within(frame).getByTestId('sparkline')).toBeTruthy()
    cleanup()
    live.mockReturnValue({ status: 'ok', points: [] })
    renderActivity()

    const measuring = screen.getAllByTestId('osd-activity-measuring')
    const emptyFrames = screen.getAllByTestId('osd-activity-chart')

    expect(emptyFrames).toHaveLength(2)
    measuring.forEach((m, i) => expect(emptyFrames[i]).toContainElement(m))
  })

  it('Enterprise Live: the stored history comes first, the real-time points after it, without overlap', () => {
    history.mockReturnValue({ points: [p(-60_000, 1), p(-30_000, 2), p(3000, 3)], state: 'live' })
    live.mockReturnValue({ status: 'ok', points: [p(1000), p(6000, 40)] })
    renderActivity({ enterprise: true })
    expect(history).toHaveBeenCalledWith('c1', 0, 'live', true, true)
    expect(screen.getByText('Last hour of history, then real time')).toBeTruthy()
    // 3 stored points + the one real-time point newer than the last stored one.
    const first = screen.getAllByTestId('sparkline')[0].querySelectorAll('polyline')[0].getAttribute('points')!.split(' ')

    expect(first).toHaveLength(4)
  })

  it('Enterprise over a period: the history alone, the state of the period when there is none', () => {
    history.mockReturnValue({ points: [p(1), p(2), p(3)], state: 'ready' })
    renderActivity({ enterprise: true, range: '24h' })
    expect(screen.getByText('History over 24 h')).toBeTruthy()
    expect(screen.getAllByTestId('sparkline')).toHaveLength(2)
    cleanup()
    history.mockReturnValue({ points: [], state: 'unavailable' })
    renderActivity({ enterprise: true, range: '24h' })
    expect(screen.getAllByTestId('trend-unavailable')).toHaveLength(2)
    cleanup()
    history.mockReturnValue({ points: [], state: 'loading' })
    renderActivity({ enterprise: true, range: '7d' })
    expect(screen.getAllByTestId('trend-loading')).toHaveLength(2)
  })

  describe('exporter not reachable', () => {
    beforeEach(() => {
      live.mockReturnValue({ status: 'unreachable', points: [] })
    })

    it('information box with the port of the connection; the procedure is collapsed', () => {
      port.mockReturnValue(9100)
      renderActivity()
      expect(screen.getByTestId('osd-activity-info')).toHaveTextContent(
        'To see more precise metrics (IOPS and throughput per OSD), install the ceph-exporter package on the Ceph nodes and open port 9100 to ProxCenter.',
      )
      expect(port).toHaveBeenCalledWith('c1', true)
      expect(screen.queryByTestId('osd-activity-steps')).toBeNull()
      expect(screen.queryByTestId('osd-activity-ops')).toBeNull()
    })

    it('refused: says nothing listens on the port of the node, and proposes the installation procedure', () => {
      live.mockReturnValue({ status: 'unreachable', reason: 'refused', points: [] })
      port.mockReturnValue(9100)
      renderActivity()
      expect(screen.getByTestId('osd-activity-info')).toHaveTextContent('Nothing listens on port 9100 of pve1: the ceph-exporter package is not installed or its service is stopped.')
      expect(screen.getByRole('button', { name: 'Show the installation procedure' })).toBeTruthy()
    })

    it('timeout: asks to open the port, without the installation procedure', () => {
      live.mockReturnValue({ status: 'unreachable', reason: 'timeout', points: [] })
      port.mockReturnValue(9100)
      renderActivity()
      expect(screen.getByTestId('osd-activity-info')).toHaveTextContent('pve1 does not answer on port 9100: open this port from ProxCenter in the firewall.')
      expect(screen.queryByRole('button', { name: 'Show the installation procedure' })).toBeNull()
      expect(screen.queryByTestId('osd-activity-steps')).toBeNull()
    })

    it('invalid: points at the port set on the connection, without the installation procedure', () => {
      live.mockReturnValue({ status: 'unreachable', reason: 'invalid', points: [] })
      renderActivity()
      expect(screen.getByTestId('osd-activity-info')).toHaveTextContent('Port 9926 of pve1 does not return ceph-exporter metrics: check the port set on the connection.')
      expect(screen.queryByRole('button', { name: 'Show the installation procedure' })).toBeNull()
    })

    it('no reason (older server): the generic message and the procedure, as before', () => {
      renderActivity()
      expect(screen.getByTestId('osd-activity-info')).toHaveTextContent('To see more precise metrics')
      expect(screen.getByRole('button', { name: 'Show the installation procedure' })).toBeTruthy()
    })

    it('the procedure unfolds, is the verified one, and the button copies it', async () => {
      const writeText = vi.fn(async () => undefined)

      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
      renderActivity()
      fireEvent.click(screen.getByRole('button', { name: 'Show the installation procedure' }))
      expect((await screen.findByTestId('osd-activity-steps')).textContent).toBe(CEPH_EXPORTER_INSTALL_STEPS)
      expect(CEPH_EXPORTER_INSTALL_STEPS).toContain('--no-mon-config')
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Procedure copied'))
      expect(writeText).toHaveBeenCalledWith(CEPH_EXPORTER_INSTALL_STEPS)
    })

    it('a refused copy says so', async () => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
      renderActivity()
      fireEvent.click(screen.getByRole('button', { name: 'Show the installation procedure' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Copy' }))
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Copy failed'))
    })
  })

  it('osd_not_exported: its own message, not the installation box', () => {
    live.mockReturnValue({ status: 'not_exported', points: [] })
    renderActivity()
    expect(screen.getByTestId('osd-activity-not-exported')).toHaveTextContent('The exporter of node pve1 answers but does not report osd.0.')
    expect(screen.queryByTestId('osd-activity-info')).toBeNull()
    expect(port).toHaveBeenCalledWith('c1', false)
  })

  it('no matching PVE node: a short explanation, no installation box', () => {
    renderActivity({ node: null })
    expect(screen.getByTestId('osd-activity-nonode')).toHaveTextContent('no Proxmox node matches the host pve1')
  })

  it('a plain error (network, 5xx): a discreet "reading unavailable" line, no box, no endless measuring', () => {
    live.mockReturnValue({ status: 'error', points: [] })
    renderActivity()
    expect(screen.queryByTestId('osd-activity-info')).toBeNull()
    expect(screen.getByTestId('osd-activity-unavailable')).toHaveTextContent('Reading unavailable')
    expect(screen.queryByTestId('osd-activity-measuring')).toBeNull()
  })

  it('the node of the two messages carries its Proxmox glyph', () => {
    live.mockReturnValue({ status: 'not_exported', points: [] })
    renderActivity()
    expect(screen.getByTestId('osd-activity-not-exported').querySelector('img, svg')).not.toBeNull()
    cleanup()
    renderActivity({ node: null })
    expect(screen.getByTestId('osd-activity-nonode').querySelector('img, svg')).not.toBeNull()
  })
})
