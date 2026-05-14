// Green IT / RSE metrics — reusable computations
//
// Original cluster-scoped formula lives in `/api/v1/resources/overview`.
// This file factors out the configuration loading + a per-VM aggregation
// suited for tenant-scoped views (where the caller doesn't own the nodes
// and only contributes power proportionally to their VMs' vCPU / RAM /
// runtime utilisation).

import { getSetting } from '@/lib/db/settings'
import { getCurrentTenantId, DEFAULT_TENANT_ID } from '@/lib/tenant'

export interface GreenConfig {
  tdpPerCore: number
  wattsPerGbRam: number
  pue: number
  co2Factor: number
  electricityPrice: number
  currency: string
  equivalences: {
    kmVoiture: number
    arbreParAn: number
    chargeSmartphone: number
  }
}

const DEFAULT_GREEN_CONFIG: GreenConfig = {
  tdpPerCore: 10,
  wattsPerGbRam: 0.375,
  pue: 1.4,
  co2Factor: 0.052, // France
  electricityPrice: 0.18,
  currency: 'EUR',
  equivalences: {
    kmVoiture: 0.193,
    arbreParAn: 25,
    chargeSmartphone: 0.0085,
  },
}

/**
 * Loads green-IT settings for the requested tenant id. Returns `null` if
 * no settings row exists, so the caller can surface a "configure green-IT"
 * empty state instead of fabricating numbers from defaults.
 *
 * In MSP deployments, tenants don't configure their own green parameters
 * (PUE, electricity price, CO₂ factor are datacentre-level concerns owned
 * by the provider). For the tenant cockpit, pass `DEFAULT_TENANT_ID` so
 * the provider's configuration applies to every vDC.
 */
export async function loadGreenSettingsForTenant(tenantId: string): Promise<GreenConfig | null> {
  try {
    const parsed = await getSetting<any>('green', tenantId)

    if (!parsed) return null

return {
      tdpPerCore: parsed.serverSpecs?.tdpPerCore ?? DEFAULT_GREEN_CONFIG.tdpPerCore,
      wattsPerGbRam: parsed.serverSpecs?.wattsPerGbRam ?? DEFAULT_GREEN_CONFIG.wattsPerGbRam,
      pue: parsed.pue ?? DEFAULT_GREEN_CONFIG.pue,
      co2Factor: parsed.co2Factor ?? DEFAULT_GREEN_CONFIG.co2Factor,
      electricityPrice: parsed.electricityPrice ?? DEFAULT_GREEN_CONFIG.electricityPrice,
      currency: parsed.currency ?? DEFAULT_GREEN_CONFIG.currency,
      equivalences: DEFAULT_GREEN_CONFIG.equivalences,
    }
  } catch {
    return null
  }
}

export async function loadGreenSettingsForCurrentTenant(): Promise<GreenConfig | null> {
  return loadGreenSettingsForTenant(await getCurrentTenantId())
}

export async function loadGreenSettingsForProvider(): Promise<GreenConfig | null> {
  return loadGreenSettingsForTenant(DEFAULT_TENANT_ID)
}

export interface GreenMetrics {
  power: { current: number; max: number; monthly: number; yearly: number }
  co2: {
    hourly: number; daily: number; monthly: number; yearly: number
    factor: number
    equivalentKmCar: number
    equivalentTrees: number
  }
  cost: {
    hourly: number; daily: number; monthly: number; yearly: number
    pricePerKwh: number
    currency: string
  }
  efficiency: { pue: number; vmPerKw: number; score: number }
}

export interface VmGreenInput {

  /** vCPU count provisioned to the VM. */
  vcpus: number

  /** RAM provisioned to the VM (bytes). */
  ramBytes: number

  /** PVE returns 'running', 'stopped', etc. */
  status: string

  /** Current CPU usage as a fraction 0..1 (PVE's `cpu` field). */
  cpuPct: number

  /**
   * Optional per-VM config override. When set, this VM's contribution to
   * power / CO₂ / cost uses these values instead of the function-level
   * fallback. Allows multi-DC aggregation: each VM running on a node in
   * DC-A pulls from DC-A's PUE/CO₂/electricity, and the result aggregates
   * a heterogeneous fleet correctly.
   */
  config?: GreenConfig
}

/**
 * Aggregates per-VM contributions and returns the GreenMetrics shape the
 * existing GreenMetricsCard already consumes. Skips per-node overhead since
 * a tenant doesn't own hardware — only their VMs' CPU + RAM × runtime
 * utilisation, lifted by the datacentre PUE, count toward the bill.
 *
 * When VMs carry their own `config`, each one is computed against its own
 * datacentre parameters and figures aggregate naturally. The output's PUE
 * / CO₂ factor / electricity price are reported as kWh-weighted averages
 * for display, since "average" is the only honest single-number summary
 * across a multi-DC fleet.
 */
export function computeGreenMetricsForVms(vms: VmGreenInput[], fallback: GreenConfig): GreenMetrics {
  let totalWatts = 0          // already PUE-lifted, sum across VMs
  let maxWatts = 0
  let pueWeightedSum = 0      // for displayed weighted PUE
  let pueWeight = 0
  let yearlyCo2 = 0
  let yearlyCost = 0
  let yearlyKwhTotal = 0
  let co2FactorWeightedSum = 0
  let priceWeightedSum = 0
  let primaryCurrency = fallback.currency
  let runningVms = 0
  let totalCpuPctSum = 0
  let runningCpuVms = 0

  for (const vm of vms) {
    const cfg = vm.config ?? fallback
    const ramGb = vm.ramBytes / (1024 * 1024 * 1024)
    const ramW = cfg.wattsPerGbRam * ramGb

    let cpuW = 0
    let maxCpuW = 0

    if (vm.status === 'running') {
      runningVms++
      totalCpuPctSum += vm.cpuPct
      runningCpuVms++
      cpuW = cfg.tdpPerCore * vm.vcpus * Math.max(0, Math.min(1, vm.cpuPct))
      maxCpuW = cfg.tdpPerCore * vm.vcpus
    } else {
      maxCpuW = cfg.tdpPerCore * vm.vcpus
    }

    const vmItWatts = cpuW + ramW
    const vmTotalWatts = vmItWatts * cfg.pue
    const vmMaxWatts = (maxCpuW + ramW) * cfg.pue
    const vmYearlyKwh = (vmTotalWatts * 24 * 365) / 1000

    totalWatts += vmTotalWatts
    maxWatts += vmMaxWatts
    yearlyKwhTotal += vmYearlyKwh
    yearlyCo2 += vmYearlyKwh * cfg.co2Factor
    yearlyCost += vmYearlyKwh * cfg.electricityPrice

    pueWeightedSum += cfg.pue * vmTotalWatts
    pueWeight += vmTotalWatts
    co2FactorWeightedSum += cfg.co2Factor * vmYearlyKwh
    priceWeightedSum += cfg.electricityPrice * vmYearlyKwh
  }

  const monthlyKwh = (totalWatts * 24 * 30) / 1000
  const yearlyKwh = yearlyKwhTotal
  const monthlyCo2 = (monthlyKwh / Math.max(1, yearlyKwhTotal)) * yearlyCo2
  const dailyCo2 = (totalWatts * 24 / 1000) * (yearlyCo2 / Math.max(1, yearlyKwhTotal))
  const hourlyCo2 = (totalWatts / 1000) * (yearlyCo2 / Math.max(1, yearlyKwhTotal))
  const monthlyCost = (monthlyKwh / Math.max(1, yearlyKwhTotal)) * yearlyCost
  const dailyCost = (totalWatts * 24 / 1000) * (yearlyCost / Math.max(1, yearlyKwhTotal))
  const hourlyCost = (totalWatts / 1000) * (yearlyCost / Math.max(1, yearlyKwhTotal))

  const weightedPue = pueWeight > 0 ? pueWeightedSum / pueWeight : fallback.pue
  const weightedCo2Factor = yearlyKwhTotal > 0 ? co2FactorWeightedSum / yearlyKwhTotal : fallback.co2Factor
  const weightedPrice = yearlyKwhTotal > 0 ? priceWeightedSum / yearlyKwhTotal : fallback.electricityPrice

  const equivalentKmCar = Math.round(yearlyCo2 / fallback.equivalences.kmVoiture)
  const equivalentTrees = Math.round((yearlyCo2 / fallback.equivalences.arbreParAn) * 10) / 10

  const avgCpuPct = runningCpuVms > 0 ? (totalCpuPctSum / runningCpuVms) * 100 : 0
  const totalVms = vms.length
  const stoppedRatio = totalVms > 0 ? (totalVms - runningVms) / totalVms : 0

  // Score green: tenant-friendly variant — CPU utilisation, idle ratio,
  // weighted-average PUE across the fleet (single-DC fleets reduce to the
  // legacy formula).
  let score = 100

  if (avgCpuPct < 10) score -= 20
  else if (avgCpuPct < 20) score -= 10
  else if (avgCpuPct < 30) score -= 5
  if (stoppedRatio > 0.5) score -= 15
  else if (stoppedRatio > 0.3) score -= 10
  else if (stoppedRatio > 0.2) score -= 5
  if (weightedPue > 1.8) score -= 15
  else if (weightedPue > 1.5) score -= 10
  else if (weightedPue > 1.3) score -= 5
  else if (weightedPue <= 1.2) score += 5
  score = Math.max(0, Math.min(100, score))

  const kwUsed = totalWatts / 1000
  const vmPerKw = kwUsed > 0 ? Math.round((runningVms / kwUsed) * 10) / 10 : 0


  // Currency is reported as the fallback's; mixing currencies across DCs in
  // the same display would be a UX smell to address separately.
  void primaryCurrency

  return {
    power: {
      current: Math.round(totalWatts),
      max: Math.round(maxWatts),
      monthly: Math.round(monthlyKwh),
      yearly: Math.round(yearlyKwh),
    },
    co2: {
      hourly: Math.round(hourlyCo2 * 1000) / 1000,
      daily: Math.round(dailyCo2 * 100) / 100,
      monthly: Math.round(monthlyCo2 * 10) / 10,
      yearly: Math.round(yearlyCo2),
      factor: Math.round(weightedCo2Factor * 1000) / 1000,
      equivalentKmCar,
      equivalentTrees,
    },
    cost: {
      hourly: Math.round(hourlyCost * 100) / 100,
      daily: Math.round(dailyCost * 100) / 100,
      monthly: Math.round(monthlyCost),
      yearly: Math.round(yearlyCost),
      pricePerKwh: Math.round(weightedPrice * 1000) / 1000,
      currency: fallback.currency,
    },
    efficiency: {
      pue: Math.round(weightedPue * 100) / 100,
      vmPerKw,
      score,
    },
  }
}
