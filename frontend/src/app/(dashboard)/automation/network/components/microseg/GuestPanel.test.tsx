/**
 * GuestPanel: the firewall log of a guest clicked on the map, newest lines first, a page of 20 at a time, a search over
 * the 2000 newest lines read once, and a live mode that reads the new lines every 5 s for 10 minutes at most.
 */
import { act } from 'react'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor, within } from '@/__tests__/setup/renderWithProviders'
import type { GuestLogPage } from '@/lib/api/firewall'
import { parseFirewallLogLine } from '@/lib/firewall/logParse'

import GuestPanel, { LIVE_EVERY_MS, LIVE_FOR_MS, LOG_PAGE_SIZE, SEARCH_LINES, lineSummary, matchLines, newestFirst } from './GuestPanel'
import type { MapMember } from './zoneGraph'

const getGuestLogPage = vi.fn<(...args: unknown[]) => Promise<GuestLogPage>>()
const getGuestLogAfter = vi.fn<(...args: unknown[]) => Promise<GuestLogPage>>()

vi.mock('@/lib/api/firewall', () => ({
  getGuestLogPage: (...args: unknown[]) => getGuestLogPage(...args),
  getGuestLogAfter: (...args: unknown[]) => getGuestLogAfter(...args),
}))

const GUEST: MapMember = { key: 'qemu/100', name: 'web-1', vmid: 100, node: 'pve1', type: 'qemu', status: 'running', ips: ['10.0.0.1'], pending: false }

/** A line as PVE writes it, `n` its number, `port` its destination port. */
const raw = (n: number, port = 443, src = '10.0.0.9') =>
  `100 6 tap100i0-IN 18/Nov/2026:17:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')} +0100 ACCEPT: IN=fwbr100i0 OUT=fwbr100i0 SRC=${src} DST=10.0.0.1 LEN=60 PROTO=TCP SPT=33238 DPT=${port}`
const page = (total: number, from: number, to: number, port?: (n: number) => number): GuestLogPage => ({
  total,
  lines: Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => ({ n: from + i, t: raw(from + i, port?.(from + i)) })),
})
const shown = () => screen.queryAllByRole('listitem').filter(e => e.hasAttribute('data-log-line'))
const render = () => renderWithProviders(<GuestPanel guest={GUEST} connectionId='c1' onClose={vi.fn()} />)

beforeEach(() => {
  getGuestLogPage.mockReset()
  getGuestLogAfter.mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('helpers', () => {
  it('turns a page into its lines, newest first, a line in another shape kept raw', () => {
    const lines = newestFirst({ total: 2, lines: [{ n: 1, t: raw(1) }, { n: 2, t: 'not a firewall line' }] })
    expect(lines.map(l => l.key)).toEqual([2, 1])
    expect(lines[0].parsed).toBeNull()
    expect(lines[1].parsed?.dport).toBe(443)
    expect(newestFirst(null)).toEqual([])
  })

  it('sums a line up as source, destination with its port, and protocol', () => {
    expect(lineSummary(parseFirewallLogLine(raw(1))!)).toBe('10.0.0.9 → 10.0.0.1:443 tcp')
    expect(lineSummary({ ...parseFirewallLogLine(raw(1))!, dst: undefined, dport: undefined, proto: undefined })).toBe('10.0.0.9')
  })

  it('keeps the lines holding every word of the search, any case', () => {
    const lines = newestFirst(page(3, 1, 3, n => (n === 2 ? 22 : 443)))
    expect(matchLines(lines, ' ').length).toBe(3)
    expect(matchLines(lines, 'DPT=22').map(l => l.key)).toEqual([2])
    expect(matchLines(lines, 'accept dpt=443').map(l => l.key)).toEqual([3, 1])
  })
})

describe('GuestPanel', () => {
  it('shows the newest lines first with the count, and reads a later page with the count handed back', async () => {
    getGuestLogPage.mockResolvedValueOnce(page(45, 26, 45)).mockResolvedValueOnce(page(45, 6, 25))
    render()
    expect(await screen.findByRole('complementary', { name: 'Guest web-1' })).toBeTruthy()
    await waitFor(() => expect(shown()).toHaveLength(LOG_PAGE_SIZE))
    expect(getGuestLogPage).toHaveBeenCalledWith('c1', GUEST, 0, LOG_PAGE_SIZE, undefined)
    expect(shown()[0].textContent).toContain('10.0.0.9 → 10.0.0.1:443 tcp')
    expect(screen.getByText('1-20 of 45')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(getGuestLogPage).toHaveBeenLastCalledWith('c1', GUEST, 1, LOG_PAGE_SIZE, 45))
    await waitFor(() => expect(screen.getByText('21-40 of 45')).toBeTruthy())
  })

  it('reads the guest of a shared policy through its own cluster', async () => {
    getGuestLogPage.mockResolvedValue(page(0, 1, 0))
    renderWithProviders(<GuestPanel guest={{ ...GUEST, cluster: { id: 'c2', name: 'PVE-B' } }} connectionId='c1' onClose={vi.fn()} />)
    expect(await screen.findByText('No line in the firewall log of this guest.')).toBeTruthy()
    expect(getGuestLogPage).toHaveBeenCalledWith('c2', expect.objectContaining({ vmid: 100 }), 0, LOG_PAGE_SIZE, undefined)
    expect(screen.getByText('100 · pve1 · PVE-B')).toBeTruthy()
  })

  it('says why the log could not be read, and reads it again on Refresh', async () => {
    getGuestLogPage.mockRejectedValueOnce(new Error('PVE 500')).mockResolvedValueOnce(page(3, 1, 3))
    render()
    expect(await screen.findByText('The log could not be read: PVE 500')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Read the newest lines again' }))
    await waitFor(() => expect(shown()).toHaveLength(3))
    expect(getGuestLogPage).toHaveBeenCalledTimes(2)
  })

  it('searches the 2000 newest lines read once, filtering in the browser while typing', async () => {
    getGuestLogPage.mockResolvedValueOnce(page(5000, 4981, 5000)).mockResolvedValueOnce(page(5000, 3001, 5000, n => (n % 10 === 0 ? 22 : 443)))
    render()
    await waitFor(() => expect(shown()).toHaveLength(LOG_PAGE_SIZE))
    const box = screen.getByRole('textbox', { name: /Search the log/ })

    fireEvent.change(box, { target: { value: 'DPT=22' } })
    expect(await screen.findByText('200 lines found in the 2,000 newest')).toBeTruthy()
    expect(getGuestLogPage).toHaveBeenLastCalledWith('c1', GUEST, 0, SEARCH_LINES, 5000)
    expect(shown()).toHaveLength(LOG_PAGE_SIZE)

    fireEvent.change(box, { target: { value: 'DPT=22 nothing' } })
    expect(await screen.findByText('No line found in the 2,000 newest')).toBeTruthy()
    fireEvent.change(box, { target: { value: '' } })
    fireEvent.change(box, { target: { value: 'dpt=443' } })
    expect(await screen.findByText('1,800 lines found in the 2,000 newest')).toBeTruthy()
    // The page and the block of the search: no other read.
    expect(getGuestLogPage).toHaveBeenCalledTimes(2)
  })

  it('shows the new lines every 5 s in live mode, one read each, then stops after 10 minutes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    getGuestLogPage.mockResolvedValue(page(40, 21, 40))
    getGuestLogAfter.mockResolvedValueOnce(page(42, 41, 42, () => 8080)).mockResolvedValue(page(42, 1, 0))
    render()
    await waitFor(() => expect(shown()).toHaveLength(LOG_PAGE_SIZE))

    fireEvent.click(screen.getByRole('button', { name: 'Live' }))
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_EVERY_MS) })
    expect(getGuestLogAfter).toHaveBeenCalledWith('c1', GUEST, 40, 200)
    await waitFor(() => expect(shown()[0].textContent).toContain(':8080'))
    expect(shown()).toHaveLength(LOG_PAGE_SIZE)
    // The next read starts after the lines already shown.
    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_EVERY_MS) })
    expect(getGuestLogAfter).toHaveBeenLastCalledWith('c1', GUEST, 42, 200)

    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_FOR_MS) })
    expect(await screen.findByText('Live mode stopped after 10 minutes.')).toBeTruthy()
    const reads = getGuestLogAfter.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_EVERY_MS * 3) })
    expect(getGuestLogAfter).toHaveBeenCalledTimes(reads)
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy()
  })

  it('reads nothing while the tab is hidden, starts over on a rotated log, and stops on its button', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    getGuestLogPage.mockResolvedValue(page(40, 21, 40))
    // The log was rotated: 5 lines in the new file.
    getGuestLogAfter.mockResolvedValueOnce(page(5, 1, 0)).mockRejectedValueOnce(new Error('PVE busy')).mockResolvedValue(page(5, 1, 0))
    render()
    await waitFor(() => expect(shown()).toHaveLength(LOG_PAGE_SIZE))
    fireEvent.click(screen.getByRole('button', { name: 'Live' }))

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_EVERY_MS * 2) })
    expect(getGuestLogAfter).not.toHaveBeenCalled()
    hidden.mockRestore()

    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_EVERY_MS) })
    expect(getGuestLogAfter).toHaveBeenCalledWith('c1', GUEST, 40, 200)
    await waitFor(() => expect(shown()).toHaveLength(0))
    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_EVERY_MS) })
    // After the rotation the next read starts from the newest lines of the new file.
    expect(getGuestLogAfter).toHaveBeenLastCalledWith('c1', GUEST, 0, 200)
    expect(await screen.findByText('The log could not be read: PVE busy')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Stop the live mode' }))
    const reads = getGuestLogAfter.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_EVERY_MS * 2) })
    expect(getGuestLogAfter).toHaveBeenCalledTimes(reads)
    expect(within(screen.getByRole('complementary', { name: 'Guest web-1' })).getByRole('button', { name: 'Next page' })).toBeTruthy()
  })
})
