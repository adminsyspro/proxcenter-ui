/**
 * CD/DVD media for the console toolbars (#1309).
 *
 * The noVNC and SPICE pages are static HTML: they reach this through the
 * ConsoleUI bundle (bundle-console.js). Every request goes to the routes the
 * Hardware tab already uses, so RBAC (vm.config.media), the tenant drive guard
 * and the digest check stay where they are. Nothing here polls: the menu reads
 * when it opens and writes once per change.
 */
import { isOpticalDrive, replaceCdromMedia } from '../proxmox/cdrom'

export type GuestRef = { connId: string; type: string; node: string; vmid: string }

export type MediaKind = 'iso' | 'empty' | 'physical'

export type ConsoleOpticalDrive = {
  /** Config key, e.g. "ide2". */
  slot: string
  /** Raw PVE drive string, kept to rebuild it with the same options. */
  raw: string
  kind: MediaKind
  /** Mounted volume ("local:iso/debian.iso"), null when empty or physical. */
  volid: string | null
}

export type IsoImage = { volid: string; name: string }

export type IsoStorage = { storage: string; images: IsoImage[] }

export type ConsoleMediaState = {
  node: string
  digest: string | undefined
  drives: ConsoleOpticalDrive[]
  storages: IsoStorage[]
}

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<any>
}>

export const EMPTY_MEDIA = 'none'

/** A refused media change; 409 means the config moved since the menu read it. */
export class MediaChangeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'MediaChangeError'
  }
}

const SLOT_RE = /^(ide|sata|scsi)(\d+)$/
const BUS_ORDER = ['ide', 'sata', 'scsi']

function slotRank(slot: string): [number, number] {
  const m = SLOT_RE.exec(slot)

  return m ? [BUS_ORDER.indexOf(m[1]), Number(m[2])] : [BUS_ORDER.length, 0]
}

/** "ide2" -> "IDE 2", the way the Hardware tab names the slot. */
export function slotLabel(slot: string): string {
  const m = SLOT_RE.exec(slot)

  return m ? `${m[1].toUpperCase()} ${m[2]}` : slot
}

/** "local:iso/sub/debian.iso" -> "sub/debian.iso". */
export function isoFileName(volid: string): string {
  const idx = volid.indexOf(':iso/')

  return idx < 0 ? volid : volid.slice(idx + 5)
}

/** Every optical drive of a QEMU config, IDE first then SATA then SCSI. */
export function listOpticalDrives(config: Record<string, unknown> | null | undefined): ConsoleOpticalDrive[] {
  if (!config) return []

  const drives: ConsoleOpticalDrive[] = []

  for (const [slot, value] of Object.entries(config)) {
    if (!SLOT_RE.test(slot) || !isOpticalDrive(value)) continue
    const raw = value as string
    const head = raw.split(',')[0]

    if (head === 'cdrom') drives.push({ slot, raw, kind: 'physical', volid: null })
    else if (head === EMPTY_MEDIA) drives.push({ slot, raw, kind: 'empty', volid: null })
    else drives.push({ slot, raw, kind: 'iso', volid: head })
  }

  return drives.sort((a, b) => {
    const [ba, na] = slotRank(a.slot)
    const [bb, nb] = slotRank(b.slot)

    return ba - bb || na - nb
  })
}

/**
 * The PUT body that swaps the medium of one drive and nothing else. The digest
 * makes PVE refuse the write if the config moved since the menu read it.
 */
export function mediaChangeBody(drive: ConsoleOpticalDrive, volume: string, digest?: string): Record<string, string> {
  const body: Record<string, string> = { [drive.slot]: replaceCdromMedia(drive.raw, volume) }

  if (digest) body.digest = digest

  return body
}

export function guestApiBase(ref: GuestRef, node: string = ref.node): string {
  const e = encodeURIComponent

  return `/api/v1/connections/${e(ref.connId)}/guests/${e(ref.type)}/${e(node)}/${e(ref.vmid)}`
}

async function readError(res: { status: number; json: () => Promise<any> }): Promise<string> {
  try {
    const json = await res.json()

    if (json && typeof json.error === 'string' && json.error) return json.error
  } catch {
    // Not JSON: fall back to the status.
  }

  return `HTTP ${res.status}`
}

async function listIsoImages(fetchFn: FetchLike, ref: GuestRef, node: string, storage: string): Promise<IsoImage[]> {
  const e = encodeURIComponent
  const res = await fetchFn(`/api/v1/connections/${e(ref.connId)}/nodes/${e(node)}/storage/${e(storage)}/content?content=iso`)

  if (!res.ok) return []
  const json = await res.json()
  const rows: unknown[] = Array.isArray(json?.data) ? json.data : []

  return rows
    .map(row => (row as { volid?: unknown })?.volid)
    .filter((volid): volid is string => typeof volid === 'string' && volid.includes(':iso/'))
    .map(volid => ({ volid, name: isoFileName(volid) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Optical drives of the guest plus the ISO images it may mount. A storage that
 * fails to list is left out rather than failing the whole menu.
 */
export async function loadConsoleMedia(fetchFn: FetchLike, ref: GuestRef): Promise<ConsoleMediaState> {
  const configRes = await fetchFn(`${guestApiBase(ref)}/config`)

  if (!configRes.ok) throw new Error(await readError(configRes))
  const configJson = await configRes.json()
  const config = configJson?.data ?? {}
  const node = typeof configJson?.movedTo === 'string' && configJson.movedTo ? configJson.movedTo : ref.node
  const drives = listOpticalDrives(config)
  const digest = typeof config.digest === 'string' ? config.digest : undefined

  if (drives.length === 0) return { node, digest, drives, storages: [] }

  const e = encodeURIComponent
  const storagesRes = await fetchFn(`/api/v1/connections/${e(ref.connId)}/nodes/${e(node)}/storages?content=iso`)
  const storagesJson = storagesRes.ok ? await storagesRes.json() : null
  const names: string[] = (Array.isArray(storagesJson?.data) ? storagesJson.data : [])
    .filter((s: any) => typeof s?.storage === 'string' && String(s.content ?? '').split(',').includes('iso'))
    .map((s: any) => s.storage as string)
  const unique = [...new Set(names)].sort((a, b) => a.localeCompare(b))
  const storages = await Promise.all(unique.map(async storage => ({
    storage,
    images: await listIsoImages(fetchFn, ref, node, storage).catch((): IsoImage[] => []),
  })))

  return { node, digest, drives, storages }
}

/** Mount `volume` (a volid, or EMPTY_MEDIA to eject) in `drive`. */
export async function applyConsoleMedia(
  fetchFn: FetchLike,
  ref: GuestRef,
  state: Pick<ConsoleMediaState, 'node' | 'digest'>,
  drive: ConsoleOpticalDrive,
  volume: string,
): Promise<void> {
  const res = await fetchFn(`${guestApiBase(ref, state.node)}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mediaChangeBody(drive, volume, state.digest)),
  })

  if (!res.ok) throw new MediaChangeError(await readError(res), res.status)
}

/**
 * The select's option groups for one drive. The mounted ISO always appears,
 * even when its storage is not listed for this user, so the select can show it.
 */
export function mediaOptionGroups(drive: ConsoleOpticalDrive, storages: IsoStorage[]): IsoStorage[] {
  const groups = storages.map(s => ({ storage: s.storage, images: [...s.images] }))
  const volid = drive.volid

  if (!volid || groups.some(g => g.images.some(i => i.volid === volid))) return groups

  const storage = volid.slice(0, volid.indexOf(':'))
  const image = { volid, name: isoFileName(volid) }
  const group = groups.find(g => g.storage === storage)

  if (group) group.images.unshift(image)
  else groups.unshift({ storage, images: [image] })

  return groups
}
