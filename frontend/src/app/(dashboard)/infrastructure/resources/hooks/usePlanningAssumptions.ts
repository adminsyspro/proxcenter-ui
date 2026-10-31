'use client'

import { useCallback, useEffect, useState } from 'react'

import { DEFAULT_ASSUMPTIONS, type PlanningAssumptions } from '../algorithms/capacityPlanning'

export const PLANNING_ASSUMPTIONS_STORAGE_KEY = 'proxcenter_resources_planning'

const positive = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max

export function parseAssumptions(raw: string | null): PlanningAssumptions | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)

    if (positive(parsed?.template?.vcpu, 512) && positive(parsed?.template?.ramGiB, 8192) && positive(parsed?.maxVcpuRatio, 64)) {
      return { template: { vcpu: parsed.template.vcpu, ramGiB: parsed.template.ramGiB }, maxVcpuRatio: parsed.maxVcpuRatio }
    }
  } catch {
    // unreadable value: fall back to the defaults
  }

  return null
}

// The VM size and accepted vCPU ratio are a planner's preference, so they live in
// the browser; blocked storage keeps the defaults for the visit.
export function usePlanningAssumptions(): [PlanningAssumptions, (next: PlanningAssumptions) => void] {
  const [assumptions, setAssumptions] = useState<PlanningAssumptions>(DEFAULT_ASSUMPTIONS)

  useEffect(() => {
    try {
      const saved = parseAssumptions(localStorage.getItem(PLANNING_ASSUMPTIONS_STORAGE_KEY))

      if (saved) setAssumptions(saved)
    } catch {
      // storage unavailable
    }
  }, [])

  const update = useCallback((next: PlanningAssumptions) => {
    setAssumptions(next)
    try {
      localStorage.setItem(PLANNING_ASSUMPTIONS_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // storage unavailable: the choice lasts for this visit only
    }
  }, [])

  return [assumptions, update]
}
