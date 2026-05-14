import React from 'react'

import type { Status } from '../types'

function StatusChip({ status }: { status: Status }) {
  const map: Record<Status, { icon: string; color: string }> = {
    ok: { icon: 'ri-checkbox-circle-fill', color: '#4caf50' },
    warn: { icon: 'ri-error-warning-fill', color: '#ff9800' },
    crit: { icon: 'ri-close-circle-fill', color: '#f44336' },
    unknown: { icon: 'ri-question-line', color: '#9e9e9e' },
  }

  const { icon, color } = map[status] || map.unknown

  return <i className={icon} style={{ fontSize: 18, color, flexShrink: 0 }} />
}


export default StatusChip
