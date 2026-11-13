'use client'

import type { ReactNode } from 'react'

import { Alert, Tooltip, Typography } from '@mui/material'

import type { MyGpuEntry } from '@/lib/gpu/vdcView'

type Translate = (key: string, values?: Record<string, string | number>) => string

export const MIB_PER_GIB = 1024

// Codes the tenant routes answer with; anything else reads as the generic one.
const ERROR_CODES = new Set([
  'not_found', 'vm_not_found', 'entry_not_found', 'quota_exhausted', 'no_free_slot', 'no_room_here',
  'contact_provider', 'pve_refused', 'invalid_body', 'feature_required', 'unavailable', 'gpu_check_unavailable',
])

/** The tenant-facing sentence for an error code, never the upstream text. */
export function gpuErrorMessage(t: Translate, code: unknown, extra?: { used?: unknown; count?: unknown }): string {
  const key = typeof code === 'string' && ERROR_CODES.has(code) ? code : 'generic'
  return t(`myVdc.gpu.errors.${key}`, { used: Number(extra?.used ?? 0), count: Number(extra?.count ?? 0) })
}

/** "vGPU <profile> · used / count" or "Whole card <model> · used / count". */
export function entryLabel(t: Translate, e: Pick<MyGpuEntry, 'kind' | 'modelName' | 'profileName' | 'used' | 'count'>): string {
  return e.kind === 'vgpu'
    ? t('myVdc.gpu.entryVgpu', { profile: e.profileName, used: e.used, count: e.count })
    : t('myVdc.gpu.entryWhole', { model: e.modelName, used: e.used, count: e.count })
}

/** What a GPU of a VM is, without the counters. */
export function gpuKindLabel(t: Translate, g: { kind: string; modelName: string; profileName: string | null }): string {
  return g.kind === 'vgpu' && g.profileName
    ? t('myVdc.gpu.profileVgpu', { profile: g.profileName })
    : t('myVdc.gpu.profileWhole', { model: g.modelName })
}

/** One line that never wraps: the full text is in the tooltip when it is cut. */
export function OneLine({ children, color, variant = 'body2', sx }: {
  children: string
  color?: string
  variant?: 'body2' | 'caption'
  sx?: object
}) {
  return (
    <Tooltip title={children} placement="top-start">
      <Typography variant={variant} color={color} noWrap sx={{ minWidth: 0, ...sx }}>{children}</Typography>
    </Tooltip>
  )
}

/** An alert whose message stays on one line (ellipsis and tooltip). */
export function OneLineAlert({ severity, children }: { severity: 'warning' | 'error' | 'info'; children: string }): ReactNode {
  return (
    <Alert severity={severity} sx={{ '& .MuiAlert-message': { minWidth: 0, overflow: 'hidden' } }}>
      <OneLine>{children}</OneLine>
    </Alert>
  )
}
