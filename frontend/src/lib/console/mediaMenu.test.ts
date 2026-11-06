// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FetchLike, GuestRef } from './media'
import { mountMediaMenu, type MediaMenu } from './mediaMenu'

const REF: GuestRef = { connId: 'c1', type: 'qemu', node: 'pve1', vmid: '110' }
const BASE = '/api/v1/connections/c1'
const CONFIG = `GET ${BASE}/guests/qemu/pve1/110/config`
const PUT = `PUT ${BASE}/guests/qemu/pve1/110/config`
const STORAGES = `GET ${BASE}/nodes/pve1/storages?content=iso`
const LOCAL = `GET ${BASE}/nodes/pve1/storage/local/content?content=iso`

type Reply = { status?: number; body?: unknown }

function server(initial: Record<string, unknown>) {
  let config: Record<string, unknown> = { ...initial, digest: 'd1' }
  const puts: Record<string, string>[] = []
  let putReply: Reply | null = null
  const fn = vi.fn<FetchLike>(async (url, init) => {
    const key = `${init?.method ?? 'GET'} ${url}`
    let reply: Reply

    if (key === CONFIG) reply = { body: { data: config } }
    else if (key === STORAGES) reply = { body: { data: [{ storage: 'local', content: 'iso' }] } }
    else if (key === LOCAL) reply = { body: { data: [{ volid: 'local:iso/a.iso' }, { volid: 'local:iso/virtio.iso' }] } }
    else if (key === PUT) {
      const body = JSON.parse(init?.body ?? '{}')

      puts.push(body)
      if (putReply) reply = putReply
      else {
        const { digest: _d, ...rest } = body

        config = { ...config, ...rest, digest: `d${puts.length + 1}` }
        reply = { body: { data: null } }
      }
    } else reply = { status: 404, body: { error: `no route ${key}` } }

    const status = reply.status ?? 200

    return { ok: status < 300, status, json: async () => reply.body }
  })

  return {
    fn,
    puts,
    refuseNextPut(r: Reply) { putReply = r },
  }
}

let menu: MediaMenu | null = null
let toolbar: HTMLDivElement
let buttons: HTMLDivElement

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = '<div id="toolbar"><div class="buttons"><button id="other">Paste</button></div></div><div id="screen"></div>'
  toolbar = document.getElementById('toolbar') as HTMLDivElement
  buttons = toolbar.querySelector('.buttons') as HTMLDivElement
})

afterEach(() => {
  menu?.destroy()
  menu = null
})

function mount(fn: FetchLike, onClose?: () => void, ref: GuestRef = REF) {
  menu = mountMediaMenu({ doc: document, container: buttons, host: toolbar, ref, fetchFn: fn, onClose })

  return menu
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

async function settle() {
  for (let i = 0; i < 5; i++) await flush()
}

function rows() {
  return Array.from(menu!.panel.querySelectorAll('.pxc-media-row')) as HTMLDivElement[]
}

function statusText() {
  return menu!.panel.querySelector('.pxc-media-status')!
}

describe('mountMediaMenu', () => {
  it('is not mounted for a container', () => {
    expect(mount(server({}).fn, undefined, { ...REF, type: 'lxc' })).toBeNull()
    expect(toolbar.querySelector('.pxc-media-btn')).toBeNull()
  })

  it('puts the button first in the toolbar and injects its style once', () => {
    const s = server({})

    mount(s.fn)
    expect(buttons.firstElementChild?.classList.contains('pxc-media-btn')).toBe(true)
    expect(toolbar.classList.contains('pxc-media-host')).toBe(true)
    menu!.destroy()
    mount(s.fn)
    expect(document.querySelectorAll('#pxc-media-style')).toHaveLength(1)
    expect(menu!.panel.hidden).toBe(true)
    expect(s.fn).not.toHaveBeenCalled()
  })

  it('reads on open and lists one row per optical drive', async () => {
    const s = server({ ide2: 'local:iso/a.iso,media=cdrom', sata0: 'cdrom', scsi0: 'local-lvm:vm-110-disk-0' })

    mount(s.fn)
    menu!.button.click()
    expect(menu!.isOpen()).toBe(true)
    expect(menu!.button.getAttribute('aria-expanded')).toBe('true')
    await settle()

    const [ide2, sata0] = rows()

    expect(rows()).toHaveLength(2)
    expect(ide2.querySelector('.pxc-media-slot')?.textContent).toBe('IDE 2')
    const select = ide2.querySelector('select') as HTMLSelectElement

    expect(select.value).toBe('local:iso/a.iso')
    expect(Array.from(select.options).map(o => o.value)).toEqual(['none', 'local:iso/a.iso', 'local:iso/virtio.iso'])
    expect(select.querySelector('optgroup')?.label).toBe('local')
    expect((sata0.querySelector('select') as HTMLSelectElement).value).toBe('cdrom')
    expect(statusText().textContent).toBe('')
  })

  it('mounts the chosen ISO with the digest it read, then re-reads', async () => {
    const s = server({ ide2: 'none,media=cdrom' })

    mount(s.fn)
    await menu!.open()
    const row = rows()[0]
    const eject = row.querySelector('button') as HTMLButtonElement

    expect(eject.disabled).toBe(true)
    const select = row.querySelector('select') as HTMLSelectElement

    select.value = 'local:iso/virtio.iso'
    select.dispatchEvent(new Event('change'))
    expect(statusText().textContent).toBe('Mounting virtio.iso...')
    await settle()

    expect(s.puts).toEqual([{ ide2: 'local:iso/virtio.iso,media=cdrom', digest: 'd1' }])
    expect((rows()[0].querySelector('select') as HTMLSelectElement).value).toBe('local:iso/virtio.iso')
    expect((rows()[0].querySelector('button') as HTMLButtonElement).disabled).toBe(false)
    expect(statusText().textContent).toBe('virtio.iso mounted in IDE 2')
    expect(statusText().className).toContain('ok')
  })

  it('ejects', async () => {
    const s = server({ ide2: 'local:iso/a.iso,media=cdrom' })

    mount(s.fn)
    await menu!.open()
    ;(rows()[0].querySelector('button') as HTMLButtonElement).click()
    expect(statusText().textContent).toBe('Ejecting IDE 2...')
    await settle()

    expect(s.puts).toEqual([{ ide2: 'none,media=cdrom', digest: 'd1' }])
    expect(statusText().textContent).toBe('IDE 2 ejected')
    expect((rows()[0].querySelector('select') as HTMLSelectElement).value).toBe('none')
    expect((rows()[0].querySelector('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('ignores re-selecting the current medium or the host drive', async () => {
    const s = server({ ide2: 'cdrom' })

    mount(s.fn)
    await menu!.open()
    const select = rows()[0].querySelector('select') as HTMLSelectElement

    select.dispatchEvent(new Event('change'))
    await settle()
    expect(s.puts).toEqual([])
  })

  it('shows the refusal and what the drive really holds', async () => {
    const s = server({ ide2: 'local:iso/a.iso,media=cdrom' })

    s.refuseNextPut({ status: 403, body: { error: 'Permission denied' } })
    mount(s.fn)
    await menu!.open()
    const select = rows()[0].querySelector('select') as HTMLSelectElement

    select.value = 'local:iso/virtio.iso'
    select.dispatchEvent(new Event('change'))
    await settle()

    expect(statusText().textContent).toBe('Permission denied')
    expect(statusText().className).toContain('error')
    const fresh = rows()[0].querySelector('select') as HTMLSelectElement

    expect(fresh.value).toBe('local:iso/a.iso')
    expect(fresh.disabled).toBe(false)
  })

  it('explains a stale digest instead of echoing the route', async () => {
    const s = server({ ide2: 'none,media=cdrom' })

    s.refuseNextPut({ status: 409, body: { error: 'VM configuration changed; reload before saving' } })
    mount(s.fn)
    await menu!.open()
    const select = rows()[0].querySelector('select') as HTMLSelectElement

    expect(select.style.maxWidth).toBe('none')
    select.value = 'local:iso/a.iso'
    select.dispatchEvent(new Event('change'))
    await settle()
    expect(statusText().textContent).toBe('The VM changed meanwhile: drives re-read, choose again.')
  })

  it('tells when the VM has no optical drive', async () => {
    const s = server({ scsi0: 'local-lvm:vm-110-disk-0' })

    mount(s.fn)
    await menu!.open()
    expect(rows()).toHaveLength(0)
    expect(menu!.panel.textContent).toContain('no CD/DVD drive')
  })

  it('tells when no ISO is available', async () => {
    const fn = vi.fn<FetchLike>(async url => ({
      ok: true,
      status: 200,
      json: async () => (url.endsWith('/config') ? { data: { ide2: 'none,media=cdrom' } } : { data: [] }),
    }))

    mount(fn)
    await menu!.open()
    expect(statusText().textContent).toBe('No ISO image available on this node.')
  })

  it('reports a config it cannot read', async () => {
    const fn = vi.fn<FetchLike>(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) }))

    mount(fn)
    await menu!.open()
    expect(statusText().textContent).toBe('Cannot read the drives: Forbidden')
  })

  it('closes on Escape, outside click and second button click, handing focus back', async () => {
    const onClose = vi.fn()

    mount(server({ ide2: 'none,media=cdrom' }).fn, onClose)

    await menu!.open()
    menu!.panel.querySelector('select')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(menu!.isOpen()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(menu!.isOpen()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(menu!.isOpen()).toBe(false)
    expect(menu!.button.getAttribute('aria-expanded')).toBe('false')

    await menu!.open()
    document.getElementById('screen')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(menu!.isOpen()).toBe(false)

    menu!.button.click()
    await settle()
    menu!.button.click()
    expect(menu!.isOpen()).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(3)

    menu!.close()
    expect(onClose).toHaveBeenCalledTimes(3)
    document.getElementById('screen')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })

  it('drops a read that lands after the panel closed', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const fn = vi.fn<FetchLike>(async () => {
      await gate

      return { ok: true, status: 200, json: async () => ({ data: { ide2: 'none,media=cdrom' } }) }
    })

    mount(fn)
    const opening = menu!.open()

    menu!.close()
    release()
    await opening
    expect(rows()).toHaveLength(0)
  })

  it('keeps the panel inside the window near the right edge', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })
    mount(server({ ide2: 'none,media=cdrom' }).fn)
    vi.spyOn(menu!.panel, 'getBoundingClientRect').mockReturnValue({ right: 500 } as DOMRect)
    await menu!.open()
    expect(menu!.panel.style.right).toBe('8px')
    expect(menu!.panel.style.left).toBe('')
  })
})
