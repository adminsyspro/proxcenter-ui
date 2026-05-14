'use client'

import { widgetColors } from '@/components/dashboard/widgets/themeColors'
import { formatTime } from '@/components/dashboard/widgets/timeRangeUtils'

function formatRate(bytes: number | undefined | null): string {
  if (bytes == null) return '-'
  if (bytes < 1024) return `${Math.round(bytes)} B/s`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`

return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB/s`
}

interface TooltipProps {
  active?: boolean
  payload?: any[]
  isDark: boolean
}

export function CpuRamTooltip({ active, payload, isDark }: TooltipProps) {
  if (!active || !payload?.length) return null
  const cpu = payload.find(p => p.dataKey === 'cpu')?.value
  const ram = payload.find(p => p.dataKey === 'ram')?.value
  const time = formatTime(payload)
  const c = widgetColors(isDark)

  return (
    <div style={{ background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 6, overflow: 'hidden', fontSize: 10, minWidth: 80, color: c.tooltipText }}>
      <div style={{ background: '#f97316', color: '#fff', padding: '2px 8px', fontWeight: 700, fontSize: 9, display: 'flex', alignItems: 'center', gap: 4 }}>
        <i className="ri-cpu-line" style={{ fontSize: 10 }} /> CPU / RAM
        {time && <span style={{ fontWeight: 400, opacity: 0.8, marginLeft: 'auto' }}>{time}</span>}
      </div>
      <div style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {cpu != null && <div><span style={{ color: '#f97316', fontWeight: 700 }}>CPU</span> {cpu}%</div>}
        {ram != null && <div><span style={{ color: '#3b82f6', fontWeight: 700 }}>RAM</span> {ram}%</div>}
      </div>
    </div>
  )
}

export function IoNetTooltip({ active, payload, isDark }: TooltipProps) {
  if (!active || !payload?.length) return null
  const netin = payload.find(p => p.dataKey === 'netin')?.value
  const netout = payload.find(p => p.dataKey === 'netout')?.value
  const time = formatTime(payload)
  const c = widgetColors(isDark)

  return (
    <div style={{ background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 6, overflow: 'hidden', fontSize: 10, minWidth: 80, color: c.tooltipText }}>
      <div style={{ background: '#ab47bc', color: '#fff', padding: '2px 8px', fontWeight: 700, fontSize: 9, display: 'flex', alignItems: 'center', gap: 4 }}>
        <i className="ri-exchange-line" style={{ fontSize: 10 }} /> IO / NET
        {time && <span style={{ fontWeight: 400, opacity: 0.8, marginLeft: 'auto' }}>{time}</span>}
      </div>
      <div style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {netin != null && <div><span style={{ color: '#4caf50', fontWeight: 700 }}>Net In</span> {formatRate(netin)}</div>}
        {netout != null && <div><span style={{ color: '#f97316', fontWeight: 700 }}>Net Out</span> {formatRate(netout)}</div>}
      </div>
    </div>
  )
}
