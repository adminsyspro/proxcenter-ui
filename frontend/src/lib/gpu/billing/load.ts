// Server side of the GPU chargeback routes: the usage rows of a month and the
// report built from them with the current prices.
import { prisma } from '@/lib/db/prisma'

import { buildBillingReport, monthRange, type BillingReport } from './report'
import { loadGpuBillingSettings } from './settings'

export async function loadBillingReport(month: string): Promise<BillingReport | null> {
  const range = monthRange(month)
  if (!range) return null
  const [rows, settings] = await Promise.all([
    prisma.gpuUsageHour.findMany({
      where: { hour: { gte: range.from, lt: range.to } },
      select: {
        hour: true, connectionId: true, connectionName: true, node: true, vmid: true, vmName: true, modelKey: true, modelName: true,
        pool: true, vdcId: true, vdcName: true, tenantId: true, tenantName: true, runningSeconds: true, reservedSeconds: true,
      },
    }),
    loadGpuBillingSettings(),
  ])
  return buildBillingReport(rows, settings.prices, { ...range, currency: settings.currency })
}

/** The current month, YYYY-MM in UTC. */
export const currentMonth = (now = new Date()) => now.toISOString().slice(0, 7)
