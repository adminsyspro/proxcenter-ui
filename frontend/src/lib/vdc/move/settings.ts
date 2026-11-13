// Provider settings of the moves between vDCs (#1335), stored under one key of
// the settings table (tenant `default`, like the other provider settings) and
// edited in the vDC settings tab. They bound the load a tenant can put on the
// clusters: each move copies every disk of the guest across clusters.

import { z } from 'zod'

import { getSetting, setSetting } from '@/lib/db/settings'

export const VDC_MOVE_SETTING_KEY = 'vdc.moves'

const PROVIDER_TENANT = 'default'

export const vdcMoveSettingsSchema = z.object({
  // Tenants may start moves themselves. Off, only the provider moves guests.
  tenantSelfService: z.boolean().default(true),
  // Moves of one tenant copying at the same time.
  maxConcurrentPerTenant: z.number().int().min(1).max(10).default(1),
  // Bandwidth cap of the copy in MiB/s, 0 = the cluster's own migration limit.
  bwlimitMiBps: z.number().int().min(0).max(100_000).default(0),
})

export type VdcMoveSettings = z.infer<typeof vdcMoveSettingsSchema>

export const DEFAULT_VDC_MOVE_SETTINGS: VdcMoveSettings = vdcMoveSettingsSchema.parse({})

/** Parse whatever the settings row holds; a corrupt row yields the defaults, never a throw. */
export function parseVdcMoveSettings(raw: unknown): VdcMoveSettings {
  const parsed = vdcMoveSettingsSchema.safeParse(raw ?? {})

  return parsed.success ? parsed.data : { ...DEFAULT_VDC_MOVE_SETTINGS }
}

export async function loadVdcMoveSettings(): Promise<VdcMoveSettings> {
  return parseVdcMoveSettings(await getSetting(VDC_MOVE_SETTING_KEY, PROVIDER_TENANT))
}

export async function saveVdcMoveSettings(settings: VdcMoveSettings): Promise<VdcMoveSettings> {
  const value = vdcMoveSettingsSchema.parse(settings)

  await setSetting(VDC_MOVE_SETTING_KEY, PROVIDER_TENANT, value)

  return value
}

/** PVE's remote_migrate `bwlimit` is in KiB/s; undefined leaves the cluster default. */
export function bwlimitKiBps(settings: VdcMoveSettings): number | undefined {
  return settings.bwlimitMiBps > 0 ? settings.bwlimitMiBps * 1024 : undefined
}
