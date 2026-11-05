// vGPU profiles (#672): what a profile name and a PVE mdev type tell. Pure
// and client-safe.
import type { VisibleVgpuType } from './metricsShared'

/** "RTXA5000-12Q" -> 12 GiB of frame buffer, series Q; null for another name. */
export function parseProfile(name: string): { gib: number; series: string } | null {
  const m = /-(\d+)([A-Z])$/.exec(name.trim())
  return m ? { gib: Number(m[1]), series: m[2] } : null
}

/** "nvidia-665" -> 665. */
export function mdevTypeId(mdev: string | null | undefined): number | null {
  const m = /^nvidia-(\d+)$/.exec(mdev ?? '')
  return m ? Number(m[1]) : null
}

/**
 * Profiles that run AI work: Q (virtual workstation, CUDA) and C (compute).
 * B (virtual PC) and A (virtual applications) carry no CUDA worth the name.
 */
export const isComputeProfile = (name: string) => ['Q', 'C'].includes(parseProfile(name)?.series ?? '')

/** The profile name of a hostpci `mdev=` on a card, from the card's catalog. */
export function profileName(mdev: string | null | undefined, deviceKey: string | null, catalog: VisibleVgpuType[]): string | null {
  const id = mdevTypeId(mdev)
  if (id === null) return null
  return catalog.find(t => t.typeId === id && (!deviceKey || t.deviceKey === deviceKey))?.name ?? null
}

/** Frame buffer of a profile, MiB: the catalog first, the name otherwise. */
export function profileMemory(mdev: string | null | undefined, deviceKey: string | null, catalog: VisibleVgpuType[]): number | null {
  const id = mdevTypeId(mdev)
  const own = id === null ? null : catalog.find(t => t.typeId === id && (!deviceKey || t.deviceKey === deviceKey))
  if (own) return own.fbMemory
  const parsed = parseProfile(profileName(mdev, deviceKey, catalog) ?? '')
  return parsed ? parsed.gib * 1024 : null
}

/** One profile of a card model, across the cards of that model in the scope. */
export type ProfileRow = {
  typeId: number
  name: string
  fbMemory: number
  maxInstances: number
  /** VMs whose config holds this profile (stopped ones included: they take it back at start). */
  holders: Array<{ vmid: string; vmName: string | null; running: boolean; deviceKey: string }>
  /** How many more of this profile each card can take now, its frame buffer allowing. */
  perCard: Array<{ deviceKey: string; node: string; free: number }>
}

export type ProfileModel = {
  /** vendor:device of the cards. */
  key: string
  cards: Array<{ deviceKey: string; node: string; connectionName: string; fbTotal: number; fbPromised: number }>
  vendorId: string | null
  vendorName: string | null
  deviceName: string | null
  /** Cards of the model whose host was not read: no catalog, no capacity. */
  unread: string[]
  rows: ProfileRow[]
}

type CardLike = { key: string; node: string; connectionName: string; vendorId: string | null; vendorName: string | null; deviceName: string | null; deviceId: string | null }
type AllocLike = { deviceKey: string | null; mdev: string | null; vmid: string | null; vmName: string | null; vmStatus: string | null; template: boolean; hidden: boolean }

/**
 * The vGPU profiles of each card model and what is left of them (#672): a
 * card's frame buffer is what its largest profile holds; the profiles its
 * VMs are configured with are promised (a stopped VM takes its back at
 * start); what is left, divided by a profile's size, is how many more of it
 * the card can take. Mixed sizes share the frame buffer, so this is the
 * frame buffer's answer, the instance cap of the profile aside.
 */
export function profileCapacity(cards: CardLike[], allocations: AllocLike[], catalog: VisibleVgpuType[]): ProfileModel[] {
  const models = new Map<string, ProfileModel>()
  for (const c of cards) {
    const key = `${c.vendorId ?? '?'}:${c.deviceId ?? '?'}`
    const model = models.get(key) ?? { key, cards: [], vendorId: c.vendorId, vendorName: c.vendorName, deviceName: c.deviceName, unread: [], rows: [] }
    const own = catalog.filter(t => t.deviceKey === c.key)
    if (!own.length) {
      model.unread.push(c.key)
      models.set(key, model)
      continue
    }
    const fbTotal = Math.max(...own.map(t => t.fbMemory))
    const held = allocations.filter(a => a.deviceKey === c.key && a.mdev && !a.template)
    const fbPromised = held.reduce((s, a) => s + (own.find(t => t.typeId === mdevTypeId(a.mdev))?.fbMemory ?? 0), 0)
    model.cards.push({ deviceKey: c.key, node: c.node, connectionName: c.connectionName, fbTotal, fbPromised })
    for (const t of own) {
      let row = model.rows.find(r => r.typeId === t.typeId)
      if (!row) {
        row = { typeId: t.typeId, name: t.name, fbMemory: t.fbMemory, maxInstances: t.maxInstances, holders: [], perCard: [] }
        model.rows.push(row)
      }
      for (const a of held) {
        if (mdevTypeId(a.mdev) === t.typeId && a.vmid && !a.hidden) row.holders.push({ vmid: a.vmid, vmName: a.vmName, running: a.vmStatus === 'running', deviceKey: c.key })
      }
      const fit = t.fbMemory > 0 ? Math.floor(Math.max(0, fbTotal - fbPromised) / t.fbMemory) : 0
      row.perCard.push({ deviceKey: c.key, node: c.node, free: Math.min(fit, t.maxInstances) })
    }
    models.set(key, model)
  }
  for (const m of models.values()) m.rows.sort((a, b) => (parseProfile(a.name)?.series ?? '').localeCompare(parseProfile(b.name)?.series ?? '') || a.fbMemory - b.fbMemory)
  return [...models.values()]
}
