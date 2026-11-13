/**
 * Component tests for VdcGpuQuotaEditor (#672): the provider-side editor of a
 * vDC's per-profile GPU contingent, mounted in the vDC edit dialog.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor, within } from '@/__tests__/setup/renderWithProviders'
import LicenseContext from '@/contexts/LicenseContext'
import VdcGpuQuotaEditor, { type VdcGpuQuotaHandle } from '@/components/settings/VdcGpuQuotaEditor'

const ENTRY_A = {
  id: 'e1', kind: 'vgpu', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: 'RTXA5000-12Q',
  count: 4, held: 2, overCommitted: false,
}
const ENTRY_WHOLE = {
  id: 'e2', kind: 'whole', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: '',
  count: 1, held: 3, overCommitted: true,
}
const OFFERS = [
  { kind: 'vgpu', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: 'RTXA5000-12Q', fbMemory: 12288, freeNow: 3 },
  { kind: 'vgpu', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: 'RTXA5000-6Q', fbMemory: 6144, freeNow: 5 },
  { kind: 'whole', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: '', fbMemory: null, freeNow: 1 },
]

let getView: any
let getStatus: number
let putStatus: number
let putView: any
let putBody: any

function jsonRes(body: any, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

function mockFetch() {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      putBody = JSON.parse(String(init.body))
      return putStatus === 200 ? jsonRes({ data: putView }) : jsonRes({ error: 'invalid_body' }, putStatus)
    }
    return getStatus === 200 ? jsonRes({ data: getView }) : jsonRes({ error: 'not_found' }, getStatus)
  }))
}

let handle: VdcGpuQuotaHandle | null
let invalid: boolean | undefined

function renderEditor(licensed = true, vdcId: string | null = 'v1') {
  const value: any = { hasFeature: () => licensed }
  return renderWithProviders(
    <LicenseContext.Provider value={value}>
      <VdcGpuQuotaEditor
        vdcId={vdcId}
        ref={(h) => { handle = h }}
        onInvalidChange={(v) => { invalid = v }}
      />
    </LicenseContext.Provider>,
  )
}

/** The dialog's save, as VdcTab calls it. */
async function save(id = 'v1') {
  let ok: boolean | undefined
  await act(async () => { ok = await handle!.save(id) })
  return ok
}

const gpuSwitch = () => screen.getByRole('checkbox', { name: 'GPU / vGPU' }) as HTMLInputElement

const lines = () => screen.queryAllByTestId('gpu-quota-row')

/** Opens the profile picker of one line and returns its options. */
async function openPicker(line: HTMLElement) {
  fireEvent.mouseDown(within(line).getByRole('combobox', { name: 'GPU profile' }))
  return screen.findAllByRole('option')
}

beforeEach(() => {
  getView = { entries: [ENTRY_A, ENTRY_WHOLE], offers: OFFERS, readable: true }
  getStatus = 200
  putStatus = 200
  putView = { entries: [{ ...ENTRY_A, id: 'n1' }], offers: OFFERS, readable: true }
  putBody = undefined
  handle = null
  invalid = undefined
  mockFetch()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('VdcGpuQuotaEditor', () => {
  it('puts the switch, the count and the picker of the first profile on the row itself, one line per profile', async () => {
    renderEditor()
    await waitFor(() => expect(lines()).toHaveLength(2))
    const [first, second] = lines()
    expect(within(first).getByRole('checkbox', { name: 'GPU / vGPU' })).toBeTruthy()
    expect(within(first).getByText('Enabled')).toBeTruthy()
    expect(within(first).getByText('RTXA5000-12Q')).toBeTruthy()
    expect((within(first).getByRole('spinbutton') as HTMLInputElement).value).toBe('4')
    expect(within(first).getByText('Held 2 · 12 GB')).toBeTruthy()
    expect(within(second).queryByRole('checkbox')).toBeNull()
    // An invisible copy of the label and switch keeps the next lines in the same columns.
    expect(second.querySelector('[aria-hidden="true"] .MuiSwitch-root')).toBeTruthy()
    expect(within(second).getByText('RTX A5000 · Whole card')).toBeTruthy()
    expect(within(second).getByText('Held 3')).toBeTruthy()
    expect(within(first).queryByRole('button', { name: 'Add a GPU profile' })).toBeNull()
    expect(within(second).getByRole('button', { name: 'Add a GPU profile' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('flags an over-committed line with the alert color', async () => {
    renderEditor()
    const flag = await screen.findByText('Held 3')
    expect(flag.getAttribute('data-over')).toBe('true')
    expect(screen.getByText('Held 2 · 12 GB').getAttribute('data-over')).toBe('false')
    expect(screen.getAllByText('Over quota').length).toBe(1)
    expect(screen.queryByText(/Held more than the contingent/i)).toBeNull()
    fireEvent.mouseOver(screen.getByText('Over quota'))
    expect(await screen.findByText(/Held more than the contingent/i)).toBeTruthy()
  })

  it('starts switched off without any entry, with nothing but the switch, and on shows one empty line', async () => {
    getView = { entries: [], offers: OFFERS, readable: true }
    renderEditor()
    await waitFor(() => expect(gpuSwitch().disabled).toBe(false))
    expect(gpuSwitch().checked).toBe(false)
    expect(screen.getByText('Disabled')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('spinbutton')).toBeNull()
    fireEvent.click(gpuSwitch())
    expect(lines()).toHaveLength(1)
    expect(screen.getByText('Choose a profile')).toBeTruthy()
    const count = screen.getByRole('spinbutton') as HTMLInputElement
    expect(count.value).toBe('')
    expect(count.getAttribute('aria-invalid')).toBe('false')
    expect(invalid).toBe(false)
    expect(screen.queryByTestId('gpu-quota-notice')).toBeNull()
  })

  it('picks a profile on the empty line with a count of 1 and writes it', async () => {
    getView = { entries: [], offers: OFFERS, readable: true }
    renderEditor()
    await waitFor(() => expect(gpuSwitch().disabled).toBe(false))
    fireEvent.click(gpuSwitch())
    const options = await openPicker(lines()[0])
    fireEvent.click(options[1])
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('1')
    expect(await save()).toBe(true)
    expect(putBody.entries).toEqual([
      { kind: 'vgpu', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: 'RTXA5000-6Q', count: 1 },
    ])
  })

  it('hides the lines when switched off and brings them back when switched on', async () => {
    renderEditor()
    await waitFor(() => expect(lines()).toHaveLength(2))
    fireEvent.click(gpuSwitch())
    expect(lines()).toHaveLength(0)
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(screen.queryByText('RTXA5000-12Q')).toBeNull()
    fireEvent.click(gpuSwitch())
    expect(lines()).toHaveLength(2)
  })

  it('warns on the row that held GPUs stay in place when switched off', async () => {
    renderEditor()
    await waitFor(() => expect(lines()).toHaveLength(2))
    expect(screen.queryByTestId('gpu-quota-notice')).toBeNull()
    fireEvent.click(gpuSwitch())
    expect(screen.getByTestId('gpu-quota-notice').textContent).toMatch(/already attached stay in place/i)
  })

  it('does not warn when switched off with nothing held', async () => {
    getView = { entries: [{ ...ENTRY_A, held: 0 }], offers: OFFERS, readable: true }
    renderEditor()
    await waitFor(() => expect(lines()).toHaveLength(1))
    fireEvent.click(gpuSwitch())
    expect(screen.queryByTestId('gpu-quota-notice')).toBeNull()
  })

  it('offers the free capacity and disables profiles used by another line', async () => {
    renderEditor()
    await waitFor(() => expect(lines()).toHaveLength(2))
    const options = await openPicker(lines()[0])
    expect(options).toHaveLength(3)
    const text = options.map((o) => o.textContent)
    expect(text[0]).toContain('3 free')
    expect(text[0]).toContain('12 GB')
    expect(text[1]).toContain('5 free')
    expect(options[0].getAttribute('aria-disabled')).not.toBe('true')
    expect(options[1].getAttribute('aria-disabled')).not.toBe('true')
    expect(options[2].getAttribute('aria-disabled')).toBe('true')
  })

  it('adds a line with the + button only once the last line has a profile', async () => {
    renderEditor()
    await waitFor(() => expect(lines()).toHaveLength(2))
    fireEvent.click(within(lines()[1]).getByRole('button', { name: 'Add a GPU profile' }))
    expect(lines()).toHaveLength(3)
    const add = within(lines()[2]).getByRole('button', { name: 'Add a GPU profile' })
    expect(add.hasAttribute('disabled')).toBe(true)
    expect((within(lines()[2]).getByRole('spinbutton') as HTMLInputElement).value).toBe('')
    expect(invalid).toBe(false)
    const options = await openPicker(lines()[2])
    fireEvent.click(options[1])
    expect(await save('v9')).toBe(true)
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe('/api/v1/vdcs/v9/gpu/quota')
    expect(putBody.entries).toEqual([
      { kind: 'vgpu', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: 'RTXA5000-12Q', count: 4 },
      { kind: 'whole', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: '', count: 1 },
      { kind: 'vgpu', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: 'RTXA5000-6Q', count: 1 },
    ])
  })

  it('does not write anything when nothing changed, nor for an empty line left blank', async () => {
    renderEditor()
    await waitFor(() => expect(lines()).toHaveLength(2))
    fireEvent.click(within(lines()[1]).getByRole('button', { name: 'Add a GPU profile' }))
    expect(await save()).toBe(true)
    expect(putBody).toBeUndefined()
  })

  it('sends the edited count and reloads from the PUT answer', async () => {
    renderEditor()
    await waitFor(() => expect(lines()).toHaveLength(2))
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '6' } })
    expect(await save()).toBe(true)
    expect(putBody.entries[0].count).toBe(6)
    await waitFor(() => expect(screen.queryByText('RTX A5000 · Whole card')).toBeNull())
    expect(screen.getByText('RTXA5000-12Q')).toBeTruthy()
  })

  it('writes an empty contingent when switched off', async () => {
    renderEditor()
    await waitFor(() => expect(lines()).toHaveLength(2))
    fireEvent.click(gpuSwitch())
    expect(await save()).toBe(true)
    expect(putBody).toEqual({ entries: [] })
  })

  it('removes a line, and removing the last one leaves an empty line', async () => {
    renderEditor()
    await waitFor(() => expect(lines()).toHaveLength(2))
    fireEvent.click(within(lines()[1]).getByRole('button', { name: 'Remove' }))
    expect(screen.queryByText('RTX A5000 · Whole card')).toBeNull()
    fireEvent.click(within(lines()[0]).getByRole('button', { name: 'Remove' }))
    expect(lines()).toHaveLength(1)
    expect(screen.getByText('Choose a profile')).toBeTruthy()
    expect(gpuSwitch().checked).toBe(true)
    await save()
    expect(putBody).toEqual({ entries: [] })
  })

  it('reports a count out of range on a picked line so the dialog can hold its save', async () => {
    renderEditor()
    await waitFor(() => expect(lines()).toHaveLength(2))
    expect(invalid).toBe(false)
    const count = screen.getAllByRole('spinbutton')[0]
    fireEvent.change(count, { target: { value: '0' } })
    await waitFor(() => expect(invalid).toBe(true))
    expect(count.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(count, { target: { value: '' } })
    expect(count.getAttribute('aria-invalid')).toBe('true')
    fireEvent.click(gpuSwitch())
    await waitFor(() => expect(invalid).toBe(false))
  })

  it('returns false and shows the error when the write is refused', async () => {
    putStatus = 400
    renderEditor()
    await waitFor(() => expect(lines()).toHaveLength(2))
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '5' } })
    expect(await save()).toBe(false)
    expect(screen.getByTestId('gpu-quota-notice').textContent).toMatch(/Could not save the GPU contingent/i)
    expect(screen.getByText('RTXA5000-12Q')).toBeTruthy()
  })

  it('keeps the lines, hides what they hold and disables adding when the cluster is unreadable', async () => {
    getView = { entries: [ENTRY_A], offers: [], readable: false }
    renderEditor()
    expect(await screen.findByText('RTXA5000-12Q')).toBeTruthy()
    expect(screen.getByText(/cannot be read/i)).toBeTruthy()
    expect(screen.queryByText(/^Held/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Add a GPU profile' }).hasAttribute('disabled')).toBe(true)
  })

  describe('promised against the cluster (ceiling, not reservation)', () => {
    const KEY = '0x10de:0x2231'
    const line = (id: string, profileName: string, count: number, kind = 'vgpu') => ({
      id, kind, modelKey: KEY, modelName: 'GA102GL [RTX A5000]', profileName, count, held: 0, overCommitted: false,
    })
    const offer = (profileName: string, fbMemory: number | null, kind = 'vgpu') => ({
      kind, modelKey: KEY, modelName: 'GA102GL [RTX A5000]', profileName, fbMemory, freeNow: 1,
    })
    const OFFERS_A5000 = [offer('RTXA5000-12Q', 12288), offer('RTXA5000-24Q', 24576), offer('RTXA5000-24A', 24576), offer('', null, 'whole')]
    const CAPACITY = [{ modelKey: KEY, modelName: 'GA102GL [RTX A5000]', fbTotal: 24576, wholeCards: 1, partial: false }]
    const mention = () => screen.queryByTestId('gpu-quota-overpromise-text')

    it('says 60 GB are promised for 24 GB with 12Q + 24Q + 24A on one 24 GB card, and still lets the save through', async () => {
      getView = {
        entries: [line('a', 'RTXA5000-12Q', 1), line('b', 'RTXA5000-24Q', 1), line('c', 'RTXA5000-24A', 1)],
        offers: OFFERS_A5000, capacity: CAPACITY, readable: true,
      }
      renderEditor()
      await waitFor(() => expect(lines()).toHaveLength(3))
      expect(mention()?.textContent).toBe('RTX A5000: 60 GB promised for 24 GB available on the cluster')
      // On its own line, in the count column (invisible copy of the label and switch in front).
      expect(screen.getByTestId('gpu-quota-overpromise').querySelector('[aria-hidden="true"] .MuiSwitch-root')).toBeTruthy()
      expect(invalid).toBe(false)
      fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '2' } })
      expect(mention()?.textContent).toContain('72 GB promised')
      expect(await save()).toBe(true)
      expect(putBody.entries).toHaveLength(3)
    })

    it('says nothing while the lines fit, and tells as soon as an edit goes over', async () => {
      getView = { entries: [line('a', 'RTXA5000-12Q', 2)], offers: OFFERS_A5000, capacity: CAPACITY, readable: true }
      renderEditor()
      await waitFor(() => expect(lines()).toHaveLength(1))
      expect(mention()).toBeNull()
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } })
      expect(mention()?.textContent).toContain('36 GB promised for 24 GB')
      fireEvent.click(gpuSwitch())
      expect(mention()).toBeNull()
    })

    it('counts whole cards against the cards that are not in SR-IOV mode', async () => {
      getView = { entries: [line('w', '', 3, 'whole')], offers: OFFERS_A5000, capacity: CAPACITY, readable: true }
      renderEditor()
      await waitFor(() => expect(lines()).toHaveLength(1))
      expect(mention()?.textContent).toBe('RTX A5000: 3 cards promised for 1 available')
    })

    it('does not judge a model with an unread card', async () => {
      getView = {
        entries: [line('a', 'RTXA5000-24Q', 2)], offers: OFFERS_A5000,
        capacity: [{ ...CAPACITY[0], partial: true }], readable: true,
      }
      renderEditor()
      await waitFor(() => expect(lines()).toHaveLength(1))
      expect(mention()).toBeNull()
    })

    it('marks the A and B profiles as without CUDA in the picker and on the picked value, Q first', async () => {
      getView = { entries: [line('c', 'RTXA5000-24A', 1)], offers: OFFERS_A5000, capacity: CAPACITY, readable: true }
      renderEditor()
      await waitFor(() => expect(lines()).toHaveLength(1))
      expect(within(lines()[0]).getByText('RTXA5000-24A · no CUDA')).toBeTruthy()
      const options = await openPicker(lines()[0])
      const text = options.map((o) => o.textContent)
      expect(text[0]).toContain('RTXA5000-12Q')
      expect(text[0]).not.toContain('no CUDA')
      expect(text[1]).not.toContain('no CUDA')
      expect(text[2]).toContain('RTXA5000-24A')
      expect(text[2]).toContain('no CUDA')
      expect(text[3]).not.toContain('no CUDA')
    })
  })

  describe('a cluster without GPU', () => {
    it('keeps the switch off and disabled and says so on the row, with nothing else', async () => {
      getView = { entries: [], offers: [], readable: true }
      renderEditor()
      const notice = await screen.findByTestId('gpu-quota-notice')
      expect(notice.textContent).toBe("No GPU on this vDC's cluster")
      expect(gpuSwitch().checked).toBe(false)
      expect(gpuSwitch().disabled).toBe(true)
      expect(screen.getByText('Disabled')).toBeTruthy()
      // On the switch row itself, in the next column.
      expect(notice.closest('[data-testid="gpu-quota"]')?.contains(gpuSwitch())).toBe(true)
      expect(screen.queryByRole('spinbutton')).toBeNull()
      expect(screen.queryByRole('combobox')).toBeNull()
      expect(screen.queryAllByRole('button')).toHaveLength(0)
      expect(await save()).toBe(true)
      expect(putBody).toBeUndefined()
    })

    it('keeps stored lines editable when the cards are gone, with + disabled and the reason in its tooltip', async () => {
      getView = { entries: [ENTRY_A], offers: [], readable: true }
      renderEditor()
      await waitFor(() => expect(lines()).toHaveLength(1))
      expect(gpuSwitch().disabled).toBe(false)
      const add = screen.getByRole('button', { name: 'Add a GPU profile' })
      expect(add.hasAttribute('disabled')).toBe(true)
      fireEvent.mouseOver(add.parentElement as HTMLElement)
      expect(await screen.findByText("No GPU on this vDC's cluster")).toBeTruthy()
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } })
      expect(await save()).toBe(true)
      expect(putBody.entries[0].count).toBe(2)
    })

    it('falls back to the no-GPU row once the last stored line is removed, and writes an empty contingent', async () => {
      getView = { entries: [ENTRY_A], offers: [], readable: true }
      renderEditor()
      await waitFor(() => expect(lines()).toHaveLength(1))
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
      expect(screen.getByTestId('gpu-quota-notice').textContent).toBe("No GPU on this vDC's cluster")
      expect(gpuSwitch().disabled).toBe(true)
      expect(await save()).toBe(true)
      expect(putBody).toEqual({ entries: [] })
    })
  })

  it('keeps an unreadable cluster on the single line, and an empty picker says no profile is available', async () => {
    getView = { entries: [], offers: [], readable: false }
    renderEditor()
    await waitFor(() => expect(gpuSwitch().disabled).toBe(false))
    expect(screen.queryByText("No GPU on this vDC's cluster")).toBeNull()
    fireEvent.click(gpuSwitch())
    expect(lines()).toHaveLength(1)
    const [row] = lines()
    expect(within(row).getByText(/cannot be read/i)).toBeTruthy()
    expect(within(row).getByRole('checkbox', { name: 'GPU / vGPU' })).toBeTruthy()
    const options = await openPicker(row)
    expect(options).toHaveLength(1)
    expect(options[0].textContent).toBe('No profile available')
    expect(options[0].getAttribute('aria-disabled')).toBe('true')
  })

  it('renders nothing and does not fetch without the gpu_management feature', async () => {
    const { container } = renderEditor(false)
    await new Promise((r) => setTimeout(r, 20))
    expect(container.textContent).toBe('')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([403, 404])('hides the row silently on a %i from the route', async (status) => {
    getStatus = status
    const { container } = renderEditor()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(container.textContent).toBe('')
  })

  it('shows the switch at creation, says profiles come once the vDC is saved, and writes nothing', async () => {
    renderEditor(true, null)
    expect(gpuSwitch().checked).toBe(false)
    expect(screen.queryByTestId('gpu-quota-notice')).toBeNull()
    fireEvent.click(gpuSwitch())
    expect(screen.getByTestId('gpu-quota-notice').textContent).toMatch(/once the vDC is saved/i)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(await save('vdc-new')).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows a load error on the row on any other failure and writes nothing', async () => {
    getStatus = 500
    renderEditor()
    expect(await screen.findByText(/Could not load/i)).toBeTruthy()
    expect(gpuSwitch().disabled).toBe(true)
    expect(await save()).toBe(true)
    expect(putBody).toBeUndefined()
  })
})
