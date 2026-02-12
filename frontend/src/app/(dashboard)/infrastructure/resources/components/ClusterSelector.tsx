'use client'

import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import type { ConnectionInfo } from '../types'

export default function ClusterSelector({ connections, value, onChange }: {
  connections: ConnectionInfo[]
  value: string
  onChange: (connectionId: string) => void
}) {
  const t = useTranslations()

  if (connections.length <= 1) return null

  return (
    <FormControl size="small" sx={{ minWidth: 200 }}>
      <InputLabel>{t('resources.cluster')}</InputLabel>
      <Select
        value={value}
        label={t('resources.cluster')}
        onChange={(e) => onChange(e.target.value)}
        sx={{ borderRadius: 2 }}
      >
        <MenuItem value="">{t('resources.allClusters')}</MenuItem>
        {connections.map(conn => (
          <MenuItem key={conn.id} value={conn.id}>{conn.name}</MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}
