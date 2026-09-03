'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Alert, Box, CircularProgress, FormControl, InputLabel, MenuItem, Select, Typography } from '@mui/material'

import { fetchResourceMappings, mappingCoversNode, mappingIssues } from './utils'
import type { MappingKind, ResourceMapping } from './utils'

export type ResourceMappingsState = {
  mappings: ResourceMapping[]
  loading: boolean
  error: string | null
}

// Datacenter resource mappings of `kind` visible to the connection's token,
// checked against `node`. Fetched only while `enabled`; the list is dropped as
// soon as the kind changes or the caller no longer needs it (#852).
export function useResourceMappings(
  connId: string,
  node: string,
  kind: MappingKind | null,
  enabled: boolean,
): ResourceMappingsState {
  const [mappings, setMappings] = useState<ResourceMapping[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setMappings([])
    setError(null)

    if (!enabled || !connId || !node || !kind) {
      setLoading(false)

      return
    }

    let cancelled = false

    setLoading(true)
    fetchResourceMappings(connId, kind, node)
      .then(list => { if (!cancelled) setMappings(list) })
      .catch((e: any) => { if (!cancelled) setError(e?.message || String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [connId, node, kind, enabled])

  return { mappings, loading, error }
}

type ResourceMappingSelectProps = ResourceMappingsState & {
  kind: MappingKind
  node: string
  value: string
  onChange: (mappingId: string) => void
  /** Keep `value` selectable when PVE no longer lists it (deleted mapping, Mapping.Use revoked). */
  keepCurrent?: boolean
}

// Select of the mappings PVE lets the token see. A mapping without an entry
// for `node` is listed but locked, with the description and the node checks
// PVE reported as a caption.
export function ResourceMappingSelect({
  kind, node, value, onChange, mappings, loading, error, keepCurrent = false,
}: ResourceMappingSelectProps) {
  const t = useTranslations()
  const current = keepCurrent && value && !mappings.some(m => m.id === value) ? value : ''

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <CircularProgress size={16} /> {t('hardware.loadingMappings')}
      </Box>
    )
  }

  if (error) {
    return <Alert severity="error" sx={{ fontSize: 13 }}>{t('hardware.mappingsLoadError', { error })}</Alert>
  }

  if (mappings.length === 0 && !current) {
    return <Alert severity="warning" sx={{ fontSize: 13 }}>{t('hardware.noMappings', { kind: kind === 'usb' ? 'USB' : 'PCI' })}</Alert>
  }

  return (
    <FormControl fullWidth size="small">
      <InputLabel>{t('hardware.mapping')}</InputLabel>
      <Select
        value={value}
        onChange={e => onChange(e.target.value as string)}
        label={t('hardware.mapping')}
        renderValue={selected => String(selected)}
      >
        {mappings.map(m => {
          const onNode = mappingCoversNode(m, node)
          const details = [m.description, ...mappingIssues(m)].filter(Boolean).join(' / ')

          return (
            <MenuItem key={m.id} value={m.id} disabled={!onNode}>
              <Box sx={{ opacity: onNode ? 1 : 0.5 }}>
                <Typography variant="body2">
                  {m.id}{!onNode && ` (${t('hardware.mappingNotOnNode', { node })})`}
                </Typography>
                {details && <Typography variant="caption" sx={{ opacity: 0.6 }}>{details}</Typography>}
              </Box>
            </MenuItem>
          )
        })}
        {current && <MenuItem value={current}>{current} ({t('hardware.currentValue')})</MenuItem>}
      </Select>
    </FormControl>
  )
}
