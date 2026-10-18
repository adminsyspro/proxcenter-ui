// Provider-level settings of the vDC usage history (#902), stored under one key
// of the settings table (tenant `default`, like the other provider settings).
// Read by the sampler on every tick, so a change made in the vDC settings tab
// takes effect within a minute, without a restart.

import { z } from 'zod'

import { getSetting, setSetting } from '@/lib/db/settings'

export const VDC_USAGE_HISTORY_SETTING_KEY = 'vdc.usageHistory'

const PROVIDER_TENANT = 'default'

export const vdcUsageHistorySettingsSchema = z.object({
  enabled: z.boolean().default(true),
  // Minutes between two samples of the same vDC. One minute is the floor: the
  // sampler wakes up once a minute, and each sample costs a few PVE calls per
  // guest of the vDC.
  intervalMinutes: z.number().int().min(1).max(1440).default(15),
  // 400 days keeps a full year plus the month being invoiced.
  retentionDays: z.number().int().min(1).max(3650).default(400),
})

export type VdcUsageHistorySettings = z.infer<typeof vdcUsageHistorySettingsSchema>

export const DEFAULT_VDC_USAGE_HISTORY_SETTINGS: VdcUsageHistorySettings = vdcUsageHistorySettingsSchema.parse({})

/** Parse whatever the settings row holds; a corrupt row yields the defaults, never a throw. */
export function parseVdcUsageHistorySettings(raw: unknown): VdcUsageHistorySettings {
  const parsed = vdcUsageHistorySettingsSchema.safeParse(raw ?? {})

  return parsed.success ? parsed.data : { ...DEFAULT_VDC_USAGE_HISTORY_SETTINGS }
}

export async function loadVdcUsageHistorySettings(): Promise<VdcUsageHistorySettings> {
  return parseVdcUsageHistorySettings(await getSetting(VDC_USAGE_HISTORY_SETTING_KEY, PROVIDER_TENANT))
}

export async function saveVdcUsageHistorySettings(settings: VdcUsageHistorySettings): Promise<VdcUsageHistorySettings> {
  const value = vdcUsageHistorySettingsSchema.parse(settings)

  await setSetting(VDC_USAGE_HISTORY_SETTING_KEY, PROVIDER_TENANT, value)

  return value
}
