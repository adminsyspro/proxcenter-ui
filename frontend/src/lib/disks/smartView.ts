export type SmartAttrRow = {
  id: string | number | null
  name: string
  value: string | number | null
  worst: string | number | null
  threshold: string | number | null
  raw: string | null
  /** True when the normalized value has reached or fallen below the threshold. */
  failing: boolean
}

export type SmartView =
  | { kind: 'attributes'; health: string | null; rows: SmartAttrRow[] }
  | { kind: 'text'; health: string | null; text: string }
  | { kind: 'unavailable' }

/**
 * Decide how to render /nodes/{node}/disks/smart?disk=.
 *
 * The Proxmox schema is `{ attributes?, health, text?, type? }` and
 * `attributes` is OPTIONAL. Measured on a real QEMU disk, PVE returns
 * `{ health: "OK", type: "text", text: "..." }` with no attributes at all, so
 * the text branch is a nominal case rather than a degraded one. The choice is
 * therefore driven by the response shape, never by a guessed device type.
 */
export function buildSmartView(smart: unknown): SmartView {
  if (!smart || typeof smart !== 'object') return { kind: 'unavailable' }

  const s = smart as Record<string, unknown>
  const health = typeof s.health === 'string' ? s.health : null

  if (Array.isArray(s.attributes) && s.attributes.length > 0) {
    const rows: SmartAttrRow[] = s.attributes.map((a: any) => {
      const value = a?.value ?? null
      const threshold = a?.threshold ?? null
      const vNum = Number(value)
      const tNum = Number(threshold)
      const failing = Number.isFinite(vNum) && Number.isFinite(tNum) && tNum > 0 && vNum <= tNum

      return {
        id: a?.id ?? null,
        name: typeof a?.name === 'string' && a.name !== '' ? a.name : String(a?.id ?? ''),
        value,
        worst: a?.worst ?? null,
        threshold,
        raw: a?.raw != null ? String(a.raw) : null,
        failing,
      }
    })

    return { kind: 'attributes', health, rows }
  }

  if (typeof s.text === 'string' && s.text.trim() !== '') {
    return { kind: 'text', health, text: s.text }
  }

  return { kind: 'unavailable' }
}
