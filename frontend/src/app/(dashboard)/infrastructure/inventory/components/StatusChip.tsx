import React from 'react'
import { Chip } from '@mui/material'
import type { Status } from '../types'

function StatusChip({ status }: { status: Status }) {
  const map: Record<Status, { label: string; color: any }> = {
    ok: { label: 'OK', color: 'success' },
    warn: { label: 'WARN', color: 'warning' },
    crit: { label: 'CRIT', color: 'error' },
    unknown: { label: 'UNKNOWN', color: 'default' },
  }

  
return <Chip size="small" label={map[status].label} color={map[status].color} variant="outlined" />
}


export default StatusChip
