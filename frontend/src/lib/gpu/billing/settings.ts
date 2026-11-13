// Provider settings of the GPU chargeback (#672): sampling cadence, retention,
// currency and the hourly price of each GPU model. One key of the settings
// table (tenant `default`), read by the sampler at every pass and by the
// billing report, so a price change applies to the next report at once.
import { z } from 'zod'

import { getSetting, setSetting } from '@/lib/db/settings'

export const GPU_BILLING_SETTING_KEY = 'gpu.billing'
export const GPU_BILLING_LAST_PASS_KEY = 'gpu.billing.lastPass'

const PROVIDER_TENANT = 'default'

const price = z.object({
  /** `${vendorId}:${deviceId}` of the model (lib/gpu/fleet modelKey), or `name:<device name>`. */
  modelKey: z.string().min(1).max(160),
  label: z.string().max(200).default(''),
  /** Per GPU and per hour the VM runs. */
  runningHourly: z.number().min(0).max(100000).default(0),
  /** Per GPU and per hour a stopped VM keeps it (0: reservation is free). */
  reservedHourly: z.number().min(0).max(100000).default(0),
})

export const gpuBillingSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  // Minutes between two passes. Each pass reuses the GPU collection of the
  // page (cached per connection), so a short cadence costs no extra PVE call.
  intervalMinutes: z.number().int().min(1).max(60).default(5),
  // 400 days keeps a full year plus the month being invoiced.
  retentionDays: z.number().int().min(1).max(3650).default(400),
  currency: z.string().regex(/^[A-Z]{3}$/).default('EUR'),
  prices: z.array(price).max(500).default([]),
})

export type GpuBillingSettings = z.infer<typeof gpuBillingSettingsSchema>
export type GpuPrice = z.infer<typeof price>

export const DEFAULT_GPU_BILLING_SETTINGS: GpuBillingSettings = gpuBillingSettingsSchema.parse({})

/** Parse whatever the settings row holds; a corrupt row yields the defaults, never a throw. */
export function parseGpuBillingSettings(raw: unknown): GpuBillingSettings {
  const parsed = gpuBillingSettingsSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : { ...DEFAULT_GPU_BILLING_SETTINGS }
}

export async function loadGpuBillingSettings(): Promise<GpuBillingSettings> {
  return parseGpuBillingSettings(await getSetting(GPU_BILLING_SETTING_KEY, PROVIDER_TENANT))
}

export async function saveGpuBillingSettings(settings: GpuBillingSettings): Promise<GpuBillingSettings> {
  const value = gpuBillingSettingsSchema.parse(settings)
  // One price per model: the last one sent wins.
  value.prices = [...new Map(value.prices.map(p => [p.modelKey, p])).values()]
  await setSetting(GPU_BILLING_SETTING_KEY, PROVIDER_TENANT, value)
  return value
}

/** When the sampler last credited time, read back by the next pass (any process). */
export async function loadLastPass(): Promise<Date | null> {
  const raw = await getSetting(GPU_BILLING_LAST_PASS_KEY, PROVIDER_TENANT)
  const at = typeof raw === 'string' ? new Date(raw) : null
  return at && !Number.isNaN(at.getTime()) ? at : null
}

export async function saveLastPass(at: Date): Promise<void> {
  await setSetting(GPU_BILLING_LAST_PASS_KEY, PROVIDER_TENANT, at.toISOString())
}
