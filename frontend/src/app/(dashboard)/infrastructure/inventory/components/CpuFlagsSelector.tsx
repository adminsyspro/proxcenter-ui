'use client'

import React, { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Box, Chip, Collapse, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'

export type CpuFlags = Record<string, '+' | '-'>

// The "Extra CPU Flags" PVE offers in its CPU editor.
const CPU_FLAGS = [
  { flag: 'nested-virt', desc: 'nestedVirt' },
  { flag: 'md-clear', desc: 'mdClear' },
  { flag: 'pcid', desc: 'pcid' },
  { flag: 'spec-ctrl', desc: 'specCtrl' },
  { flag: 'ssbd', desc: 'ssbd' },
  { flag: 'ibpb', desc: 'ibpb' },
  { flag: 'virt-ssbd', desc: 'virtSsbd' },
  { flag: 'amd-ssbd', desc: 'amdSsbd' },
  { flag: 'amd-no-ssb', desc: 'amdNoSsb' },
  { flag: 'pdpe1gb', desc: 'pdpe1gb' },
  { flag: 'hv-tlbflush', desc: 'hvTlbflush' },
  { flag: 'hv-evmcs', desc: 'hvEvmcs' },
  { flag: 'aes', desc: 'aes' },
] as const

/** PVE `cpu` value for a model plus its flags: `host,flags=+aes;-pcid`. */
export function cpuWithFlags(model: string, flags: CpuFlags): string {
  const active = Object.entries(flags).filter(([, v]) => v === '+' || v === '-')

  return active.length > 0 ? `${model},flags=${active.map(([k, v]) => `${v}${k}`).join(';')}` : model
}

/** Collapsible −/off/+ selector per CPU flag, shared by the CPU editor and the creation wizard. */
export default function CpuFlagsSelector({ flags, onChange, disabled, sx }: {
  flags: CpuFlags
  onChange: (next: CpuFlags) => void
  disabled?: boolean
  sx?: SxProps<Theme>
}) {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  const activeCount = Object.keys(flags).length

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden', ...sx } as SxProps<Theme>}>
      <Box
        onClick={() => setOpen(!open)}
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
      >
        {/* component="div": body2 would render a <p>, and the Chip
            below renders a <div> — invalid nesting, hydration error. */}
        <Typography variant="body2" component="div" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-flag-line" style={{ fontSize: 16 }} />
          {t('inventory.cpuFlags')}
          {activeCount > 0 && (
            <Chip label={activeCount} size="small" color="primary" sx={{ height: 20, fontSize: '0.7rem', ml: 0.5 }} />
          )}
        </Typography>
        <i className={open ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 20, opacity: 0.5 }} />
      </Box>
      <Collapse in={open}>
        <Box sx={{ px: 2, pb: 2, pt: 1, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
          {CPU_FLAGS.map(({ flag, desc }) => {
            const val = flags[flag] || 'default'
            return (
            <Tooltip key={flag} title={t(`inventory.cpuFlagDesc.${desc}`)} placement="top" arrow>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ToggleButtonGroup
                  disabled={disabled}
                  size="small"
                  exclusive
                  value={val}
                  aria-label={flag}
                  onChange={(_, v) => {
                    if (!v) return
                    const next = { ...flags }
                    if (v === 'default') {
                      delete next[flag]
                    } else {
                      next[flag] = v
                    }
                    onChange(next)
                  }}
                  sx={{ height: 28 }}
                >
                  <ToggleButton value="-" sx={{
                    px: 0.8, fontSize: '0.75rem', fontWeight: 700,
                    ...(val === '-' && { bgcolor: 'error.main', color: 'error.contrastText', '&:hover': { bgcolor: 'error.dark' }, '&.Mui-selected': { bgcolor: 'error.main', color: 'error.contrastText', '&:hover': { bgcolor: 'error.dark' } } })
                  }}>−</ToggleButton>
                  <ToggleButton value="default" sx={{ px: 0.8, fontSize: '0.65rem' }}>off</ToggleButton>
                  <ToggleButton value="+" sx={{
                    px: 0.8, fontSize: '0.75rem', fontWeight: 700,
                    ...(val === '+' && { bgcolor: 'success.main', color: 'success.contrastText', '&:hover': { bgcolor: 'success.dark' }, '&.Mui-selected': { bgcolor: 'success.main', color: 'success.contrastText', '&:hover': { bgcolor: 'success.dark' } } })
                  }}>+</ToggleButton>
                </ToggleButtonGroup>
                <Typography variant="caption" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem' }}>
                  {flag}
                </Typography>
              </Box>
            </Tooltip>
            )
          })}
        </Box>
      </Collapse>
    </Box>
  )
}
