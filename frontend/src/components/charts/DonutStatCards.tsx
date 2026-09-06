'use client'

import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import { Cell, Pie, PieChart } from 'recharts'

import ChartContainer from '@/components/ChartContainer'

// The small donut stat cards of the Operations pages (Events, Changes, Alerts)
// and of the DRS history. One implementation so the four rows read the same;
// the remainder uses the theme's hover tint so it stays visible in light mode.
const REMAINDER_FILL = 'var(--mui-palette-action-hover)'

interface CardBodyProps {
  title: string
  value: number | string
  /** Optional small line under the value, e.g. an average. */
  subtitle?: string
}

const CardBody = ({ title, value, subtitle }: CardBodyProps) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography variant='caption' sx={{ opacity: 0.6 }}>{title}</Typography>
    <Typography variant='h5' sx={{ fontWeight: 700 }}>{value}</Typography>
    {subtitle && (
      <Typography variant='caption' sx={{ opacity: 0.6, display: 'block' }}>{subtitle}</Typography>
    )}
  </Box>
)

const Donut = ({ data }: { data: { value: number; color: string }[] }) => (
  <Box sx={{ width: 52, height: 52, flexShrink: 0 }}>
    <ChartContainer>
      <PieChart>
        <Pie
          data={data}
          dataKey='value'
          cx='50%' cy='50%'
          innerRadius={14} outerRadius={24}
          strokeWidth={0}
          startAngle={90} endAngle={-270}
        >
          {data.map((s, i) => <Cell key={i} fill={s.color} />)}
        </Pie>
      </PieChart>
    </ChartContainer>
  </Box>
)

export interface DonutStatCardProps extends CardBodyProps {
  value: number
  total: number
  color: string
}

/** One value out of a total: a single colored arc over the remainder. */
export function DonutStatCard({ title, value, total, color, subtitle }: DonutStatCardProps) {
  const remainder = Math.max(0, total - value)

  return (
    <Card variant='outlined'>
      <CardContent sx={{ py: 1.5, px: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Donut data={[{ value: value || 0, color }, { value: remainder || 1, color: REMAINDER_FILL }]} />
        <CardBody title={title} value={value} subtitle={subtitle} />
      </CardContent>
    </Card>
  )
}

export interface DonutTotalCardProps extends CardBodyProps {
  segments: { value: number; color: string }[]
}

/** A total split into colored segments; an empty total shows a neutral ring. */
export function DonutTotalCard({ title, value, segments, subtitle }: DonutTotalCardProps) {
  const data = segments.filter(s => s.value > 0)

  if (data.length === 0) data.push({ value: 1, color: REMAINDER_FILL })

  return (
    <Card variant='outlined'>
      <CardContent sx={{ py: 1.5, px: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Donut data={data} />
        <CardBody title={title} value={value} subtitle={subtitle} />
      </CardContent>
    </Card>
  )
}
