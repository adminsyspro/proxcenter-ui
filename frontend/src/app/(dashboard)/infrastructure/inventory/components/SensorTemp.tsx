'use client'

import React from 'react'

import { Typography } from '@mui/material'

import type { NodeSensors, SensorRole } from '@/lib/sensors/hwmon'
import { sensorSeverity } from '@/lib/sensors/hwmon'

const SEVERITY_COLOR = { ok: 'text.primary', warn: 'warning.main', crit: 'error.main' } as const

export function formatCelsius(value: number) {
  return `${value.toFixed(1)} °C`
}

/**
 * One temperature, shown next to whatever it measures: the CPU reading beside
 * CPU usage, the memory reading beside RAM usage, and so on. The bar it sits on
 * already carries the icon and the label for that domain, so the reading is
 * just the figure. When a role covers several sensors (one per DIMM, one per
 * NVMe namespace) the hottest is the one worth surfacing.
 *
 * Renders nothing when the host reports no sensor for that role, so a
 * virtualized node or a connection without SSH shows the usage bars unchanged.
 */
export function SensorTemp({
  sensors,
  role,
}: {
  sensors: NodeSensors | null | undefined
  role: SensorRole
}) {
  const entry = sensors?.byRole.find(candidate => candidate.role === role)

  if (!entry) return null

  return (
    <Typography
      variant="caption"
      sx={{ fontWeight: 700, color: SEVERITY_COLOR[sensorSeverity(entry.role, entry.max)] }}
    >
      {formatCelsius(entry.max)}
    </Typography>
  )
}
